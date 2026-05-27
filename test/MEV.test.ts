// SPDX-License-Identifier: MIT
// MEV scenario tests for the commit-reveal flow.

import { expect } from "chai";
import { network } from "hardhat";
import {
  keccak256, encodeAbiParameters, parseAbiParameters,
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
const THREE_YEARS = 3n * 365n * 24n * 60n * 60n;
const MIN_COMMITMENT_AGE = 30n;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;

function makeCommitmentFull(
  label: string, owner: `0x${string}`, duration: bigint,
  resolver: `0x${string}`, paymentToken: `0x${string}`, secret: `0x${string}`,
): `0x${string}` {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("string, address, uint256, address, address, bytes32"),
    [label, owner, duration, resolver, paymentToken, secret],
  ));
}

describe("MEV — commit-reveal resistance to parameter swapping", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, attacker] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();
    return { ...deployed, owner, alice, attacker, publicClient, testClient, viem };
  }

  it("attacker cannot swap resolver in reveal", async function () {
    const { controller, resolver, registry, alice, attacker, testClient, viem } =
      await deploy();

    // Deploy a second resolver using the SAME viem instance (same chain).
    //   같은 chain의 두 번째 resolver 배포.
    const attackerResolver = await viem.deployContract("DXResolver", [
      registry.address,
    ]);

    const label = "victim";
    const secret = `0x${"77".repeat(32)}` as `0x${string}`;

    const legitCommitment = makeCommitmentFull(
      label, alice.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([legitCommitment], { account: alice.account });

    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });

    const price = await controller.read.rentPrice([ONE_YEAR]);

    await expectRevert(
      controller.write.register(
        [label, alice.account.address, ONE_YEAR, attackerResolver.address, secret],
        { account: attacker.account, value: price },
      ),
    );

    await controller.write.register(
      [label, alice.account.address, ONE_YEAR, resolver.address, secret],
      { account: alice.account, value: price },
    );
  });

  it("attacker cannot swap duration in reveal", async function () {
    const { controller, resolver, alice, attacker, testClient } = await deploy();

    const label = "duration-victim";
    const secret = `0x${"88".repeat(32)}` as `0x${string}`;

    const commitment = makeCommitmentFull(
      label, alice.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: alice.account });

    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });

    const tripleYearPrice = await controller.read.rentPrice([THREE_YEARS]);
    await expectRevert(
      controller.write.register(
        [label, alice.account.address, THREE_YEARS, resolver.address, secret],
        { account: attacker.account, value: tripleYearPrice },
      ),
    );
  });

  it("attacker cannot swap owner in reveal", async function () {
    const { controller, resolver, alice, attacker, testClient } = await deploy();

    const label = "owner-victim";
    const secret = `0x${"99".repeat(32)}` as `0x${string}`;

    const commitment = makeCommitmentFull(
      label, alice.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: alice.account });

    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });

    const price = await controller.read.rentPrice([ONE_YEAR]);
    await expectRevert(
      controller.write.register(
        [label, attacker.account.address, ONE_YEAR, resolver.address, secret],
        { account: attacker.account, value: price },
      ),
    );
  });

  it("attacker cannot swap paymentToken in reveal", async function () {
    const { controller, resolver, mockUsdc, alice, attacker, testClient } =
      await deploy();

    const label = "payment-victim";
    const secret = `0x${"aa".repeat(32)}` as `0x${string}`;

    const commitment = makeCommitmentFull(
      label, alice.account.address, ONE_YEAR, resolver.address, mockUsdc.address, secret,
    );
    await controller.write.commit([commitment], { account: alice.account });

    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });

    const price = await controller.read.rentPrice([ONE_YEAR]);
    await expectRevert(
      controller.write.register(
        [label, alice.account.address, ONE_YEAR, resolver.address, secret],
        { account: attacker.account, value: price },
      ),
    );
  });

  it("legacy 3-arg commitment is rejected at reveal", async function () {
    const { controller, resolver, alice, testClient } = await deploy();

    const label = "legacy-user";
    const secret = `0x${"bb".repeat(32)}` as `0x${string}`;

    const legacyCommitment = keccak256(
      encodeAbiParameters(
        parseAbiParameters("string, address, bytes32"),
        [label, alice.account.address, secret],
      ),
    );
    await controller.write.commit([legacyCommitment], { account: alice.account });

    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });

    const price = await controller.read.rentPrice([ONE_YEAR]);
    await expectRevert(
      controller.write.register(
        [label, alice.account.address, ONE_YEAR, resolver.address, secret],
        { account: alice.account, value: price },
      ),
    );
  });

  it("reveal before minCommitmentAge rejects", async function () {
    const { controller, resolver, alice } = await deploy();

    const label = "tooearly2";
    const secret = `0x${"cc".repeat(32)}` as `0x${string}`;
    const commitment = makeCommitmentFull(
      label, alice.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: alice.account });

    const price = await controller.read.rentPrice([ONE_YEAR]);
    await expectRevert(
      controller.write.register(
        [label, alice.account.address, ONE_YEAR, resolver.address, secret],
        { account: alice.account, value: price },
      ),
    );
  });
});

describe("MEV — race conditions on same label", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();
    return { ...deployed, owner, alice, bob, publicClient, testClient };
  }

  it("first reveal wins; second reveal of same label reverts", async function () {
    const { controller, resolver, alice, bob, testClient } = await deploy();

    const label = "race";
    const aliceSecret = `0x${"dd".repeat(32)}` as `0x${string}`;
    const bobSecret = `0x${"ee".repeat(32)}` as `0x${string}`;

    const aliceC = makeCommitmentFull(
      label, alice.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, aliceSecret,
    );
    const bobC = makeCommitmentFull(
      label, bob.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, bobSecret,
    );
    await controller.write.commit([aliceC], { account: alice.account });
    await controller.write.commit([bobC], { account: bob.account });

    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });

    const price = await controller.read.rentPrice([ONE_YEAR]);

    await controller.write.register(
      [label, alice.account.address, ONE_YEAR, resolver.address, aliceSecret],
      { account: alice.account, value: aliceSecret === aliceSecret ? price : price },
    );

    await expectRevert(
      controller.write.register(
        [label, bob.account.address, ONE_YEAR, resolver.address, bobSecret],
        { account: bob.account, value: price },
      ),
    );
  });
});
