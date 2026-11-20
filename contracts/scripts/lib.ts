import hre, { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

export const DEPLOYMENTS_DIR = path.resolve(__dirname, "../deployments");

/** Public testnets we deploy to. Same contracts on each; the API uses one at a time. */
export const LIVE_NETWORKS: Record<string, { label: string; gas: string; explorer: string; npmSuffix: string }> = {
  fuji: { label: "Avalanche Fuji", gas: "AVAX", explorer: "https://testnet.snowtrace.io", npmSuffix: "fuji" },
  bscTestnet: { label: "BNB Smart Chain testnet", gas: "tBNB", explorer: "https://testnet.bscscan.com", npmSuffix: "bsc" },
};

export const live = () => LIVE_NETWORKS[network.name];
export const isLive = () => network.name in LIVE_NETWORKS;
/** npm script suffix for "next step" hints: fuji | bsc | local */
export const npmSuffix = () => live()?.npmSuffix ?? "local";

export interface Deployment {
  network: string;
  chainId: number;
  deployer: string;
  deployedAt: string;
  contracts: {
    DemoZAR: { address: string; blockNumber: number };
    CivicProofFactory: { address: string; blockNumber: number };
  };
  /** project uuid → its ProjectWallet address (filled by setup-demo) */
  projects: Record<string, { projectId: string; wallet: string; allocatedCents: string }>;
}

export function deploymentFile(net = network.name) {
  return path.join(DEPLOYMENTS_DIR, `${net}.json`);
}

export function loadDeployment(): Deployment {
  const file = deploymentFile();
  if (!fs.existsSync(file)) {
    throw new Error(`No deployments/${network.name}.json. Run the deploy script on ${network.name} first.`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function saveDeployment(d: Deployment) {
  if (network.name === "hardhat") return; // in-memory network: nothing to keep
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  fs.writeFileSync(deploymentFile(), JSON.stringify(d, null, 2) + "\n");
}

/** Same derivation the API uses: on-chain ids are keccak256(utf8 uuid). */
export const idOf = (uuid: string) => ethers.keccak256(ethers.toUtf8Bytes(uuid));

/** 200000000n → "R2,000,000.00" */
export function rand(cents: bigint) {
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `R${whole}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** Explorer link on the current network (Snowtrace or BscScan); undefined locally. */
export function explorerUrl(kind: "address" | "tx", value: string) {
  const net = live();
  return net ? `${net.explorer}/${kind}/${value}` : undefined;
}

/**
 * Verifies source on the current network's explorer (live testnets only). Never throws:
 * a failed verification must not fail a deploy, so it prints the manual command instead.
 */
export async function verifyOnExplorer(name: string, address: string, args: unknown[] = []) {
  if (!isLive()) return;
  try {
    await hre.run("verify:verify", { address, constructorArguments: args });
    console.log(`✓ verified ${name} on ${live()!.explorer}`);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (/already verified/i.test(msg)) {
      console.log(`✓ ${name} already verified`);
      return;
    }
    console.warn(`! could not verify ${name}: ${msg.split("\n")[0]}`);
    console.warn(`  retry later: npx hardhat verify --network ${network.name} ${address} ${args.join(" ")}`);
  }
}
