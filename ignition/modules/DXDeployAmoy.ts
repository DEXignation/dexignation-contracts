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
const DXN_PURCHASE_REWARD_BPS = 1000n;
const DXN_PURCHASE_REWARD_PRICE_ATTO_USD = 2n * 10n ** 18n;

const REVENUE_BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const REVENUE_DISTRIBUTOR_TREASURY_BPS = 6000;
const REVENUE_DISTRIBUTOR_STAKING_BPS = 3000;
const REVENUE_DISTRIBUTOR_BURN_BPS = 0;
const REVENUE_DISTRIBUTOR_BUFFER_BPS = 1000;

const STAKE_DISCOUNT_THRESHOLD = 100n * 10n ** 18n;
const STAKE_DISCOUNT_BPS = 250n;

// Subname commerce (A3): protocol fee per subname sale, routed to the
// RevenueDistributor. 500 bps = 5% (cap MAX_FEE_BPS = 2000 / 20%).
//   서브네임 판매당 프로토콜 수수료(RevenueDistributor로). 500 bps = 5%.
const SUBNAME_PROTOCOL_FEE_BPS = 500n;

export default buildModule("DXDeployAmoy", (m) => {
  const owner = m.getAccount(0);
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

  const registry = m.contract("DXRegistry", [owner]);
  const registrar = m.contract("DXRegistrar", [registry, TLD_NODE, TLD, owner]);
  const resolver = m.contract("DXResolver", [registry, owner]);
  const priceOracle = m.contract("DXPriceOracle", [RENT_PRICES, owner]);
  const reverseRegistrar = m.contract("DXReverseRegistrar", [registry, resolver]);
  const controller = m.contract("DXRegistrarController", [registrar,registry,priceOracle, owner]);

  // Reservation registry — useful on Amoy for testing trademark / premium
  // flows before mainnet.
  //
  // 예약 레지스트리 — Amoy에서 상표/프리미엄 플로우 테스트용.
  const reservations = m.contract("DXReservations", [owner]);
  const contributionSBT = m.contract("DXContributionSBT", [owner]);
  const dxnToken = m.contract("DXNToken", ["DEXignation Token", "DXN", DXN_CAP, owner]);
  const dxnStaking = m.contract("DXNStaking", [dxnToken, m.getAccount(0), owner]);
  const revenueDistributor = m.contract(
    "RevenueDistributor",
    [
      [
        m.getAccount(0),
        dxnStaking,
        m.getAccount(0),
        REVENUE_BURN_ADDRESS,
        m.getAccount(0),
        REVENUE_DISTRIBUTOR_TREASURY_BPS,
        REVENUE_DISTRIBUTOR_STAKING_BPS,
        REVENUE_DISTRIBUTOR_BURN_BPS,
        REVENUE_DISTRIBUTOR_BUFFER_BPS,
      ],
      owner,
    ],
  );

  // Subname commerce module (A3). Default resolver = the protocol resolver;
  // fee recipient = the RevenueDistributor. Authorised as a sale module below
  // (AllowSubnameSaleModule). Each parent owner must additionally delegate at
  // runtime via registry.setApprovalForAll(subnameRegistrar, true) before
  // selling subnames.
  //   서브네임 커머스 모듈. 기본 resolver=프로토콜 resolver, 수수료 수신처=
  //   RevenueDistributor. 아래에서 판매 모듈로 인가. 각 부모는 판매 전 런타임에
  //   setApprovalForAll로 위임해야 한다.
  const subnameRegistrar = m.contract("DXSubnameRegistrar", [
    registry,
    resolver,
    revenueDistributor,
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
  m.call(priceOracle, "setPolUsdOracle", [AMOY_POL_USD_FEED], {id: "SetPolUsdOracle"});
  m.call(controller, "setAllowedPaymentToken", [mockUsdc, true], {id: "AllowUSDC"});
  m.call(controller, "setAllowedPaymentToken", [mockUsdt, true], {id: "AllowUSDT"});
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

  // v2: authorise the subname module as a registry sale module so it may call
  // issueSubnodeRecordLocked (sale-locked subname issuance). Root-node (0x0)
  // owner only — the deployer (account 0) holds it.
  //   서브네임 모듈을 registry 판매 모듈로 인가(판매-잠금 발급 권한). 루트(0x0)
  //   소유자=배포자만 호출.
  m.call(registry, "setSaleModule", [subnameRegistrar, true], {
    id: "AllowSubnameSaleModule",
  });

  // Set stake discount and set revenue distributor notifier
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

  // Set DXN purchase reward
  m.call(dxnToken, "setMinter", [controller, true], { id: "AllowControllerDxnMint" });
  m.call(controller, "setDxnReward", [
    dxnToken,
    DXN_PURCHASE_REWARD_BPS,
    DXN_PURCHASE_REWARD_PRICE_ATTO_USD,
  ], {
    id: "SetDxnPurchaseReward",
  });

  // ── Mint mock tokens ──────────────────────────────────────────────────────
  m.call(mockUsdc, "mint", [m.getAccount(0), 10000n * 10n ** 6n], {
    id: "MintUsdc",
  });
  m.call(mockUsdt, "mint", [m.getAccount(0), 10000n * 10n ** 6n], {
    id: "MintUsdt",
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
    dxnToken,
    dxnStaking,
    revenueDistributor,
    subnameRegistrar,
    mockUsdc,
    mockUsdt,
    mockDiscountToken,
  };
});
