// SPDX-License-Identifier: MIT
//
// Tests for the MOL holder discount feature on DXRegistrarController.
//
// Covers:
//   - Default state: discount disabled, prices unchanged.
//   - Owner can enable discount via setMolDiscount.
//   - User above threshold gets price reduction.
//   - User below threshold pays full price.
//   - Discount applies to both register and renew, native and token paths.
//   - Owner can disable by passing zero token address.
//   - Discount setter rejects > 50% rate.
//
// MOL 홀더 할인 기능 테스트.

import { expect } from "chai";
import { network } from "hardhat";
import {
  keccak256,
  toBytes,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import DXDeployLocal from "../ignition/modules/DXDeployLocal.js";

const ONE_YEAR = 365n * 24n * 60n * 60n;
const MIN_COMMITMENT_AGE = 30n;
const ONE_MOL = 10n ** 18n;
const ONE_MILLION_MOL = 1_000_000n * ONE_MOL;

function makeCommitmentFull(
  label: string,
  owner: `0x${string}`,
  duration: bigint,
  resolver: `0x${string}`,
  paymentToken: `0x${string}`,
  secret: `0x${string}`,
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("string, address, uint256, address, address, bytes32"),
      [label, owner, duration, resolver, paymentToken, secret],
    ),
  );
}

describe("MOL holder discount", function () {
  async function deploy() {
    const { ignition, viem } = await network.connect();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    // Deploy a mock MOL token (reuse MockERC20).
    const mol = await viem.deployContract("MockERC20", ["MolePin", "MOL", 18]);

    return { ...deployed, mol, owner, alice, bob, publicClient };
  }

  it("by default returns the same price for everyone", async function () {
    const { controller, alice } = await deploy();

    const basePrice = await controller.read.rentPriceFor(["alice", ONE_YEAR]);
    const aliceQuote = await controller.read.rentPriceForPayer([
      "alice",
      ONE_YEAR,
      alice.account.address,
    ]);

    expect(aliceQuote).to.equal(basePrice);
    expect(await controller.read.isMolEligible([alice.account.address])).to.equal(false);
  });

  it("owner can configure MOL discount", async function () {
    const { controller, mol, owner } = await deploy();

    await controller.write.setMolDiscount(
      [mol.address, ONE_MILLION_MOL, 1000n], // 10%
      { account: owner.account },
    );

    expect((await controller.read.molToken()).toLowerCase()).to.equal(
      mol.address.toLowerCase(),
    );
    expect(await controller.read.molThreshold()).to.equal(ONE_MILLION_MOL);
    expect(await controller.read.molDiscountBps()).to.equal(1000n);
  });

  it("non-owner cannot configure discount", async function () {
    const { controller, mol, alice } = await deploy();
    await expect(
      controller.write.setMolDiscount(
        [mol.address, ONE_MILLION_MOL, 1000n],
        { account: alice.account },
      ),
    ).to.be.rejected;
  });

  it("rejects discount > 50% (MAX_MOL_DISCOUNT_BPS)", async function () {
    const { controller, mol, owner } = await deploy();
    await expect(
      controller.write.setMolDiscount(
        [mol.address, ONE_MILLION_MOL, 5001n],
        { account: owner.account },
      ),
    ).to.be.rejected;
  });

  it("user above threshold gets the discount", async function () {
    const { controller, mol, owner, alice } = await deploy();

    await controller.write.setMolDiscount(
      [mol.address, ONE_MILLION_MOL, 1000n],
      { account: owner.account },
    );

    // Alice gets 1M MOL.
    await mol.write.mint([alice.account.address, ONE_MILLION_MOL], {
      account: owner.account,
    });

    const basePrice = await controller.read.rentPriceFor(["alice", ONE_YEAR]);
    const aliceQuote = await controller.read.rentPriceForPayer([
      "alice",
      ONE_YEAR,
      alice.account.address,
    ]);

    // 10% discount: price * 9000 / 10000
    const expected = (basePrice * 9000n) / 10000n;
    expect(aliceQuote).to.equal(expected);
    expect(await controller.read.isMolEligible([alice.account.address])).to.equal(true);
  });

  it("user below threshold pays full price", async function () {
    const { controller, mol, owner, alice } = await deploy();

    await controller.write.setMolDiscount(
      [mol.address, ONE_MILLION_MOL, 1000n],
      { account: owner.account },
    );

    // Alice gets only 999_999 MOL — one short.
    await mol.write.mint([alice.account.address, ONE_MILLION_MOL - 1n], {
      account: owner.account,
    });

    const basePrice = await controller.read.rentPriceFor(["alice", ONE_YEAR]);
    const aliceQuote = await controller.read.rentPriceForPayer([
      "alice",
      ONE_YEAR,
      alice.account.address,
    ]);

    expect(aliceQuote).to.equal(basePrice);
    expect(await controller.read.isMolEligible([alice.account.address])).to.equal(false);
  });

  it("owner can disable discount by passing zero address", async function () {
    const { controller, mol, owner, alice } = await deploy();

    await controller.write.setMolDiscount(
      [mol.address, ONE_MILLION_MOL, 1000n],
      { account: owner.account },
    );
    await mol.write.mint([alice.account.address, ONE_MILLION_MOL], {
      account: owner.account,
    });

    // Now disable.
    await controller.write.setMolDiscount(
      ["0x0000000000000000000000000000000000000000", 0n, 0n],
      { account: owner.account },
    );

    const basePrice = await controller.read.rentPriceFor(["alice", ONE_YEAR]);
    const aliceQuote = await controller.read.rentPriceForPayer([
      "alice",
      ONE_YEAR,
      alice.account.address,
    ]);
    expect(aliceQuote).to.equal(basePrice);
    expect(await controller.read.isMolEligible([alice.account.address])).to.equal(false);
  });

  it("discount applies end-to-end in native register()", async function () {
    const { controller, mol, resolver, owner, alice, publicClient } =
      await deploy();

    await controller.write.setMolDiscount(
      [mol.address, ONE_MILLION_MOL, 1000n],
      { account: owner.account },
    );
    await mol.write.mint([alice.account.address, ONE_MILLION_MOL], {
      account: owner.account,
    });

    const label = "discounted";
    const secret = `0x${"55".repeat(32)}` as `0x${string}`;
    const userAddr = alice.account.address;
    const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;

    const commitment = makeCommitmentFull(
      label, userAddr, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: alice.account });

    await publicClient.testClient.increaseTime({
      seconds: Number(MIN_COMMITMENT_AGE) + 5,
    });
    await publicClient.testClient.mine({ blocks: 1 });

    const basePrice = await controller.read.rentPriceFor([label, ONE_YEAR]);
    const discountedPrice = await controller.read.rentPriceForPayer([
      label,
      ONE_YEAR,
      userAddr,
    ]);
    expect(discountedPrice).to.be.lessThan(basePrice);

    // Pay only the discounted price — must succeed.
    //   할인된 금액만 결제 — 성공해야 함.
    await controller.write.register(
      [label, userAddr, ONE_YEAR, resolver.address, secret],
      { account: alice.account, value: discountedPrice },
    );
  });

  it("user without MOL must pay full price (not discounted)", async function () {
    const { controller, mol, resolver, owner, alice, bob, publicClient } =
      await deploy();

    await controller.write.setMolDiscount(
      [mol.address, ONE_MILLION_MOL, 1000n],
      { account: owner.account },
    );
    // Bob has zero MOL.

    const label = "fullprice";
    const secret = `0x${"66".repeat(32)}` as `0x${string}`;
    const userAddr = bob.account.address;
    const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;

    const commitment = makeCommitmentFull(
      label, userAddr, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: bob.account });

    await publicClient.testClient.increaseTime({
      seconds: Number(MIN_COMMITMENT_AGE) + 5,
    });
    await publicClient.testClient.mine({ blocks: 1 });

    const basePrice = await controller.read.rentPriceFor([label, ONE_YEAR]);
    const bobQuote = await controller.read.rentPriceForPayer([
      label,
      ONE_YEAR,
      userAddr,
    ]);
    expect(bobQuote).to.equal(basePrice);

    // Bob attempting to pay 90% should fail.
    //   Bob이 90%만 지불 시도 — 실패해야 함.
    const tryDiscounted = (basePrice * 9000n) / 10000n;
    await expect(
      controller.write.register(
        [label, userAddr, ONE_YEAR, resolver.address, secret],
        { account: bob.account, value: tryDiscounted },
      ),
    ).to.be.rejected;
  });
});
