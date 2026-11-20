/**
 * Reads the setup transactions that already happened on chain (project created, funded,
 * milestone registered) and writes SQL for Supabase's `transactions` table, so the
 * dashboard shows the real balance and hashes in fuji/bsc mode.
 *
 *   npm run export-ledger:fuji     →  supabase/deployments/<code>_fuji_ledger.sql
 *
 * Uses PROJECT_UUID and MILESTONE_M1_UUID from .env (same as setup-demo). Safe to re-run:
 * the SQL skips hashes that are already recorded.
 */
import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import { idOf, isLive, loadDeployment } from "./lib";

const MODE: Record<string, string> = { fuji: "fuji", bscTestnet: "bsc", localhost: "fuji" };
// The public Fuji RPC caps eth_getLogs at 100 blocks per request. Override with LOGS_CHUNK.
const CHUNK = Number(process.env.LOGS_CHUNK || 100);
const DELAY_MS = Number(process.env.LOGS_DELAY_MS || 700);
// Setup runs all its transactions within a minute or two, so a window around ONE known
// setup transaction (e.g. the fundProject hash setup:demo printed) finds the rest in a
// couple of requests instead of scanning from the deployment block.
const NEAR_TX = process.env.NEAR_TX;
const NEAR_BLOCKS = Number(process.env.NEAR_BLOCKS || 150);

/** All logs from these contracts with any of these event topics, in RPC-sized pieces. */
async function logs(addresses: string[], topics: string[], from: number, to: number) {
  const out = [];
  const pieces = Math.ceil((to - from + 1) / CHUNK);
  for (let start = from, i = 1; start <= to; start += CHUNK, i++) {
    const end = Math.min(start + CHUNK - 1, to);
    for (let attempt = 1; ; attempt++) {
      try {
        out.push(...(await ethers.provider.getLogs({ address: addresses, topics: [topics], fromBlock: start, toBlock: end })));
        break;
      } catch (err) {
        // Public RPCs rate-limit bursts ("Too Many Requests"): back off 2, 4, 8, 16, 32 s.
        if (attempt === 6) throw err;
        const wait = 1000 * 2 ** attempt;
        process.stdout.write(`  rate-limited, waiting ${wait / 1000}s…\n`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    await new Promise((r) => setTimeout(r, DELAY_MS)); // stay under the rate limit
    if (i % 10 === 0 || i === pieces) process.stdout.write(`  scanned ${i}/${pieces} pieces\n`);
  }
  return out;
}

async function main() {
  const mode = MODE[network.name];
  if (!mode) throw new Error(`Unsupported network ${network.name}`);
  const d = loadDeployment();
  const projectUuid = process.env.PROJECT_UUID || (isLive() ? "" : "00000000-0000-4000-8000-000000000001");
  const m1Uuid = process.env.MILESTONE_M1_UUID || (isLive() ? "" : "00000000-0000-4000-8000-0000000000a1");
  if (!projectUuid || !m1Uuid) throw new Error("Set PROJECT_UUID and MILESTONE_M1_UUID in .env (from supabase/seed.sql).");
  const project = d.projects[projectUuid];
  if (!project) throw new Error(`No ${projectUuid} in deployments/${network.name}.json. Run setup:demo first.`);

  const factory = await ethers.getContractAt("CivicProofFactory", d.contracts.CivicProofFactory.address);
  const wallet = await ethers.getContractAt("ProjectWallet", project.wallet);
  let from = d.contracts.CivicProofFactory.blockNumber;
  let to = await ethers.provider.getBlockNumber();
  if (NEAR_TX) {
    const r = await ethers.provider.getTransactionReceipt(NEAR_TX);
    if (!r) throw new Error(`NEAR_TX ${NEAR_TX} not found on ${network.name}`);
    from = Math.max(from, r.blockNumber - NEAR_BLOCKS);
    to = Math.min(to, r.blockNumber + NEAR_BLOCKS);
  }
  console.log(`Scanning blocks ${from}–${to} on ${network.name} for ${projectUuid}…`);

  const rows: string[] = [];
  const row = (op: string, amount: bigint, hash: string, block: number, milestone?: string) =>
    rows.push(`  ('${projectUuid}', ${milestone ? `'${milestone}'` : "null"}, '${op}', ${amount}, '${mode}', 'confirmed', '${hash}', ${block}, now())`);

  const created = factory.interface.getEvent("ProjectCreated")!.topicHash;
  const funded = wallet.interface.getEvent("ProjectFunded")!.topicHash;
  const registered = wallet.interface.getEvent("MilestoneRegistered")!.topicHash;
  const found = await logs([factory.target as string, project.wallet], [created, funded, registered], from, to);
  found.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);

  for (const l of found) {
    const fromFactory = l.address.toLowerCase() === (factory.target as string).toLowerCase();
    if (fromFactory && l.topics[0] === created) {
      if (factory.interface.parseLog(l)!.args.projectId === idOf(projectUuid)) row("create_project", 0n, l.transactionHash, l.blockNumber);
    } else if (!fromFactory && l.topics[0] === funded) {
      row("fund_project", wallet.interface.parseLog(l)!.args.amount, l.transactionHash, l.blockNumber);
    } else if (!fromFactory && l.topics[0] === registered) {
      if (wallet.interface.parseLog(l)!.args.milestoneId === idOf(m1Uuid)) row("register_milestone", 0n, l.transactionHash, l.blockNumber, m1Uuid);
    }
  }
  if (!rows.length) throw new Error("No setup transactions found. Did setup:demo run on this network?");
  const missing = ["create_project", "fund_project", "register_milestone"].filter((op) => !rows.some((r) => r.includes(`'${op}'`)));
  if (missing.length) {
    throw new Error(`Missing ${missing.join(", ")} in blocks ${from}–${to}. ` +
      (NEAR_TX ? "Widen the window (e.g. NEAR_BLOCKS=500) or drop NEAR_TX for a full scan." : "Did setup:demo finish on this network?"));
  }

  const [balance] = await wallet.getBalance();
  const sql = `-- GENERATED by contracts/scripts/export-ledger.ts from ${network.name} (chain ${d.chainId}).
-- The on-chain setup of ${projectUuid}: wallet ${project.wallet}, balance ${balance} cents.
-- Apply after supabase/deployments/cp001_${mode}_wallet.sql. Safe to re-run.
insert into public.transactions (project_id, milestone_id, operation, amount_cents, mode, status, tx_hash, block_number, confirmed_at)
values
${rows.join(",\n")}
on conflict (mode, tx_hash) where tx_hash is not null do nothing;
`;
  const out = path.resolve(__dirname, `../../supabase/deployments/cp001_${mode}_ledger.sql`);
  if (network.name === "localhost") {
    console.log(sql);
  } else {
    fs.writeFileSync(out, sql);
    console.log(sql);
    console.log(`✓ wrote ${path.relative(process.cwd(), out)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
