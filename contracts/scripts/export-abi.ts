/**
 * Copies the ABIs and the public deployed addresses into packages/shared/abi/,
 * where the API's FujiWalletService imports them.
 *
 *   npm run export-abi
 */
import { artifacts } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { DEPLOYMENTS_DIR, Deployment } from "./lib";

const CONTRACTS = ["DemoZAR", "CivicProofFactory", "ProjectWallet"] as const;

async function main() {
  const outDir = path.resolve(__dirname, "../../packages/shared/abi");
  fs.mkdirSync(outDir, { recursive: true });

  for (const name of CONTRACTS) {
    const { abi } = await artifacts.readArtifact(name);
    fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(abi, null, 2) + "\n");
    console.log(`✓ ${name}.json`);
  }

  // Public testnet addresses only. localhost.json is throwaway and gitignored.
  const addresses: Record<string, unknown> = {};
  if (fs.existsSync(DEPLOYMENTS_DIR)) {
    for (const file of fs.readdirSync(DEPLOYMENTS_DIR).filter((f) => f.endsWith(".json"))) {
      const d: Deployment = JSON.parse(fs.readFileSync(path.join(DEPLOYMENTS_DIR, file), "utf8"));
      if (d.network === "localhost") continue;
      addresses[d.network] = {
        chainId: d.chainId,
        DemoZAR: d.contracts.DemoZAR.address,
        CivicProofFactory: d.contracts.CivicProofFactory.address,
        factoryBlock: d.contracts.CivicProofFactory.blockNumber,
        projects: d.projects,
      };
    }
  }
  fs.writeFileSync(path.join(outDir, "addresses.json"), JSON.stringify(addresses, null, 2) + "\n");
  console.log(`✓ addresses.json (${Object.keys(addresses).join(", ") || "no testnet deployments yet"})`);
  console.log(`\nWrote ${path.relative(process.cwd(), outDir)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
