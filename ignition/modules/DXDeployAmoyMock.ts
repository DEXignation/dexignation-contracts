// SPDX-License-Identifier: MIT
//
// Ignition module — Polygon Amoy testnet deployment WITH A MOCK PRICE FEED.
//
// The documented Amoy Chainlink POL/USD feed (0x001382...) is dead (reverts on
// read), which blocks price conversion. This module deploys a MockPriceOracle
// in its place so the full flow — pricing, registration, NFT, resolution, and
// the v2 transfer-invalidation — can be exercised end-to-end on a live network.
// All other logic is identical to DXDeployAmoy; only the price feed is mocked.
//
// Amoy의 실제 Chainlink POL/USD 피드가 죽어있어(read 시 revert) 가격 환산이
// 막힌다. 이 모듈은 그 자리에 MockPriceOracle를 배포해 가격·등록·NFT·해석·
// v2 전송무효화 전체 흐름을 실네트워크에서 검증할 수 있게 한다. 피드만 mock이고
// 나머지 로직은 DXDeployAmoy와 동일.

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
  55n * 10n ** 18n,
];

const MOCK_POL_USD = 40_000_000n; // $0.40 with 8 decimals.

export default buildModule("DXDeployAmoyMock", (m) => {
  // Mock stablecoins + mock price feed (Amoy real feed is dead).
  const mockUsdc = m.contract("MockERC20", ["Test USDC", "tUSDC", 6], { id: "TestUSDC" });
  const mockUsdt = m.contract("MockERC20", ["Test USDT", "tUSDT", 6], { id: "TestUSDT" });
  const mockPolUsd = m.contract("MockPriceOracle", [8, MOCK_POL_USD], { id: "MockPolUsd" });

  const registry = m.contract("DXRegistry", []);
  const registrar = m.contract("DXRegistrar", [registry, TLD_NODE, TLD]);
  const resolver = m.contract("DXResolver", [registry]);
  const priceOracle = m.contract("DXPriceOracle", [RENT_PRICES]);
  const reverseRegistrar = m.contract("DXReverseRegistrar", [registry, resolver]);
  const controller = m.contract("DXRegistrarController", [registrar, registry, priceOracle]);
  const reservations = m.contract("DXReservations", []);

  const grantTld = m.call(registry, "setSubnodeOwner", [zeroHash, TLD_LABEL_HASH, registrar], {
    id: "GrantTldToRegistrar",
  });
  m.call(registry, "setSubnodeOwner", [zeroHash, REVERSE_LABEL_HASH, m.getAccount(0)], {
    id: "CreateReverseNode",
  });
  m.call(registry, "setSubnodeOwner", [REVERSE_NODE, ADDR_LABEL_HASH, reverseRegistrar], {
    id: "GrantAddrReverseToReverseRegistrar",
  });
  m.call(registrar, "addController", [controller], { id: "AddController" });
  // Use the MOCK feed instead of the dead Amoy Chainlink feed.
  m.call(priceOracle, "setPolUsdOracle", [mockPolUsd], { id: "SetPolUsdOracle" });
  m.call(controller, "setAllowedPaymentToken", [mockUsdc, true], { id: "AllowUSDC" });
  m.call(controller, "setAllowedPaymentToken", [mockUsdt, true], { id: "AllowUSDT" });
  m.call(controller, "setReservations", [reservations], { id: "WireReservations" });

  // v2: registrar ↔ resolver wiring for transfer-time record invalidation.
  m.call(registrar, "setResolver", [resolver], {
    id: "SetRegistrarResolver",
    after: [grantTld],
  });
  m.call(resolver, "setRegistrar", [registrar], { id: "SetResolverRegistrar" });

  return {
    registry, registrar, resolver, priceOracle, reverseRegistrar,
    controller, reservations, mockUsdc, mockUsdt, mockPolUsd,
  };
});