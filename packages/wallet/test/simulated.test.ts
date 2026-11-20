/**
 * SimulatedWalletService against a real Postgres (PGlite, in memory) running
 * sql/simulated_wallet.sql: the same SQL Supabase runs.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "fs";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RpcClient, SimulatedWalletService } from "../src";
import { R, sha, walletConformance } from "./conformance";

let db: PGlite;
let wallet: SimulatedWalletService;

/** Mimics supabase.rpc(fn, args): named arguments, { data, error } result. */
function pgliteRpc(pg: PGlite): RpcClient {
  return {
    async rpc(fn, args = {}) {
      const keys = Object.keys(args);
      const call = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as result`;
      try {
        const res = await pg.query<{ result: unknown }>(call, keys.map((k) => args[k]));
        return { data: res.rows[0]?.result ?? null, error: null };
      } catch (err: any) {
        return { data: null, error: { message: String(err?.message ?? err) } };
      }
    },
  };
}

beforeAll(async () => {
  db = new PGlite();
  const sql = readFileSync(join(__dirname, "../sql/simulated_wallet.sql"), "utf8");
  await db.exec(sql);
  await db.exec(sql); // the migration must be safe to re-run
  wallet = new SimulatedWalletService(pgliteRpc(db));
});

afterAll(async () => {
  await db?.close();
});

walletConformance("simulated", () => wallet);

describe("simulated-only", () => {
  it("uses sim_ hashes and confirms instantly", async () => {
    const id = crypto.randomUUID();
    const r = await wallet.createProject(id, R(1));
    expect(r).toMatchObject({ mode: "simulated", status: "confirmed" });
    expect(r.txHash).toMatch(/^sim_[0-9a-f-]{36}$/);
  });

  it("reports the request's current status for INVALID_STATUS", async () => {
    const p = crypto.randomUUID();
    const inv = crypto.randomUUID();
    await wallet.createProject(p, R(10));
    await wallet.fundProject(p, R(10));
    await wallet.submitPaymentRequest(inv, p, "0x" + "1".repeat(40), R(1), sha("a"));
    await wallet.rejectPayment(inv);
    expect(await wallet.approvePayment(inv)).toMatchObject({ error: "INVALID_STATUS", detail: "rejected" });
  });

  it("two simultaneous approvals can't commit the same money", async () => {
    const p = crypto.randomUUID();
    await wallet.createProject(p, R(100));
    await wallet.fundProject(p, R(100));
    const a = crypto.randomUUID();
    const b = crypto.randomUUID();
    await wallet.submitPaymentRequest(a, p, "0x" + "2".repeat(40), R(80), sha("a"));
    await wallet.submitPaymentRequest(b, p, "0x" + "3".repeat(40), R(80), sha("b"));
    const results = await Promise.all([wallet.approvePayment(a), wallet.approvePayment(b)]);
    expect(results.filter((r) => r.status === "confirmed")).toHaveLength(1);
    expect(results.filter((r) => r.error === "INSUFFICIENT_AVAILABLE")).toHaveLength(1);
  });

  it("throws (never returns 'failed') when the error isn't a wallet rule", async () => {
    const broken = new SimulatedWalletService({
      rpc: async () => ({ data: null, error: { message: "fetch failed" } }),
    });
    await expect(broken.releasePayment(crypto.randomUUID())).rejects.toMatchObject({ code: "UNKNOWN" });
  });

  it("reset wipes the simulated ledger", async () => {
    const p = crypto.randomUUID();
    await wallet.createProject(p, R(1));
    await wallet.reset();
    await expect(wallet.getBalance(p)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
});
