// SPDX-License-Identifier: MIT
//
// Ignition module — local deployment with Mock dependencies.
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
  55n * 10n ** 18n,
];

const MOCK_POL_USD = 40_000_000n; // $0.40 with 8 decimals.

const DXN_CAP = 100_000_000n * 10n ** 18n;
const DXN_INITIAL_MINT = 1_000_000n * 10n ** 18n;
const DXN_PURCHASE_REWARD_BPS = 1000n;
const DXN_PURCHASE_REWARD_PRICE_ATTO_USD = 2n * 10n ** 18n;

const REVENUE_BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const REVENUE_DISTRIBUTOR_TREASURY_BPS = 6000;
const REVENUE_DISTRIBUTOR_STAKING_BPS = 3000;
const REVENUE_DISTRIBUTOR_BURN_BPS = 0;
const REVENUE_DISTRIBUTOR_BUFFER_BPS = 1000;

const STAKE_DISCOUNT_THRESHOLD = 100n * 10n ** 18n;
const STAKE_DISCOUNT_BPS = 250n;

// Subname commerce (A3): protocol fee taken from each subname sale, routed to
// the RevenueDistributor. 500 bps = 5% (cap is MAX_FEE_BPS = 2000 / 20%).
//   서브네임 판매당 프로토콜 수수료(RevenueDistributor로). 500 bps = 5%.
const SUBNAME_PROTOCOL_FEE_BPS = 500n;

export default buildModule("DXDeployLocal", (m) => {
  const owner = m.getAccount(0);
  // ── Mocks ─────────────────────────────────────────────────────────────────
  const mockUsdc = m.contract("MockERC20", ["Mock USDC", "tUSDC", 6], { 
    id: "MockUSDC" 
  });
  const mockUsdt = m.contract("MockERC20", ["Mock USDT", "tUSDT", 6], {
    id: "MockUSDT" 
  });
  const mockDiscountToken = m.contract("MockERC20", ["Mock Discount Token", "tDIS", 18], {
    id: "MockDiscountToken" 
  });
  const mockPolUsd = m.contract("MockPriceOracle", [8, MOCK_POL_USD], {
    id: "MockPolUsd" 
  });

  // ── Core protocol ─────────────────────────────────────────────────────────
  const registry = m.contract("DXRegistry", [owner]);
  const registrar = m.contract("DXRegistrar", [registry, TLD_NODE, TLD, owner]);
  const resolver = m.contract("DXResolver", [registry, owner]);
  const priceOracle = m.contract("DXPriceOracle", [RENT_PRICES, owner]);
  const reverseRegistrar = m.contract("DXReverseRegistrar", [registry, resolver]);
  const controller = m.contract("DXRegistrarController", [registrar, registry, priceOracle, owner]);

  // ── Optional add-ons ──────────────────────────────────────────────────────
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
  // fee recipient = the RevenueDistributor. Must be authorised as a sale module
  // (see "AllowSubnameSaleModule" below) AND delegated by each parent owner
  // (registry.setApprovalForAll at runtime) before it can issue subnames.
  //   서브네임 커머스 모듈. 기본 resolver=프로토콜 resolver, 수수료 수신처=
  //   RevenueDistributor. 발급하려면 판매 모듈 인가(아래) + 각 부모의 위임 필요.
  const subnameRegistrar = m.contract("DXSubnameRegistrar", [
    registry,
    resolver,
    revenueDistributor,
    SUBNAME_PROTOCOL_FEE_BPS,
    owner,
  ]);

  // ── Wiring ────────────────────────────────────────────────────────────────
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
  m.call(priceOracle, "setPolUsdOracle", [mockPolUsd], { id: "SetPolUsdOracle" });
  m.call(controller, "setAllowedPaymentToken", [mockUsdc, true], { id: "AllowUSDC" });
  m.call(controller, "setAllowedPaymentToken", [mockUsdt, true], { id: "AllowUSDT" });
  m.call(controller, "setReservations", [reservations], { id: "WireReservations" });
  m.call(controller, "setStakeDiscount", [
    dxnStaking,
    STAKE_DISCOUNT_THRESHOLD,
    STAKE_DISCOUNT_BPS,
  ], { id: "SetStakeDiscount" });
  m.call(dxnStaking, "addRewardAsset", [mockUsdc], { id: "AddUsdcRewardAsset" });
  m.call(dxnStaking, "addRewardAsset", [mockUsdt], { id: "AddUsdtRewardAsset" });
  m.call(dxnStaking, "setNotifier", [revenueDistributor, true], {
    id: "AllowRevenueDistributorNotifier",
  });
  m.call(revenueDistributor, "setStakingNotifier", [dxnStaking], {
    id: "SetRevenueDistributorStakingNotifier",
  });
  m.call(dxnToken, "setMinter", [controller, true], { id: "AllowControllerDxnMint" });
  m.call(controller, "setDxnReward", [
    dxnToken,
    DXN_PURCHASE_REWARD_BPS,
    DXN_PURCHASE_REWARD_PRICE_ATTO_USD,
  ], {
    id: "SetDxnPurchaseReward",
  });

  // ── v2: registrar ↔ resolver wiring for transfer-time record invalidation ──
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

  // ── v2: subname sale-lock commerce wiring ──────────────────────────────────
  // Authorise the subname module as a registry sale module so it may call
  // issueSubnodeRecordLocked. Root-node (0x0) owner only — deployer (account 0).
  //   서브네임 모듈을 registry 판매 모듈로 인가. 루트(0x0) 소유자=배포자.
  m.call(registry, "setSaleModule", [subnameRegistrar, true], {
    id: "AllowSubnameSaleModule",
  });

  // ── Mint mock tokens ──────────────────────────────────────────────────────
  m.call(mockUsdc, "mint", [m.getAccount(0), 1000n * 10n ** 6n], {
    id: "MintUsdc",
  });
  m.call(mockUsdt, "mint", [m.getAccount(0), 1000n * 10n ** 6n], {
    id: "MintUsdt",
  });
  m.call(mockDiscountToken, "mint", [m.getAccount(0), 1000n * 10n ** 18n], {
    id: "MintDiscountToken",
  });
  m.call(dxnToken, "mint", [m.getAccount(0), DXN_INITIAL_MINT], {
    id: "MintDxn",
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
    mockPolUsd,
  };
});
