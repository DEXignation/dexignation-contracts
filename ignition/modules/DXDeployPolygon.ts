// SPDX-License-Identifier: MIT
//
// Ignition module — Polygon mainnet deployment.
// Uses production Chainlink feeds and real USDT / USDC.
//
// Polygon 메인넷 배포 모듈. 운영용 Chainlink 피드와 실제 USDT/USDC 사용.

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

// Production Chainlink feeds on Polygon mainnet.
// Verify against https://docs.chain.link/data-feeds/price-feeds/addresses
// before deploying.
// Polygon 메인넷 Chainlink 피드. 배포 전 위 링크에서 재확인.
const POLYGON_POL_USD_FEED = "0xAB594600376Ec9fD91F8e885dADF0CE036862dE0";

// Real USDT / USDC on Polygon mainnet.
const POLYGON_USDT = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
const POLYGON_USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

const DXN_CAP = 100_000_000n * 10n ** 18n;
const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const STAKE_DISCOUNT_THRESHOLD = 100n * 10n ** 18n;
const STAKE_DISCOUNT_BPS = 250n;
const SUBNAME_PROTOCOL_FEE_BPS = 250n;

export default buildModule("DXDeployPolygon", (m) => {
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

  // Reservation registry for trademark / premium handling on mainnet.
  // 메인넷의 상표/프리미엄 라벨 처리용 예약 레지스트리.
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
  m.call(priceOracle, "setPolUsdOracle", [POLYGON_POL_USD_FEED], {
    id: "SetPolUsdOracle",
  });
  m.call(controller, "setAllowedPaymentToken", [POLYGON_USDC, true], {
    id: "AllowUSDC",
  });
  m.call(controller, "setAllowedPaymentToken", [POLYGON_USDT, true], {
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

  // setDiscountToken is left disabled by default. The owner activates it
  // once a partner/community token (e.g. MOL on Polygon) is chosen.
  //   할인 토큰은 기본 비활성. owner가 파트너/커뮤니티 토큰(예: Polygon MOL)을
  //   정한 뒤 별도 호출로 활성화.

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
  };
});