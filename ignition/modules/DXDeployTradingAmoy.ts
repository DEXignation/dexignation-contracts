// SPDX-License-Identifier: MIT
//
// Ignition module - Polygon Amoy trading + commerce layer.
//
// Deploys, on top of the Amoy core protocol (DXDeployAmoy):
//   - DXMarketplace         (fixed-price P2P)
//   - DXEnglishAuction      (timed ascending, escrow + anti-snipe)
//   - DXDutchAuction        (step descending price)
//   - DXSubscriptionRenewer (auto-renewal)
//
// This mirrors DXDeployTradingPolygon, but reuses the Amoy testnet core and
// whitelists the Amoy mock stablecoins deployed by DXDeployAmoy.

import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import DXDeployAmoy from "./DXDeployAmoy.js";

// Trading-layer config
const FEE_BPS = 250n;            // 2.5% protocol fee (marketplace & auctions)
const MIN_INCREMENT_BPS = 500n;  // English: a new bid must beat top by +5%
const EXTEND_WINDOW = 600n;      // English anti-snipe: bids within 10 min...
const EXTEND_BY = 600n;          // ...push the deadline +10 min

// Subscription config
const RENEWAL_WINDOW = 30n * 24n * 60n * 60n; // 30 days before expiry

export default buildModule("DXDeployTradingAmoy", (m) => {
  const { registrar, controller, mockUsdc, mockUsdt } =
    m.useModule(DXDeployAmoy);

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
  m.call(marketplace, "setAuctionContracts", [english, dutch], {id: "MarketplaceKnowsAuctions",});
  m.call(english, "setMarketplace", [marketplace], { id: "EnglishKnowsMarketplace" });
  m.call(dutch, "setMarketplace", [marketplace], { id: "DutchKnowsMarketplace" });

  // ── Whitelist REAL stablecoins on all three trading contracts ──────────
  m.call(marketplace, "setPayToken", [mockUsdc, true], { id: "MktAllowUSDC" });
  m.call(marketplace, "setPayToken", [mockUsdt, true], { id: "MktAllowUSDT" });
  m.call(english, "setPayToken", [mockUsdc, true], { id: "EngAllowUSDC" });
  m.call(english, "setPayToken", [mockUsdt, true], { id: "EngAllowUSDT" });
  m.call(dutch, "setPayToken", [mockUsdc, true], { id: "DutchAllowUSDC" });
  m.call(dutch, "setPayToken", [mockUsdt, true], { id: "DutchAllowUSDT" });

  return {
    marketplace,
    english,
    dutch,
    subscriptionRenewer,
  };
});
