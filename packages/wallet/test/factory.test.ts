import { describe, expect, it } from "vitest";
import { ChainWalletService, SimulatedWalletService, createWalletService } from "../src";

const supabase = { rpc: async () => ({ data: null, error: null }) };
const resolveProjectId = async () => "x";
const KEY = "0x" + "11".repeat(32);
const ADDR = "0x" + "22".repeat(20);

describe("createWalletService", () => {
  it("defaults to simulated", () => {
    expect(createWalletService({}, { supabase })).toBeInstanceOf(SimulatedWalletService);
  });

  it("builds a chain service for fuji and bsc", () => {
    for (const mode of ["fuji", "bsc"] as const) {
      const w = createWalletService(
        { WALLET_MODE: mode, DEPLOYER_PRIVATE_KEY: KEY, FACTORY_ADDRESS: ADDR, DEMOZAR_ADDRESS: ADDR },
        { resolveProjectId },
      );
      expect(w).toBeInstanceOf(ChainWalletService);
      expect(w.mode).toBe(mode);
    }
  });

  it("explains every missing setting", () => {
    expect(() => createWalletService({ WALLET_MODE: "polygon" }, { supabase })).toThrow(/simulated, fuji or bsc/);
    expect(() => createWalletService({ WALLET_MODE: "simulated" })).toThrow(/service-role Supabase/);
    expect(() => createWalletService({ WALLET_MODE: "fuji" })).toThrow(/resolveProjectId/);
    expect(() => createWalletService({ WALLET_MODE: "bsc", DEPLOYER_PRIVATE_KEY: KEY }, { resolveProjectId }))
      .toThrow(/No BNB Smart Chain testnet deployment/);
    expect(() =>
      createWalletService({ WALLET_MODE: "fuji", FACTORY_ADDRESS: ADDR, DEMOZAR_ADDRESS: ADDR }, { resolveProjectId }),
    ).toThrow(/DEPLOYER_PRIVATE_KEY/);
  });
});
