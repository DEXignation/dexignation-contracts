// SPDX-License-Identifier: MIT
//
// Transfer-safety tests (v2): NFT transfer moves control AND invalidates records.
//
// When a .dex name NFT is transferred between users (secondary transfer, not
// the registration delivery), the registrar's _update hook must:
//   1. Move registry ownership to the new holder (control transfer)
//   2. Bump the resolver record version, invalidating ALL record kinds
//      (addr, text, contenthash, profile, agent) so the name no longer
//      resolves to the previous owner — preventing mis-sent funds.
//   3. Old records remain on chain under the previous version (history).
//   4. The new owner can set fresh records; the old owner cannot.
//   5. Mint and burn must NOT trigger invalidation (regression).
//
// NFT 양도 시 _update 훅이 (1) registry 제어권 이전 (2) 레코드 버전 증가로
// 모든 레코드(addr/text/contenthash/profile/agent) 무효화 (3) 옛 레코드는
// 이력 보존 (4) 새 소유자만 재설정 가능 (5) mint/burn은 무효화 안 함을 검증.

import { expect } from "chai";
import { network } from "hardhat";
import {
  keccak256,
  toBytes,
  encodePacked,
  encodeAbiParameters,
  parseAbiParameters,
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

// EVM/Polygon coin type used by the controller's auto-set addr record.
const COIN_TYPE_POLYGON = (1n << 31n) | 137n;

// Sample agent pointers.
const AGENT_REGISTRY = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const AGENT_ID = 7n;
const CARD_URI = "ipfs://agentcard/seller";
const PAY_TO = "0x2222222222222222222222222222222222222222" as `0x${string}`;
const PAY_TOKEN = "0x3333333333333333333333333333333333333333" as `0x${string}`;

const IPFS_HASH =
  "0xe30101701220ca1ce5cae8b8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8" as `0x${string}`;

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

describe("Transfer safety — control transfer + record invalidation (v2)", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();
    return { ...deployed, owner, alice, bob, publicClient, testClient, viem };
  }

  // Register `label`.dex to `registrant`. Returns the subnode.
  async function registerName(deployed: any, registrant: any, label: string) {
    const { controller, resolver, testClient } = deployed;
    const secret = `0x${"ab".repeat(32)}` as `0x${string}`;
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
    return subnodeFor(tldNode(), label);
  }

  // ── Core: control transfer ────────────────────────────────────────────────

  it("transfer moves registry control to the new owner", async function () {
    const deployed = await deploy();
    const { registrar, registry, alice, bob } = deployed;
    const node = await registerName(deployed, alice, "ctrlmove");
    const id = tokenIdFromLabel("ctrlmove");

    // Before: registry owner is alice (set during registration delivery).
    expect((await registry.read.owner([node])).toLowerCase())
      .to.equal(alice.account.address.toLowerCase());

    // Secondary transfer alice → bob.
    await registrar.write.transferFrom(
      [alice.account.address, bob.account.address, id],
      { account: alice.account },
    );

    // After: NFT owner AND registry owner are both bob.
    expect((await registrar.read.ownerOf([id])).toLowerCase())
      .to.equal(bob.account.address.toLowerCase());
    expect((await registry.read.owner([node])).toLowerCase())
      .to.equal(bob.account.address.toLowerCase());
  });

  // ── Core: all six record kinds invalidated ────────────────────────────────

  it("transfer invalidates ALL record kinds (addr/text/contenthash/profile/agent)", async function () {
    const deployed = await deploy();
    const { registrar, resolver, alice, bob } = deployed;
    const node = await registerName(deployed, alice, "wipeall");
    const id = tokenIdFromLabel("wipeall");

    // alice populates every record kind.
    await resolver.write.setAddr(
      [node, COIN_TYPE_POLYGON, alice.account.address],
      { account: alice.account },
    );
    await resolver.write.setText([node, "email", "alice@x.com"], {
      account: alice.account,
    });
    await resolver.write.setContenthash([node, IPFS_HASH], {
      account: alice.account,
    });
    await resolver.write.setProfile(
      [node, "en", "Alice", "bio", "ipfs://av", "https://a.dex"],
      { account: alice.account },
    );
    await resolver.write.setAgent(
      [node, AGENT_REGISTRY, AGENT_ID, CARD_URI, PAY_TO, PAY_TOKEN],
      { account: alice.account },
    );

    // Sanity: records are set (addr is the auto-set one + our explicit set).
    expect((await resolver.read.addr([node, COIN_TYPE_POLYGON])).toLowerCase())
      .to.equal(alice.account.address.toLowerCase());
    expect(await resolver.read.text([node, "email"])).to.equal("alice@x.com");
    expect(await resolver.read.hasAgent([node])).to.equal(true);

    // Secondary transfer alice → bob triggers invalidation.
    await registrar.write.transferFrom(
      [alice.account.address, bob.account.address, id],
      { account: alice.account },
    );

    // ALL record kinds now return empty/zero (version bumped).
    expect(await resolver.read.addr([node, COIN_TYPE_POLYGON])).to.equal("0x");
    expect(await resolver.read.text([node, "email"])).to.equal("");
    expect(await resolver.read.contenthash([node])).to.equal("0x");
    const [pName, pBio, pAvatar, pUrl] =
      await resolver.read.getProfile([node, "en"]);
    expect(pName).to.equal("");
    expect(pBio).to.equal("");
    expect(pAvatar).to.equal("");
    expect(pUrl).to.equal("");
    expect(await resolver.read.hasAgent([node])).to.equal(false);
    const [aReg, , , aPayTo] = await resolver.read.getAgent([node]);
    expect(aReg).to.equal(ZERO_ADDR);
    expect(aPayTo).to.equal(ZERO_ADDR);
  });

  // ── Authorization flips to the new owner ──────────────────────────────────

  it("after transfer, old owner cannot set records; new owner can", async function () {
    const deployed = await deploy();
    const { registrar, resolver, alice, bob } = deployed;
    const node = await registerName(deployed, alice, "authflip");
    const id = tokenIdFromLabel("authflip");

    await registrar.write.transferFrom(
      [alice.account.address, bob.account.address, id],
      { account: alice.account },
    );

    // Old owner (alice) can no longer write — registry owner is bob now.
    await expectRevert(
      resolver.write.setAddr(
        [node, COIN_TYPE_POLYGON, alice.account.address],
        { account: alice.account },
      ),
      "Not authorized",
    );

    // New owner (bob) can write.
    await resolver.write.setAddr(
      [node, COIN_TYPE_POLYGON, bob.account.address],
      { account: bob.account },
    );
    expect((await resolver.read.addr([node, COIN_TYPE_POLYGON])).toLowerCase())
      .to.equal(bob.account.address.toLowerCase());
  });

  // ── Resolution resumes after the new owner sets a fresh record ────────────

  it("resolution resumes once the new owner sets a fresh address", async function () {
    const deployed = await deploy();
    const { registrar, resolver, alice, bob } = deployed;
    const node = await registerName(deployed, alice, "resume");
    const id = tokenIdFromLabel("resume");

    // alice's auto-set addr points at alice.
    expect((await resolver.read.addr([node, COIN_TYPE_POLYGON])).toLowerCase())
      .to.equal(alice.account.address.toLowerCase());

    await registrar.write.transferFrom(
      [alice.account.address, bob.account.address, id],
      { account: alice.account },
    );

    // Immediately after transfer: empty (mis-send protection window).
    expect(await resolver.read.addr([node, COIN_TYPE_POLYGON])).to.equal("0x");

    // bob sets his own address; resolution resumes pointing at bob.
    await resolver.write.setAddr(
      [node, COIN_TYPE_POLYGON, bob.account.address],
      { account: bob.account },
    );
    expect((await resolver.read.addr([node, COIN_TYPE_POLYGON])).toLowerCase())
      .to.equal(bob.account.address.toLowerCase());
  });

  // ── History: version bumps, old version retained ──────────────────────────

  it("record version increments on transfer (history preserved on chain)", async function () {
    const deployed = await deploy();
    const { registrar, resolver, alice, bob } = deployed;
    const node = await registerName(deployed, alice, "versionbump");
    const id = tokenIdFromLabel("versionbump");

    const v0 = await resolver.read.recordVersions([node]);

    await registrar.write.transferFrom(
      [alice.account.address, bob.account.address, id],
      { account: alice.account },
    );

    const v1 = await resolver.read.recordVersions([node]);
    expect(v1).to.equal(v0 + 1n);

    // A second hop bob → alice bumps again.
    await registrar.write.transferFrom(
      [bob.account.address, alice.account.address, id],
      { account: bob.account },
    );
    const v2 = await resolver.read.recordVersions([node]);
    expect(v2).to.equal(v1 + 1n);
  });

  // ── Regression: registration delivery does NOT invalidate ─────────────────

  it("registration (controller delivery) does NOT invalidate the auto-set addr", async function () {
    const deployed = await deploy();
    const { resolver, alice } = deployed;
    const node = await registerName(deployed, alice, "regnobump");

    // The controller auto-sets the Polygon addr during registration. Despite
    // the internal controller→owner transfer, it must survive (controllers[from]
    // skip). Version should still be 0.
    expect(await resolver.read.recordVersions([node])).to.equal(0n);
    expect((await resolver.read.addr([node, COIN_TYPE_POLYGON])).toLowerCase())
      .to.equal(alice.account.address.toLowerCase());
  });

  // ── Regression: burn does not bump a live node's version path ─────────────

  it("mint does not bump version (fresh name starts at version 0)", async function () {
    const deployed = await deploy();
    const { resolver, alice } = deployed;
    const node = await registerName(deployed, alice, "freshzero");
    expect(await resolver.read.recordVersions([node])).to.equal(0n);
  });
});