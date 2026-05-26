// SPDX-License-Identifier: MIT
//
// Hardhat 3 configuration for the DEXignation smart contracts.
// Hardhat 3 기반 DEXignation 스마트 컨트랙트 설정.

import type { HardhatUserConfig } from "hardhat/config";
import HardhatToolboxViem from "@nomicfoundation/hardhat-toolbox-viem";
import HardhatIgnition from "@nomicfoundation/hardhat-ignition";
import HardhatVerify from "@nomicfoundation/hardhat-verify";
import "dotenv/config";

// ── Environment / 환경 변수 ────────────────────────────────────────────────
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL ?? "https://polygon-rpc.com";
const AMOY_RPC_URL = process.env.AMOY_RPC_URL ?? "https://rpc-amoy.polygon.technology";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const POLYGONSCAN_API_KEY = process.env.POLYGONSCAN_API_KEY ?? "";

/**
 * Build a `accounts` array for live networks. Falls back to an empty
 * array if the deployer key isn't set, so local dev / CI doesn't fail.
 *
 * 라이브 네트워크용 `accounts` 배열을 만든다. 배포 키가 없으면 빈 배열을
 * 반환하여 로컬 개발·CI 환경에서 실패하지 않도록 한다.
 */
function liveAccounts(): string[] {
  if (!DEPLOYER_PRIVATE_KEY) return [];
  return [DEPLOYER_PRIVATE_KEY.startsWith("0x")
    ? DEPLOYER_PRIVATE_KEY
    : `0x${DEPLOYER_PRIVATE_KEY}`];
}

const config: HardhatUserConfig = {
  plugins: [HardhatToolboxViem, HardhatIgnition, HardhatVerify],

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

  networks: {
    // Local Hardhat node, used for `npm run test` and `npm run deploy:local`.
    // 로컬 Hardhat 노드. 테스트와 로컬 배포에 사용.
    hardhat: {
      type: "edr",
      chainType: "l1",
    },

    // Polygon Amoy testnet — chain id 80002.
    // Polygon Amoy 테스트넷.
    amoy: {
      type: "http",
      chainType: "l1",
      url: AMOY_RPC_URL,
      accounts: liveAccounts(),
      chainId: 80002,
    },

    // Polygon mainnet — chain id 137.
    // Polygon 메인넷.
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
