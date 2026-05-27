// SPDX-License-Identifier: MIT
//
// Hardhat 3 configuration for the DEXignation smart contracts.
// Hardhat 3 기반 DEXignation 스마트 컨트랙트 설정.

import type { HardhatUserConfig } from "hardhat/config";
import HardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import HardhatIgnition from "@nomicfoundation/hardhat-ignition";
import HardhatMocha from "@nomicfoundation/hardhat-mocha";
import HardhatVerify from "@nomicfoundation/hardhat-verify";
import "dotenv/config";

// ── Environment / 환경 변수 ────────────────────────────────────────────────
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL ?? "https://polygon-rpc.com";
const AMOY_RPC_URL = process.env.AMOY_RPC_URL ?? "https://rpc-amoy.polygon.technology";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY ?? "";

function liveAccounts(): string[] {
  if (!DEPLOYER_PRIVATE_KEY) return [];
  return [DEPLOYER_PRIVATE_KEY.startsWith("0x")
    ? DEPLOYER_PRIVATE_KEY
    : `0x${DEPLOYER_PRIVATE_KEY}`];
}

const config: HardhatUserConfig = {
  plugins: [
    HardhatToolboxViem,
    HardhatIgnition,
    HardhatMocha,        // ← 추가
    HardhatVerify,
  ],

  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
      evmVersion: "cancun",
    },
  },

  paths: {
    tests: {
      mocha: "test",
    },
  },

  test: {
    mocha: {
      timeout: 60000,
    },
  },

  networks: {
    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
    },
    amoy: {
      type: "http",
      chainType: "l1",
      url: AMOY_RPC_URL,
      accounts: liveAccounts(),
      chainId: 80002,
    },
    polygon: {
      type: "http",
      chainType: "l1",
      url: POLYGON_RPC_URL,
      accounts: liveAccounts(),
      chainId: 137,
    },
  },

  verify: {
    etherscan: {
      apiKey: POLYGONSCAN_API_KEY,
    },
  },
};

export default config;