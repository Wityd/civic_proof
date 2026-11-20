import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import * as path from "path";

// Read contracts/.env first, then the repo-root .env (the API's), so P3 can
// keep one .env at the root like everyone else.
dotenv.config({ path: path.resolve(__dirname, ".env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
const accounts = deployerKey ? [deployerKey] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    // Avalanche Fuji C-Chain testnet (gas: test AVAX)
    fuji: {
      url: process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc",
      chainId: 43113,
      accounts,
    },
    // BNB Smart Chain testnet (gas: test BNB). Same contracts, same deployer key.
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
      chainId: 97,
      accounts,
    },
  },
  // Source verification. A single key switches hardhat-verify to the Etherscan v2 API,
  // which is the only way BscScan verification still works. Routescan (Snowtrace)
  // accepts any non-empty key, so the same value covers Fuji.
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || "verify-key-not-set",
    customChains: [
      {
        network: "fuji",
        chainId: 43113,
        urls: {
          apiURL: "https://api.routescan.io/v2/network/testnet/evm/43113/etherscan",
          browserURL: "https://testnet.snowtrace.io",
        },
      },
      {
        network: "bscTestnet",
        chainId: 97,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api",
          browserURL: "https://testnet.bscscan.com",
        },
      },
    ],
  },
  sourcify: { enabled: false },
  typechain: { outDir: "typechain-types", target: "ethers-v6" },
};

export default config;
