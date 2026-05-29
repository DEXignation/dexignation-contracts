// SPDX-License-Identifier: MIT
//
// Contenthash record tests (EIP-1577).
//
// Verifies:
//   - Set / read / delete contenthash bytes
//   - Authorization
//   - Length bound (128 bytes)
//   - Expired node returns empty bytes
//   - ERC-165 support
//
// EIP-1577 contenthash 테스트.

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

function labelHash(label: string): `0x${string}` {
  return keccak256(toBytes(label));
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

// Sample EIP-1577 contenthashes. Format is multicodec-prefixed CID bytes.
//   샘플 EIP-1577 contenthash. multicodec-prefix + CID.

/// IPFS CIDv0 example: 0xe3 (ipfs-ns) || 0x01 (cidv1) || 0x70 (dag-pb) ||
///   0x12 (sha2-256) || 0x20 (32-byte hash) || <32 bytes>.
const IPFS_HASH = "0xe30101701220ca1ce5cae8b8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8a8" as `0x${string}`;

/// IPNS example: 0xe5 (ipns-ns) prefix.
const IPNS_HASH = "0xe50101720024080112deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as `0x${string}`;

describe("DXResolver — contenthash (EIP-1577)", function () {
  async function deploy() {
    const { ignition, viem } = await network.connect();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();
    return {
      ...deployed,
      owner,
      alice,
      bob,
      viem,
      publicClient,
      testClient,
    };
  }

  async function registerName(deployed: any, registrant: any, label: string) {
    const { controller, resolver, testClient } = deployed;
    const secret = `0x${"b2".repeat(32)}` as `0x${string}`;
    // Commitment must use abi.encode (not encodePacked).
    //   commitment는 abi.encode 사용 필수 (encodePacked 아님).
    const commitment = keccak256(
      encodeAbiParameters(
        parseAbiParameters("string, address, uint256, address, address, bytes32"),
        [
          label,
          registrant.account.address,
          ONE_YEAR,
          resolver.address,
          "0x0000000000000000000000000000000000000000",
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

  // ── Read/write basics ───────────────────────────────────────────────────

  it("returns empty bytes for an unset contenthash", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicech1");
    const v = await deployed.resolver.read.contenthash([node]);
    expect(v).to.equal("0x");
  });

  it("stores and reads an IPFS contenthash", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicech2");

    await deployed.resolver.write.setContenthash([node, IPFS_HASH], {
      account: deployed.alice.account,
    });

    const v = await deployed.resolver.read.contenthash([node]);
    expect(v.toLowerCase()).to.equal(IPFS_HASH.toLowerCase());
  });

  it("overwrites an existing contenthash (IPFS → IPNS)", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicech3");

    await deployed.resolver.write.setContenthash([node, IPFS_HASH], {
      account: deployed.alice.account,
    });
    await deployed.resolver.write.setContenthash([node, IPNS_HASH], {
      account: deployed.alice.account,
    });

    const v = await deployed.resolver.read.contenthash([node]);
    expect(v.toLowerCase()).to.equal(IPNS_HASH.toLowerCase());
  });

  it("empty bytes deletes the contenthash", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicech4");

    await deployed.resolver.write.setContenthash([node, IPFS_HASH], {
      account: deployed.alice.account,
    });
    await deployed.resolver.write.setContenthash([node, "0x"], {
      account: deployed.alice.account,
    });

    expect(await deployed.resolver.read.contenthash([node])).to.equal("0x");
  });

  // ── Authorization ───────────────────────────────────────────────────────

  it("non-owner cannot setContenthash", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicech5");

    // Bob tries to write to alice's node. Should revert (Unauthorized).
    //   bob이 alice의 노드에 쓰기 시도. revert해야 함.
    await expectRevert(
      deployed.resolver.write.setContenthash([node, IPFS_HASH], {
        account: deployed.bob.account,
      }),
    );
  });

  // ── Length bounds ───────────────────────────────────────────────────────

  it("rejects contenthash over MAX_CONTENTHASH_LENGTH (128 bytes)", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicech6");

    // 129-byte hex string: 0x + 258 hex chars
    const tooLong = ("0x" + "ab".repeat(129)) as `0x${string}`;
    await expectRevert(
      deployed.resolver.write.setContenthash([node, tooLong], {
        account: deployed.alice.account,
      }),
      "ContenthashTooLong",
    );
  });

  it("accepts contenthash at exactly MAX_CONTENTHASH_LENGTH (128 bytes)", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicech7");

    const maxHash = ("0x" + "cd".repeat(128)) as `0x${string}`;
    await deployed.resolver.write.setContenthash([node, maxHash], {
      account: deployed.alice.account,
    });
    expect((await deployed.resolver.read.contenthash([node])).toLowerCase())
      .to.equal(maxHash.toLowerCase());
  });

  // ── Expiry ──────────────────────────────────────────────────────────────

  it("returns empty bytes after the node expires", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicech8");

    await deployed.resolver.write.setContenthash([node, IPFS_HASH], {
      account: deployed.alice.account,
    });
    expect((await deployed.resolver.read.contenthash([node])).toLowerCase())
      .to.equal(IPFS_HASH.toLowerCase());

    // Fast-forward past expiry + grace
    await deployed.testClient.increaseTime({
      seconds: Number(ONE_YEAR) + 31 * 24 * 60 * 60,
    });
    await deployed.testClient.mine({ blocks: 1 });

    expect(await deployed.resolver.read.contenthash([node])).to.equal("0x");
  });

  // ── ERC-165 ─────────────────────────────────────────────────────────────

  it("reports support for EIP-1577 (contenthash) via ERC-165", async function () {
    const deployed = await deploy();
    // EIP-1577 contenthash interfaceId = 0xbc1c58d1
    const supports = await deployed.resolver.read.supportsInterface(["0xbc1c58d1"]);
    expect(supports).to.equal(true);
  });
});
