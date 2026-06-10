// SPDX-License-Identifier: MIT
//
// End-to-end registration flow tests using the local Ignition module.
// 로컬 Ignition 모듈을 사용한 등록 플로우 E2E 테스트.

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
const EXPECTED_DXN_REWARD = 4n * 10n ** 17n;

function labelHash(label: string): `0x${string}` {
  return keccak256(toBytes(label));
}
function tokenIdFromLabel(label: string): bigint {
  return BigInt(labelHash(label));
}
function subnodeFor(parent: `0x${string}`, label: string): `0x${string}` {
  return keccak256(encodePacked(["bytes32", "bytes32"], [parent, labelHash(label)]));
}
function makeCommitmentFull(
  label: string, owner: `0x${string}`, duration: bigint,
  resolver: `0x${string}`, paymentToken: `0x${string}`, secret: `0x${string}`,
): `0x${string}` {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("string, address, uint256, address, address, bytes32"),
    [label, owner, duration, resolver, paymentToken, secret],
  ));
}

describe("DXRegistrarController — registration flow", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, user] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();
    return { ...deployed, owner, user, publicClient, testClient };
  }

  it("accepts multilingual labels while rejecting unsafe ASCII labels", async function () {
    const { controller } = await deploy();

    for (const label of ["홍길동", "東京名", "مرحبا", "中文명"]) {
      expect(await controller.read.isValidLabel([label])).to.equal(true);
    }

    for (const label of ["Alice", "ab cd", "alice.dex", "bad<label", "doub--le"]) {
      expect(await controller.read.isValidLabel([label])).to.equal(false);
    }
  });

  it("registers a multilingual label end-to-end", async function () {
    const { controller, registrar, resolver, registry, user, testClient } = await deploy();

    const label = "홍길동";
    const secret = `0x${"66".repeat(32)}` as `0x${string}`;
    const userAddr = user.account.address;

    const commitment = makeCommitmentFull(
      label, userAddr, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: user.account });

    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });

    const price = await controller.read.rentPrice([ONE_YEAR]);
    await controller.write.register(
      [label, userAddr, ONE_YEAR, resolver.address, secret],
      { account: user.account, value: price },
    );

    const tokenId = tokenIdFromLabel(label);
    const tokenOwner = await registrar.read.ownerOf([tokenId]);
    expect(tokenOwner.toLowerCase()).to.equal(userAddr.toLowerCase());

    const baseNode = await registrar.read.baseNode();
    const subnode = subnodeFor(baseNode, label);
    const subnodeOwner = await registry.read.owner([subnode]);
    expect(subnodeOwner.toLowerCase()).to.equal(userAddr.toLowerCase());
  });

  it("registers a name end-to-end with native payment", async function () {
    const { controller, registrar, resolver, registry, dxnToken, user, publicClient, testClient } =
      await deploy();

    const label = "alice";
    const secret = `0x${"11".repeat(32)}` as `0x${string}`;
    const userAddr = user.account.address;

    const commitment = makeCommitmentFull(
      label, userAddr, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: user.account });

    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });

    const price = await controller.read.rentPrice([ONE_YEAR]);
    await controller.write.register(
      [label, userAddr, ONE_YEAR, resolver.address, secret],
      { account: user.account, value: price },
    );

    const tokenId = tokenIdFromLabel(label);
    const tokenOwner = await registrar.read.ownerOf([tokenId]);
    expect(tokenOwner.toLowerCase()).to.equal(userAddr.toLowerCase());

    const baseNode = await registrar.read.baseNode();
    const subnode = subnodeFor(baseNode, label);
    const subnodeOwner = await registry.read.owner([subnode]);
    expect(subnodeOwner.toLowerCase()).to.equal(userAddr.toLowerCase());

    const resolverAddr = await registry.read.resolver([subnode]);
    expect(resolverAddr.toLowerCase()).to.equal(resolver.address.toLowerCase());

    const COIN_TYPE_POLYGON = (1n << 31n) | 137n;
    const stored = await resolver.read.addr([subnode, COIN_TYPE_POLYGON]);
    expect(stored.toLowerCase()).to.equal(userAddr.toLowerCase());

    // $8 registration, 10% reward, DXN reward price $2 => 0.4 DXN.
    expect(await controller.read.dxnRewardPriceAttoUSD()).to.equal(2n * 10n ** 18n);
    expect(await dxnToken.read.balanceOf([userAddr])).to.equal(EXPECTED_DXN_REWARD);
  });

  it("mints DXN rewards for token-paid registrations", async function () {
    const { controller, registrar, resolver, dxnToken, mockUsdc, user, testClient } =
      await deploy();

    const label = "usdcname";
    const secret = `0x${"44".repeat(32)}` as `0x${string}`;
    const userAddr = user.account.address;

    const commitment = makeCommitmentFull(
      label, userAddr, ONE_YEAR, resolver.address, mockUsdc.address, secret,
    );
    await controller.write.commit([commitment], { account: user.account });

    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });

    const amount = await controller.read.rentPriceInTokenForPayer([
      label,
      ONE_YEAR,
      mockUsdc.address,
      userAddr,
    ]);
    await mockUsdc.write.mint([userAddr, amount], { account: user.account });
    await mockUsdc.write.approve([controller.address, amount], { account: user.account });

    await controller.write.registerWithToken(
      [label, userAddr, ONE_YEAR, resolver.address, mockUsdc.address, secret],
      { account: user.account },
    );

    const tokenId = tokenIdFromLabel(label);
    const tokenOwner = await registrar.read.ownerOf([tokenId]);
    expect(tokenOwner.toLowerCase()).to.equal(userAddr.toLowerCase());
    expect(await dxnToken.read.balanceOf([userAddr])).to.equal(EXPECTED_DXN_REWARD);
  });

  it("mints DXN rewards to the payer, not a different domain owner", async function () {
    const { controller, registrar, resolver, dxnToken, user, owner, testClient } =
      await deploy();

    const label = "giftname";
    const secret = `0x${"55".repeat(32)}` as `0x${string}`;
    const payerAddr = user.account.address;
    const domainOwnerAddr = owner.account.address;

    const commitment = makeCommitmentFull(
      label, domainOwnerAddr, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: user.account });

    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });

    const price = await controller.read.rentPrice([ONE_YEAR]);
    await controller.write.register(
      [label, domainOwnerAddr, ONE_YEAR, resolver.address, secret],
      { account: user.account, value: price },
    );

    const tokenId = tokenIdFromLabel(label);
    const tokenOwner = await registrar.read.ownerOf([tokenId]);
    expect(tokenOwner.toLowerCase()).to.equal(domainOwnerAddr.toLowerCase());
    expect(await dxnToken.read.balanceOf([payerAddr])).to.equal(EXPECTED_DXN_REWARD);
    expect(await dxnToken.read.balanceOf([domainOwnerAddr])).to.equal(1_000_000n * 10n ** 18n);
  });

  it("owner can update the DXN reward accounting price", async function () {
    const { controller, resolver, dxnToken, user, owner, testClient } = await deploy();

    await controller.write.setDxnReward([
      dxnToken.address,
      1000n,
      1n * 10n ** 18n,
    ], { account: owner.account });
    expect(await controller.read.dxnRewardPriceAttoUSD()).to.equal(1n * 10n ** 18n);

    const label = "pricedxn";
    const secret = `0x${"77".repeat(32)}` as `0x${string}`;
    const userAddr = user.account.address;

    const commitment = makeCommitmentFull(
      label, userAddr, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: user.account });

    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });

    const price = await controller.read.rentPrice([ONE_YEAR]);
    await controller.write.register(
      [label, userAddr, ONE_YEAR, resolver.address, secret],
      { account: user.account, value: price },
    );

    // $8 registration, 10% reward, owner-updated DXN reward price $1 => 0.8 DXN.
    expect(await dxnToken.read.balanceOf([userAddr])).to.equal(8n * 10n ** 17n);
  });

  it("rejects reveal that is too early", async function () {
    const { controller, resolver, user } = await deploy();
    const label = "tooearly";
    const secret = `0x${"22".repeat(32)}` as `0x${string}`;
    const userAddr = user.account.address;

    const commitment = makeCommitmentFull(
      label, userAddr, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: user.account });

    const price = await controller.read.rentPrice([ONE_YEAR]);
    await expectRevert(
      controller.write.register(
        [label, userAddr, ONE_YEAR, resolver.address, secret],
        { account: user.account, value: price },
      ),
    );
  });

  it("refunds overpayment in native currency", async function () {
    const { controller, resolver, user, publicClient, testClient } = await deploy();
    const label = "refund";
    const secret = `0x${"33".repeat(32)}` as `0x${string}`;
    const userAddr = user.account.address;

    const commitment = makeCommitmentFull(
      label, userAddr, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: user.account });

    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });

    const price = await controller.read.rentPrice([ONE_YEAR]);
    const overpay = price * 3n;

    const balBefore = await publicClient.getBalance({ address: userAddr });
    const txHash = await controller.write.register(
      [label, userAddr, ONE_YEAR, resolver.address, secret],
      { account: user.account, value: overpay },
    );
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;
    const balAfter = await publicClient.getBalance({ address: userAddr });

    const expected = price + gasUsed;
    const actual = balBefore - balAfter;
    expect(actual).to.equal(expected);
  });
});
