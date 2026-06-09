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

// Polygon Amoy Chainlink POL/USD feed.
// Verify at: https://docs.chain.link/data-feeds/price-feeds/addresses?network=polygon
// Polygon Amoy의 Chainlink POL/USD 피드 주소.
const AMOY_POL_USD_FEED = "0x001382149eBa3441043c1c66972b4772963f5D43";

const DXN_CAP = 100_000_000n * 10n ** 18n;
const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const STAKE_DISCOUNT_THRESHOLD = 100n * 10n ** 18n;
const STAKE_DISCOUNT_BPS = 250n;
const SUBNAME_PROTOCOL_FEE_BPS = 250n;

export default buildModule("DXDeployAmoy", (m) => {
  // Mock stablecoins on Amoy (testnet only; the user mints freely).
  // Amoy 테스트용 mock 스테이블코인 (자유 mint 가능).
  const mockUsdc = m.contract("MockERC20", ["Test USDC", "tUSDC", 6], {
    id: "TestUSDC",
  });
  const mockUsdt = m.contract("MockERC20", ["Test USDT", "tUSDT", 6], {
    id: "TestUSDT",
  });
  const mockDiscountToken = m.contract("MockERC20", ["Test Discount Token", "tDIS", 18], {
    id: "TestDiscountToken",
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

  // Reservation registry — useful on Amoy for testing trademark / premium
  // flows before mainnet.
  //
  // 예약 레지스트리 — Amoy에서 상표/프리미엄 플로우 테스트용.
  const reservations = m.contract("DXReservations", []);

  const contributionSBT = m.contract("DXContributionSBT", []);
  const subnameRegistrar = m.contract("DXSubnameRegistrar", [
    registry,
    resolver,
    m.getAccount(0),
    SUBNAME_PROTOCOL_FEE_BPS,
  ]);
  const dxnToken = m.contract("DXNToken", ["DEXignation Token", "DXN", DXN_CAP]);
  const dxnStaking = m.contract("DXNStaking", [dxnToken]);
  const revenueDistributor = m.contract(
    "RevenueDistributor",
    [
      [
        m.getAccount(0),
        dxnStaking,
        m.getAccount(0),
        BURN_ADDRESS,
        m.getAccount(0),
        5000,
        3000,
        1000,
        1000,
      ],
    ],
  );

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
  m.call(priceOracle, "setPolUsdOracle", [AMOY_POL_USD_FEED], {
    id: "SetPolUsdOracle",
  });
  m.call(controller, "setAllowedPaymentToken", [mockUsdc, true], {
    id: "AllowUSDC",
  });
  m.call(controller, "setAllowedPaymentToken", [mockUsdt, true], {
    id: "AllowUSDT",
  });
  m.call(controller, "setReservations", [reservations], { id: "WireReservations" });

  // v2: registrar ↔ resolver wiring for transfer-time record invalidation.
  m.call(registrar, "setResolver", [resolver], {
    id: "SetRegistrarResolver",
    after: [grantTld],
  });
  m.call(resolver, "setRegistrar", [registrar], { id: "SetResolverRegistrar" });

  // Set stake discount and add reward assets.
  m.call(controller, "setStakeDiscount", [
    dxnStaking,
    STAKE_DISCOUNT_THRESHOLD,
    STAKE_DISCOUNT_BPS,
  ], { id: "SetStakeDiscount" });
  m.call(dxnStaking, "setNotifier", [revenueDistributor, true], {
    id: "AllowRevenueDistributorNotifier",
  });
  m.call(revenueDistributor, "setStakingNotifier", [dxnStaking], {
    id: "SetRevenueDistributorStakingNotifier",
  });

  return {
    registry,
    registrar,
    resolver,
    priceOracle,
    reverseRegistrar,
    controller,
    reservations,
    contributionSBT,
    subnameRegistrar,
    dxnToken,
    dxnStaking,
    revenueDistributor,
    mockUsdc,
    mockUsdt,
    mockDiscountToken,
  };
});