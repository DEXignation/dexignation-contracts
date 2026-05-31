// SPDX-License-Identifier: MIT
//
// Transfer-safety EDGE CASES (v2 hardening).
//
// Beyond the core transfer-invalidation tests, these probe the corners that
// could bite in production:
//   1. safeTransferFrom (not just transferFrom) also invalidates
//   2. unauthorized parties cannot call resolver.bumpVersion directly
//   3. unauthorized parties cannot call registrar-only paths
//   4. owner-to-self / approved-operator transfers behave correctly
//   5. multiple sequential transfers keep incrementing the version
//   6. records set by the NEW owner survive (only the transfer bump clears)
//
// 프로덕션에서 문제될 수 있는 모서리 케이스 검증: safeTransferFrom, 무권한
// bumpVersion 차단, 승인 operator 전송, 연속 전송, 새 소유자 레코드 보존.

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
const COIN_TYPE_POLYGON = (1n << 31n) | 137n;

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

describe("Transfer safety — edge cases (v2 hardening)", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob, carol] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();
    return { ...deployed, owner, alice, bob, carol, publicClient, testClient, viem };
  }

  async function registerName(deployed: any, registrant: any, label: string) {
    const { controller, resolver, testClient } = deployed;
    const secret = `0x${"cd".repeat(32)}` as `0x${string}`;
    const commitment = keccak256(
      encodeAbiParameters(
        parseAbiParameters("string, address, uint256, address, address, bytes32"),
        [label, registrant.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret],
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

  // ── 1. safeTransferFrom also invalidates ──────────────────────────────────

  it("safeTransferFrom also moves control and invalidates records", async function () {
    const deployed = await deploy();
    const { registrar, registry, resolver, alice, bob } = deployed;
    const node = await registerName(deployed, alice, "safexfer");
    const id = tokenIdFromLabel("safexfer");

    await resolver.write.setText([node, "email", "alice@x.com"], {
      account: alice.account,
    });

    // safeTransferFrom (3-arg) — different code path than transferFrom but
    // both route through _update.
    await registrar.write.safeTransferFrom(
      [alice.account.address, bob.account.address, id],
      { account: alice.account },
    );

    expect((await registry.read.owner([node])).toLowerCase())
      .to.equal(bob.account.address.toLowerCase());
    expect(await resolver.read.text([node, "email"])).to.equal("");
  });

  // ── 2. Unauthorized bumpVersion is rejected ───────────────────────────────

  it("a random account cannot call resolver.bumpVersion directly", async function () {
    const deployed = await deploy();
    const { resolver, alice, carol } = deployed;
    const node = await registerName(deployed, alice, "nobump");

    // carol (not the registrar) tries to grief by bumping alice's version.
    await expectRevert(
      resolver.write.bumpVersion([node], { account: carol.account }),
      "Only registrar",
    );
  });

  // ── 3. Even the resolver owner cannot bumpVersion (only registrar can) ─────

  it("not even the contract owner can bumpVersion (registrar-gated)", async function () {
    const deployed = await deploy();
    const { resolver, owner, alice } = deployed;
    const node = await registerName(deployed, alice, "ownernobump");

    await expectRevert(
      resolver.write.bumpVersion([node], { account: owner.account }),
      "Only registrar",
    );
  });

  // ── 4. Approved-operator transfer still invalidates ───────────────────────

  it("operator-initiated transfer (approved) also invalidates", async function () {
    const deployed = await deploy();
    const { registrar, registry, resolver, alice, bob, carol } = deployed;
    const node = await registerName(deployed, alice, "operxfer");
    const id = tokenIdFromLabel("operxfer");

    await resolver.write.setText([node, "x", "v"], { account: alice.account });

    // alice approves carol as operator; carol moves the token to bob.
    await registrar.write.setApprovalForAll([carol.account.address, true], {
      account: alice.account,
    });
    await registrar.write.transferFrom(
      [alice.account.address, bob.account.address, id],
      { account: carol.account },
    );

    // from is still alice (token holder), so invalidation applies.
    expect((await registry.read.owner([node])).toLowerCase())
      .to.equal(bob.account.address.toLowerCase());
    expect(await resolver.read.text([node, "x"])).to.equal("");
  });

  // ── 5. Sequential transfers keep bumping ──────────────────────────────────

  it("three sequential transfers bump the version each time", async function () {
    const deployed = await deploy();
    const { registrar, resolver, alice, bob, carol } = deployed;
    const node = await registerName(deployed, alice, "triphop");
    const id = tokenIdFromLabel("triphop");

    const v0 = await resolver.read.recordVersions([node]);

    await registrar.write.transferFrom(
      [alice.account.address, bob.account.address, id],
      { account: alice.account },
    );
    await registrar.write.transferFrom(
      [bob.account.address, carol.account.address, id],
      { account: bob.account },
    );
    await registrar.write.transferFrom(
      [carol.account.address, alice.account.address, id],
      { account: carol.account },
    );

    expect(await resolver.read.recordVersions([node])).to.equal(v0 + 3n);
  });

  // ── 6. New owner's records persist (only transfer clears) ─────────────────

  it("records set AFTER transfer by the new owner persist", async function () {
    const deployed = await deploy();
    const { registrar, resolver, alice, bob } = deployed;
    const node = await registerName(deployed, alice, "newkeep");
    const id = tokenIdFromLabel("newkeep");

    await registrar.write.transferFrom(
      [alice.account.address, bob.account.address, id],
      { account: alice.account },
    );

    // bob sets a record; it must survive (no further transfer).
    await resolver.write.setText([node, "site", "bob.example"], {
      account: bob.account,
    });
    expect(await resolver.read.text([node, "site"])).to.equal("bob.example");

    // A read of an unrelated key is still empty (clean version namespace).
    expect(await resolver.read.text([node, "email"])).to.equal("");
  });
});