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
const EXTEND_BY = 1200n;          // +20 min
const AUCTION_DUR = 24n * 60n * 60n; // 1 day
const DUTCH_DUR = 7n * 24n * 60n * 60n;
const RESERVE = 100n * 10n ** 6n; // 100 USDC
// Anti-grief bond = max(reserve × 10%, minDeposit). For RESERVE=100: 10% = 10,
// which equals the 10-USDC floor, so DEPOSIT = 10 USDC in these tests.
const DEPOSIT = 10n * 10n ** 6n;
const MINT = 10_000n * 10n ** 6n;
const GRACE_PERIOD = 70n * 24n * 60n * 60n;
const ERC4906_INTERFACE_ID = "0x49064906";
const METADATA_UPDATE_TOPIC = keccak256(toBytes("MetadataUpdate(uint256)"));

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
      owner.account.address,
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
    // Seller must also fund + approve the anti-grief bond, pulled at createAuction.
    await fund(d, seller);
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

  async function expectMetadataUpdate(d: any, hash: `0x${string}`, tokenId: bigint) {
    const receipt = await d.publicClient.waitForTransactionReceipt({ hash });
    const encodedTokenId = encodeAbiParameters(parseAbiParameters("uint256"), [tokenId]);
    const logs = receipt.logs.filter(
      (log: any) =>
        log.address.toLowerCase() === d.registrar.address.toLowerCase() &&
        log.topics[0] === METADATA_UPDATE_TOPIC &&
        log.data === encodedTokenId,
    );
    expect(logs.length).to.equal(1);
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

  it("emits ERC-4906 MetadataUpdate when auction state changes", async function () {
    const d = await deploy();
    const { auction, registrar, mockUsdc, alice, testClient } = d;
    const tokenId = await registerName(d, alice, "eng4906");

    expect(await registrar.read.supportsInterface([ERC4906_INTERFACE_ID])).to.equal(true);

    await registrar.write.approve([auction.address, tokenId], { account: alice.account });
    await fund(d, alice); // fund + approve the anti-grief bond
    const createHash = await auction.write.createAuction(
      [tokenId, mockUsdc.address, RESERVE, AUCTION_DUR],
      { account: alice.account },
    );
    await expectMetadataUpdate(d, createHash, tokenId);

    await testClient.increaseTime({ seconds: Number(AUCTION_DUR + 10n) });
    await testClient.mine({ blocks: 1 });
    const settleHash = await auction.write.settle([tokenId], { account: alice.account });
    await expectMetadataUpdate(d, settleHash, tokenId);
  });

  it("keeps auction actions working if registrar metadata notification wiring is cleared", async function () {
    const d = await deploy();
    const { auction, registrar, mockUsdc, alice, owner, testClient } = d;
    const tokenId = await registerName(d, alice, "eng-best-effort");

    await registrar.write.approve([auction.address, tokenId], { account: alice.account });
    await registrar.write.setAuctions([ZERO, ZERO], { account: owner.account });
    await fund(d, alice); // fund + approve the anti-grief bond

    await auction.write.createAuction(
      [tokenId, mockUsdc.address, RESERVE, AUCTION_DUR],
      { account: alice.account },
    );
    expect(await auction.read.isOnAuction([tokenId])).to.equal(true);

    await testClient.increaseTime({ seconds: Number(AUCTION_DUR + 10n) });
    await testClient.mine({ blocks: 1 });
    await auction.write.settle([tokenId], { account: alice.account });
    expect(await auction.read.isOnAuction([tokenId])).to.equal(false);
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
      d.registrar.address, d.owner.account.address, FEE_BPS, d.owner.account.address]);
    await marketplace.write.setPayToken([d.mockUsdc.address, true], { account: d.owner.account });
    await d.registrar.write.setMarketplace([marketplace.address], { account: d.owner.account });
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

  it("rejects createAuction while the token is on a Dutch auction", async function () {
    const d = await deploy();
    const dutch = await d.viem.deployContract("DXDutchAuction", [
      d.registrar.address, d.owner.account.address, FEE_BPS, d.owner.account.address]);
    await dutch.write.setPayToken([d.mockUsdc.address, true], { account: d.owner.account });
    await d.auction.write.setPeerAuction([dutch.address], { account: d.owner.account });

    const tokenId = await registerName(d, d.alice, "dual-dutch-first");
    await d.registrar.write.approve([dutch.address, tokenId], { account: d.alice.account });
    await dutch.write.createAuction(
      [tokenId, d.mockUsdc.address, 1_000n * 10n ** 6n, RESERVE, DUTCH_DUR, 3600n, 0n, 100n * 10n ** 6n],
      { account: d.alice.account },
    );

    await d.registrar.write.approve([d.auction.address, tokenId], { account: d.alice.account });
    await expectRevert(
      d.auction.write.createAuction([tokenId, d.mockUsdc.address, RESERVE, AUCTION_DUR],
        { account: d.alice.account }),
      "AuctionedElsewhere");
  });

  it("keeps an expired but unsettled auction marked as occupying the token", async function () {
    const d = await deploy();
    const { auction, mockUsdc, registrar, alice, testClient } = d;
    const tokenId = await startAuction(d, alice, "expired-english");

    await testClient.increaseTime({ seconds: Number(AUCTION_DUR + 10n) });
    await testClient.mine({ blocks: 1 });

    expect(await auction.read.isOnAuction([tokenId])).to.equal(true);

    await registrar.write.approve([auction.address, tokenId], { account: alice.account });
    await expectRevert(
      auction.write.createAuction([tokenId, mockUsdc.address, RESERVE, AUCTION_DUR],
        { account: alice.account }),
      "AlreadyAuctioned",
    );
  });

  it("rejects createAuction while an expired Dutch auction is still unsettled", async function () {
    const d = await deploy();
    const dutch = await d.viem.deployContract("DXDutchAuction", [
      d.registrar.address, d.owner.account.address, FEE_BPS, d.owner.account.address]);
    await dutch.write.setPayToken([d.mockUsdc.address, true], { account: d.owner.account });
    await d.auction.write.setPeerAuction([dutch.address], { account: d.owner.account });

    const tokenId = await registerName(d, d.alice, "expired-dutch-first");
    await d.registrar.write.approve([dutch.address, tokenId], { account: d.alice.account });
    await dutch.write.createAuction(
      [tokenId, d.mockUsdc.address, 1_000n * 10n ** 6n, RESERVE, DUTCH_DUR, 3600n, 0n, 100n * 10n ** 6n],
      { account: d.alice.account },
    );

    await d.testClient.increaseTime({ seconds: Number(DUTCH_DUR + 10n) });
    await d.testClient.mine({ blocks: 1 });
    expect(await dutch.read.isOnAuction([tokenId])).to.equal(true);

    await d.registrar.write.approve([d.auction.address, tokenId], { account: d.alice.account });
    await expectRevert(
      d.auction.write.createAuction([tokenId, d.mockUsdc.address, RESERVE, AUCTION_DUR],
        { account: d.alice.account }),
      "AuctionedElsewhere",
    );
  });

  // ── bid + escrow + pull refund ──────────────────────────────────────────────
  it("bids are escrowed; an outbid bidder is credited and can withdraw", async function () {
    const d = await deploy();
    const { auction, mockUsdc, bob, carol } = d;
    const tokenId = await startAuction(d, d.alice, "roy");
    await fund(d, bob); await fund(d, carol);

    const bobStart = await mockUsdc.read.balanceOf([bob.account.address]);
    await auction.write.bid([tokenId, RESERVE], { account: bob.account });           // 100
    // escrowed: bob down 100; contract holds the seller's bond + bob's bid
    expect(bobStart - (await mockUsdc.read.balanceOf([bob.account.address]))).to.equal(RESERVE);
    expect(await mockUsdc.read.balanceOf([auction.address])).to.equal(DEPOSIT + RESERVE);

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

  it("caps anti-snipe extensions at three", async function () {
    const d = await deploy();
    const { auction, bob, carol, dave, testClient } = d;
    const tokenId = await startAuction(d, d.alice, "roy-ext-cap");
    await fund(d, bob); await fund(d, carol); await fund(d, dave);

    const bidders = [bob, carol, dave, bob];
    let amount = RESERVE;

    for (let i = 0; i < bidders.length; i++) {
      await testClient.increaseTime({
        seconds: Number(i === 0 ? AUCTION_DUR - 300n : EXTEND_BY - 300n),
      });
      await testClient.mine({ blocks: 1 });

      const before = (await auction.read.getAuction([tokenId]))[3] as bigint;
      if (i > 0) {
        amount += (amount * MIN_INCREMENT_BPS) / 10000n;
      }
      await auction.write.bid([tokenId, amount], { account: bidders[i].account });
      const after = (await auction.read.getAuction([tokenId]))[3] as bigint;

      if (i < 3) {
        expect(after > before).to.equal(true);
      } else {
        expect(after).to.equal(before);
      }
    }
  });

  it("lets the owner configure the anti-snipe extension cap", async function () {
    const d = await deploy();
    const { auction, bob, carol, testClient, owner } = d;
    const tokenId = await startAuction(d, d.alice, "roy-ext-config");
    await fund(d, bob); await fund(d, carol);

    await auction.write.setMaxExtensions([1], { account: owner.account });
    expect(await auction.read.maxExtensions()).to.equal(1);

    let amount = RESERVE;
    const bidders = [bob, carol];
    for (let i = 0; i < bidders.length; i++) {
      await testClient.increaseTime({
        seconds: Number(i === 0 ? AUCTION_DUR - 300n : EXTEND_BY - 300n),
      });
      await testClient.mine({ blocks: 1 });

      const before = (await auction.read.getAuction([tokenId]))[3] as bigint;
      if (i > 0) amount += (amount * MIN_INCREMENT_BPS) / 10000n;
      await auction.write.bid([tokenId, amount], { account: bidders[i].account });
      const after = (await auction.read.getAuction([tokenId]))[3] as bigint;

      if (i === 0) {
        expect(after > before).to.equal(true);
      } else {
        expect(after).to.equal(before);
      }
    }
  });

  it("rejects anti-snipe params that could shorten the deadline", async function () {
    const d = await deploy();

    await expectRevert(
      d.viem.deployContract("DXEnglishAuction", [
        d.registrar.address, d.owner.account.address, FEE_BPS,
        MIN_INCREMENT_BPS, EXTEND_WINDOW, EXTEND_WINDOW,
        d.owner.account.address,
      ]),
      "BadExtension",
    );

    await expectRevert(
      d.auction.write.setAuctionParams([MIN_INCREMENT_BPS, EXTEND_WINDOW, EXTEND_WINDOW - 1n], {
        account: d.owner.account,
      }),
      "BadExtension",
    );
  });

  it("enforces owner-configured duration bounds within the 1-30 day hard limits", async function () {
    const d = await deploy();
    const { auction, registrar, mockUsdc, alice, owner } = d;
    const tokenId = await registerName(d, alice, "eng-duration-guard");
    await registrar.write.approve([auction.address, tokenId], { account: alice.account });
    await fund(d, alice); // fund + approve the anti-grief bond for the later success case

    expect(await auction.read.MIN_DURATION_LIMIT()).to.equal(24n * 60n * 60n);
    expect(await auction.read.MAX_DURATION_LIMIT()).to.equal(30n * 24n * 60n * 60n);

    await expectRevert(
      auction.write.createAuction(
        [tokenId, mockUsdc.address, RESERVE, 24n * 60n * 60n - 1n],
        { account: alice.account },
      ),
      "BadDuration",
    );

    await expectRevert(
      auction.write.setAuctionDurationBounds(
        [24n * 60n * 60n - 1n, 30n * 24n * 60n * 60n],
        { account: owner.account },
      ),
      "BadDurationBounds",
    );
    await expectRevert(
      auction.write.setAuctionDurationBounds(
        [24n * 60n * 60n, 30n * 24n * 60n * 60n + 1n],
        { account: owner.account },
      ),
      "BadDurationBounds",
    );

    await auction.write.setAuctionDurationBounds(
      [2n * 24n * 60n * 60n, 10n * 24n * 60n * 60n],
      { account: owner.account },
    );
    expect(await auction.read.minAuctionDuration()).to.equal(2n * 24n * 60n * 60n);
    expect(await auction.read.maxAuctionDuration()).to.equal(10n * 24n * 60n * 60n);

    await expectRevert(
      auction.write.createAuction(
        [tokenId, mockUsdc.address, RESERVE, 24n * 60n * 60n],
        { account: alice.account },
      ),
      "BadDuration",
    );

    await auction.write.createAuction(
      [tokenId, mockUsdc.address, RESERVE, 2n * 24n * 60n * 60n],
      { account: alice.account },
    );
    expect(await auction.read.isOnAuction([tokenId])).to.equal(true);
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
    // seller receives proceeds (top − fee) AND gets the anti-grief bond back
    expect((await mockUsdc.read.balanceOf([alice.account.address])) - aliceBefore).to.equal(top - fee + DEPOSIT);
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
    const transferHash = await registrar.write.transferFrom([alice.account.address, dave.account.address, tokenId],
      { account: alice.account });
    await expectMetadataUpdate(d, transferHash, tokenId);
    await testClient.increaseTime({ seconds: Number(AUCTION_DUR + 10n) });
    await testClient.mine({ blocks: 1 });

    // settle does NOT revert — it ends the auction and credits the winner.
    //   settle는 revert하지 않고 경매를 종료하며 낙찰자에게 환불을 적립한다.
    await auction.write.settle([tokenId], { account: bob.account });

    // NFT stays with dave (the transfer was skipped)
    expect((await registrar.read.ownerOf([tokenId])).toLowerCase())
      .to.equal(dave.account.address.toLowerCase());
    // winner credited: full bid refund PLUS the seller's forfeited bond
    expect(await auction.read.pendingReturns([mockUsdc.address, bob.account.address])).to.equal(RESERVE + DEPOSIT);
    // and can actually withdraw it
    const before = await mockUsdc.read.balanceOf([bob.account.address]);
    await auction.write.withdraw([mockUsdc.address], { account: bob.account });
    expect((await mockUsdc.read.balanceOf([bob.account.address])) - before).to.equal(RESERVE + DEPOSIT);
    // auction is closed
    expect(await auction.read.isOnAuction([tokenId])).to.equal(false);
  });

  it("settle ends gracefully and refunds the winner if ownerOf reverts after burn", async function () {
    const d = await deploy();
    const { auction, registrar, mockUsdc, alice, bob, dave, testClient } = d;
    const tokenId = await startAuction(d, alice, "royburn");
    await fund(d, bob);
    await auction.write.bid([tokenId, RESERVE], { account: bob.account });

    // Jump past expiry + grace, then burn the expired token. From this point
    // ERC-721 ownerOf(tokenId) reverts, so settle must use its refund path.
    //   만료+유예 이후 토큰을 burn하면 ownerOf(tokenId)가 revert한다.
    //   settle은 이 경우에도 낙찰자 환불 경로로 정상 종료해야 한다.
    await testClient.increaseTime({ seconds: Number(ONE_YEAR + GRACE_PERIOD + 60n) });
    await testClient.mine({ blocks: 1 });
    await registrar.write.burn([tokenId], { account: dave.account });

    await auction.write.settle([tokenId], { account: dave.account });

    expect(await auction.read.pendingReturns([mockUsdc.address, bob.account.address])).to.equal(RESERVE + DEPOSIT);
    const before = await mockUsdc.read.balanceOf([bob.account.address]);
    await auction.write.withdraw([mockUsdc.address], { account: bob.account });
    expect((await mockUsdc.read.balanceOf([bob.account.address])) - before).to.equal(RESERVE + DEPOSIT);
    expect(await auction.read.isOnAuction([tokenId])).to.equal(false);
  });

  it("settle ends gracefully and refunds the winner if the seller revoked approval but kept the NFT", async function () {
    const d = await deploy();
    const { auction, registrar, mockUsdc, alice, bob, testClient } = d;
    const tokenId = await startAuction(d, alice, "roy");
    await fund(d, bob);
    await auction.write.bid([tokenId, RESERVE], { account: bob.account });

    // alice keeps the NFT but revokes the approval (e.g. approves another market,
    // or clears it). ownerOf still == alice, so only the approval re-check saves us.
    //   alice가 NFT는 그대로 두고 approval만 회수. ownerOf는 여전히 alice라
    //   approval 재확인만이 낙찰자 자금 락업을 막는다.
    await registrar.write.approve([ZERO, tokenId], { account: alice.account });
    await testClient.increaseTime({ seconds: Number(AUCTION_DUR + 10n) });
    await testClient.mine({ blocks: 1 });

    // settle must NOT revert — it credits the winner instead of trapping escrow.
    //   settle는 revert하면 안 되고, 에스크로를 가두는 대신 낙찰자에게 적립한다.
    await auction.write.settle([tokenId], { account: bob.account });

    // NFT stays with alice (transfer skipped), winner refunded and can withdraw.
    //   NFT는 alice에게 그대로(이전 생략), 낙찰자는 환불 적립 후 인출 가능.
    expect((await registrar.read.ownerOf([tokenId])).toLowerCase())
      .to.equal(alice.account.address.toLowerCase());
    // winner refunded AND compensated with the seller's forfeited bond
    expect(await auction.read.pendingReturns([mockUsdc.address, bob.account.address])).to.equal(RESERVE + DEPOSIT);
    const before = await mockUsdc.read.balanceOf([bob.account.address]);
    await auction.write.withdraw([mockUsdc.address], { account: bob.account });
    expect((await mockUsdc.read.balanceOf([bob.account.address])) - before).to.equal(RESERVE + DEPOSIT);
    expect(await auction.read.isOnAuction([tokenId])).to.equal(false);
  });

  it("rejects a bid once the seller no longer owns the NFT", async function () {
    const d = await deploy();
    const { auction, registrar, alice, bob, carol, dave } = d;
    const tokenId = await startAuction(d, alice, "roy");
    await fund(d, bob); await fund(d, carol);
    await auction.write.bid([tokenId, RESERVE], { account: bob.account });

    // alice moves the NFT away mid-auction; further bids must be rejected so a
    // bidder can't escrow funds into an auction that can only refund at settle.
    //   alice가 경매 중 NFT를 옮기면 이후 입찰은 거부 — 환불로만 끝날 경매에
    //   자금을 에스크로하지 못하게.
    await registrar.write.transferFrom([alice.account.address, dave.account.address, tokenId],
      { account: alice.account });
    const top = RESERVE + (RESERVE * MIN_INCREMENT_BPS) / 10000n;
    await expectRevert(auction.write.bid([tokenId, top], { account: carol.account }), "SellerNoLongerOwns");
  });

  it("never rounds the min increment down to zero on a low-priced auction", async function () {
    const d = await deploy();
    const { auction, bob, carol } = d;
    // reserve = 1 base unit: highestBid * 500bps = 500 < 10000, so floor division
    // would yield a 0 increment and allow an equal re-bid. Ceil must forbid it.
    //   reserve=1: 1*500=500 < 10000 → floor 나눗셈이면 증가분 0이라 같은 금액
    //   재입찰이 통과. 올림은 이를 금지해야 한다.
    const tokenId = await startAuction(d, d.alice, "roy", 1n);
    await fund(d, bob); await fund(d, carol);
    await auction.write.bid([tokenId, 1n], { account: bob.account });
    // an equal re-bid (1) must now revert; minimum acceptable is 2.
    //   같은 금액(1) 재입찰은 revert; 최소 허용은 2.
    await expectRevert(auction.write.bid([tokenId, 1n], { account: carol.account }), "BidTooLow");
    await auction.write.bid([tokenId, 2n], { account: carol.account });
    expect((await auction.read.getAuction([tokenId]))[5]).to.equal(2n); // highestBid
  });

  it("owner cannot set a fee above MAX_FEE_BPS", async function () {
    const d = await deploy();
    await expectRevert(
      d.auction.write.setProtocolFee([MAX_FEE_BPS + 1n], { account: d.owner.account }), "FeeTooHigh");
  });

  it("rejects zero minIncrementBps in constructor and setter", async function () {
    const d = await deploy();

    await expectRevert(
      d.viem.deployContract("DXEnglishAuction", [
        d.registrar.address, d.owner.account.address, FEE_BPS,
        0n, EXTEND_WINDOW, EXTEND_BY,
        d.owner.account.address,
      ]),
      "ZeroMinIncrement",
    );

    await expectRevert(
      d.auction.write.setAuctionParams([0n, EXTEND_WINDOW, EXTEND_BY], {
        account: d.owner.account,
      }),
      "ZeroMinIncrement",
    );
  });

  it("rejects minIncrementBps above MAX_INCREMENT_BPS in constructor and setter", async function () {
    const d = await deploy();
    const MAX = await d.auction.read.MAX_INCREMENT_BPS() as bigint;
    expect(MAX).to.equal(10000n);

    // constructor: one over the cap must revert
    await expectRevert(
      d.viem.deployContract("DXEnglishAuction", [
        d.registrar.address, d.owner.account.address, FEE_BPS,
        MAX + 1n, EXTEND_WINDOW, EXTEND_BY,
        d.owner.account.address,
      ]),
      "IncrementTooHigh",
    );

    // setter: one over the cap must revert
    await expectRevert(
      d.auction.write.setAuctionParams([MAX + 1n, EXTEND_WINDOW, EXTEND_BY], {
        account: d.owner.account,
      }),
      "IncrementTooHigh",
    );

    // boundary: exactly at the cap is allowed
    await d.auction.write.setAuctionParams([MAX, EXTEND_WINDOW, EXTEND_BY], {
      account: d.owner.account,
    });
    expect(await d.auction.read.minIncrementBps()).to.equal(MAX);
  });
});
