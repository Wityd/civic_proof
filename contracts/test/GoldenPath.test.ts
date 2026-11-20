/**
 * The 3-minute demo from the build plan, end to end on one project.
 * If this passes, the on-chain half of the golden path works.
 */
import { expect } from "chai";
import { ethers } from "hardhat";

const id = (uuid: string) => ethers.keccak256(ethers.toUtf8Bytes(uuid));
const docHash = (name: string) => ethers.sha256(ethers.toUtf8Bytes(name));
const R = (rand: number) => BigInt(Math.round(rand * 100)); // rand → cents
const ZERO = ethers.ZeroHash;

enum Status { None, Pending, Approved, Rejected, Released }

describe("Golden path: CP001 Kgotso Valley Water Access", () => {
  it("SAFETY: the full demo flow ends at R1,817,600.00", async () => {
    const [municipality, blueBasin, pipeworks, summitMotors] = await ethers.getSigners();

    // Setup: R2,000,000.00 ring-fenced in CP001's own wallet
    const dzar = await ethers.deployContract("DemoZAR");
    const factory = await ethers.deployContract("CivicProofFactory", [await dzar.getAddress()]);
    const CP001 = id("CP001");
    await factory.createProject(CP001, R(2_000_000));
    const wallet = await ethers.getContractAt("ProjectWallet", await factory.getWallet(CP001));
    await dzar.mint(municipality.address, R(2_000_000));
    await dzar.approve(await wallet.getAddress(), R(2_000_000));
    await wallet.fundProject(R(2_000_000));

    const M1 = id("M1");
    await wallet.registerMilestone(M1);

    const [INV1, INV2, INV3, INV4] = ["inv1", "inv2", "inv3", "inv4"].map(id);

    // 1. Citizen view: R2,000,000.00 allocated, nothing spent
    let [balance] = await wallet.getBalance();
    expect(balance).to.equal(R(2_000_000));

    // 2. Fair invoice: 8 × 10,000 L tanks, no flags → approve → pay
    await wallet.submitPaymentRequest(INV1, blueBasin.address, R(118_400), docHash("inv1.pdf"), ZERO);
    await wallet.approvePayment(INV1);
    await wallet.releasePayment(INV1);
    [balance] = await wallet.getBalance();
    expect(balance).to.equal(R(1_881_600));

    // 3. Inflated invoice: 20 pipes at R12,000.00 → HOLD (off-chain), money stays
    await wallet.submitPaymentRequest(INV2, pipeworks.address, R(240_000), docHash("inv2.pdf"), ZERO);

    // 4. Wrong purpose: bakkie → REJECT, recorded on chain
    await wallet.submitPaymentRequest(INV3, summitMotors.address, R(785_000), docHash("inv3.pdf"), ZERO);
    await wallet.rejectPayment(INV3);

    // 5. Prove the service: installation linked to M1 is blocked until verified
    await wallet.submitPaymentRequest(INV4, blueBasin.address, R(64_000), docHash("inv4.pdf"), M1);
    await wallet.approvePayment(INV4);
    await expect(wallet.releasePayment(INV4)).to.be.revertedWithCustomError(wallet, "MilestoneNotVerified");
    await wallet.verifyMilestone(M1);
    await wallet.releasePayment(INV4);

    // 6. Close: R1,817,600.00 left; held + rejected money (R1,025,000.00) never left
    const [finalBalance, available] = await wallet.getBalance();
    expect(finalBalance).to.equal(R(1_817_600));
    expect(available).to.equal(R(1_817_600));
    expect(await dzar.balanceOf(await wallet.getAddress())).to.equal(R(1_817_600));
    expect(await wallet.released()).to.equal(R(182_400));

    expect(await dzar.balanceOf(blueBasin.address)).to.equal(R(182_400)); // #1 + #4
    expect(await dzar.balanceOf(pipeworks.address)).to.equal(0n);
    expect(await dzar.balanceOf(summitMotors.address)).to.equal(0n);

    expect((await wallet.getTransaction(INV1)).status).to.equal(Status.Released);
    expect((await wallet.getTransaction(INV2)).status).to.equal(Status.Pending); // held
    expect((await wallet.getTransaction(INV3)).status).to.equal(Status.Rejected);
    expect((await wallet.getTransaction(INV4)).status).to.equal(Status.Released);

    // The anchored hash proves the inflated invoice wasn't swapped after submission
    expect((await wallet.getTransaction(INV2)).invoiceHash).to.equal(docHash("inv2.pdf"));
  });
});
