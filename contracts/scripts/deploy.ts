/**
 * Deploys DemoZAR and CivicProofFactory, writes deployments/<network>.json and,
 * on a live testnet, verifies both on its explorer.
 *
 *   npm run deploy:local   (needs `npm run node` in another terminal)
 *   npm run deploy:fuji    Avalanche Fuji   (needs test AVAX)
 *   npm run deploy:bsc     BNB testnet      (needs test BNB)
 *
 * Both testnets use the same DEPLOYER_PRIVATE_KEY.
 * Next: npm run setup:demo:<network>, then npm run export-abi.
 */
import { ethers, network } from "hardhat";
import { Deployment, explorerUrl, isLive, live, npmSuffix, saveDeployment, verifyOnExplorer } from "./lib";

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No deployer account. Set DEPLOYER_PRIVATE_KEY in .env.");

  const { chainId } = await ethers.provider.getNetwork();
  const gasSymbol = live()?.gas ?? "ETH";
  const gas = await ethers.provider.getBalance(deployer.address);
  console.log(`Network:  ${live()?.label ?? network.name} (chain ${chainId})`);
  console.log(`Deployer: ${deployer.address} (${ethers.formatEther(gas)} ${gasSymbol})`);
  if (gas === 0n) throw new Error(`Deployer has no gas. Get test ${gasSymbol} from the faucet first.`);

  // On a live testnet, wait a few confirmations so the explorer has indexed the bytecode before verifying.
  const confirmations = isLive() ? 5 : 1;

  const dzar = await ethers.deployContract("DemoZAR");
  const dzarReceipt = await dzar.deploymentTransaction()!.wait(confirmations);
  const dzarAddress = await dzar.getAddress();
  console.log(`✓ DemoZAR:           ${dzarAddress}`);

  const factory = await ethers.deployContract("CivicProofFactory", [dzarAddress]);
  const factoryReceipt = await factory.deploymentTransaction()!.wait(confirmations);
  const factoryAddress = await factory.getAddress();
  console.log(`✓ CivicProofFactory: ${factoryAddress}`);

  const deployment: Deployment = {
    network: network.name,
    chainId: Number(chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      DemoZAR: { address: dzarAddress, blockNumber: dzarReceipt!.blockNumber },
      CivicProofFactory: { address: factoryAddress, blockNumber: factoryReceipt!.blockNumber },
    },
    projects: {},
  };
  saveDeployment(deployment);
  if (network.name !== "hardhat") console.log(`✓ wrote deployments/${network.name}.json`);

  await verifyOnExplorer("DemoZAR", dzarAddress);
  await verifyOnExplorer("CivicProofFactory", factoryAddress, [dzarAddress]);

  console.log(`\nAdd to the API .env (for ${live()?.label ?? network.name}):`);
  console.log(`DEMOZAR_ADDRESS=${dzarAddress}`);
  console.log(`FACTORY_ADDRESS=${factoryAddress}`);

  if (isLive()) {
    console.log("\nExplorer:");
    console.log(`  ${explorerUrl("address", dzarAddress)}`);
    console.log(`  ${explorerUrl("address", factoryAddress)}`);
  }
  console.log(`\nNext: npm run setup:demo:${npmSuffix()}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
