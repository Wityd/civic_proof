/**
 * @civicproof/wallet: the one place the API gets its wallet from.
 *
 *   import { createWalletService } from "../../packages/wallet/src";
 *   const wallet = createWalletService(process.env, { supabase, resolveProjectId });
 *
 * WALLET_MODE=simulated  → SimulatedWalletService (Supabase, needs simulated_wallet.sql applied)
 * WALLET_MODE=fuji       → ChainWalletService on Avalanche Fuji
 * WALLET_MODE=bsc        → ChainWalletService on BNB Smart Chain testnet
 *
 * Switching chains is one env change; the API code stays the same.
 */
import addresses from "../../shared/abi/addresses.json";
import { CHAINS, ChainMode, ChainWalletService } from "./chain";
import { RpcClient, SimulatedWalletService } from "./simulated";
import { WalletError, WalletMode, WalletService } from "./types";

export * from "./types";
export { CHAINS, ChainWalletService, chainId } from "./chain";
export type { ChainMode, ChainWalletConfig } from "./chain";
export { SimulatedWalletService } from "./simulated";
export type { RpcClient } from "./simulated";
export { solidityErrorToCode } from "./errors";

const DEFAULT_RPC: Record<ChainMode, { env: string; url: string }> = {
  fuji: { env: "FUJI_RPC_URL", url: "https://api.avax-test.network/ext/bc/C/rpc" },
  bsc: { env: "BSC_TESTNET_RPC_URL", url: "https://data-seed-prebsc-1-s1.bnbchain.org:8545" },
};

export interface WalletDeps {
  /** Supabase client created with the SERVICE ROLE key (simulated mode). */
  supabase?: RpcClient;
  /** invoice/milestone uuid → project uuid, read from Supabase (chain modes). */
  resolveProjectId?: (kind: "invoice" | "milestone", id: string) => Promise<string>;
}

export function createWalletService(
  env: Record<string, string | undefined> = process.env,
  deps: WalletDeps = {},
): WalletService {
  const mode = (env.WALLET_MODE || "simulated") as WalletMode;

  if (mode === "simulated") {
    if (!deps.supabase) throw new WalletError("CONFIG", "Simulated mode needs a service-role Supabase client");
    return new SimulatedWalletService(deps.supabase);
  }

  if (mode !== "fuji" && mode !== "bsc") {
    throw new WalletError("CONFIG", `WALLET_MODE must be simulated, fuji or bsc (got "${mode}")`);
  }
  if (!deps.resolveProjectId) throw new WalletError("CONFIG", "Chain mode needs resolveProjectId");

  // Addresses come from the deploy scripts (packages/shared/abi/addresses.json).
  // FACTORY_ADDRESS / DEMOZAR_ADDRESS override them for the selected chain only.
  const deployed = (addresses as Record<string, any>)[CHAINS[mode].deployment] ?? {};
  const factoryAddress = env.FACTORY_ADDRESS || deployed.CivicProofFactory;
  const tokenAddress = env.DEMOZAR_ADDRESS || deployed.DemoZAR;
  if (!factoryAddress || !tokenAddress) {
    throw new WalletError(
      "CONFIG",
      `No ${CHAINS[mode].label} deployment found. Run the deploy + export-abi scripts, or set FACTORY_ADDRESS and DEMOZAR_ADDRESS.`,
    );
  }

  return new ChainWalletService({
    mode,
    rpcUrl: env[DEFAULT_RPC[mode].env] || DEFAULT_RPC[mode].url,
    privateKey: env.DEPLOYER_PRIVATE_KEY || "",
    factoryAddress,
    tokenAddress,
    resolveProjectId: deps.resolveProjectId,
    confirmations: env.WALLET_CONFIRMATIONS ? Number(env.WALLET_CONFIRMATIONS) : undefined,
  });
}
