import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

// Same derivation the API uses: on-chain ids are keccak256(utf8 uuid).
const id = (uuid: string) => ethers.keccak256(ethers.toUtf8Bytes(uuid));
const R = (rand: number) => BigInt(Math.round(rand * 100)); // rand → cents

const CP001 = id("00000000-0000-4000-8000-000000000001");
const CP002 = id("00000000-0000-4000-8000-000000000002");

async function deployFactory() {
  const [deployer, outsider] = await ethers.getSigners();
  const dzar = await ethers.deployContract("DemoZAR");
  const factory = await ethers.deployContract("CivicProofFactory", [await dzar.getAddress()]);
  return { dzar, factory, deployer, outsider };
}

async function deployWithCP001() {
  const base = await deployFactory();
  await base.factory.createProject(CP001, R(2_000_000));
  const wallet = await ethers.getContractAt("ProjectWallet", await base.factory.getWallet(CP001));
  return { ...base, wallet };
}

/** Mint and approve so the deployer can fund `wallet`. */
async function mintAndApprove(dzar: any, deployer: any, wallet: any, cents: bigint) {
  await dzar.mint(deployer.address, cents);
  await dzar.approve(await wallet.getAddress(), cents);
}

describe("CivicProofFactory", () => {
  it("creates a separate wallet contract per project", async () => {
    const { factory } = await loadFixture(deployFactory);
    await expect(factory.createProject(CP001, R(2_000_000))).to.emit(factory, "ProjectCreated");
    await factory.createProject(CP002, R(500_000));

    const w1 = await factory.getWallet(CP001);
    const w2 = await factory.getWallet(CP002);
    expect(w1).to.not.equal(ethers.ZeroAddress);
    expect(w1).to.not.equal(w2);
    expect(await factory.projectCount()).to.equal(2n);
    expect(await factory.allProjects()).to.deep.equal([CP001, CP002]);
  });

  it("records the project id and allocation in the wallet", async () => {
    const { wallet, dzar } = await loadFixture(deployWithCP001);
    expect(await wallet.projectId()).to.equal(CP001);
    expect(await wallet.allocated()).to.equal(R(2_000_000));
    expect(await wallet.token()).to.equal(await dzar.getAddress());
  });

  it("gives the creator the municipality and approver roles on the new wallet", async () => {
    const { wallet, deployer, outsider } = await loadFixture(deployWithCP001);
    expect(await wallet.hasRole(await wallet.MUNICIPALITY_ROLE(), deployer.address)).to.equal(true);
    expect(await wallet.hasRole(await wallet.APPROVER_ROLE(), deployer.address)).to.equal(true);
    expect(await wallet.hasRole(await wallet.APPROVER_ROLE(), outsider.address)).to.equal(false);
  });

  it("rejects creating the same project twice", async () => {
    const { factory, wallet } = await loadFixture(deployWithCP001);
    await expect(factory.createProject(CP001, R(1)))
      .to.be.revertedWithCustomError(factory, "ProjectAlreadyExists")
      .withArgs(CP001, await wallet.getAddress());
  });

  it("rejects a zero allocation", async () => {
    const { factory } = await loadFixture(deployFactory);
    const wallet = await ethers.getContractFactory("ProjectWallet");
    await expect(factory.createProject(CP001, 0n)).to.be.revertedWithCustomError(wallet, "InvalidAmount");
  });

  it("does not let an outsider create projects", async () => {
    const { factory, outsider } = await loadFixture(deployFactory);
    await expect(factory.connect(outsider).createProject(CP001, R(1)))
      .to.be.revertedWithCustomError(factory, "AccessControlUnauthorizedAccount");
  });

  it("reverts when looking up an unknown project", async () => {
    const { factory } = await loadFixture(deployFactory);
    await expect(factory.getWallet(CP001)).to.be.revertedWithCustomError(factory, "ProjectNotFound");
    expect(await factory.walletOf(CP001)).to.equal(ethers.ZeroAddress);
  });
});

describe("ProjectWallet funding", () => {
  it("funds CP001 with R2,000,000.00", async () => {
    const { dzar, wallet, deployer } = await loadFixture(deployWithCP001);
    await mintAndApprove(dzar, deployer, wallet, R(2_000_000));

    await expect(wallet.fundProject(R(2_000_000)))
      .to.emit(wallet, "ProjectFunded")
      .withArgs(deployer.address, R(2_000_000), R(2_000_000));

    const [balance, available] = await wallet.getBalance();
    expect(balance).to.equal(R(2_000_000));
    expect(available).to.equal(R(2_000_000));
    expect(await dzar.balanceOf(await wallet.getAddress())).to.equal(R(2_000_000));
  });

  it("can be funded in several deposits up to the allocation", async () => {
    const { dzar, wallet, deployer } = await loadFixture(deployWithCP001);
    await mintAndApprove(dzar, deployer, wallet, R(2_000_000));
    await wallet.fundProject(R(1_500_000));
    await wallet.fundProject(R(500_000));
    expect(await wallet.funded()).to.equal(R(2_000_000));
  });

  it("rejects funding beyond the allocation", async () => {
    const { dzar, wallet, deployer } = await loadFixture(deployWithCP001);
    await mintAndApprove(dzar, deployer, wallet, R(2_000_000.01));
    await wallet.fundProject(R(1_500_000));
    await expect(wallet.fundProject(R(500_000.01)))
      .to.be.revertedWithCustomError(wallet, "ExceedsAllocation")
      .withArgs(R(500_000.01), R(500_000));
  });

  it("rejects a zero deposit", async () => {
    const { wallet } = await loadFixture(deployWithCP001);
    await expect(wallet.fundProject(0n)).to.be.revertedWithCustomError(wallet, "InvalidAmount");
  });

  it("does not let an outsider fund through the wallet", async () => {
    const { dzar, wallet, outsider } = await loadFixture(deployWithCP001);
    await dzar.mint(outsider.address, R(1)); // give the outsider real dZAR to try with
    await dzar.connect(outsider).approve(await wallet.getAddress(), R(1));
    await expect(wallet.connect(outsider).fundProject(R(1)))
      .to.be.revertedWithCustomError(wallet, "AccessControlUnauthorizedAccount");
  });

  it("ignores tokens sent straight to the wallet address", async () => {
    const { dzar, wallet, deployer } = await loadFixture(deployWithCP001);
    await dzar.mint(deployer.address, R(10));
    await dzar.transfer(await wallet.getAddress(), R(10)); // bypasses fundProject
    const [balance] = await wallet.getBalance();
    expect(balance).to.equal(0n);
    expect(await wallet.funded()).to.equal(0n);
  });
});
