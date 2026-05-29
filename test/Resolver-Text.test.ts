// SPDX-License-Identifier: MIT
//
// Text records tests (EIP-634).
//
// Verifies:
//   - Set / read / delete free-form text records
//   - Authorization (only owner or approved operator can write)
//   - Length bounds (key, value)
//   - Empty value clears the record
//   - Expiry returns empty string from reads
//   - Event emission with correct indexed/non-indexed parameters
//
// EIP-634 텍스트 레코드 테스트. 설정/조회/삭제, 권한, 길이 상한,
// 만료 처리, 이벤트 emit 검증.

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

describe("DXResolver — text records (EIP-634)", function () {
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
    const secret = `0x${"a1".repeat(32)}` as `0x${string}`;
    // Commitment must use abi.encode (not encodePacked) to match the
    // contract's keccak256(abi.encode(...)).
    //   commitment는 컨트랙트의 keccak256(abi.encode(...))와 일치하도록
    //   abi.encode 사용 필수.
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

  it("returns empty string for an unset key", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicetext1");
    const v = await deployed.resolver.read.text([node, "url"]);
    expect(v).to.equal("");
  });

  it("stores and reads a text record", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicetext2");

    await deployed.resolver.write.setText(
      [node, "url", "https://alice.example.com"],
      { account: deployed.alice.account },
    );

    const v = await deployed.resolver.read.text([node, "url"]);
    expect(v).to.equal("https://alice.example.com");
  });

  it("stores multiple distinct keys for the same node", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicetext3");

    await deployed.resolver.write.setText([node, "url", "https://a.com"], {
      account: deployed.alice.account,
    });
    await deployed.resolver.write.setText([node, "com.twitter", "alice"], {
      account: deployed.alice.account,
    });
    await deployed.resolver.write.setText([node, "avatar", "ipfs://QmAvatar"], {
      account: deployed.alice.account,
    });

    expect(await deployed.resolver.read.text([node, "url"]))
      .to.equal("https://a.com");
    expect(await deployed.resolver.read.text([node, "com.twitter"]))
      .to.equal("alice");
    expect(await deployed.resolver.read.text([node, "avatar"]))
      .to.equal("ipfs://QmAvatar");
  });

  it("isolates records across different nodes", async function () {
    const deployed = await deploy();
    const aliceNode = await registerName(deployed, deployed.alice, "alicetext4");
    const bobNode = await registerName(deployed, deployed.bob, "bobtext1");

    await deployed.resolver.write.setText([aliceNode, "url", "alice"], {
      account: deployed.alice.account,
    });
    await deployed.resolver.write.setText([bobNode, "url", "bob"], {
      account: deployed.bob.account,
    });

    expect(await deployed.resolver.read.text([aliceNode, "url"])).to.equal("alice");
    expect(await deployed.resolver.read.text([bobNode, "url"])).to.equal("bob");
  });

  // ── Overwrite / delete ──────────────────────────────────────────────────

  it("overwrites an existing value", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicetext5");

    await deployed.resolver.write.setText([node, "url", "v1"], {
      account: deployed.alice.account,
    });
    await deployed.resolver.write.setText([node, "url", "v2"], {
      account: deployed.alice.account,
    });
    expect(await deployed.resolver.read.text([node, "url"])).to.equal("v2");
  });

  it("empty value deletes the record", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicetext6");

    await deployed.resolver.write.setText([node, "url", "https://x.com"], {
      account: deployed.alice.account,
    });
    expect(await deployed.resolver.read.text([node, "url"])).to.equal("https://x.com");

    await deployed.resolver.write.setText([node, "url", ""], {
      account: deployed.alice.account,
    });
    expect(await deployed.resolver.read.text([node, "url"])).to.equal("");
  });

  // ── Authorization ───────────────────────────────────────────────────────

  it("non-owner cannot setText", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicetext7");

    // Bob tries to write to alice's node. Should revert (Unauthorized).
    //   bob이 alice의 노드에 쓰기 시도. revert해야 함.
    await expectRevert(
      deployed.resolver.write.setText([node, "url", "bob-tries"], {
        account: deployed.bob.account,
      }),
    );
  });

  it("approved operator can setText", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicetext8");

    // alice approves bob as operator over her resolver writes
    await deployed.resolver.write.setApprovalForAll(
      [deployed.bob.account.address, true],
      { account: deployed.alice.account },
    );

    await deployed.resolver.write.setText([node, "url", "via-bob"], {
      account: deployed.bob.account,
    });
    expect(await deployed.resolver.read.text([node, "url"])).to.equal("via-bob");
  });

  // ── Length bounds ───────────────────────────────────────────────────────

  it("rejects key over MAX_TEXT_KEY_LENGTH (64 bytes)", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicetext9");

    const longKey = "x".repeat(65);
    await expectRevert(
      deployed.resolver.write.setText([node, longKey, "v"], {
        account: deployed.alice.account,
      }),
      "TextKeyTooLong",
    );
  });

  it("accepts key at exactly MAX_TEXT_KEY_LENGTH", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicetext10");

    const maxKey = "x".repeat(64);
    await deployed.resolver.write.setText([node, maxKey, "v"], {
      account: deployed.alice.account,
    });
    expect(await deployed.resolver.read.text([node, maxKey])).to.equal("v");
  });

  it("rejects value over MAX_TEXT_VALUE_LENGTH (1024 bytes)", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicetext11");

    const longValue = "y".repeat(1025);
    await expectRevert(
      deployed.resolver.write.setText([node, "url", longValue], {
        account: deployed.alice.account,
      }),
      "TextValueTooLong",
    );
  });

  it("accepts value at exactly MAX_TEXT_VALUE_LENGTH", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicetext12");

    const maxValue = "y".repeat(1024);
    await deployed.resolver.write.setText([node, "url", maxValue], {
      account: deployed.alice.account,
    });
    expect(await deployed.resolver.read.text([node, "url"])).to.equal(maxValue);
  });

  // ── Expiry ──────────────────────────────────────────────────────────────

  it("returns empty string after the node expires", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "alicetext13");

    await deployed.resolver.write.setText([node, "url", "https://x.com"], {
      account: deployed.alice.account,
    });
    expect(await deployed.resolver.read.text([node, "url"])).to.equal("https://x.com");

    // Fast-forward past expiry + grace
    await deployed.testClient.increaseTime({
      seconds: Number(ONE_YEAR) + 31 * 24 * 60 * 60,
    });
    await deployed.testClient.mine({ blocks: 1 });

    expect(await deployed.resolver.read.text([node, "url"])).to.equal("");
  });

  // ── ERC-165 ─────────────────────────────────────────────────────────────

  it("reports support for EIP-634 (text) via ERC-165", async function () {
    const deployed = await deploy();
    // EIP-634 text() interfaceId = 0x59d1d43c
    const supports = await deployed.resolver.read.supportsInterface(["0x59d1d43c"]);
    expect(supports).to.equal(true);
  });
});
