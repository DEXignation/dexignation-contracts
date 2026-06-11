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
import DXDeployPolygon from "./DXDeployPolygon.js";

// ── Real Polygon mainnet stablecoins ──────────────────────────────────────
const POLYGON_USDT = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F";
const POLYGON_USDC = "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359";

// ── Trading-layer config ──────────────────────────────────────────────────
const FEE_BPS = 250n;            // 2.5% protocol fee (marketplace & auctions)
const MIN_INCREMENT_BPS = 500n;  // English: a new bid must beat top by +5%
const EXTEND_WINDOW = 600n;      // English anti-snipe: bids within 10 min …
const EXTEND_BY = 600n;          //   … push the deadline +10 min

// ── Subscription config ───────────────────────────────────────────────────
const RENEWAL_WINDOW = 30n * 24n * 60n * 60n; // 30 days before expiry

export default buildModule("DXDeployTradingPolygon", (m) => {
  // Reuse the REAL core already deployed on Polygon mainnet.
  //   메인넷에 이미 배포된 실제 코어 재사용 (재배포하지 않음).
  const { registrar, controller } =
    m.useModule(DXDeployPolygon);

  // Treasury / fee recipient. NOTE: defaults to deployer account(0).
  // For production you may want a multisig — see the note at the bottom.
  //   수수료 수신처. 기본은 배포자 계정. 운영 시 멀티시그 고려(하단 주석).
  const feeRecipient = m.getAccount(0);

  // ── Deploy the trading layer ───────────────────────────────────────────
  const marketplace = m.contract("DXMarketplace", [registrar, feeRecipient, FEE_BPS]);
  const english = m.contract("DXEnglishAuction", [
    registrar, feeRecipient, FEE_BPS, MIN_INCREMENT_BPS, EXTEND_WINDOW, EXTEND_BY,
  ]);
  const dutch = m.contract("DXDutchAuction", [registrar, feeRecipient, FEE_BPS]);

  // ── Deploy subscription module ─────────────────────────────────────────
  const subscriptionRenewer = m.contract("DXSubscriptionRenewer", [
    controller, registrar, RENEWAL_WINDOW,
  ]);

  // ── Wire the SVG marks on the registrar ────────────────────────────────
  m.call(registrar, "setMarketplace", [marketplace], { id: "WireMarketplaceMark" });
  m.call(registrar, "setAuctions", [english, dutch], { id: "WireAuctionMarks" });

  // ── Wire mutual exclusion (both directions) ────────────────────────────
  m.call(marketplace, "setAuctionContracts", [english, dutch], { id: "MarketplaceKnowsAuctions" });
  m.call(english, "setMarketplace", [marketplace], { id: "EnglishKnowsMarketplace" });
  m.call(dutch, "setMarketplace", [marketplace], { id: "DutchKnowsMarketplace" });

  // ── Whitelist REAL stablecoins on all three trading contracts ──────────
  m.call(marketplace, "setPayToken", [POLYGON_USDC, true], { id: "MktAllowUSDC" });
  m.call(marketplace, "setPayToken", [POLYGON_USDT, true], { id: "MktAllowUSDT" });
  m.call(english, "setPayToken", [POLYGON_USDC, true], { id: "EngAllowUSDC" });
  m.call(english, "setPayToken", [POLYGON_USDT, true], { id: "EngAllowUSDT" });
  m.call(dutch, "setPayToken", [POLYGON_USDC, true], { id: "DutchAllowUSDC" });
  m.call(dutch, "setPayToken", [POLYGON_USDT, true], { id: "DutchAllowUSDT" });

  return {
    marketplace,
    english,
    dutch,
    subscriptionRenewer,
  };
});
