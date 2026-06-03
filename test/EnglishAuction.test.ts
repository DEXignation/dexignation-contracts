// SPDX-License-Identifier: MIT
//
// Integration tests for DXEnglishAuction — timed ascending auction for .dex 2LD.
//
// Exercises the full path against the REAL registrar + registry:
//   create → bid (escrow) → outbid (pull-refund ledger) → withdraw →
//   anti-snipe extension → settle (atomic pay + transfer + subname follow).
// Plus guards: reserve, min-increment, no-cancel-after-bid, settle re-checks
// ownership, mutual exclusion with the fixed-price marketplace.
//
// 실제 registrar+registry 대상 영국식 경매 전체 흐름 + 가드 검증.

import { expect } from "chai";
import { network } from "hardhat";
import {
  keccak256, toBytes, encodeAbiParameters, parseAbiParameters, encodePacked,
} from "viem";
import DXDeployLocal from "../ignition/modules/DXDeployLocal.js";

async function expectRevert(p: Promise<unknown>, kw?: string): Promise<void> {
  try { await p; } catch (e: unknown) { if (kw) expect(String(e)).to.include(kw); return; }
  throw new Error(kw ? `Expected revert with ${kw}` : "Expected revert");
}

const ONE_YEAR = 365n * 24n * 60n * 60n;
const MIN_COMMITMENT_AGE = 30n;
const ZERO = "0x0000000000000000000000000000000000000000" as `0x${string}`;

const FEE_BPS = 250n;             // 2.5%
const MAX_FEE_BPS = 1000n;
const MIN_INCREMENT_BPS = 500n;   // +5% over current top
const EXTEND_WINDOW = 600n;       // 10 min
const EXTEND_BY = 600n;           // +10 min
const AUCTION_DUR = 3600n;        // 1 hour
const RESERVE = 100n * 10n ** 6n; // 100 USDC
const MINT = 10_000n * 10n ** 6n;

function labelHash(l: string): `0x${string}` { return keccak256(toBytes(l)); }
function tokenIdOf(l: string): bigint { return BigInt(labelHash(l)); }
function subnodeFor(p: `0x${string}`, l: string): `0x${string}` {
  return keccak256(encodePacked(["bytes32", "bytes32"], [p, labelHash(l)]));
}
function tldNode(): `0x${string}` {
  return subnodeFor("0x0000000000000000000000000000000000000000000000000000000000000000", "dex");
}

describe("DXEnglishAuction — timed ascending auction for .dex 2LD", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob, carol, dave] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();

    const auction = await viem.deployContract("DXEnglishAuction", [
      deployed.registrar.address, owner.account.address, FEE_BPS,
      MIN_INCREMENT_BPS, EXTEND_WINDOW, EXTEND_BY,
    ]);
    await auction.write.setPayToken([deployed.mockUsdc.address, true], { account: owner.account });
    // Wire the auction to the registrar so tokenURI can render the AUCTION mark.
    //   tokenURI가 AUCTION 마크를 그릴 수 있도록 경매를 registrar에 연결.
    await deployed.registrar.write.setAuctions(
      [auction.address, "0x0000000000000000000000000000000000000000"],
      { account: owner.account });

    return { ...deployed, auction, owner, alice, bob, carol, dave, publicClient, testClient, viem };
  }

  async function registerName(d: any, who: any, label: string) {
    const { controller, resolver, testClient } = d;
    const secret = `0x${"a1".repeat(32)}` as `0x${string}`;
    const commitment = keccak256(encodeAbiParameters(
      parseAbiParameters("string, address, uint256, address, address, bytes32"),
      [label, who.account.address, ONE_YEAR, resolver.address, ZERO, secret]));
    await controller.write.commit([commitment], { account: who.account });
    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });
    const price = await controller.read.rentPrice([ONE_YEAR]);
    await controller.write.register(
      [label, who.account.address, ONE_YEAR, resolver.address, secret],
      { account: who.account, value: price });
    return tokenIdOf(label);
  }

  // register + approve auction + createAuction
  async function startAuction(d: any, seller: any, label: string, reserve = RESERVE) {
    const { auction, registrar, mockUsdc } = d;
    const tokenId = await registerName(d, seller, label);
    await registrar.write.approve([auction.address, tokenId], { account: seller.account });
    await auction.write.createAuction(
      [tokenId, mockUsdc.address, reserve, AUCTION_DUR], { account: seller.account });
    return tokenId;
  }

  async function fund(d: any, who: any, amount = MINT) {
    await d.mockUsdc.write.mint([who.account.address, amount], { account: who.account });
    await d.mockUsdc.write.approve([d.auction.address, amount], { account: who.account });
  }

  function decodeSvg(uri: string): string {
    const json = Buffer.from(uri.replace("data:application/json;base64,", ""), "base64").toString("utf8");
    const m = json.match(/data:image\/svg\+xml;base64,([^"]+)/);
    if (!m) throw new Error("no svg");
    return Buffer.from(m[1], "base64").toString("utf8");
  }

  // ── AUCTION mark ────────────────────────────────────────────────────────────
  it("an auctioned name shows the AUCTION mark; it clears after settle", async function () {
    const d = await deploy();
    const { auction, registrar, alice, testClient } = d;
    const tokenId = await startAuction(d, alice, "roy");

    // mark present while on auction
    let svg = decodeSvg(await registrar.read.tokenURI([tokenId]) as string);
    expect(svg).to.include("AUCTION");
    expect(svg).to.include("#FFB020");      // amber
    expect(svg).to.not.include("LISTED");   // mutually exclusive

    // close with no bid → settle → mark clears
    await testClient.increaseTime({ seconds: Number(AUCTION_DUR + 10n) });
    await testClient.mine({ blocks: 1 });
    await auction.write.settle([tokenId], { account: alice.account });
    svg = decodeSvg(await registrar.read.tokenURI([tokenId]) as string);
    expect(svg).to.not.include("AUCTION");
  });

  // ── create ────────────────────────────────────────────────────────────────
  it("creates an auction; the NFT stays with the seller", async function () {
    const d = await deploy();
    const tokenId = await startAuction(d, d.alice, "roy");
    expect(await d.auction.read.isOnAuction([tokenId])).to.equal(true);
    // NFT not moved
    expect((await d.registrar.read.ownerOf([tokenId])).toLowerCase())
      .to.equal(d.alice.account.address.toLowerCase());
  });

  it("rejects createAuction below an existing fixed-price listing (mutual exclusion)", async function () {
    const d = await deploy();
    // deploy + wire a marketplace; list there first
    const marketplace = await d.viem.deployContract("DXMarketplace", [
      d.registrar.address, d.owner.account.address, FEE_BPS]);
    await marketplace.write.setPayToken([d.mockUsdc.address, true], { account: d.owner.account });
    await d.auction.write.setMarketplace([marketplace.address], { account: d.owner.account });

    const tokenId = await registerName(d, d.alice, "dual");
    await d.registrar.write.approve([marketplace.address, tokenId], { account: d.alice.account });
    await marketplace.write.list([tokenId, d.mockUsdc.address, RESERVE], { account: d.alice.account });

    // now try to auction the same name → must revert
    await d.registrar.write.approve([d.auction.address, tokenId], { account: d.alice.account });
    await expectRevert(
      d.auction.write.createAuction([tokenId, d.mockUsdc.address, RESERVE, AUCTION_DUR],
        { account: d.alice.account }),
      "ListedElsewhere");
  });

  // ── bid + escrow + pull refund ──────────────────────────────────────────────
  it("bids are escrowed; an outbid bidder is credited and can withdraw", async function () {
    const d = await deploy();
    const { auction, mockUsdc, bob, carol } = d;
    const tokenId = await startAuction(d, d.alice, "roy");
    await fund(d, bob); await fund(d, carol);

    const bobStart = await mockUsdc.read.balanceOf([bob.account.address]);
    await auction.write.bid([tokenId, RESERVE], { account: bob.account });           // 100
    // escrowed: bob down 100, contract holds 100
    expect(bobStart - (await mockUsdc.read.balanceOf([bob.account.address]))).to.equal(RESERVE);
    expect(await mockUsdc.read.balanceOf([auction.address])).to.equal(RESERVE);

    const higher = RESERVE + (RESERVE * MIN_INCREMENT_BPS) / 10000n;                  // +5% = 105
    await auction.write.bid([tokenId, higher], { account: carol.account });
    // bob credited in pull ledger
    expect(await auction.read.pendingReturns([mockUsdc.address, bob.account.address])).to.equal(RESERVE);

    // bob withdraws
    const before = await mockUsdc.read.balanceOf([bob.account.address]);
    await auction.write.withdraw([mockUsdc.address], { account: bob.account });
    expect((await mockUsdc.read.balanceOf([bob.account.address])) - before).to.equal(RESERVE);
  });

  it("rejects a bid below reserve, and below min-increment", async function () {
    const d = await deploy();
    const { auction, bob, carol } = d;
    const tokenId = await startAuction(d, d.alice, "roy");
    await fund(d, bob); await fund(d, carol);
    await expectRevert(auction.write.bid([tokenId, RESERVE - 1n], { account: bob.account }), "BidTooLow");
    await auction.write.bid([tokenId, RESERVE], { account: bob.account });
    // +4% is below the +5% min increment
    const tooLow = RESERVE + (RESERVE * 400n) / 10000n;
    await expectRevert(auction.write.bid([tokenId, tooLow], { account: carol.account }), "BidTooLow");
  });

  // ── anti-snipe ──────────────────────────────────────────────────────────────
  it("a bid inside the closing window extends the deadline", async function () {
    const d = await deploy();
    const { auction, bob, testClient } = d;
    const tokenId = await startAuction(d, d.alice, "roy");
    await fund(d, bob);

    const before = (await auction.read.getAuction([tokenId]))[3] as bigint; // endTime
    // jump to within the extend window (1h - 5min)
    await testClient.increaseTime({ seconds: Number(AUCTION_DUR - 300n) });
    await testClient.mine({ blocks: 1 });
    await auction.write.bid([tokenId, RESERVE], { account: bob.account });
    const after = (await auction.read.getAuction([tokenId]))[3] as bigint;
    expect(after > before).to.equal(true); // extended (BigInt compare)
  });

  // ── settle ──────────────────────────────────────────────────────────────────
  it("settles after close: winner gets the name, seller paid, fee taken, subname follows", async function () {
    const d = await deploy();
    const { auction, registrar, registry, mockUsdc, owner, alice, bob, carol, testClient } = d;
    const tokenId = await startAuction(d, alice, "roy");

    // create a subname under roy.dex first (alice is parent owner)
    const royNode = subnodeFor(tldNode(), "roy");
    await registry.write.setSubnodeOwner([royNode, labelHash("pay"), alice.account.address],
      { account: alice.account });

    await fund(d, bob); await fund(d, carol);
    await auction.write.bid([tokenId, RESERVE], { account: bob.account });
    const top = RESERVE + (RESERVE * MIN_INCREMENT_BPS) / 10000n;
    await auction.write.bid([tokenId, top], { account: carol.account }); // carol leads

    // close
    await testClient.increaseTime({ seconds: Number(AUCTION_DUR + EXTEND_BY + 10n) });
    await testClient.mine({ blocks: 1 });

    const aliceBefore = await mockUsdc.read.balanceOf([alice.account.address]);
    const feeBefore = await mockUsdc.read.balanceOf([owner.account.address]);
    await auction.write.settle([tokenId], { account: bob.account }); // anyone can settle

    expect((await registrar.read.ownerOf([tokenId])).toLowerCase())
      .to.equal(carol.account.address.toLowerCase());
    const fee = (top * FEE_BPS) / 10000n;
    expect((await mockUsdc.read.balanceOf([alice.account.address])) - aliceBefore).to.equal(top - fee);
    expect((await mockUsdc.read.balanceOf([owner.account.address])) - feeBefore).to.equal(fee);
    // registry control + subname followed to carol
    expect((await registry.read.owner([royNode])).toLowerCase())
      .to.equal(carol.account.address.toLowerCase());
    await registry.write.setSubnodeOwner([royNode, labelHash("pay"), carol.account.address],
      { account: carol.account }); // carol now controls the subtree
    // bob (outbid) can still withdraw his escrow
    expect(await auction.read.pendingReturns([mockUsdc.address, bob.account.address])).to.equal(RESERVE);
  });

  it("no-bid auction: settle leaves the name with the seller", async function () {
    const d = await deploy();
    const { auction, registrar, alice, testClient } = d;
    const tokenId = await startAuction(d, alice, "roy");
    await testClient.increaseTime({ seconds: Number(AUCTION_DUR + 10n) });
    await testClient.mine({ blocks: 1 });
    await auction.write.settle([tokenId], { account: alice.account });
    expect((await registrar.read.ownerOf([tokenId])).toLowerCase())
      .to.equal(alice.account.address.toLowerCase());
    expect(await auction.read.isOnAuction([tokenId])).to.equal(false);
  });

  // ── guards ──────────────────────────────────────────────────────────────────
  it("cannot cancel after a bid exists", async function () {
    const d = await deploy();
    const { auction, alice, bob } = d;
    const tokenId = await startAuction(d, alice, "roy");
    await fund(d, bob);
    await auction.write.bid([tokenId, RESERVE], { account: bob.account });
    await expectRevert(auction.write.cancelAuction([tokenId], { account: alice.account }), "HasBids");
  });

  it("can cancel before any bid", async function () {
    const d = await deploy();
    const { auction, alice } = d;
    const tokenId = await startAuction(d, alice, "roy");
    await auction.write.cancelAuction([tokenId], { account: alice.account });
    expect(await auction.read.isOnAuction([tokenId])).to.equal(false);
  });

  it("settle ends gracefully and refunds the winner if the seller moved the NFT away", async function () {
    const d = await deploy();
    const { auction, registrar, mockUsdc, alice, bob, dave, testClient } = d;
    const tokenId = await startAuction(d, alice, "roy");
    await fund(d, bob);
    await auction.write.bid([tokenId, RESERVE], { account: bob.account });
    // alice moves the NFT to dave after the bid
    await registrar.write.transferFrom([alice.account.address, dave.account.address, tokenId],
      { account: alice.account });
    await testClient.increaseTime({ seconds: Number(AUCTION_DUR + 10n) });
    await testClient.mine({ blocks: 1 });

    // settle does NOT revert — it ends the auction and credits the winner.
    //   settle는 revert하지 않고 경매를 종료하며 낙찰자에게 환불을 적립한다.
    await auction.write.settle([tokenId], { account: bob.account });

    // NFT stays with dave (the transfer was skipped)
    expect((await registrar.read.ownerOf([tokenId])).toLowerCase())
      .to.equal(dave.account.address.toLowerCase());
    // winner credited for the full refund
    expect(await auction.read.pendingReturns([mockUsdc.address, bob.account.address])).to.equal(RESERVE);
    // and can actually withdraw it
    const before = await mockUsdc.read.balanceOf([bob.account.address]);
    await auction.write.withdraw([mockUsdc.address], { account: bob.account });
    expect((await mockUsdc.read.balanceOf([bob.account.address])) - before).to.equal(RESERVE);
    // auction is closed
    expect(await auction.read.isOnAuction([tokenId])).to.equal(false);
  });

  it("owner cannot set a fee above MAX_FEE_BPS", async function () {
    const d = await deploy();
    await expectRevert(
      d.auction.write.setProtocolFee([MAX_FEE_BPS + 1n], { account: d.owner.account }), "FeeTooHigh");
  });
});
