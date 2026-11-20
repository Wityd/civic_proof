/**
 * Gets the demo project ready on chain in one command. Safe to re-run: every step
 * is skipped if it has already happened.
 *
 *   npm run setup:demo:fuji     Avalanche Fuji
 *   npm run setup:demo:bsc      BNB testnet
 *
 * Use the same uuids on both chains: the project and milestone ids are then identical.
 *
 * Reads from .env (values from supabase/seed.sql):
 *   PROJECT_UUID              CP001's uuid
 *   PROJECT_ALLOCATION_CENTS  default 200000000 (R2,000,000.00)
 *   MILESTONE_M1_UUID         M1's uuid ("8 tanks installed at 4 village sites")
 *
 * Steps: createProject (factory deploys CP001's wallet) → mint → approve → fundProject
 *        → registerMilestone(M1) → verify the wallet on the explorer.
 */
import { ethers, network } from "hardhat";
import { explorerUrl, idOf, isLive, live, loadDeployment, rand, saveDeployment, verifyOnExplorer } from "./lib";

// Fallbacks for local runs only. On a live testnet, always use the real seed.sql uuids.
const LOCAL_PROJECT_UUID = "00000000-0000-4000-8000-000000000001";
const LOCAL_M1_UUID = "00000000-0000-4000-8000-0000000000a1";

function uuidFromEnv(name: string, localFallback: string) {
  const value = process.env[name];
  if (value) return value;
  if (isLive()) throw new Error(`Set ${name} in .env (from supabase/seed.sql).`);
  console.warn(`! ${name} not set, using local demo uuid ${localFallback}`);
  return localFallback;
}

async function main() {
  const deployment = loadDeployment();
  const [deployer] = await ethers.getSigners();
  const confirmations = isLive() ? 2 : 1;

  const projectUuid = uuidFromEnv("PROJECT_UUID", LOCAL_PROJECT_UUID);
  const m1Uuid = uuidFromEnv("MILESTONE_M1_UUID", LOCAL_M1_UUID);
  const allocation = BigInt(process.env.PROJECT_ALLOCATION_CENTS || "200000000");
  const projectId = idOf(projectUuid);
  const m1Id = idOf(m1Uuid);

  const dzar = await ethers.getContractAt("DemoZAR", deployment.contracts.DemoZAR.address);
  const factory = await ethers.getContractAt("CivicProofFactory", deployment.contracts.CivicProofFactory.address);

  console.log(`Network:    ${live()?.label ?? network.name}`);
  console.log(`Project:    ${projectUuid} → ${projectId}`);
  console.log(`Allocation: ${rand(allocation)}`);

  // 1. Create CP001's wallet through the factory
  let walletAddress = await factory.walletOf(projectId);
  if (walletAddress === ethers.ZeroAddress) {
    await (await factory.createProject(projectId, allocation)).wait(confirmations);
    walletAddress = await factory.walletOf(projectId);
    console.log(`✓ createProject → wallet ${walletAddress}`);
  } else {
    console.log(`✓ project exists → wallet ${walletAddress}`);
  }
  const wallet = await ethers.getContractAt("ProjectWallet", walletAddress);
  const onChainAllocation = await wallet.allocated();
  if (onChainAllocation !== allocation) {
    console.warn(`! on-chain allocation ${rand(onChainAllocation)} differs from ${rand(allocation)}; using on-chain`);
  }

  // 2. Fund whatever is still missing
  const toFund = onChainAllocation - (await wallet.funded());
  if (toFund === 0n) {
    console.log("✓ already fully funded");
  } else {
    const have = await dzar.balanceOf(deployer.address);
    if (have < toFund) {
      await (await dzar.mint(deployer.address, toFund - have)).wait(confirmations);
      console.log(`✓ mint ${rand(toFund - have)} dZAR`);
    }
    if ((await dzar.allowance(deployer.address, walletAddress)) < toFund) {
      await (await dzar.approve(walletAddress, toFund)).wait(confirmations);
      console.log(`✓ approve ${rand(toFund)}`);
    }
    const receipt = await (await wallet.fundProject(toFund)).wait(confirmations);
    console.log(`✓ fundProject ${rand(toFund)} (tx ${receipt!.hash})`);
  }

  // 3. Register M1 so invoice #4 can depend on it
  if ((await wallet.milestoneStatus(m1Id)) === 0n) {
    await (await wallet.registerMilestone(m1Id)).wait(confirmations);
    console.log(`✓ registerMilestone M1 (${m1Uuid})`);
  } else {
    console.log("✓ M1 already registered");
  }

  // 4. Remember the wallet for export-abi, and verify it on Snowtrace
  deployment.projects[projectUuid] = {
    projectId,
    wallet: walletAddress,
    allocatedCents: onChainAllocation.toString(),
  };
  saveDeployment(deployment);
  await verifyOnExplorer("CP001 ProjectWallet", walletAddress, [
    deployment.contracts.DemoZAR.address,
    projectId,
    onChainAllocation.toString(),
    deployer.address,
  ]);

  const [balance, available] = await wallet.getBalance();
  console.log(`\nCP001 wallet: ${walletAddress}`);
  console.log(`Balance: ${rand(balance)}, available: ${rand(available)}`);
  if (isLive()) console.log(explorerUrl("address", walletAddress));
  console.log("\nNext: npm run export-abi");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
