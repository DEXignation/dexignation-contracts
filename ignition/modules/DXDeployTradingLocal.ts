// SPDX-License-Identifier: MIT
//
// Ignition module — Marketplace + Auctions (English & Dutch) with full wiring.
//
//   Deploys the trading layer on top of the core protocol and wires every
//   cross-reference so the mutual-exclusion checks and SVG marks work:
//     • DXMarketplace        (fixed-price)
//     • DXEnglishAuction     (timed ascending, escrow + anti-snipe)
//     • DXDutchAuction       (step descending price)
//
//   Wiring performed here (the reason a single module is convenient):
//     registrar.setMarketplace(marketplace)            // LISTED mark
//     registrar.setAuctions(english, dutch)            // AUCTION mark
//     marketplace.setAuctionContracts(english, dutch)  // list() ↔ auction mutual-excl
//     english.setMarketplace(marketplace)              // createAuction ↔ listing mutual-excl
//     dutch.setMarketplace(marketplace)                //   〃
//     english.setPeerAuction(dutch)                    // English ↔ Dutch mutual-excl
//     dutch.setPeerAuction(english)                    //   〃
//     {marketplace,english,dutch}.setPayToken(USDC/USDT, true)
//
//   거래 레이어를 핵심 프로토콜 위에 배포하고, 상호 배타 검사와 SVG 마크가
//   작동하도록 모든 상호참조를 연결한다. 위 6종 호출이 한 모듈에 모여 있어
//   배포 후 수동 연결 실수를 막는다.
//
//   This module assumes the core protocol is already deployed via
//   DXDeployLocal (registry/registrar/resolver/controller/mock tokens). It
//   imports that module so Ignition reuses the same instances.
//   핵심 프로토콜은 DXDeployLocal로 이미 배포된 것으로 가정하고 import하여
//   Ignition이 동일 인스턴스를 재사용하게 한다.

import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { encodePacked, keccak256, toBytes, zeroHash } from "viem";
import DXDeployLocal from "./DXDeployLocal.js";

// ── Trading-layer config ──────────────────────────────────────────────────
const FEE_BPS = 250n;             // 2.5% protocol fee (both marketplace & auctions)
const MIN_INCREMENT_BPS = 1000n;   // English: a new bid must beat the top by +10%
const EXTEND_WINDOW = 600n;       // English anti-snipe: bids within 10 min …
const EXTEND_BY = 1200n;          //   … push the deadline +20 min

// Subscription config
const RENEWAL_WINDOW = 30n * 24n * 60n * 60n; // 30 days before expiry
const REVERSE_LABEL_HASH = keccak256(toBytes("reverse"));
const REVERSE_NODE = keccak256(
  encodePacked(["bytes32", "bytes32"], [zeroHash, REVERSE_LABEL_HASH]),
);

export default buildModule("DXDeployTrading", (m) => {
  // Reuse the core protocol + mock tokens from DXDeployLocal.
  //   DXDeployLocal의 핵심 프로토콜 + mock 토큰 재사용.
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
    mockUsdc,
    mockUsdt,
  } = m.useModule(DXDeployLocal);

  const feeRecipient = m.getAccount(0); // stand-in treasury / RevenueDistributor
  const owner = m.getAccount(0);        // contract owner (Ownable)
  const adminSafe = m.getParameter("adminSafe", owner);

  // ── Deploy the trading layer ──────────────────────────────────────────────
  const marketplace = m.contract("DXMarketplace", [registrar, feeRecipient, FEE_BPS, owner]);
  const english = m.contract("DXEnglishAuction", [
    registrar, feeRecipient, FEE_BPS, MIN_INCREMENT_BPS, EXTEND_WINDOW, EXTEND_BY, owner,
  ]);
  const dutch = m.contract("DXDutchAuction", [registrar, feeRecipient, FEE_BPS, owner]);

  // ── Deploy subscription module ─────────────────────────────────────────
  const subscriptionRenewer = m.contract("DXSubscriptionRenewer", [
    controller, registrar, RENEWAL_WINDOW, owner,
  ]);

  // ── Wire the SVG marks on the registrar ───────────────────────────────────
  const wireMarketplaceMark = m.call(registrar, "setMarketplace", [marketplace], { id: "WireMarketplaceMark" });
  const wireAuctionMarks = m.call(registrar, "setAuctions", [english, dutch], { id: "WireAuctionMarks" });

  // ── Wire mutual exclusion (both directions) ───────────────────────────────
  const marketplaceKnowsAuctions = m.call(marketplace, "setAuctionContracts", [english, dutch], { id: "MarketplaceKnowsAuctions" });
  const englishKnowsMarketplace = m.call(english, "setMarketplace", [marketplace], { id: "EnglishKnowsMarketplace" });
  const dutchKnowsMarketplace = m.call(dutch, "setMarketplace", [marketplace], { id: "DutchKnowsMarketplace" });
  const englishKnowsDutch = m.call(english, "setPeerAuction", [dutch], { id: "EnglishKnowsDutch" });
  const dutchKnowsEnglish = m.call(dutch, "setPeerAuction", [english], { id: "DutchKnowsEnglish" });

  // ── Whitelist stablecoins on all three ────────────────────────────────────
  const mktAllowUsdc = m.call(marketplace, "setPayToken", [mockUsdc, true], { id: "MktAllowUSDC" });
  const mktAllowUsdt = m.call(marketplace, "setPayToken", [mockUsdt, true], { id: "MktAllowUSDT" });
  const engAllowUsdc = m.call(english, "setPayToken", [mockUsdc, true], { id: "EngAllowUSDC" });
  const engAllowUsdt = m.call(english, "setPayToken", [mockUsdt, true], { id: "EngAllowUSDT" });
  const dutchAllowUsdc = m.call(dutch, "setPayToken", [mockUsdc, true], { id: "DutchAllowUSDC" });
  const dutchAllowUsdt = m.call(dutch, "setPayToken", [mockUsdt, true], { id: "DutchAllowUSDT" });

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
