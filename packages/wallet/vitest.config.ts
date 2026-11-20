import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // The chain suite starts a Hardhat node on a fixed port: run files one at a time.
    fileParallelism: false,
  },
});
