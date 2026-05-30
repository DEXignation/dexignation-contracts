// SPDX-License-Identifier: MIT
//
// Ignition module — local deployment with Mock dependencies.
// Useful for hardhat node + integration testing of the full payment flow.
//
// 로컬 배포 모듈. Mock 의존성을 함께 배포하여 결제 플로우 전체를 시험할 수 있다.

import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { keccak256, toBytes, zeroHash, encodePacked } from "viem";

function tldNamehash(label: string): `0x${string}` {
  const labelHash = keccak256(toBytes(label));
  return keccak256(encodePacked(["bytes32", "bytes32"], [zeroHash, labelHash]));
}

const TLD = "dex";
const TLD_NODE = tldNamehash(TLD);
const TLD_LABEL_HASH = keccak256(toBytes(TLD));
const REVERSE_LABEL_HASH = keccak256(toBytes("reverse"));
const REVERSE_NODE = keccak256(
  encodePacked(["bytes32", "bytes32"], [zeroHash, REVERSE_LABEL_HASH]),
);
const ADDR_LABEL_HASH = keccak256(toBytes("addr"));

const RENT_PRICES = [
  8n * 10n ** 18n,
  18n * 10n ** 18n,
  25n * 10n ** 18n,
  40n * 10n ** 18n,
];

const MOCK_POL_USD = 40_000_000n; // $0.40 with 8 decimals.

export default buildModule("DXDeployLocal", (m) => {
  // ── Mocks ─────────────────────────────────────────────────────────────────
  const mockUsdc = m.contract("MockERC20", ["Mock USDC", "USDC", 6], { id: "MockUSDC" });
  const mockUsdt = m.contract("MockERC20", ["Mock USDT", "USDT", 6], { id: "MockUSDT" });
  const mockPolUsd = m.contract("MockPriceOracle", [8, MOCK_POL_USD], { id: "MockPolUsd" });

  // ── Core protocol ─────────────────────────────────────────────────────────
  const registry = m.contract("DXRegistry", []);
  const registrar = m.contract("DXRegistrar", [registry, TLD_NODE, TLD]);
  const resolver = m.contract("DXResolver", [registry]);
  const priceOracle = m.contract("DXPriceOracle", [RENT_PRICES]);
  const reverseRegistrar = m.contract("DXReverseRegistrar", [registry, resolver]);
  const controller = m.contract("DXRegistrarController", [registrar, registry, priceOracle]);

  // ── Optional add-ons ──────────────────────────────────────────────────────
  // Reservation registry — owner-managed reserved label list.
  //   예약 레지스트리 — 오너 관리 예약 라벨.
  const reservations = m.contract("DXReservations", []);

  // ── Wiring ────────────────────────────────────────────────────────────────
  m.call(registry, "setSubnodeOwner", [zeroHash, TLD_LABEL_HASH, registrar], {
    id: "GrantTldToRegistrar",
  });
  m.call(registry, "setSubnodeOwner", [zeroHash, REVERSE_LABEL_HASH, m.getAccount(0)], {
    id: "CreateReverseNode",
  });
  m.call(registry, "setSubnodeOwner", [REVERSE_NODE, ADDR_LABEL_HASH, reverseRegistrar], {
    id: "GrantAddrReverseToReverseRegistrar",
  });
  m.call(registrar, "addController", [controller], { id: "AddController" });
  m.call(priceOracle, "setPolUsdOracle", [mockPolUsd], { id: "SetPolUsdOracle" });
  m.call(controller, "setAllowedPaymentToken", [mockUsdc, true], { id: "AllowUSDC" });
  m.call(controller, "setAllowedPaymentToken", [mockUsdt, true], { id: "AllowUSDT" });
  m.call(controller, "setReservations", [reservations], { id: "WireReservations" });

  // setDiscountToken is intentionally NOT called here. The owner activates
  // it after deciding which token to honour (MOL on Polygon, or none).
  //   할인 토큰 활성화는 owner가 토큰을 정한 뒤 별도 호출.

  return {
    registry,
    registrar,
    resolver,
    priceOracle,
    reverseRegistrar,
    controller,
    reservations,
    mockUsdc,
    mockUsdt,
    mockPolUsd,
  };
});
