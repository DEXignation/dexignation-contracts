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

// Subname commerce (A3): protocol fee per subname sale. On this mock module
// there is no RevenueDistributor, so the fee recipient is the deployer
// (account 0) — fine for testnet verification. 500 bps = 5%.
//   서브네임 판매당 프로토콜 수수료. 이 mock 모듈엔 RevenueDistributor가 없으므로
//   수수료 수신처는 배포자(account 0) — 테스트넷 검증용으로 무방. 500 bps = 5%.
const SUBNAME_PROTOCOL_FEE_BPS = 500n;

export default buildModule("DXDeployAmoyMock", (m) => {
  const owner = m.getAccount(0);
  // Mock stablecoins + mock price feed (Amoy real feed is dead).
  const mockUsdc = m.contract("MockERC20", ["Test USDC", "tUSDC", 6], { id: "TestUSDC" });
  const mockUsdt = m.contract("MockERC20", ["Test USDT", "tUSDT", 6], { id: "TestUSDT" });
  const mockPolUsd = m.contract("MockPriceOracle", [8, MOCK_POL_USD], { id: "MockPolUsd" });

  const registry = m.contract("DXRegistry", [owner]);
  const registrar = m.contract("DXRegistrar", [registry, TLD_NODE, TLD, owner]);
  const resolver = m.contract("DXResolver", [registry, owner]);
  const priceOracle = m.contract("DXPriceOracle", [RENT_PRICES, owner]);
  const reverseRegistrar = m.contract("DXReverseRegistrar", [registry, resolver]);
  const controller = m.contract("DXRegistrarController", [registrar, registry, priceOracle, owner]);
  const reservations = m.contract("DXReservations", [owner]);

  // Subname commerce module (A3). No RevenueDistributor here, so the fee
  // recipient is the deployer (account 0). Authorised as a sale module below;
  // each parent owner must delegate via setApprovalForAll before selling.
  //   서브네임 커머스 모듈. RevenueDistributor가 없어 수수료 수신처는 배포자.
  //   아래에서 판매 모듈로 인가. 부모는 판매 전 setApprovalForAll로 위임.
  const subnameRegistrar = m.contract("DXSubnameRegistrar", [
    registry,
    resolver,
    m.getAccount(0),
    SUBNAME_PROTOCOL_FEE_BPS,
    owner,
  ]);

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
  m.call(registry, "setRecordInvalidator", [resolver], {
    id: "SetRegistryRecordInvalidator",
  });
  m.call(resolver, "setRecordInvalidator", [registry, true], {
    id: "AllowRegistryRecordInvalidator",
  });

  // v2: authorise the subname module as a registry sale module (root-node owner
  // = deployer). Lets it call issueSubnodeRecordLocked.
  //   서브네임 모듈을 판매 모듈로 인가(루트 소유자=배포자).
  m.call(registry, "setSaleModule", [subnameRegistrar, true], {
    id: "AllowSubnameSaleModule",
  });

  return {
    registry, registrar, resolver, priceOracle, reverseRegistrar,
    controller, reservations, subnameRegistrar, mockUsdc, mockUsdt, mockPolUsd,
  };
});