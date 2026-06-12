// SPDX-License-Identifier: MIT
//
// Resolver expiry guard regressions.
//
// Verifies stale payment/contract routing records are hidden after expiry.

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

const ONE_YEAR = 365n * 24n * 60n * 60n;
const MIN_COMMITMENT_AGE = 30n;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;
const COIN_TYPE_POLYGON = (1n << 31n) | 137n;

function labelHash(label: string): `0x${string}` {
  return keccak256(toBytes(label));
}

function subnodeFor(parent: `0x${string}`, label: string): `0x${string}` {
  return keccak256(
    encodePacked(["bytes32", "bytes32"], [parent, labelHash(label)]),
  );
}

function tldNode(): `0x${string}` {
  return subnodeFor(
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    "dex",
  );
}

describe("DXResolver — expiry guards", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice] = await viem.getWalletClients();
    const testClient = await viem.getTestClient();
    return { ...deployed, owner, alice, testClient };
  }

  async function registerName(deployed: any, label: string) {
    const { controller, resolver, testClient, alice } = deployed;
    const secret = `0x${"c3".repeat(32)}` as `0x${string}`;
    const commitment = keccak256(
      encodeAbiParameters(
        parseAbiParameters("string, address, uint256, address, address, bytes32"),
        [
          label,
          alice.account.address,
          ONE_YEAR,
          resolver.address,
          ZERO_ADDR,
          secret,
        ],
      ),
    );

    await controller.write.commit([commitment], { account: alice.account });
    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });

    const price = await controller.read.rentPrice([ONE_YEAR]);
    await controller.write.register(
      [label, alice.account.address, ONE_YEAR, resolver.address, secret],
      { account: alice.account, value: price },
    );

    return subnodeFor(tldNode(), label);
  }

  async function expireName(deployed: any) {
    await deployed.testClient.increaseTime({
      seconds: Number(ONE_YEAR) + 1,
    });
    await deployed.testClient.mine({ blocks: 1 });
  }

  it("addr returns empty bytes after the node expires", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, "addrguard");

    expect(
      (await deployed.resolver.read.addr([node, COIN_TYPE_POLYGON])).toLowerCase(),
    ).to.equal(deployed.alice.account.address.toLowerCase());

    await expireName(deployed);

    expect(await deployed.resolver.read.addr([node, COIN_TYPE_POLYGON])).to.equal(
      "0x",
    );
  });

  it("ABI returns empty data after the node expires", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, "abiguard");
    const abiData = "0x7b22616269223a5b5d7d" as `0x${string}`; // {"abi":[]}

    await deployed.resolver.write.setABI([node, 137n, 4n, abiData], {
      account: deployed.alice.account,
    });
    expect(await deployed.resolver.read.ABI([node, 137n, 4n])).to.deep.equal([
      4n,
      abiData,
    ]);

    await expireName(deployed);

    expect(await deployed.resolver.read.ABI([node, 137n, 4n])).to.deep.equal([
      0n,
      "0x",
    ]);
  });
});
