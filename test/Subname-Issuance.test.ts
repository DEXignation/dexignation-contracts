// SPDX-License-Identifier: MIT
//
// Registry-direct subname issuance tests.

import { expect } from "chai";
import { network } from "hardhat";
import {
  encodeAbiParameters,
  encodePacked,
  keccak256,
  parseAbiParameters,
  toBytes,
} from "viem";
import DXDeployLocal from "../ignition/modules/DXDeployLocal.js";

async function expectRevert(
  promise: Promise<unknown>,
  keyword?: string,
): Promise<void> {
  try {
    await promise;
  } catch (err: unknown) {
    if (keyword) expect(String(err)).to.include(keyword);
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

describe("DXRegistry — direct subname issuance", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob, carol] = await viem.getWalletClients();
    const testClient = await viem.getTestClient();
    return { ...deployed, owner, alice, bob, carol, testClient };
  }

  async function registerParent(deployed: any, registrant: any, label: string) {
    const { controller, resolver, testClient } = deployed;
    const secret = `0x${"b7".repeat(32)}` as `0x${string}`;
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

  it("issues a subname directly to a specific recipient", async function () {
    const d = await deploy();
    const parentNode = await registerParent(d, d.alice, "aliceissue");

    await d.registry.write.issueSubnodeRecord(
      [parentNode, "team", d.bob.account.address, d.resolver.address],
      { account: d.alice.account },
    );

    const subnode = subnodeFor(parentNode, "team");
    expect((await d.registry.read.owner([subnode])).toLowerCase())
      .to.equal(d.bob.account.address.toLowerCase());
    expect((await d.registry.read.resolver([subnode])).toLowerCase())
      .to.equal(d.resolver.address.toLowerCase());
  });

  it("only allows the current parent owner to issue", async function () {
    const d = await deploy();
    const parentNode = await registerParent(d, d.alice, "aliceowner");

    await expectRevert(
      d.registry.write.issueSubnodeRecord(
        [parentNode, "team", d.bob.account.address, d.resolver.address],
        { account: d.bob.account },
      ),
    );
  });

  it("reassigns a subname and invalidates old resolver records", async function () {
    const d = await deploy();
    const parentNode = await registerParent(d, d.alice, "alicereassign");

    await d.registry.write.issueSubnodeRecord(
      [parentNode, "team", d.bob.account.address, d.resolver.address],
      { account: d.alice.account },
    );

    const subnode = subnodeFor(parentNode, "team");
    await d.resolver.write.setText([subnode, "description", "owned by bob"], {
      account: d.bob.account,
    });
    expect(await d.resolver.read.text([subnode, "description"]))
      .to.equal("owned by bob");

    await d.registry.write.reassignSubnodeRecord(
      [parentNode, "team", d.carol.account.address, d.resolver.address],
      { account: d.alice.account },
    );

    expect((await d.registry.read.owner([subnode])).toLowerCase())
      .to.equal(d.carol.account.address.toLowerCase());
    expect(await d.resolver.read.text([subnode, "description"])).to.equal("");
  });

  it("revokes a subname back to the parent owner and invalidates records", async function () {
    const d = await deploy();
    const parentNode = await registerParent(d, d.alice, "alicerevoke");

    await d.registry.write.issueSubnodeRecord(
      [parentNode, "team", d.bob.account.address, d.resolver.address],
      { account: d.alice.account },
    );

    const subnode = subnodeFor(parentNode, "team");
    await d.resolver.write.setText([subnode, "description", "owned by bob"], {
      account: d.bob.account,
    });

    await d.registry.write.revokeSubnodeRecord(
      [parentNode, "team", d.resolver.address],
      { account: d.alice.account },
    );

    expect((await d.registry.read.owner([subnode])).toLowerCase())
      .to.equal(d.alice.account.address.toLowerCase());
    expect(await d.resolver.read.text([subnode, "description"])).to.equal("");
  });

  it("inherits parent expiry", async function () {
    const d = await deploy();
    const parentNode = await registerParent(d, d.alice, "aliceexpire");

    await d.registry.write.issueSubnodeRecord(
      [parentNode, "team", d.bob.account.address, d.resolver.address],
      { account: d.alice.account },
    );

    const subnode = subnodeFor(parentNode, "team");
    expect(await d.registry.read.isExpired([subnode])).to.equal(false);

    await d.testClient.increaseTime({ seconds: Number(ONE_YEAR) + 5 });
    await d.testClient.mine({ blocks: 1 });

    expect(await d.registry.read.isExpired([subnode])).to.equal(true);
  });

  it("rejects invalid labels", async function () {
    const d = await deploy();
    const parentNode = await registerParent(d, d.alice, "alicelabel");

    await expectRevert(
      d.registry.write.issueSubnodeRecord(
        [parentNode, "ab", d.bob.account.address, d.resolver.address],
        { account: d.alice.account },
      ),
      "InvalidLabel",
    );
  });

  it("rejects zero address sale modules", async function () {
    const d = await deploy();

    await expectRevert(
      d.registry.write.setSaleModule([ZERO_ADDR, true], {
        account: d.owner.account,
      }),
      "ZeroAddress",
    );
  });
});
