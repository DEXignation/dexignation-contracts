// SPDX-License-Identifier: MIT
//
// Ignition module — Polygon MAINNET trading + commerce layer.
//
//   Deploys, on top of the ALREADY-DEPLOYED core (DXDeployPolygon):
//     • DXMarketplace         (fixed-price P2P)
//     • DXEnglishAuction      (timed ascending, escrow + anti-snipe)
//     • DXDutchAuction        (step descending price)
//     • DXSubscriptionRenewer (auto-renewal)
//
//   CRITICAL DIFFERENCE vs DXDeployTrading.ts:
//     - imports DXDeployPolygon (NOT DXDeployLocal) → reuses the real core
//       instances already on mainnet, never redeploys them.
//     - uses REAL Polygon USDC/USDT, never Mock tokens.
//
//   DXDeployTrading.ts와의 결정적 차이: DXDeployLocal이 아니라
//   DXDeployPolygon을 import하여 메인넷에 이미 배포된 실제 코어를 재사용하고,
//   Mock이 아닌 실제 Polygon USDC/USDT를 사용한다.

import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { encodePacked, keccak256, toBytes, zeroHash } from "viem";
import DXDeployPolygon from "./DXDeployPolygon.js";

// ── Real Polygon mainnet stablecoins ──────────────────────────────────────
const POLYGON_USDT = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
const POLYGON_USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

// ── Trading-layer config ──────────────────────────────────────────────────
const FEE_BPS = 250n;            // 2.5% protocol fee (marketplace & auctions)
const MIN_INCREMENT_BPS = 500n;  // English: a new bid must beat top by +5%
const EXTEND_WINDOW = 600n;      // English anti-snipe: bids within 10 min …
const EXTEND_BY = 1200n;         //   … push the deadline +20 min

// ── Subscription config ───────────────────────────────────────────────────
const RENEWAL_WINDOW = 30n * 24n * 60n * 60n; // 30 days before expiry
const REVERSE_LABEL_HASH = keccak256(toBytes("reverse"));
const REVERSE_NODE = keccak256(
  encodePacked(["bytes32", "bytes32"], [zeroHash, REVERSE_LABEL_HASH]),
);

export default buildModule("DXDeployTradingPolygon", (m) => {
  // Reuse the REAL core already deployed on Polygon mainnet.
  //   메인넷에 이미 배포된 실제 코어 재사용 (재배포하지 않음).
  const {
    registry,
    registrar,
    controller,
    resolver,
    priceOracle,
    reservations,
    contributionSBT,
    dxnToken,
    dxnStaking,
    revenueDistributor,
    subnameRegistrar,
  } =
    m.useModule(DXDeployPolygon);

  // Treasury / fee recipient. NOTE: defaults to deployer account(0).
  // For production you may want a multisig — see the note at the bottom.
  //   수수료 수신처. 기본은 배포자 계정. 운영 시 멀티시그 고려(하단 주석).
  const feeRecipient = m.getAccount(0);
  const owner = m.getAccount(0);
  const adminSafe = m.getParameter("adminSafe", owner);

  // ── Deploy the trading layer ───────────────────────────────────────────
  const marketplace = m.contract("DXMarketplace", [registrar, feeRecipient, FEE_BPS, owner]);
  const english = m.contract("DXEnglishAuction", [
    registrar, feeRecipient, FEE_BPS, MIN_INCREMENT_BPS, EXTEND_WINDOW, EXTEND_BY, owner,
  ]);
  const dutch = m.contract("DXDutchAuction", [registrar, feeRecipient, FEE_BPS, owner]);

  // ── Deploy subscription module ─────────────────────────────────────────
  const subscriptionRenewer = m.contract("DXSubscriptionRenewer", [
    controller, registrar, RENEWAL_WINDOW, owner,
  ]);

  // ── Wire the SVG marks on the registrar ────────────────────────────────
  const wireMarketplaceMark = m.call(registrar, "setMarketplace", [marketplace], { id: "WireMarketplaceMark" });
  const wireAuctionMarks = m.call(registrar, "setAuctions", [english, dutch], { id: "WireAuctionMarks" });

  // ── Wire mutual exclusion (both directions) ────────────────────────────
  const marketplaceKnowsAuctions = m.call(marketplace, "setAuctionContracts", [english, dutch], { id: "MarketplaceKnowsAuctions" });
  const englishKnowsMarketplace = m.call(english, "setMarketplace", [marketplace], { id: "EnglishKnowsMarketplace" });
  const dutchKnowsMarketplace = m.call(dutch, "setMarketplace", [marketplace], { id: "DutchKnowsMarketplace" });
  const englishKnowsDutch = m.call(english, "setPeerAuction", [dutch], { id: "EnglishKnowsDutch" });
  const dutchKnowsEnglish = m.call(dutch, "setPeerAuction", [english], { id: "DutchKnowsEnglish" });

  // ── Whitelist REAL stablecoins on all three trading contracts ──────────
  const mktAllowUsdc = m.call(marketplace, "setPayToken", [POLYGON_USDC, true], { id: "MktAllowUSDC" });
  const mktAllowUsdt = m.call(marketplace, "setPayToken", [POLYGON_USDT, true], { id: "MktAllowUSDT" });
  const engAllowUsdc = m.call(english, "setPayToken", [POLYGON_USDC, true], { id: "EngAllowUSDC" });
  const engAllowUsdt = m.call(english, "setPayToken", [POLYGON_USDT, true], { id: "EngAllowUSDT" });
  const dutchAllowUsdc = m.call(dutch, "setPayToken", [POLYGON_USDC, true], { id: "DutchAllowUSDC" });
  const dutchAllowUsdt = m.call(dutch, "setPayToken", [POLYGON_USDT, true], { id: "DutchAllowUSDT" });

  // ── Handoff ownership ──────────────────────────────────────────────────────
  const handoffAfter = [
    wireMarketplaceMark,
    wireAuctionMarks,
    marketplaceKnowsAuctions,
    englishKnowsMarketplace,
    dutchKnowsMarketplace,
    englishKnowsDutch,
    dutchKnowsEnglish,
    mktAllowUsdc,
    mktAllowUsdt,
    engAllowUsdc,
    engAllowUsdt,
    dutchAllowUsdc,
    dutchAllowUsdt,
  ];

  // Allow admin safe to mint DXN tokens
  const allowAdminSafeDxnMint = m.call(dxnToken, "setMinter", [adminSafe, true], {
    id: "AllowAdminSafeDxnMint",
    after: handoffAfter,
  });
  // Transfer ownership to admin safe
  m.call(registrar, "transferOwnership", [adminSafe], { id: "HandoffRegistrarToSafe", after: handoffAfter });
  m.call(controller, "transferOwnership", [adminSafe], { id: "HandoffControllerToSafe", after: handoffAfter });
  m.call(resolver, "transferOwnership", [adminSafe], { id: "HandoffResolverToSafe", after: handoffAfter });
  m.call(priceOracle, "transferOwnership", [adminSafe], { id: "HandoffPriceOracleToSafe", after: handoffAfter });
  m.call(reservations, "transferOwnership", [adminSafe], { id: "HandoffReservationsToSafe", after: handoffAfter });
  m.call(contributionSBT, "transferOwnership", [adminSafe], { id: "HandoffContributionSBTToSafe", after: handoffAfter });
  m.call(dxnToken, "transferOwnership", [adminSafe], { id: "HandoffDxnTokenToSafe", after: [allowAdminSafeDxnMint] });
  m.call(dxnStaking, "transferOwnership", [adminSafe], { id: "HandoffDxnStakingToSafe", after: handoffAfter });
  m.call(revenueDistributor, "transferOwnership", [adminSafe], { id: "HandoffRevenueDistributorToSafe", after: handoffAfter });
  m.call(subnameRegistrar, "transferOwnership", [adminSafe], { id: "HandoffSubnameRegistrarToSafe", after: handoffAfter });
  m.call(marketplace, "transferOwnership", [adminSafe], { id: "HandoffMarketplaceToSafe", after: handoffAfter });
  m.call(english, "transferOwnership", [adminSafe], { id: "HandoffEnglishAuctionToSafe", after: handoffAfter });
  m.call(dutch, "transferOwnership", [adminSafe], { id: "HandoffDutchAuctionToSafe", after: handoffAfter });
  m.call(subscriptionRenewer, "transferOwnership", [adminSafe], { id: "HandoffSubscriptionRenewerToSafe", after: handoffAfter });
  // Reverse node and root node ownership transfer
  m.call(registry, "setOwner", [REVERSE_NODE, adminSafe], { id: "HandoffRegistryReverseToSafe", after: handoffAfter });
  m.call(registry, "setOwner", [zeroHash, adminSafe], { id: "HandoffRegistryRootToSafe", after: handoffAfter });

  return {
    marketplace,
    english,
    dutch,
    subscriptionRenewer,
  };
});
