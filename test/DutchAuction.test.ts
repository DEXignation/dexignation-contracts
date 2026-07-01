// SPDX-License-Identifier: MIT
//
// Integration tests for DXDutchAuction — step declining-price auction.
//
// Exercises: create (rate & fixed modes), step price decline over time,
// floor clamp, buy (atomic pay + transfer + subname follow), slippage guard,
// cancel, and the clean-integer guard (IndivisibleDrop). All prices are whole
// numbers — verified explicitly.
//
// 계단식 네덜란드 경매 검증: 생성(비율·정액), 시간 경과 계단 하락, 바닥가 고정,
// 구매(원자적), 슬리피지 가드, 취소, 정수 보장(IndivisibleDrop).

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

const FEE_BPS = 250n;
const USDC = (n: bigint) => n * 10n ** 6n;
const START = USDC(1_000_000n);   // 1,000,000 USDC
const FLOOR = USDC(700_000n);     // floor 700,000
const DUTCH_DUR = 7n * 24n * 60n * 60n;
const STEP = 5n * 60n * 60n;      // 5 hours per step
const DROP_BPS = 500n;            // 5% of start = 50,000 per step (divides evenly)
const DROP_FIXED = USDC(40_000n); // 40,000 per step
const MINT = USDC(2_000_000n);
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

describe("DXDutchAuction — step declining-price auction", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob, carol] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();

    const auction = await viem.deployContract("DXDutchAuction", [
      deployed.registrar.address, owner.account.address, FEE_BPS, owner.account.address]);
    await auction.write.setPayToken([deployed.mockUsdc.address, true], { account: owner.account });
    // Wire as the Dutch slot so tokenURI renders the AUCTION mark.
    //   둘째(네덜란드) 슬롯으로 연결해 tokenURI가 AUCTION 마크를 그리게 함.
    await deployed.registrar.write.setAuctions(
      ["0x0000000000000000000000000000000000000000", auction.address],
      { account: owner.account });

    return { ...deployed, auction, owner, alice, bob, carol, publicClient, testClient, viem };
  }

  async function registerName(d: any, who: any, label: string) {
    const { controller, resolver, testClient } = d;
    const secret = `0x${"d2".repeat(32)}` as `0x${string}`;
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

  // rate-mode auction (bps), fixed-mode helper passes amount instead
  async function startRate(d: any, seller: any, label: string) {
    const { auction, registrar, mockUsdc } = d;
    const tokenId = await registerName(d, seller, label);
    await registrar.write.approve([auction.address, tokenId], { account: seller.account });
    await auction.write.createAuction(
      [tokenId, mockUsdc.address, START, FLOOR, DUTCH_DUR, STEP, DROP_BPS, 0n],
      { account: seller.account });
    return tokenId;
  }

  async function fund(d: any, who: any) {
    await d.mockUsdc.write.mint([who.account.address, MINT], { account: who.account });
    await d.mockUsdc.write.approve([d.auction.address, MINT], { account: who.account });
  }
  const stepSeconds = (n: number) => ({ seconds: Number(STEP) * n + 1 });

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
  it("a Dutch-auctioned name shows the AUCTION mark; clears after buy", async function () {
    const d = await deploy();
    const { auction, registrar, bob } = d;
    const tokenId = await startRate(d, d.alice, "roy");

    let svg = decodeSvg(await registrar.read.tokenURI([tokenId]) as string);
    expect(svg).to.include("AUCTION");
    expect(svg).to.include("#FFB020");
    expect(svg).to.not.include("LISTED");

    // buy → auction settled → mark clears (and NFT moved to bob)
    await fund(d, bob);
    await auction.write.buy([tokenId, START], { account: bob.account });
    svg = decodeSvg(await registrar.read.tokenURI([tokenId]) as string);
    expect(svg).to.not.include("AUCTION");
  });

  it("emits ERC-4906 MetadataUpdate when auction state changes", async function () {
    const d = await deploy();
    const { auction, registrar, mockUsdc, alice } = d;
    const tokenId = await registerName(d, alice, "dutch4906");

    expect(await registrar.read.supportsInterface([ERC4906_INTERFACE_ID])).to.equal(true);
    await registrar.write.approve([auction.address, tokenId], { account: alice.account });
    const createHash = await auction.write.createAuction(
      [tokenId, mockUsdc.address, START, FLOOR, DUTCH_DUR, STEP, DROP_BPS, 0n],
      { account: alice.account },
    );
    await expectMetadataUpdate(d, createHash, tokenId);

    const cancelHash = await auction.write.cancelAuction([tokenId], { account: alice.account });
    await expectMetadataUpdate(d, cancelHash, tokenId);
  });

  it("rejects createAuction while the token is on an English auction", async function () {
    const d = await deploy();
    const english = await d.viem.deployContract("DXEnglishAuction", [
      d.registrar.address, d.owner.account.address, FEE_BPS,
      500n, 600n, 1200n,
      d.owner.account.address,
    ]);
    await english.write.setPayToken([d.mockUsdc.address, true], { account: d.owner.account });
    await d.auction.write.setPeerAuction([english.address], { account: d.owner.account });

    const tokenId = await registerName(d, d.alice, "dual-english-first");
    await d.registrar.write.approve([english.address, tokenId], { account: d.alice.account });
    await english.write.createAuction(
      [tokenId, d.mockUsdc.address, USDC(100n), 24n * 60n * 60n],
      { account: d.alice.account },
    );

    await d.registrar.write.approve([d.auction.address, tokenId], { account: d.alice.account });
    await expectRevert(
      d.auction.write.createAuction(
        [tokenId, d.mockUsdc.address, START, FLOOR, DUTCH_DUR, STEP, DROP_BPS, 0n],
        { account: d.alice.account },
      ),
      "AuctionedElsewhere",
    );
  });

  it("keeps auction actions working if registrar metadata notification wiring is cleared", async function () {
    const d = await deploy();
    const { auction, registrar, mockUsdc, alice, owner } = d;
    const tokenId = await registerName(d, alice, "dutch-best-effort");

    await registrar.write.approve([auction.address, tokenId], { account: alice.account });
    await registrar.write.setAuctions([ZERO, ZERO], { account: owner.account });

    await auction.write.createAuction(
      [tokenId, mockUsdc.address, START, FLOOR, DUTCH_DUR, STEP, DROP_BPS, 0n],
      { account: alice.account },
    );
    expect(await auction.read.isOnAuction([tokenId])).to.equal(true);

    await auction.write.cancelAuction([tokenId], { account: alice.account });
    expect(await auction.read.isOnAuction([tokenId])).to.equal(false);
  });

  // ── price decline (the core behavior) ───────────────────────────────────────
  it("price holds, then drops by a fixed whole amount each step (rate mode)", async function () {
    const d = await deploy();
    const { auction, testClient } = d;
    const tokenId = await startRate(d, d.alice, "roy");

    // step 0: start price
    expect(await auction.read.currentPrice([tokenId])).to.equal(START);            // 1,000,000

    await testClient.increaseTime(stepSeconds(1)); await testClient.mine({ blocks: 1 });
    expect(await auction.read.currentPrice([tokenId])).to.equal(USDC(950_000n));    // -50,000

    await testClient.increaseTime(stepSeconds(1)); await testClient.mine({ blocks: 1 });
    expect(await auction.read.currentPrice([tokenId])).to.equal(USDC(900_000n));    // -50,000

    await testClient.increaseTime(stepSeconds(2)); await testClient.mine({ blocks: 1 });
    expect(await auction.read.currentPrice([tokenId])).to.equal(USDC(800_000n));    // step 4
  });

  it("clamps at the floor and never goes below (rate mode)", async function () {
    const d = await deploy();
    const { auction, testClient } = d;
    const tokenId = await startRate(d, d.alice, "roy");
    // jump past the floor while the auction is still within its duration
    await testClient.increaseTime(stepSeconds(7)); await testClient.mine({ blocks: 1 });
    expect(await auction.read.currentPrice([tokenId])).to.equal(FLOOR); // 700,000, not lower
  });

  it("fixed mode: drops by the exact given amount each step", async function () {
    const d = await deploy();
    const { auction, registrar, mockUsdc, alice, testClient } = d;
    const tokenId = await registerName(d, alice, "roy");
    await registrar.write.approve([auction.address, tokenId], { account: alice.account });
    await auction.write.createAuction(
      [tokenId, mockUsdc.address, START, FLOOR, DUTCH_DUR, STEP, 0n, DROP_FIXED], { account: alice.account });
    expect(await auction.read.currentPrice([tokenId])).to.equal(START);
    await testClient.increaseTime(stepSeconds(1)); await testClient.mine({ blocks: 1 });
    expect(await auction.read.currentPrice([tokenId])).to.equal(USDC(960_000n)); // -40,000
    await testClient.increaseTime(stepSeconds(2)); await testClient.mine({ blocks: 1 });
    expect(await auction.read.currentPrice([tokenId])).to.equal(USDC(880_000n)); // step 3
  });

  // ── clean-integer guard ─────────────────────────────────────────────────────
  it("rejects a rate that would not divide into a clean integer (IndivisibleDrop)", async function () {
    const d = await deploy();
    const { auction, registrar, mockUsdc, alice } = d;
    const tokenId = await registerName(d, alice, "roy");
    await registrar.write.approve([auction.address, tokenId], { account: alice.account });
    // floor=0 hits BadPrices first (validated before the drop math)
    await expectRevert(
      auction.write.createAuction([tokenId, mockUsdc.address, 100n, 0n, DUTCH_DUR, STEP, 1n, 0n],
        { account: alice.account }), "BadPrices");
    // start=15001, bps=1 → 15001*1 = 15001; 15001 % 10000 = 5001 ≠ 0 → IndivisibleDrop
    await expectRevert(
      auction.write.createAuction([tokenId, mockUsdc.address, 15001n, 1n, DUTCH_DUR, STEP, 1n, 0n],
        { account: alice.account }), "IndivisibleDrop");
  });

  it("rejects setting both bps and amount, or neither (BadStep)", async function () {
    const d = await deploy();
    const { auction, registrar, mockUsdc, alice } = d;
    const tokenId = await registerName(d, alice, "roy");
    await registrar.write.approve([auction.address, tokenId], { account: alice.account });
    await expectRevert(  // both set
      auction.write.createAuction([tokenId, mockUsdc.address, START, FLOOR, DUTCH_DUR, STEP, DROP_BPS, DROP_FIXED],
        { account: alice.account }), "BadStep");
    await expectRevert(  // neither set
      auction.write.createAuction([tokenId, mockUsdc.address, START, FLOOR, DUTCH_DUR, STEP, 0n, 0n],
        { account: alice.account }), "BadStep");
  });

  // ── buy ─────────────────────────────────────────────────────────────────────
  it("buys at the current step price; pay + transfer atomic, subname follows", async function () {
    const d = await deploy();
    const { auction, registrar, registry, mockUsdc, owner, alice, bob, testClient } = d;
    const tokenId = await startRate(d, alice, "roy");
    // subname under roy.dex
    const royNode = subnodeFor(tldNode(), "roy");
    await registry.write.setSubnodeOwner([royNode, labelHash("pay"), alice.account.address],
      { account: alice.account });

    await fund(d, bob);
    // advance 2 steps → price 900,000
    await testClient.increaseTime(stepSeconds(2)); await testClient.mine({ blocks: 1 });
    const price = await auction.read.currentPrice([tokenId]);
    expect(price).to.equal(USDC(900_000n));

    const aliceBefore = await mockUsdc.read.balanceOf([alice.account.address]);
    const feeBefore = await mockUsdc.read.balanceOf([owner.account.address]);
    // maxPrice = current price (slippage guard satisfied)
    await auction.write.buy([tokenId, price], { account: bob.account });

    expect((await registrar.read.ownerOf([tokenId])).toLowerCase())
      .to.equal(bob.account.address.toLowerCase());
    const fee = (price as bigint * FEE_BPS) / 10000n;
    expect((await mockUsdc.read.balanceOf([alice.account.address])) - aliceBefore).to.equal(price - fee);
    expect((await mockUsdc.read.balanceOf([owner.account.address])) - feeBefore).to.equal(fee);
    // subname followed
    expect((await registry.read.owner([royNode])).toLowerCase())
      .to.equal(bob.account.address.toLowerCase());
  });

  it("buy reverts if the live price exceeds maxPrice (slippage guard)", async function () {
    const d = await deploy();
    const { auction, bob, testClient } = d;
    const tokenId = await startRate(d, d.alice, "roy");
    await fund(d, bob);
    // price is START now; set maxPrice below START → revert
    await expectRevert(
      auction.write.buy([tokenId, USDC(900_000n)], { account: bob.account }), "BadPrices");
  });

  it("can still buy at the floor before the auction expires", async function () {
    const d = await deploy();
    const { auction, registrar, bob, testClient } = d;
    const tokenId = await startRate(d, d.alice, "roy");
    await fund(d, bob);
    await testClient.increaseTime(stepSeconds(7)); await testClient.mine({ blocks: 1 });
    expect(await auction.read.currentPrice([tokenId])).to.equal(FLOOR);
    await auction.write.buy([tokenId, FLOOR], { account: bob.account });
    expect((await registrar.read.ownerOf([tokenId])).toLowerCase())
      .to.equal(bob.account.address.toLowerCase());
  });

  it("treats expired auctions as inactive, blocks buy, and allows a new auction", async function () {
    const d = await deploy();
    const { auction, registrar, mockUsdc, alice, bob, testClient } = d;
    const tokenId = await startRate(d, alice, "expiring-dutch");

    await fund(d, bob);
    await testClient.increaseTime({ seconds: Number(DUTCH_DUR) + 1 });
    await testClient.mine({ blocks: 1 });

    expect(await auction.read.isOnAuction([tokenId])).to.equal(false);
    await expectRevert(
      auction.write.buy([tokenId, FLOOR], { account: bob.account }),
      "AuctionEnded",
    );

    await registrar.write.approve([auction.address, tokenId], { account: alice.account });
    await auction.write.createAuction(
      [tokenId, mockUsdc.address, START, FLOOR, DUTCH_DUR, STEP, DROP_BPS, 0n],
      { account: alice.account },
    );
    expect(await auction.read.isOnAuction([tokenId])).to.equal(true);
  });

  // ── guards ──────────────────────────────────────────────────────────────────
  it("rejects floor >= start (BadPrices)", async function () {
    const d = await deploy();
    const { auction, registrar, mockUsdc, alice } = d;
    const tokenId = await registerName(d, alice, "roy");
    await registrar.write.approve([auction.address, tokenId], { account: alice.account });
    await expectRevert(
      auction.write.createAuction([tokenId, mockUsdc.address, FLOOR, START, DUTCH_DUR, STEP, DROP_BPS, 0n],
        { account: alice.account }), "BadPrices");
  });

  it("enforces owner-configured duration bounds within the 1-30 day hard limits", async function () {
    const d = await deploy();
    const { auction, registrar, mockUsdc, alice, owner } = d;
    const tokenId = await registerName(d, alice, "duration-guard");
    await registrar.write.approve([auction.address, tokenId], { account: alice.account });

    expect(await auction.read.MIN_DURATION_LIMIT()).to.equal(24n * 60n * 60n);
    expect(await auction.read.MAX_DURATION_LIMIT()).to.equal(30n * 24n * 60n * 60n);

    await expectRevert(
      auction.write.createAuction(
        [tokenId, mockUsdc.address, START, FLOOR, 24n * 60n * 60n - 1n, STEP, DROP_BPS, 0n],
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
        [tokenId, mockUsdc.address, START, FLOOR, 24n * 60n * 60n, STEP, DROP_BPS, 0n],
        { account: alice.account },
      ),
      "BadDuration",
    );

    await auction.write.createAuction(
      [tokenId, mockUsdc.address, START, FLOOR, 2n * 24n * 60n * 60n, STEP, DROP_BPS, 0n],
      { account: alice.account },
    );
    expect(await auction.read.isOnAuction([tokenId])).to.equal(true);
  });

  it("seller can cancel an unsold auction", async function () {
    const d = await deploy();
    const { auction, alice } = d;
    const tokenId = await startRate(d, alice, "roy");
    await auction.write.cancelAuction([tokenId], { account: alice.account });
    expect(await auction.read.isOnAuction([tokenId])).to.equal(false);
  });

  it("non-seller cannot cancel", async function () {
    const d = await deploy();
    const { auction, alice, bob } = d;
    const tokenId = await startRate(d, alice, "roy");
    await expectRevert(auction.write.cancelAuction([tokenId], { account: bob.account }), "NotSeller");
  });
});
