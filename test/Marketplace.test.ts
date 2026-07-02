// SPDX-License-Identifier: MIT
//
// Marketplace tests for DXMarketplace — fixed-price P2P sales of .dex 2LD NFTs.
//
// Exercises the full flow against the REAL registrar + registry:
//   1. alice registers roy.dex (becomes the NFT owner)
//   2. alice approves the marketplace (single token) + lists at a USDC price
//   3. the tokenURI SVG shows the "LISTED" mark while listed
//   4. bob (a new address) approves USDC + buys
//      → the domain transfers to bob (ownerOf == bob)
//      → alice receives USDC (minus fee), feeRecipient receives the fee
//      → registry control follows the NFT to bob (subtree follows parent)
//      → the LISTED mark disappears (isListed == false)
//   5. cancel removes the listing + mark
//
// Also checks guards: unsupported pay-token, zero price, non-owner list,
// not-approved list, double list, seller-moved-NFT buy reverts, fee cap.
//
// 실제 registrar + registry 대상 마켓플레이스 전체 흐름 검증.
//   roy.dex 등록 → approve + list → SVG에 LISTED 마크 → 새 주소(bob)가
//   USDC 결제하고 구매 → 도메인 이전 + 수익 분배 + registry 제어권 이전 +
//   마크 사라짐 → cancel. 각종 가드도 검증.

import { expect } from "chai";
import { network } from "hardhat";
import {
  keccak256,
  toBytes,
  encodeAbiParameters,
  parseAbiParameters,
  encodePacked,
} from "viem";
import DXDeployLocal from "../ignition/modules/DXDeployLocal.js";

async function expectRevert(
  promise: Promise<unknown>,
  keyword?: string,
): Promise<void> {
  try {
    await promise;
  } catch (err: unknown) {
    if (keyword) {
      expect(String(err)).to.include(keyword);
    }
    return;
  }
  throw new Error(
    keyword
      ? `Expected transaction/read to revert with ${keyword}`
      : "Expected transaction/read to revert",
  );
}

const ONE_YEAR = 365n * 24n * 60n * 60n;
const MIN_COMMITMENT_AGE = 30n;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;

// Marketplace config.
const FEE_BPS = 250n;            // 2.5% protocol fee
const MAX_FEE_BPS = 1000n;       // 10% cap (matches DXMarketplace.MAX_FEE_BPS)
const PRICE = 100n * 10n ** 6n;  // 100 USDC (6 decimals)
const MINT = 1_000n * 10n ** 6n; // 1,000 USDC minted to the buyer

// The mint-green "LISTED" label used by _saleMark() in DXRegistrar.
const LISTED_FILL = "#00DC82";
const LISTED_TEXT = "LISTED";
const ERC4906_INTERFACE_ID = "0x49064906";
const METADATA_UPDATE_TOPIC = keccak256(toBytes("MetadataUpdate(uint256)"));

function labelHash(label: string): `0x${string}` {
  return keccak256(toBytes(label));
}
function tokenIdFromLabel(label: string): bigint {
  return BigInt(labelHash(label));
}
function subnodeFor(parent: `0x${string}`, label: string): `0x${string}` {
  return keccak256(encodePacked(["bytes32", "bytes32"], [parent, labelHash(label)]));
}
function tldNode(): `0x${string}` {
  return subnodeFor(
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    "dex",
  );
}

// Decode a tokenURI data: URI into its embedded SVG (mirrors Registrar-SVG test).
//   tokenURI data: URI에서 SVG를 추출 (Registrar-SVG 테스트와 동일).
function decodeTokenURI(uri: string): { json: string; svg: string } {
  const jsonB64 = uri.replace("data:application/json;base64,", "");
  const json = Buffer.from(jsonB64, "base64").toString("utf8");
  const m = json.match(/data:image\/svg\+xml;base64,([^"]+)/);
  if (!m) throw new Error("no svg in tokenURI json");
  const svg = Buffer.from(m[1], "base64").toString("utf8");
  return { json, svg };
}

describe("DXMarketplace — fixed-price P2P sales of .dex 2LD", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob, carol] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();

    // Deploy the marketplace against the real registrar.
    // feeRecipient = owner (stand-in treasury / RevenueDistributor).
    //   실제 registrar 대상 마켓플레이스 배포. feeRecipient = owner.
    const marketplace = await viem.deployContract("DXMarketplace", [
      deployed.registrar.address,
      owner.account.address,
      FEE_BPS,
      owner.account.address,
    ]);

    // Wire the marketplace to the registrar so tokenURI can derive the mark,
    // and whitelist USDC as a pay-token.
    //   tokenURI가 마크를 파생할 수 있도록 마켓을 registrar에 연결하고,
    //   USDC를 결제 토큰으로 화이트리스트.
    await deployed.registrar.write.setMarketplace([marketplace.address], {
      account: owner.account,
    });
    await marketplace.write.setPayToken([deployed.mockUsdc.address, true], {
      account: owner.account,
    });

    return {
      ...deployed,
      marketplace,
      owner,
      alice,
      bob,
      carol,
      publicClient,
      testClient,
      viem,
    };
  }

  // Register `label`.dex to `registrant`; returns the tokenId.
  //   `label`.dex를 `registrant`에게 등록; tokenId 반환.
  async function registerName(deployed: any, registrant: any, label: string) {
    const { controller, resolver, testClient } = deployed;
    const secret = `0x${"e7".repeat(32)}` as `0x${string}`;
    const commitment = keccak256(
      encodeAbiParameters(
        parseAbiParameters("string, address, uint256, address, address, bytes32"),
        [
          label,
          registrant.account.address,
          ONE_YEAR,
          resolver.address,
          ZERO_ADDR,
          secret,
        ],
      ),
    );
    await controller.write.commit([commitment], { account: registrant.account });
    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });

    const price = await controller.read.rentPrice([ONE_YEAR]);
    await controller.write.register(
      [label, registrant.account.address, ONE_YEAR, resolver.address, secret],
      { account: registrant.account, value: price },
    );
    return tokenIdFromLabel(label);
  }

  // Register + approve marketplace (single token) + list at PRICE in USDC.
  //   등록 + 마켓 단일 토큰 approve + USDC PRICE로 리스팅.
  async function listName(deployed: any, seller: any, label: string, price = PRICE) {
    const { marketplace, registrar, mockUsdc } = deployed;
    const tokenId = await registerName(deployed, seller, label);
    await registrar.write.approve([marketplace.address, tokenId], {
      account: seller.account,
    });
    await marketplace.write.list([tokenId, mockUsdc.address, price], {
      account: seller.account,
    });
    return tokenId;
  }

  async function svgOf(deployed: any, tokenId: bigint): Promise<string> {
    const uri = await deployed.registrar.read.tokenURI([tokenId]);
    return decodeTokenURI(uri as string).svg;
  }

  async function expectMetadataUpdate(deployed: any, hash: `0x${string}`, tokenId: bigint) {
    const receipt = await deployed.publicClient.waitForTransactionReceipt({ hash });
    const encodedTokenId = encodeAbiParameters(parseAbiParameters("uint256"), [tokenId]);
    const logs = receipt.logs.filter(
      (log: any) =>
        log.address.toLowerCase() === deployed.registrar.address.toLowerCase() &&
        log.topics[0] === METADATA_UPDATE_TOPIC &&
        log.data === encodedTokenId,
    );
    expect(logs.length).to.equal(1);
  }

  // ── Listing + SVG mark ────────────────────────────────────────────────────

  it("lists roy.dex and the SVG shows the LISTED mark", async function () {
    const deployed = await deploy();
    const tokenId = await listName(deployed, deployed.alice, "roy");

    // Listing recorded and active.
    expect(await deployed.marketplace.read.isListed([tokenId])).to.equal(true);

    const svg = await svgOf(deployed, tokenId);
    expect(svg).to.include(LISTED_FILL);
    expect(svg).to.include(LISTED_TEXT);
  });

  it("advertises ERC-4906 and emits MetadataUpdate when listing state changes", async function () {
    const deployed = await deploy();
    const { marketplace, registrar, mockUsdc, alice } = deployed;
    const tokenId = await registerName(deployed, alice, "roy4906");

    expect(await registrar.read.supportsInterface([ERC4906_INTERFACE_ID])).to.equal(true);

    await registrar.write.approve([marketplace.address, tokenId], {
      account: alice.account,
    });
    const listHash = await marketplace.write.list([tokenId, mockUsdc.address, PRICE], {
      account: alice.account,
    });
    await expectMetadataUpdate(deployed, listHash, tokenId);

    const updateHash = await marketplace.write.updatePrice([tokenId, PRICE + 1n], {
      account: alice.account,
    });
    await expectMetadataUpdate(deployed, updateHash, tokenId);

    const cancelHash = await marketplace.write.cancel([tokenId], {
      account: alice.account,
    });
    await expectMetadataUpdate(deployed, cancelHash, tokenId);
  });

  it("keeps listing working if registrar metadata notification wiring is cleared", async function () {
    const deployed = await deploy();
    const { marketplace, registrar, mockUsdc, alice, owner } = deployed;
    const tokenId = await registerName(deployed, alice, "best-effort-list");

    await registrar.write.approve([marketplace.address, tokenId], {
      account: alice.account,
    });
    await registrar.write.setMarketplace([ZERO_ADDR], { account: owner.account });

    await marketplace.write.list([tokenId, mockUsdc.address, PRICE], {
      account: alice.account,
    });

    expect(await marketplace.read.isListed([tokenId])).to.equal(true);
  });

  it("an unlisted domain shows NO mark (control)", async function () {
    const deployed = await deploy();
    const tokenId = await registerName(deployed, deployed.alice, "plain");

    expect(await deployed.marketplace.read.isListed([tokenId])).to.equal(false);

    const svg = await svgOf(deployed, tokenId);
    expect(svg).to.not.include(LISTED_TEXT);
  });

  it("getListing returns the seller, payToken, price and active flag", async function () {
    const deployed = await deploy();
    const tokenId = await listName(deployed, deployed.alice, "roy2");

    const [seller, payToken, price, active] =
      await deployed.marketplace.read.getListing([tokenId]);
    expect(seller.toLowerCase()).to.equal(deployed.alice.account.address.toLowerCase());
    expect(payToken.toLowerCase()).to.equal(deployed.mockUsdc.address.toLowerCase());
    expect(price).to.equal(PRICE);
    expect(active).to.equal(true);
  });

  // ── Buy (the core scenario) ────────────────────────────────────────────────

  it("buyer pays USDC and the domain transfers to them, mark clears", async function () {
    const deployed = await deploy();
    const { marketplace, registrar, registry, mockUsdc, owner, alice, bob } = deployed;
    const tokenId = await listName(deployed, alice, "roy");

    // Mint USDC to bob (the new address) and approve the marketplace.
    //   bob(새 주소)에게 USDC 민트하고 마켓에 approve.
    await mockUsdc.write.mint([bob.account.address, MINT], { account: bob.account });
    await mockUsdc.write.approve([marketplace.address, PRICE], { account: bob.account });

    const aliceBefore = await mockUsdc.read.balanceOf([alice.account.address]);
    const feeBefore = await mockUsdc.read.balanceOf([owner.account.address]);

    await marketplace.write.buy([tokenId, PRICE], { account: bob.account });

    // Domain now owned by bob.
    const newOwner = await registrar.read.ownerOf([tokenId]);
    expect(newOwner.toLowerCase()).to.equal(bob.account.address.toLowerCase());

    // Revenue split: alice gets price - fee; feeRecipient (owner) gets fee.
    const expectedFee = (PRICE * FEE_BPS) / 10000n;
    const expectedSeller = PRICE - expectedFee;
    const aliceAfter = await mockUsdc.read.balanceOf([alice.account.address]);
    const feeAfter = await mockUsdc.read.balanceOf([owner.account.address]);
    expect(aliceAfter - aliceBefore).to.equal(expectedSeller);
    expect(feeAfter - feeBefore).to.equal(expectedFee);

    // Registry control followed the NFT to bob (subtree follows the parent).
    const subnode = subnodeFor(tldNode(), "roy");
    const regOwner = await registry.read.owner([subnode]);
    expect(regOwner.toLowerCase()).to.equal(bob.account.address.toLowerCase());

    // Listing closed; mark gone.
    expect(await marketplace.read.isListed([tokenId])).to.equal(false);
    const svg = await svgOf(deployed, tokenId);
    expect(svg).to.not.include(LISTED_TEXT);
  });

  it("buy without enough USDC allowance reverts", async function () {
    const deployed = await deploy();
    const { marketplace, mockUsdc, alice, bob } = deployed;
    const tokenId = await listName(deployed, alice, "roy3");

    // Mint but DON'T approve enough.
    await mockUsdc.write.mint([bob.account.address, MINT], { account: bob.account });
    await mockUsdc.write.approve([marketplace.address, PRICE - 1n], { account: bob.account });

    await expectRevert(
      marketplace.write.buy([tokenId, PRICE], { account: bob.account }),
    );
  });

  it("buy reverts if the live listing price exceeds the buyer maxPrice", async function () {
    const deployed = await deploy();
    const { marketplace, mockUsdc, alice, bob } = deployed;
    const tokenId = await listName(deployed, alice, "roy-slip");
    const raisedPrice = PRICE + 1n;

    await mockUsdc.write.mint([bob.account.address, MINT], { account: bob.account });
    await mockUsdc.write.approve([marketplace.address, raisedPrice], {
      account: bob.account,
    });
    await marketplace.write.updatePrice([tokenId, raisedPrice], {
      account: alice.account,
    });

    await expectRevert(
      marketplace.write.buy([tokenId, PRICE], { account: bob.account }),
      "PriceExceedsMax",
    );
  });

  it("buy succeeds when maxPrice exactly equals the listing price (boundary is strict >)", async function () {
    const deployed = await deploy();
    const { marketplace, registrar, mockUsdc, alice, bob } = deployed;
    const tokenId = await listName(deployed, alice, "roy-eq");

    await mockUsdc.write.mint([bob.account.address, MINT], { account: bob.account });
    await mockUsdc.write.approve([marketplace.address, PRICE], { account: bob.account });

    // maxPrice == price must settle: the guard reverts only on price > maxPrice,
    // so an equal maxPrice is the accepted boundary (not off-by-one rejected).
    await marketplace.write.buy([tokenId, PRICE], { account: bob.account });
    expect((await registrar.read.ownerOf([tokenId])).toLowerCase()).to.equal(
      bob.account.address.toLowerCase(),
    );
  });

  // ── Cancel / updatePrice ────────────────────────────────────────────────────

  it("cancel removes the listing and the mark", async function () {
    const deployed = await deploy();
    const { marketplace, alice } = deployed;
    const tokenId = await listName(deployed, alice, "roy4");

    expect(await marketplace.read.isListed([tokenId])).to.equal(true);

    await marketplace.write.cancel([tokenId], { account: alice.account });

    expect(await marketplace.read.isListed([tokenId])).to.equal(false);
    const svg = await svgOf(deployed, tokenId);
    expect(svg).to.not.include(LISTED_TEXT);
  });

  it("seller can update the price; SVG mark stays (price not in SVG)", async function () {
    const deployed = await deploy();
    const { marketplace, alice } = deployed;
    const tokenId = await listName(deployed, alice, "roy5");

    const newPrice = 250n * 10n ** 6n;
    await marketplace.write.updatePrice([tokenId, newPrice], { account: alice.account });

    const [, , price] = await marketplace.read.getListing([tokenId]);
    expect(price).to.equal(newPrice);

    // Mark still present (boolean state unchanged).
    const svg = await svgOf(deployed, tokenId);
    expect(svg).to.include(LISTED_TEXT);
  });

  // ── Guards ──────────────────────────────────────────────────────────────────

  it("rejects listing with an unsupported pay-token", async function () {
    const deployed = await deploy();
    const { marketplace, registrar, viem, alice } = deployed;
    const tokenId = await registerName(deployed, alice, "roy6");
    await registrar.write.approve([marketplace.address, tokenId], {
      account: alice.account,
    });

    // A random ERC-20 that was never whitelisted.
    const other = await viem.deployContract("MockERC20", ["Other", "OTH", 18]);
    await expectRevert(
      marketplace.write.list([tokenId, other.address, PRICE], {
        account: alice.account,
      }),
      "UnsupportedPayToken",
    );
  });

  it("rejects listing at zero price", async function () {
    const deployed = await deploy();
    const { marketplace, registrar, mockUsdc, alice } = deployed;
    const tokenId = await registerName(deployed, alice, "roy7");
    await registrar.write.approve([marketplace.address, tokenId], {
      account: alice.account,
    });
    await expectRevert(
      marketplace.write.list([tokenId, mockUsdc.address, 0n], {
        account: alice.account,
      }),
      "ZeroPrice",
    );
  });

  it("non-owner cannot list someone else's domain", async function () {
    const deployed = await deploy();
    const { marketplace, mockUsdc, alice, bob } = deployed;
    const tokenId = await registerName(deployed, alice, "roy8");
    // bob never owned it and never approved.
    await expectRevert(
      marketplace.write.list([tokenId, mockUsdc.address, PRICE], {
        account: bob.account,
      }),
      "NotTokenOwner",
    );
  });

  it("rejects listing when the marketplace is not approved", async function () {
    const deployed = await deploy();
    const { marketplace, mockUsdc, alice } = deployed;
    const tokenId = await registerName(deployed, alice, "roy9");
    // Owner but no approve() granted.
    await expectRevert(
      marketplace.write.list([tokenId, mockUsdc.address, PRICE], {
        account: alice.account,
      }),
      "MarketplaceNotApproved",
    );
  });

  it("rejects a second listing of an already-listed token", async function () {
    const deployed = await deploy();
    const { marketplace, mockUsdc, alice } = deployed;
    const tokenId = await listName(deployed, alice, "roy10");
    await expectRevert(
      marketplace.write.list([tokenId, mockUsdc.address, PRICE], {
        account: alice.account,
      }),
      "AlreadyListed",
    );
  });

  it("non-seller cannot cancel", async function () {
    const deployed = await deploy();
    const { marketplace, alice, bob } = deployed;
    const tokenId = await listName(deployed, alice, "roy11");
    await expectRevert(
      marketplace.write.cancel([tokenId], { account: bob.account }),
      "NotSeller",
    );
  });

  it("buy reverts if the seller moved the NFT away after listing", async function () {
    const deployed = await deploy();
    const { marketplace, registrar, mockUsdc, alice, bob, carol } = deployed;
    const tokenId = await listName(deployed, alice, "roy12");

    // Alice transfers the NFT to carol AFTER listing (stale listing).
    //   alice가 리스팅 후 NFT를 carol에게 전송 (stale 리스팅).
    const transferHash = await registrar.write.transferFrom(
      [alice.account.address, carol.account.address, tokenId],
      { account: alice.account },
    );
    await expectMetadataUpdate(deployed, transferHash, tokenId);

    // isListed now reflects the stale state → false (seller no longer owns).
    expect(await marketplace.read.isListed([tokenId])).to.equal(false);

    // Bob tries to buy anyway → reverts (seller no longer owns).
    await mockUsdc.write.mint([bob.account.address, MINT], { account: bob.account });
    await mockUsdc.write.approve([marketplace.address, PRICE], { account: bob.account });
    await expectRevert(
      marketplace.write.buy([tokenId, PRICE], { account: bob.account }),
      "SellerNoLongerOwns",
    );
  });

  it("owner cannot set a protocol fee above MAX_FEE_BPS", async function () {
    const deployed = await deploy();
    const { marketplace, owner } = deployed;
    await expectRevert(
      marketplace.write.setProtocolFee([MAX_FEE_BPS + 1n], { account: owner.account }),
      "FeeTooHigh",
    );
  });

  it("non-owner cannot configure the marketplace", async function () {
    const deployed = await deploy();
    const { marketplace, mockUsdc, alice } = deployed;
    await expectRevert(
      marketplace.write.setPayToken([mockUsdc.address, false], {
        account: alice.account,
      }),
      "OwnableUnauthorizedAccount",
    );
  });

  // ── Subname-follows-parent (the key safety property) ────────────────────────

  it("selling roy.dex carries its subnames to the buyer automatically", async function () {
    const deployed = await deploy();
    const { marketplace, registrar, registry, resolver, mockUsdc, alice, bob } = deployed;

    // alice registers roy.dex and creates a subname pay.roy.dex under it
    // (alice is the parent owner, so she can setSubnodeOwner directly).
    //   alice가 roy.dex 등록 후 그 아래 pay.roy.dex 서브노드 생성
    //   (부모 소유자라 직접 setSubnodeOwner 가능).
    const tokenId = await listName(deployed, alice, "roy");
    const royNode = subnodeFor(tldNode(), "roy");
    const payLabel = labelHash("pay");
    await registry.write.setSubnodeOwner(
      [royNode, payLabel, alice.account.address],
      { account: alice.account },
    );
    const payNode = subnodeFor(royNode, "pay");
    expect((await registry.read.owner([payNode])).toLowerCase())
      .to.equal(alice.account.address.toLowerCase());

    // bob buys roy.dex.
    await mockUsdc.write.mint([bob.account.address, MINT], { account: bob.account });
    await mockUsdc.write.approve([marketplace.address, PRICE], { account: bob.account });
    await marketplace.write.buy([tokenId, PRICE], { account: bob.account });

    // Parent control moved to bob. bob, as the new parent owner, now controls
    // the pay.roy.dex subnode (can reassign it) — the subtree follows.
    //   부모 제어권이 bob에게. bob이 새 부모 소유자로서 pay.roy.dex 서브노드를
    //   통제 — 서브트리가 따라온다.
    expect((await registry.read.owner([royNode])).toLowerCase())
      .to.equal(bob.account.address.toLowerCase());

    // bob can now reassign the subname (proving control followed).
    await registry.write.setSubnodeOwner(
      [royNode, payLabel, bob.account.address],
      { account: bob.account },
    );
    expect((await registry.read.owner([payNode])).toLowerCase())
      .to.equal(bob.account.address.toLowerCase());
  });
});
