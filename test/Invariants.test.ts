// SPDX-License-Identifier: MIT
// Invariant tests for DEXignation.

import { expect } from "chai";
import { network } from "hardhat";
import {
  keccak256, toBytes, encodeAbiParameters, parseAbiParameters,
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

function makeCommitmentFull(
  label: string, owner: `0x${string}`, duration: bigint,
  resolver: `0x${string}`, paymentToken: `0x${string}`, secret: `0x${string}`,
): `0x${string}` {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("string, address, uint256, address, address, bytes32"),
    [label, owner, duration, resolver, paymentToken, secret],
  ));
}

describe("Invariants — system-wide properties that must always hold", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob, carol] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();
    return { ...deployed, owner, alice, bob, carol, publicClient, testClient, viem };
  }

  it("NFT owner equals registry owner for every registered name", async function () {
    const { controller, registrar, registry, resolver, alice, bob, testClient } =
      await deploy();

    const labels = ["alpha", "beta", "gamma", "delta", "epsilon"];
    const users = [alice, bob];

    for (let i = 0; i < labels.length; i++) {
      const user = users[i % users.length];
      const secret = `0x${(i + 1).toString(16).padStart(64, "0")}` as `0x${string}`;
      const label = labels[i];

      const commitment = makeCommitmentFull(
        label, user.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
      );
      await controller.write.commit([commitment], { account: user.account });

      await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
      await testClient.mine({ blocks: 1 });

      const price = await controller.read.rentPrice([ONE_YEAR]);
      await controller.write.register(
        [label, user.account.address, ONE_YEAR, resolver.address, secret],
        { account: user.account, value: price },
      );

      const labelHash = keccak256(toBytes(label));
      const tokenId = BigInt(labelHash);
      const nftOwner = await registrar.read.ownerOf([tokenId]);

      const baseNode = await registrar.read.baseNode();
      const subnode = keccak256(
        encodeAbiParameters(
          parseAbiParameters("bytes32, bytes32"),
          [baseNode, labelHash],
        ),
      );
      const registryOwner = await registry.read.owner([subnode]);

      expect(nftOwner.toLowerCase()).to.equal(registryOwner.toLowerCase());
    }
  });

  it("native balance == sum collected - sum withdrawn", async function () {
    const { controller, resolver, owner, alice, bob, publicClient, testClient } =
      await deploy();

    let expectedBalance = 0n;
    const users = [alice, bob];

    for (let i = 0; i < 6; i++) {
      const user = users[i % users.length];
      const label = `balance${i}`;  // ← inv2_${i} 에서 변경
      const secret = `0x${(i + 100).toString(16).padStart(64, "0")}` as `0x${string}`;

      const commitment = makeCommitmentFull(
        label, user.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
      );
      await controller.write.commit([commitment], { account: user.account });
      await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
      await testClient.mine({ blocks: 1 });

      const price = await controller.read.rentPrice([ONE_YEAR]);
      await controller.write.register(
        [label, user.account.address, ONE_YEAR, resolver.address, secret],
        { account: user.account, value: price },
      );
      expectedBalance += price;

      const actualBalance = await publicClient.getBalance({
        address: controller.address,
      });
      expect(actualBalance).to.equal(expectedBalance);

      if (i === 3) {
        await controller.write.withdraw({ account: owner.account });
        expectedBalance = 0n;
        const afterWithdraw = await publicClient.getBalance({
          address: controller.address,
        });
        expect(afterWithdraw).to.equal(0n);
      }
    }
  });

  it("expiry is in the future for newly registered names", async function () {
    const { controller, registrar, resolver, alice, publicClient, testClient } =
      await deploy();

    const label = "futureexpiry";
    const secret = `0x${"aa".repeat(32)}` as `0x${string}`;
    const commitment = makeCommitmentFull(
      label, alice.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: alice.account });
    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });

    const price = await controller.read.rentPrice([ONE_YEAR]);
    await controller.write.register(
      [label, alice.account.address, ONE_YEAR, resolver.address, secret],
      { account: alice.account, value: price },
    );

    const labelHash = keccak256(toBytes(label));
    const tokenId = BigInt(labelHash);
    const expiry = await registrar.read.nameExpires([tokenId]);
    const block = await publicClient.getBlock();
    // bigint comparison via direct < / > operators
    //   bigint 직접 비교.
    expect(expiry > block.timestamp).to.equal(true,
      `Newly registered name has past expiry: ${expiry} vs ${block.timestamp}`);
  });

  it("discounted price never exceeds base price", async function () {
    const { controller, owner, alice, viem } = await deploy();
    const token = await viem.deployContract("MockERC20", ["T", "T", 18]);

    const configs = [
      { threshold: 1n, bps: 1n },
      { threshold: 100n * 10n**18n, bps: 1000n },
      { threshold: 1_000_000n * 10n**18n, bps: 5000n },
    ];

    for (const cfg of configs) {
      await controller.write.setDiscountToken(
        [token.address, cfg.threshold, cfg.bps],
        { account: owner.account },
      );
      await token.write.mint([alice.account.address, cfg.threshold], {
        account: owner.account,
      });

      const base = await controller.read.rentPriceFor(["test", ONE_YEAR]);
      const discounted = await controller.read.rentPriceForPayer([
        "test", ONE_YEAR, alice.account.address,
      ]);

      // bigint direct comparison
      expect(discounted <= base).to.equal(true,
        `Discount made price higher: base=${base} discounted=${discounted}`);
    }
  });

  it("setter rejects all discountBps above MAX_DISCOUNT_BPS", async function () {
    const { controller, owner, viem } = await deploy();
    const token = await viem.deployContract("MockERC20", ["T", "T", 18]);

    const max = await controller.read.MAX_DISCOUNT_BPS();
    expect(max).to.equal(5000n);

    await controller.write.setDiscountToken(
      [token.address, 1n, max],
      { account: owner.account },
    );

    const aboveMax = [max + 1n, 6000n, 9999n, 10000n];
    for (const v of aboveMax) {
      await expectRevert(
        controller.write.setDiscountToken([token.address, 1n, v], {
          account: owner.account,
        }),
      );
    }
  });

  it("re-registering an active name reverts", async function () {
    const { controller, resolver, alice, bob, testClient } = await deploy();

    const label = "unique";
    const secret1 = `0x${"01".repeat(32)}` as `0x${string}`;
    const secret2 = `0x${"02".repeat(32)}` as `0x${string}`;

    const c1 = makeCommitmentFull(
      label, alice.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret1,
    );
    await controller.write.commit([c1], { account: alice.account });
    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });
    const price = await controller.read.rentPrice([ONE_YEAR]);
    await controller.write.register(
      [label, alice.account.address, ONE_YEAR, resolver.address, secret1],
      { account: alice.account, value: price },
    );

    const c2 = makeCommitmentFull(
      label, bob.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret2,
    );
    await controller.write.commit([c2], { account: bob.account });
    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });
    await expectRevert(
      controller.write.register(
        [label, bob.account.address, ONE_YEAR, resolver.address, secret2],
        { account: bob.account, value: price },
      ),
    );
  });
});
