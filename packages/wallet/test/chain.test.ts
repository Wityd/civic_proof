/**
 * ChainWalletService against the real contracts on a local Hardhat node.
 * Needs compiled artifacts: run `npm test` (or `npx hardhat compile`) in contracts/ first.
 */
import { ChildProcess, spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { ContractFactory, JsonRpcProvider, NonceManager, Wallet } from "ethers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ChainWalletService } from "../src";
import { R, sha, walletConformance } from "./conformance";

const CONTRACTS_DIR = join(__dirname, "../../../contracts");
const PORT = 8549;
const RPC = `http://127.0.0.1:${PORT}`;
// Hardhat's public test account #0. Not a secret; only valid on a local node.
const LOCAL_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

let node: ChildProcess;
let wallet: ChainWalletService;
let addresses: { factory: string; token: string };
/** Plays the API's Supabase lookup: invoice/milestone uuid → project uuid. */
const owners = new Map<string, string>();

function artifact(name: string) {
  const file = join(CONTRACTS_DIR, `artifacts/contracts/${name}.sol/${name}.json`);
  if (!existsSync(file)) throw new Error(`Missing ${file}. Run "npm test" in contracts/ first to compile.`);
  return JSON.parse(readFileSync(file, "utf8"));
}

async function startNode() {
  const cli = require.resolve("hardhat/internal/cli/bootstrap.js", { paths: [CONTRACTS_DIR] });
  node = spawn(process.execPath, [cli, "node", "--port", String(PORT)], { cwd: CONTRACTS_DIR });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Hardhat node did not start in 60 s")), 60_000);
    node.stdout!.on("data", (d) => {
      if (String(d).includes("Started HTTP")) {
        clearTimeout(timer);
        resolve();
      }
    });
    node.on("exit", (code) => reject(new Error(`Hardhat node exited (${code})`)));
  });
}

function newService(extra: Partial<ConstructorParameters<typeof ChainWalletService>[0]> = {}) {
  return new ChainWalletService({
    mode: "fuji",
    chainId: 31337,
    rpcUrl: RPC,
    privateKey: LOCAL_KEY,
    factoryAddress: addresses.factory,
    tokenAddress: addresses.token,
    resolveProjectId: async (_kind, id) => {
      const p = owners.get(id);
      if (!p) throw new Error("not found");
      return p;
    },
    ...extra,
  });
}

beforeAll(async () => {
  await startNode();
  // No response cache and a nonce manager: two deploys back to back must never reuse a nonce
  // (ethers caches getTransactionCount for 250 ms by default, which made CI flaky).
  const deployer = new NonceManager(new Wallet(LOCAL_KEY, new JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 })));
  const DemoZAR = artifact("DemoZAR");
  const Factory = artifact("CivicProofFactory");
  const token = await new ContractFactory(DemoZAR.abi, DemoZAR.bytecode, deployer).deploy();
  await token.waitForDeployment();
  const factory = await new ContractFactory(Factory.abi, Factory.bytecode, deployer).deploy(await token.getAddress());
  await factory.waitForDeployment();
  addresses = { factory: await factory.getAddress(), token: await token.getAddress() };
  wallet = newService();
}, 120_000);

afterAll(() => {
  node?.kill();
});

walletConformance("chain (local node)", () => wallet);

describe("chain-only", () => {
  it("returns real tx hashes and explorer links per chain", async () => {
    const r = await wallet.createProject(crypto.randomUUID(), R(1));
    expect(r).toMatchObject({ mode: "fuji", status: "confirmed" });
    expect(r.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(r.blockNumber).toBeGreaterThan(0);
    expect(wallet.txUrl(r.txHash)).toBe(`https://testnet.snowtrace.io/tx/${r.txHash}`);
    expect(newService({ mode: "bsc" }).txUrl(r.txHash)).toBe(`https://testnet.bscscan.com/tx/${r.txHash}`);
  });

  it("a fresh API process finds an invoice's project through resolveProjectId", async () => {
    const p = crypto.randomUUID();
    const inv = crypto.randomUUID();
    await wallet.createProject(p, R(100));
    await wallet.fundProject(p, R(100));
    await wallet.submitPaymentRequest(inv, p, Wallet.createRandom().address, R(10), sha("x"));
    owners.set(inv, p); // what the API would read from invoices.project_id

    const restarted = newService(); // empty caches, as after an API redeploy
    expect((await restarted.approvePayment(inv)).status).toBe("confirmed");
    expect((await restarted.getRequest(inv))?.status).toBe("approved");
  });

  it("refuses to run against the wrong chain", async () => {
    const wrong = newService({ chainId: 43113 }); // expects Fuji, node is 31337
    await expect(wrong.createProject(crypto.randomUUID(), R(1))).rejects.toMatchObject({ code: "CONFIG" });
  });

  it("rule violations cost no gas: nothing is sent", async () => {
    const provider = new JsonRpcProvider(RPC);
    const me = new Wallet(LOCAL_KEY).address;
    const before = await provider.getTransactionCount(me);
    const r = await wallet.releasePayment(crypto.randomUUID());
    expect(r.status).toBe("failed");
    expect(await provider.getTransactionCount(me)).toBe(before);
  });
});
