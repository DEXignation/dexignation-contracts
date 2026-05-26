// SPDX-License-Identifier: MIT
//
// Ignition module — Polygon Amoy testnet deployment.
// Uses real testnet Chainlink feeds and mock stablecoins for testing.
//
// Polygon Amoy 테스트넷 배포 모듈. 실제 테스트넷 Chainlink 피드와 mock
// 스테이블코인을 함께 배포한다.

import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { keccak256, toBytes, zeroHash, encodePacked } from "viem";

function tldNamehash(label: string): `0x${string}` {
  const labelHash = keccak256(toBytes(label));
  return keccak256(encodePacked(["bytes32", "bytes32"], [zeroHash, labelHash]));
}

const TLD = "dex";
const TLD_NODE = tldNamehash(TLD);
const TLD_LABEL_HASH = keccak256(toBytes(TLD));

const RENT_PRICES = [
  8n * 10n ** 18n,
  18n * 10n ** 18n,
  25n * 10n ** 18n,
  40n * 10n ** 18n,
];

// Polygon Amoy Chainlink POL/USD feed.
// Verify at: https://docs.chain.link/data-feeds/price-feeds/addresses?network=polygon
// Polygon Amoy의 Chainlink POL/USD 피드 주소.
const AMOY_POL_USD_FEED = "0x001382149eBa3441043c1c66972b4772963f5D43";

export default buildModule("DXDeployAmoy", (m) => {
  // Mock stablecoins on Amoy (testnet only; the user mints freely).
  // Amoy 테스트용 mock 스테이블코인 (자유 mint 가능).
  const mockUsdc = m.contract("MockERC20", ["Test USDC", "tUSDC", 6], {
    id: "TestUSDC",
  });
  const mockUsdt = m.contract("MockERC20", ["Test USDT", "tUSDT", 6], {
    id: "TestUSDT",
  });

  const registry = m.contract("DXRegistry", []);
  const registrar = m.contract("DXRegistrar", [registry, TLD_NODE, TLD]);
  const resolver = m.contract("DXResolver", [registry]);
  const priceOracle = m.contract("DXPriceOracle", [RENT_PRICES]);
  const reverseRegistrar = m.contract("DXReverseRegistrar", [registry, resolver]);
  const controller = m.contract("DXRegistrarController", [
    registrar,
    registry,
    priceOracle,
  ]);

  m.call(registry, "setSubnodeOwner", [zeroHash, TLD_LABEL_HASH, registrar], {
    id: "GrantTldToRegistrar",
  });
  m.call(registrar, "addController", [controller], { id: "AddController" });
  m.call(priceOracle, "setPolUsdOracle", [AMOY_POL_USD_FEED], {
    id: "SetPolUsdOracle",
  });
  m.call(controller, "setAllowedPaymentToken", [mockUsdc, true], {
    id: "AllowUSDC",
  });
  m.call(controller, "setAllowedPaymentToken", [mockUsdt, true], {
    id: "AllowUSDT",
  });

  return {
    registry,
    registrar,
    resolver,
    priceOracle,
    reverseRegistrar,
    controller,
    mockUsdc,
    mockUsdt,
  };
});
