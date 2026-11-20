import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const id = (uuid: string) => ethers.keccak256(ethers.toUtf8Bytes(uuid));
const docHash = (name: string) => ethers.sha256(ethers.toUtf8Bytes(name));
const R = (rand: number) => BigInt(Math.round(rand * 100)); // rand → cents
const ZERO = ethers.ZeroHash;

const CP001 = id("00000000-0000-4000-8000-000000000001");
const M1 = id("milestone-M1"); // "8 tanks installed at 4 village sites"
const INV1 = id("invoice-1"); // Blue Basin tanks, R118,400.00
const INV4 = id("invoice-4"); // Blue Basin installation, R64,000.00, linked to M1

enum Status { None, Pending, Approved, Rejected, Released }
enum MilestoneStatus { None, Registered, Verified }

async function fundedCP001() {
  const [deployer, blueBasin, outsider] = await ethers.getSigners();
  const dzar = await ethers.deployContract("DemoZAR");
  const factory = await ethers.deployContract("CivicProofFactory", [await dzar.getAddress()]);
  await factory.createProject(CP001, R(2_000_000));
  const wallet = await ethers.getContractAt("ProjectWallet", await factory.getWallet(CP001));
  await dzar.mint(deployer.address, R(2_000_000));
  await dzar.approve(await wallet.getAddress(), R(2_000_000));
  await wallet.fundProject(R(2_000_000));
  return { dzar, wallet, blueBasin, outsider };
}

/** Invoice #1 submitted and approved, ready to release. */
async function approvedINV1() {
  const base = await fundedCP001();
  await base.wallet.submitPaymentRequest(INV1, base.blueBasin.address, R(118_400), docHash("inv1.pdf"), ZERO);
  await base.wallet.approvePayment(INV1);
  return base;
}

/** M1 registered; invoice #4 linked to it, submitted and approved. */
async function approvedINV4() {
  const base = await fundedCP001();
  await base.wallet.registerMilestone(M1);
  await base.wallet.submitPaymentRequest(INV4, base.blueBasin.address, R(64_000), docHash("inv4.pdf"), M1);
  await base.wallet.approvePayment(INV4);
  return base;
}

describe("ProjectWallet release", () => {
  it("pushes dZAR straight to the supplier and updates the balance", async () => {
    const { dzar, wallet, blueBasin } = await loadFixture(approvedINV1);
    await expect(wallet.releasePayment(INV1))
      .to.emit(wallet, "PaymentReleased")
      .withArgs(INV1, blueBasin.address, R(118_400), R(1_881_600));

    expect(await dzar.balanceOf(blueBasin.address)).to.equal(R(118_400));
    expect(await dzar.balanceOf(await wallet.getAddress())).to.equal(R(1_881_600));
    const [balance, available] = await wallet.getBalance();
    expect(balance).to.equal(R(1_881_600));
    expect(available).to.equal(R(1_881_600));
    expect(await wallet.released()).to.equal(R(118_400));

    const r = await wallet.getTransaction(INV1);
    expect(r.status).to.equal(Status.Released);
    expect(r.releasedAt).to.be.greaterThan(0n);
  });

  it("SAFETY: a double release reverts", async () => {
    const { dzar, wallet, blueBasin } = await loadFixture(approvedINV1);
    await wallet.releasePayment(INV1);
    await expect(wallet.releasePayment(INV1))
      .to.be.revertedWithCustomError(wallet, "InvalidStatus")
      .withArgs(INV1, Status.Released);
    expect(await dzar.balanceOf(blueBasin.address)).to.equal(R(118_400)); // paid once
  });

  it("cannot release a request that isn't approved", async () => {
    const { wallet, blueBasin } = await loadFixture(fundedCP001);
    await wallet.submitPaymentRequest(INV1, blueBasin.address, R(118_400), docHash("inv1.pdf"), ZERO);
    await expect(wallet.releasePayment(INV1))
      .to.be.revertedWithCustomError(wallet, "InvalidStatus")
      .withArgs(INV1, Status.Pending);
    await expect(wallet.releasePayment(INV4))
      .to.be.revertedWithCustomError(wallet, "RequestNotFound");
  });

  it("does not let an outsider release", async () => {
    const { wallet, outsider } = await loadFixture(approvedINV1);
    await expect(wallet.connect(outsider).releasePayment(INV1))
      .to.be.revertedWithCustomError(wallet, "AccessControlUnauthorizedAccount");
  });
});

describe("ProjectWallet milestones", () => {
  it("registers M1", async () => {
    const { wallet } = await loadFixture(fundedCP001);
    await expect(wallet.registerMilestone(M1)).to.emit(wallet, "MilestoneRegistered").withArgs(M1);
    expect(await wallet.milestoneStatus(M1)).to.equal(MilestoneStatus.Registered);
  });

  it("rejects registering a milestone twice or with an empty id", async () => {
    const { wallet } = await loadFixture(fundedCP001);
    await wallet.registerMilestone(M1);
    await expect(wallet.registerMilestone(M1))
      .to.be.revertedWithCustomError(wallet, "MilestoneAlreadyRegistered")
      .withArgs(M1);
    await expect(wallet.registerMilestone(ZERO)).to.be.revertedWithCustomError(wallet, "InvalidHash");
  });

  it("rejects an invoice that depends on an unregistered milestone", async () => {
    const { wallet, blueBasin } = await loadFixture(fundedCP001);
    await expect(wallet.submitPaymentRequest(INV4, blueBasin.address, R(64_000), docHash("inv4.pdf"), M1))
      .to.be.revertedWithCustomError(wallet, "MilestoneNotFound")
      .withArgs(M1);
  });

  it("SAFETY: a release before milestone verification reverts", async () => {
    const { dzar, wallet, blueBasin } = await loadFixture(approvedINV4);
    await expect(wallet.releasePayment(INV4))
      .to.be.revertedWithCustomError(wallet, "MilestoneNotVerified")
      .withArgs(M1);
    expect(await dzar.balanceOf(blueBasin.address)).to.equal(0n);
  });

  it("pays the installation invoice once M1 is verified", async () => {
    const { dzar, wallet, blueBasin } = await loadFixture(approvedINV4);
    await expect(wallet.verifyMilestone(M1)).to.emit(wallet, "MilestoneVerified").withArgs(M1);
    expect(await wallet.milestoneStatus(M1)).to.equal(MilestoneStatus.Verified);

    await wallet.releasePayment(INV4);
    expect(await dzar.balanceOf(blueBasin.address)).to.equal(R(64_000));
  });

  it("rejects verifying an unknown milestone or verifying twice", async () => {
    const { wallet } = await loadFixture(fundedCP001);
    await expect(wallet.verifyMilestone(M1))
      .to.be.revertedWithCustomError(wallet, "MilestoneNotFound")
      .withArgs(M1);
    await wallet.registerMilestone(M1);
    await wallet.verifyMilestone(M1);
    await expect(wallet.verifyMilestone(M1))
      .to.be.revertedWithCustomError(wallet, "MilestoneAlreadyVerified")
      .withArgs(M1);
  });

  it("does not let an outsider register or verify milestones", async () => {
    const { wallet, outsider } = await loadFixture(fundedCP001);
    await expect(wallet.connect(outsider).registerMilestone(M1))
      .to.be.revertedWithCustomError(wallet, "AccessControlUnauthorizedAccount");
    await wallet.registerMilestone(M1);
    await expect(wallet.connect(outsider).verifyMilestone(M1))
      .to.be.revertedWithCustomError(wallet, "AccessControlUnauthorizedAccount");
  });
});
