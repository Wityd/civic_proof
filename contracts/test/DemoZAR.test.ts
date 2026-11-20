import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const R = (rand: number) => BigInt(Math.round(rand * 100)); // rand → cents

async function deployToken() {
  const [deployer, outsider] = await ethers.getSigners();
  const dzar = await ethers.deployContract("DemoZAR");
  return { dzar, deployer, outsider };
}

describe("DemoZAR", () => {
  it("is labelled as a simulated test token", async () => {
    const { dzar } = await loadFixture(deployToken);
    expect(await dzar.symbol()).to.equal("dZAR");
    expect(await dzar.name()).to.contain("simulated");
  });

  it("has 2 decimals, so 1 unit = 1 cent", async () => {
    const { dzar } = await loadFixture(deployToken);
    expect(await dzar.decimals()).to.equal(2);
  });

  it("starts with zero supply", async () => {
    const { dzar } = await loadFixture(deployToken);
    expect(await dzar.totalSupply()).to.equal(0n);
  });

  it("lets the deployer mint R2,000,000.00", async () => {
    const { dzar, deployer } = await loadFixture(deployToken);
    await dzar.mint(deployer.address, R(2_000_000));
    expect(await dzar.balanceOf(deployer.address)).to.equal(200_000_000n);
  });

  it("does not let anyone else mint", async () => {
    const { dzar, outsider } = await loadFixture(deployToken);
    await expect(dzar.connect(outsider).mint(outsider.address, R(1)))
      .to.be.revertedWithCustomError(dzar, "OwnableUnauthorizedAccount")
      .withArgs(outsider.address);
  });
});
