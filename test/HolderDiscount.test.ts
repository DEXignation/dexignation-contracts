// SPDX-License-Identifier: MIT
// Tests for the generic holder-discount feature on DXRegistrarController.

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
const MIN_COMMITMENT_AGE = 30n;
const ONE_TOKEN = 10n ** 18n;
const ONE_MILLION_TOKENS = 1_000_000n * ONE_TOKEN;
const ZERO_ADDR =
  "0x0000000000000000000000000000000000000000" as `0x${string}`;

function makeCommitmentFull(
  label: string, owner: `0x${string}`, duration: bigint,
  resolver: `0x${string}`, paymentToken: `0x${string}`, secret: `0x${string}`,
): `0x${string}` {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("string, address, uint256, address, address, bytes32"),
    [label, owner, duration, resolver, paymentToken, secret],
  ));
}

describe("Holder discount", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();

    const partnerToken = await viem.deployContract("MockERC20", [
      "Partner Token", "PT", 18,
    ]);

    return { ...deployed, partnerToken, owner, alice, bob, publicClient, testClient, viem };
  }

  it("by default returns the same price for everyone", async function () {
    const { controller, alice } = await deploy();
    const basePrice = await controller.read.rentPriceFor(["alice", ONE_YEAR]);
    const aliceQuote = await controller.read.rentPriceForPayer([
      "alice", ONE_YEAR, alice.account.address,
    ]);
    expect(aliceQuote).to.equal(basePrice);
    expect(await controller.read.isDiscountEligible([alice.account.address]))
      .to.equal(false);
  });

  it("owner can configure the discount", async function () {
    const { controller, partnerToken, owner } = await deploy();

    await controller.write.setDiscountToken(
      [partnerToken.address, ONE_MILLION_TOKENS, 1000n],
      { account: owner.account },
    );

    expect((await controller.read.discountToken()).toLowerCase()).to.equal(
      partnerToken.address.toLowerCase(),
    );
    expect(await controller.read.requiredHoldAmount()).to.equal(ONE_MILLION_TOKENS);
    expect(await controller.read.discountBps()).to.equal(1000n);
  });

  it("non-owner cannot configure", async function () {
    const { controller, partnerToken, alice } = await deploy();
    await expectRevert(
      controller.write.setDiscountToken(
        [partnerToken.address, ONE_MILLION_TOKENS, 1000n],
        { account: alice.account },
      ),
    );
  });

  it("rejects discount > MAX_DISCOUNT_BPS (50%)", async function () {
    const { controller, partnerToken, owner } = await deploy();
    await expectRevert(
      controller.write.setDiscountToken(
        [partnerToken.address, ONE_MILLION_TOKENS, 5001n],
        { account: owner.account },
      ),
    );

    await controller.write.setDiscountToken(
      [partnerToken.address, ONE_MILLION_TOKENS, 5000n],
      { account: owner.account },
    );
    expect(await controller.read.discountBps()).to.equal(5000n);
  });

  it("rejects requiredHoldAmount = 0 when enabling", async function () {
    const { controller, partnerToken, owner } = await deploy();
    await expectRevert(
      controller.write.setDiscountToken(
        [partnerToken.address, 0n, 1000n],
        { account: owner.account },
      ),
    );
  });

  it("allows requiredHoldAmount = 0 when disabling (zero address)", async function () {
    const { controller, owner } = await deploy();
    await controller.write.setDiscountToken(
      [ZERO_ADDR, 0n, 0n],
      { account: owner.account },
    );
    expect((await controller.read.discountToken())).to.equal(ZERO_ADDR);
  });

  it("user above threshold gets the discount", async function () {
    const { controller, partnerToken, owner, alice } = await deploy();

    await controller.write.setDiscountToken(
      [partnerToken.address, ONE_MILLION_TOKENS, 1000n],
      { account: owner.account },
    );
    await partnerToken.write.mint([alice.account.address, ONE_MILLION_TOKENS], {
      account: owner.account,
    });

    const basePrice = await controller.read.rentPriceFor(["alice", ONE_YEAR]);
    const aliceQuote = await controller.read.rentPriceForPayer([
      "alice", ONE_YEAR, alice.account.address,
    ]);
    expect(aliceQuote).to.equal((basePrice * 9000n) / 10000n);
    expect(await controller.read.isDiscountEligible([alice.account.address]))
      .to.equal(true);
  });

  it("user just below threshold pays full price", async function () {
    const { controller, partnerToken, owner, alice } = await deploy();

    await controller.write.setDiscountToken(
      [partnerToken.address, ONE_MILLION_TOKENS, 1000n],
      { account: owner.account },
    );
    await partnerToken.write.mint(
      [alice.account.address, ONE_MILLION_TOKENS - 1n],
      { account: owner.account },
    );

    const basePrice = await controller.read.rentPriceFor(["alice", ONE_YEAR]);
    const aliceQuote = await controller.read.rentPriceForPayer([
      "alice", ONE_YEAR, alice.account.address,
    ]);
    expect(aliceQuote).to.equal(basePrice);
    expect(await controller.read.isDiscountEligible([alice.account.address]))
      .to.equal(false);
  });

  it("owner can switch discount to a different token", async function () {
    // Use the same viem instance from deploy() to ensure consistency.
    //   같은 viem instance 사용으로 일관성 확보.
    const { controller, partnerToken, owner, alice, viem } = await deploy();
    const otherToken = await viem.deployContract("MockERC20", ["Other", "OTH", 18]);

    await controller.write.setDiscountToken(
      [partnerToken.address, ONE_MILLION_TOKENS, 1000n],
      { account: owner.account },
    );
    await partnerToken.write.mint([alice.account.address, ONE_MILLION_TOKENS], {
      account: owner.account,
    });
    expect(await controller.read.isDiscountEligible([alice.account.address]))
      .to.equal(true);

    await controller.write.setDiscountToken(
      [otherToken.address, 100n * ONE_TOKEN, 500n],
      { account: owner.account },
    );
    expect(await controller.read.isDiscountEligible([alice.account.address]))
      .to.equal(false);
  });

  it("discount applies end-to-end in native register()", async function () {
    const { controller, partnerToken, resolver, owner, alice, testClient } =
      await deploy();

    await controller.write.setDiscountToken(
      [partnerToken.address, ONE_MILLION_TOKENS, 1000n],
      { account: owner.account },
    );
    await partnerToken.write.mint([alice.account.address, ONE_MILLION_TOKENS], {
      account: owner.account,
    });

    const label = "discounted";
    const secret = `0x${"55".repeat(32)}` as `0x${string}`;
    const userAddr = alice.account.address;

    const commitment = makeCommitmentFull(
      label, userAddr, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: alice.account });

    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });

    const discountedPrice = await controller.read.rentPriceForPayer([
      label, ONE_YEAR, userAddr,
    ]);

    await controller.write.register(
      [label, userAddr, ONE_YEAR, resolver.address, secret],
      { account: alice.account, value: discountedPrice },
    );
  });

  it("non-holder must pay full price in register()", async function () {
    const { controller, partnerToken, resolver, owner, bob, testClient } =
      await deploy();

    await controller.write.setDiscountToken(
      [partnerToken.address, ONE_MILLION_TOKENS, 1000n],
      { account: owner.account },
    );

    const label = "fullprice";
    const secret = `0x${"66".repeat(32)}` as `0x${string}`;
    const userAddr = bob.account.address;

    const commitment = makeCommitmentFull(
      label, userAddr, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: bob.account });

    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });

    const basePrice = await controller.read.rentPriceFor([label, ONE_YEAR]);
    const discounted = (basePrice * 9000n) / 10000n;

    await expectRevert(
      controller.write.register(
        [label, userAddr, ONE_YEAR, resolver.address, secret],
        { account: bob.account, value: discounted },
      ),
    );
  });
});
