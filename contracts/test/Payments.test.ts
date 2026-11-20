import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const id = (uuid: string) => ethers.keccak256(ethers.toUtf8Bytes(uuid));
const docHash = (name: string) => ethers.sha256(ethers.toUtf8Bytes(name));
const R = (rand: number) => BigInt(Math.round(rand * 100)); // rand → cents
const ZERO = ethers.ZeroHash;

const CP001 = id("00000000-0000-4000-8000-000000000001");
const INV1 = id("invoice-1"); // Blue Basin tanks, R118,400.00
const INV2 = id("invoice-2"); // Pipeworks inflated pipes, R240,000.00
const INV3 = id("invoice-3"); // Summit Motors bakkie, R785,000.00

enum Status { None, Pending, Approved, Rejected, Released }

/** CP001 created through the factory and funded with R2,000,000.00 */
async function fundedCP001() {
  const [deployer, blueBasin, pipeworks, summitMotors, outsider] = await ethers.getSigners();
  const dzar = await ethers.deployContract("DemoZAR");
  const factory = await ethers.deployContract("CivicProofFactory", [await dzar.getAddress()]);
  await factory.createProject(CP001, R(2_000_000));
  const wallet = await ethers.getContractAt("ProjectWallet", await factory.getWallet(CP001));
  await dzar.mint(deployer.address, R(2_000_000));
  await dzar.approve(await wallet.getAddress(), R(2_000_000));
  await wallet.fundProject(R(2_000_000));
  return { dzar, wallet, deployer, blueBasin, pipeworks, summitMotors, outsider };
}

describe("ProjectWallet payment requests", () => {
  describe("submit", () => {
    it("records the request as Pending and anchors the document hash", async () => {
      const { wallet, blueBasin } = await loadFixture(fundedCP001);
      await expect(wallet.submitPaymentRequest(INV1, blueBasin.address, R(118_400), docHash("inv1.pdf"), ZERO))
        .to.emit(wallet, "PaymentRequested")
        .withArgs(INV1, blueBasin.address, R(118_400), docHash("inv1.pdf"), ZERO);

      const r = await wallet.getTransaction(INV1);
      expect(r.status).to.equal(Status.Pending);
      expect(r.supplier).to.equal(blueBasin.address);
      expect(r.amount).to.equal(R(118_400));
      expect(r.invoiceHash).to.equal(docHash("inv1.pdf"));
      expect(r.submittedAt).to.be.greaterThan(0n);
    });

    it("does not move any money", async () => {
      const { wallet, blueBasin } = await loadFixture(fundedCP001);
      await wallet.submitPaymentRequest(INV1, blueBasin.address, R(118_400), docHash("inv1.pdf"), ZERO);
      const [balance, available] = await wallet.getBalance();
      expect(balance).to.equal(R(2_000_000));
      expect(available).to.equal(R(2_000_000));
    });

    it("allows only one request per invoice", async () => {
      const { wallet, blueBasin } = await loadFixture(fundedCP001);
      await wallet.submitPaymentRequest(INV1, blueBasin.address, R(1), docHash("a"), ZERO);
      await expect(wallet.submitPaymentRequest(INV1, blueBasin.address, R(1), docHash("a"), ZERO))
        .to.be.revertedWithCustomError(wallet, "RequestAlreadyExists")
        .withArgs(INV1);
    });

    it("rejects a zero amount, zero supplier or empty hash", async () => {
      const { wallet, blueBasin } = await loadFixture(fundedCP001);
      await expect(wallet.submitPaymentRequest(INV1, blueBasin.address, 0n, docHash("a"), ZERO))
        .to.be.revertedWithCustomError(wallet, "InvalidAmount");
      await expect(wallet.submitPaymentRequest(INV1, ethers.ZeroAddress, R(1), docHash("a"), ZERO))
        .to.be.revertedWithCustomError(wallet, "InvalidAddress");
      await expect(wallet.submitPaymentRequest(INV1, blueBasin.address, R(1), ZERO, ZERO))
        .to.be.revertedWithCustomError(wallet, "InvalidHash");
    });

    it("does not let an outsider submit", async () => {
      const { wallet, outsider } = await loadFixture(fundedCP001);
      await expect(wallet.connect(outsider).submitPaymentRequest(INV1, outsider.address, R(1), docHash("a"), ZERO))
        .to.be.revertedWithCustomError(wallet, "AccessControlUnauthorizedAccount");
    });
  });

  describe("approve", () => {
    it("commits the amount, so 'available' drops but the balance doesn't", async () => {
      const { wallet, blueBasin } = await loadFixture(fundedCP001);
      await wallet.submitPaymentRequest(INV1, blueBasin.address, R(118_400), docHash("inv1.pdf"), ZERO);
      await expect(wallet.approvePayment(INV1))
        .to.emit(wallet, "PaymentApproved")
        .withArgs(INV1, R(118_400), R(1_881_600));

      const [balance, available] = await wallet.getBalance();
      expect(balance).to.equal(R(2_000_000));
      expect(available).to.equal(R(1_881_600));
      expect((await wallet.getTransaction(INV1)).status).to.equal(Status.Approved);
    });

    it("SAFETY: overspending reverts, counting already-approved amounts", async () => {
      const { wallet, blueBasin, summitMotors } = await loadFixture(fundedCP001);
      await wallet.submitPaymentRequest(INV1, blueBasin.address, R(1_500_000), docHash("big"), ZERO);
      await wallet.approvePayment(INV1); // R500,000.00 left available
      await wallet.submitPaymentRequest(INV3, summitMotors.address, R(785_000), docHash("bakkie"), ZERO);
      await expect(wallet.approvePayment(INV3))
        .to.be.revertedWithCustomError(wallet, "InsufficientAvailable")
        .withArgs(R(785_000), R(500_000));
    });

    it("SAFETY: an outsider's approval reverts", async () => {
      const { wallet, blueBasin, outsider } = await loadFixture(fundedCP001);
      await wallet.submitPaymentRequest(INV1, blueBasin.address, R(1), docHash("a"), ZERO);
      await expect(wallet.connect(outsider).approvePayment(INV1))
        .to.be.revertedWithCustomError(wallet, "AccessControlUnauthorizedAccount");
      await expect(wallet.connect(outsider).rejectPayment(INV1))
        .to.be.revertedWithCustomError(wallet, "AccessControlUnauthorizedAccount");
    });

    it("cannot approve twice", async () => {
      const { wallet, blueBasin } = await loadFixture(fundedCP001);
      await wallet.submitPaymentRequest(INV1, blueBasin.address, R(1), docHash("a"), ZERO);
      await wallet.approvePayment(INV1);
      await expect(wallet.approvePayment(INV1))
        .to.be.revertedWithCustomError(wallet, "InvalidStatus")
        .withArgs(INV1, Status.Approved);
    });

    it("reverts for an unknown request", async () => {
      const { wallet } = await loadFixture(fundedCP001);
      await expect(wallet.approvePayment(INV1))
        .to.be.revertedWithCustomError(wallet, "RequestNotFound")
        .withArgs(INV1);
      await expect(wallet.getTransaction(INV1)).to.be.revertedWithCustomError(wallet, "RequestNotFound");
    });
  });

  describe("reject and hold", () => {
    it("rejects the bakkie: recorded on chain, no money moves", async () => {
      const { wallet, summitMotors } = await loadFixture(fundedCP001);
      await wallet.submitPaymentRequest(INV3, summitMotors.address, R(785_000), docHash("inv3.pdf"), ZERO);
      await expect(wallet.rejectPayment(INV3)).to.emit(wallet, "PaymentRejected").withArgs(INV3);

      expect((await wallet.getTransaction(INV3)).status).to.equal(Status.Rejected);
      const [balance, available] = await wallet.getBalance();
      expect(balance).to.equal(R(2_000_000));
      expect(available).to.equal(R(2_000_000));
    });

    it("a rejected request can't be approved afterwards", async () => {
      const { wallet, summitMotors } = await loadFixture(fundedCP001);
      await wallet.submitPaymentRequest(INV3, summitMotors.address, R(785_000), docHash("inv3.pdf"), ZERO);
      await wallet.rejectPayment(INV3);
      await expect(wallet.approvePayment(INV3))
        .to.be.revertedWithCustomError(wallet, "InvalidStatus")
        .withArgs(INV3, Status.Rejected);
    });

    it("a held invoice (off-chain) stays Pending, so it can still be approved or rejected later", async () => {
      const { wallet, pipeworks } = await loadFixture(fundedCP001);
      await wallet.submitPaymentRequest(INV2, pipeworks.address, R(240_000), docHash("inv2.pdf"), ZERO);
      // "Hold" is an API-only state: no chain call
      expect((await wallet.getTransaction(INV2)).status).to.equal(Status.Pending);
      await wallet.approvePayment(INV2); // later approved with a written reason in the API
      const [, available] = await wallet.getBalance();
      expect(available).to.equal(R(1_760_000));
    });
  });
});
