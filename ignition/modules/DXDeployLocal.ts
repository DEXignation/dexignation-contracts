// SPDX-License-Identifier: MIT
//
// Ignition module — local deployment with Mock dependencies.
// Useful for hardhat node + integration testing of the full payment flow.
//
// 로컬 배포 모듈. Mock 의존성을 함께 배포하여 결제 플로우 전체를 시험할 수 있다.

import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { keccak256, toBytes, zeroHash, encodePacked } from "viem";

/**
 * Compute the namehash for a simple TLD label (no dots).
 * 단순 TLD 라벨(점 없음)의 namehash 계산.
 */
function tldNamehash(label: string): `0x${string}` {
  const labelHash = keccak256(toBytes(label));
  return keccak256(encodePacked(["bytes32", "bytes32"], [zeroHash, labelHash]));
}

const TLD = "dex";
const TLD_NODE = tldNamehash(TLD);
const TLD_LABEL_HASH = keccak256(toBytes(TLD));

// attoUSD prices: $8 / $18 / $25 / $40 for 1y / 3y / 5y / 10y.
// attoUSD 가격: 1년 $8, 3년 $18, 5년 $25, 10년 $40.
const RENT_PRICES = [
  8n * 10n ** 18n,
  18n * 10n ** 18n,
  25n * 10n ** 18n,
  40n * 10n ** 18n,
];

// Mock POL/USD price: $0.40 with 8 decimals = 40_000_000.
// Mock POL/USD 가격: $0.40, 8 decimals.
const MOCK_POL_USD = 40_000_000n;

export default buildModule("DXDeployLocal", (m) => {
  // ── Mocks ─────────────────────────────────────────────────────────────────
  const mockUsdc = m.contract("MockERC20", ["Mock USDC", "USDC", 6], {
    id: "MockUSDC",
  });
  const mockUsdt = m.contract("MockERC20", ["Mock USDT", "USDT", 6], {
    id: "MockUSDT",
  });
  const mockPolUsd = m.contract("MockPriceOracle", [8, MOCK_POL_USD], {
    id: "MockPolUsd",
  });

  // ── Core protocol ─────────────────────────────────────────────────────────
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

  // ── Wiring ────────────────────────────────────────────────────────────────
  // 1. Hand `.dex` ownership to the registrar.
  m.call(registry, "setSubnodeOwner", [zeroHash, TLD_LABEL_HASH, registrar], {
    id: "GrantTldToRegistrar",
  });

  // 2. Whitelist the controller on the registrar.
  m.call(registrar, "addController", [controller], {
    id: "AddController",
  });

  // 3. Configure the price oracle's POL/USD feed (Direct path).
  m.call(priceOracle, "setPolUsdOracle", [mockPolUsd], {
    id: "SetPolUsdOracle",
  });

  // 4. Allow USDC + USDT as payment tokens.
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
    mockPolUsd,
  };
});
