/**
 * One behaviour suite for every WalletService. Simulated (Postgres) and chain (Fuji/BNB
 * contracts) must pass the SAME tests, so flipping WALLET_MODE can't change the demo.
 */
import { randomUUID, createHash } from "crypto";
import { Wallet } from "ethers";
import { describe, expect, it } from "vitest";
import type { TxResult, WalletService } from "../src";

export const R = (rand: number) => BigInt(Math.round(rand * 100)); // rand → cents
export const sha = (name: string) => createHash("sha256").update(name).digest("hex");
const supplier = () => Wallet.createRandom().address;

function confirmed(r: TxResult) {
  expect(r.error, `expected confirmed, got ${r.error} ${r.detail ?? ""}`).toBeUndefined();
  expect(r.status).toBe("confirmed");
  expect(r.txHash).not.toBe("");
  return r;
}

function failedWith(r: TxResult, code: TxResult["error"]) {
  expect(r.status).toBe("failed");
  expect(r.error).toBe(code);
  return r;
}

export function walletConformance(label: string, getWallet: () => WalletService) {
  /** A fresh, funded project with its own uuids, so tests never share state. */
  async function fundedProject(allocation = R(2_000_000)) {
    const w = getWallet();
    const projectId = randomUUID();
    confirmed(await w.createProject(projectId, allocation));
    confirmed(await w.fundProject(projectId, allocation));
    return { w, projectId };
  }

  describe(`${label}: projects`, () => {
    it("creates and funds a project with R2,000,000.00", async () => {
      const { w, projectId } = await fundedProject();
      expect(await w.getBalance(projectId)).toEqual({ balanceCents: R(2_000_000), availableCents: R(2_000_000) });
    });

    it("rejects a duplicate project, a zero allocation and funding past the allocation", async () => {
      const { w, projectId } = await fundedProject(R(1000));
      failedWith(await w.createProject(projectId, R(1)), "PROJECT_ALREADY_EXISTS");
      failedWith(await w.createProject(randomUUID(), 0n), "INVALID_AMOUNT");
      failedWith(await w.fundProject(projectId, 1n), "EXCEEDS_ALLOCATION");
    });

    it("fails cleanly for an unknown project", async () => {
      const w = getWallet();
      failedWith(await w.fundProject(randomUUID(), R(1)), "PROJECT_NOT_FOUND");
      await expect(w.getBalance(randomUUID())).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    });
  });

  describe(`${label}: payment rules`, () => {
    it("SAFETY: a double release fails and pays once", async () => {
      const { w, projectId } = await fundedProject();
      const inv = randomUUID();
      confirmed(await w.submitPaymentRequest(inv, projectId, supplier(), R(118_400), sha("inv1"), null));
      confirmed(await w.approvePayment(inv));
      confirmed(await w.releasePayment(inv));
      failedWith(await w.releasePayment(inv), "INVALID_STATUS");
      expect((await w.getBalance(projectId)).balanceCents).toBe(R(1_881_600));
    });

    it("SAFETY: overspending fails, counting already-approved amounts", async () => {
      const { w, projectId } = await fundedProject();
      const big = randomUUID();
      const bakkie = randomUUID();
      confirmed(await w.submitPaymentRequest(big, projectId, supplier(), R(1_500_000), sha("big"), null));
      confirmed(await w.approvePayment(big));
      expect((await w.getBalance(projectId)).availableCents).toBe(R(500_000));
      confirmed(await w.submitPaymentRequest(bakkie, projectId, supplier(), R(785_000), sha("bakkie"), null));
      failedWith(await w.approvePayment(bakkie), "INSUFFICIENT_AVAILABLE");
    });

    it("SAFETY: a release before milestone verification fails", async () => {
      const { w, projectId } = await fundedProject();
      const m1 = randomUUID();
      const inv = randomUUID();
      confirmed(await w.registerMilestone(m1, projectId));
      confirmed(await w.submitPaymentRequest(inv, projectId, supplier(), R(64_000), sha("inv4"), m1));
      confirmed(await w.approvePayment(inv));
      failedWith(await w.releasePayment(inv), "MILESTONE_NOT_VERIFIED");
      confirmed(await w.verifyMilestone(m1));
      confirmed(await w.releasePayment(inv));
    });

    it("needs milestones registered before an invoice can depend on them", async () => {
      const { w, projectId } = await fundedProject();
      const m1 = randomUUID();
      failedWith(await w.submitPaymentRequest(randomUUID(), projectId, supplier(), R(1), sha("x"), m1), "MILESTONE_NOT_FOUND");
      expect(await w.getMilestoneStatus(m1)).toBe("none");
      confirmed(await w.registerMilestone(m1, projectId));
      expect(await w.getMilestoneStatus(m1)).toBe("registered");
      failedWith(await w.registerMilestone(m1, projectId), "MILESTONE_ALREADY_REGISTERED");
      confirmed(await w.verifyMilestone(m1));
      expect(await w.getMilestoneStatus(m1)).toBe("verified");
      failedWith(await w.verifyMilestone(m1), "MILESTONE_ALREADY_VERIFIED");
    });

    it("allows one request per invoice and validates inputs", async () => {
      const { w, projectId } = await fundedProject();
      const inv = randomUUID();
      confirmed(await w.submitPaymentRequest(inv, projectId, supplier(), R(1), sha("a"), null));
      failedWith(await w.submitPaymentRequest(inv, projectId, supplier(), R(1), sha("a"), null), "REQUEST_ALREADY_EXISTS");
      failedWith(await w.submitPaymentRequest(randomUUID(), projectId, "0xnope", R(1), sha("a"), null), "INVALID_ADDRESS");
      failedWith(await w.submitPaymentRequest(randomUUID(), projectId, supplier(), 0n, sha("a"), null), "INVALID_AMOUNT");
      failedWith(await w.submitPaymentRequest(randomUUID(), projectId, supplier(), R(1), "not-a-hash", null), "INVALID_HASH");
    });

    it("a rejected request can never be approved or released", async () => {
      const { w, projectId } = await fundedProject();
      const inv = randomUUID();
      confirmed(await w.submitPaymentRequest(inv, projectId, supplier(), R(785_000), sha("inv3"), null));
      confirmed(await w.rejectPayment(inv));
      failedWith(await w.approvePayment(inv), "INVALID_STATUS");
      failedWith(await w.releasePayment(inv), "INVALID_STATUS");
    });

    it("an unknown invoice fails cleanly and reads as null", async () => {
      const w = getWallet();
      expect(await w.getRequest(randomUUID())).toBeNull();
    });
  });

  describe(`${label}: golden path`, () => {
    it("CP001 demo ends at R1,817,600.00 with the right statuses", async () => {
      const { w, projectId } = await fundedProject();
      const [inv1, inv2, inv3, inv4, m1] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      const blueBasin = supplier();
      confirmed(await w.registerMilestone(m1, projectId));

      // 1. Fair tanks invoice → approve → pay
      confirmed(await w.submitPaymentRequest(inv1, projectId, blueBasin, R(118_400), sha("inv1.pdf"), null));
      confirmed(await w.approvePayment(inv1));
      const paid = confirmed(await w.releasePayment(inv1));
      expect(await w.getTxStatus(paid.txHash)).toMatchObject({ status: "confirmed" });
      expect((await w.getBalance(projectId)).balanceCents).toBe(R(1_881_600));

      // 2. Inflated pipes → HOLD is API-only: submitted, never decided
      confirmed(await w.submitPaymentRequest(inv2, projectId, supplier(), R(240_000), sha("inv2.pdf"), null));

      // 3. Bakkie → reject
      confirmed(await w.submitPaymentRequest(inv3, projectId, supplier(), R(785_000), sha("inv3.pdf"), null));
      confirmed(await w.rejectPayment(inv3));

      // 4. Installation linked to M1 → blocked until verified
      confirmed(await w.submitPaymentRequest(inv4, projectId, blueBasin, R(64_000), sha("inv4.pdf"), m1));
      confirmed(await w.approvePayment(inv4));
      failedWith(await w.releasePayment(inv4), "MILESTONE_NOT_VERIFIED");
      confirmed(await w.verifyMilestone(m1));
      confirmed(await w.releasePayment(inv4));

      expect(await w.getBalance(projectId)).toEqual({ balanceCents: R(1_817_600), availableCents: R(1_817_600) });
      expect((await w.getRequest(inv1))?.status).toBe("released");
      expect(await w.getRequest(inv2)).toMatchObject({
        status: "pending",
        amountCents: R(240_000),
        documentSha256: sha("inv2.pdf"),
        milestoneLinked: false,
      });
      expect((await w.getRequest(inv3))?.status).toBe("rejected");
      expect(await w.getRequest(inv4)).toMatchObject({ status: "released", milestoneLinked: true });
    });
  });
}
