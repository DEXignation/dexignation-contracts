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
import DXDeployLocal from "./DXDeployLocal.js";

// ── Trading-layer config ──────────────────────────────────────────────────
const FEE_BPS = 250n;             // 2.5% protocol fee (both marketplace & auctions)
const MIN_INCREMENT_BPS = 500n;   // English: a new bid must beat the top by +5%
const EXTEND_WINDOW = 600n;       // English anti-snipe: bids within 10 min …
const EXTEND_BY = 600n;           //   … push the deadline +10 min

export default buildModule("DXDeployTrading", (m) => {
  // Reuse the core protocol + mock tokens from DXDeployLocal.
  //   DXDeployLocal의 핵심 프로토콜 + mock 토큰 재사용.
  const { registrar, mockUsdc, mockUsdt } = m.useModule(DXDeployLocal);

  const feeRecipient = m.getAccount(0); // stand-in treasury / RevenueDistributor

  // ── Deploy the trading layer ──────────────────────────────────────────────
  const marketplace = m.contract("DXMarketplace", [registrar, feeRecipient, FEE_BPS]);
  const english = m.contract("DXEnglishAuction", [
    registrar, feeRecipient, FEE_BPS, MIN_INCREMENT_BPS, EXTEND_WINDOW, EXTEND_BY,
  ]);
  const dutch = m.contract("DXDutchAuction", [registrar, feeRecipient, FEE_BPS]);

  // ── Wire the SVG marks on the registrar ───────────────────────────────────
  m.call(registrar, "setMarketplace", [marketplace], { id: "WireMarketplaceMark" });
  m.call(registrar, "setAuctions", [english, dutch], { id: "WireAuctionMarks" });

  // ── Wire mutual exclusion (both directions) ───────────────────────────────
  m.call(marketplace, "setAuctionContracts", [english, dutch], { id: "MarketplaceKnowsAuctions" });
  m.call(english, "setMarketplace", [marketplace], { id: "EnglishKnowsMarketplace" });
  m.call(dutch, "setMarketplace", [marketplace], { id: "DutchKnowsMarketplace" });

  // ── Whitelist stablecoins on all three ────────────────────────────────────
  m.call(marketplace, "setPayToken", [mockUsdc, true], { id: "MktAllowUSDC" });
  m.call(marketplace, "setPayToken", [mockUsdt, true], { id: "MktAllowUSDT" });
  m.call(english, "setPayToken", [mockUsdc, true], { id: "EngAllowUSDC" });
  m.call(english, "setPayToken", [mockUsdt, true], { id: "EngAllowUSDT" });
  m.call(dutch, "setPayToken", [mockUsdc, true], { id: "DutchAllowUSDC" });
  m.call(dutch, "setPayToken", [mockUsdt, true], { id: "DutchAllowUSDT" });

  return { marketplace, english, dutch };
});
