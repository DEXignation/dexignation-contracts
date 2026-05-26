// SPDX-License-Identifier: MIT
//
// Tests for the generic holder-discount feature on DXRegistrarController.
//
// Covers:
//   - Default state: discount disabled, prices unchanged.
//   - Owner can enable via setDiscountToken with any ERC-20.
//   - Setter constraints: bps ≤ 50%, threshold > 0 when enabling.
//   - User above/below threshold pricing.
//   - Owner can disable by passing zero token address (other args ignored).
//   - End-to-end: discount applied in actual register() with native payment.
//
// 일반화된 보유자 할인 테스트.

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
const ONE_TOKEN = 10n ** 18n;
const ONE_MILLION_TOKENS = 1_000_000n * ONE_TOKEN;
const ZERO_ADDR =
  "0x0000000000000000000000000000000000000000" as `0x${string}`;

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
      parseAbiParameters(
        "string, address, uint256, address, address, bytes32",
      ),
      [label, owner, duration, resolver, paymentToken, secret],
    ),
  );
}

describe("Holder discount", function () {
  async function deploy() {
    const { ignition, viem } = await network.connect();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    // Deploy a generic ERC-20 to act as the discount target. Naming is
    // irrelevant — could be MOL, a future DXN, or any partner token.
    //   할인 대상 ERC-20 — 이름 무관. MOL이든 향후 DXN이든 어떤 파트너든.
    const partnerToken = await viem.deployContract("MockERC20", [
      "Partner Token", "PT", 18,
    ]);

    return { ...deployed, partnerToken, owner, alice, bob, publicClient };
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
      [partnerToken.address, ONE_MILLION_TOKENS, 1000n], // 10%
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
    await expect(
      controller.write.setDiscountToken(
        [partnerToken.address, ONE_MILLION_TOKENS, 1000n],
        { account: alice.account },
      ),
    ).to.be.rejected;
  });

  it("rejects discount > MAX_DISCOUNT_BPS (50%)", async function () {
    const { controller, partnerToken, owner } = await deploy();
    await expect(
      controller.write.setDiscountToken(
        [partnerToken.address, ONE_MILLION_TOKENS, 5001n],
        { account: owner.account },
      ),
    ).to.be.rejected;

    // 5000 (exactly 50%) is the boundary — must succeed.
    await controller.write.setDiscountToken(
      [partnerToken.address, ONE_MILLION_TOKENS, 5000n],
      { account: owner.account },
    );
    expect(await controller.read.discountBps()).to.equal(5000n);
  });

  it("rejects requiredHoldAmount = 0 when enabling", async function () {
    const { controller, partnerToken, owner } = await deploy();
    await expect(
      controller.write.setDiscountToken(
        [partnerToken.address, 0n, 1000n],
        { account: owner.account },
      ),
    ).to.be.rejected;
  });

  it("allows requiredHoldAmount = 0 when disabling (zero address)", async function () {
    const { controller, owner } = await deploy();
    // Disabling — non-zero args don't matter.
    //   비활성화 — 다른 인자는 무시되므로 0이어도 OK.
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
    const { controller, partnerToken, owner, alice } = await deploy();
    const { viem } = await network.connect();
    const otherToken = await viem.deployContract("MockERC20", ["Other", "OTH", 18]);

    // Enable for partnerToken first.
    await controller.write.setDiscountToken(
      [partnerToken.address, ONE_MILLION_TOKENS, 1000n],
      { account: owner.account },
    );
    await partnerToken.write.mint([alice.account.address, ONE_MILLION_TOKENS], {
      account: owner.account,
    });
    expect(await controller.read.isDiscountEligible([alice.account.address]))
      .to.equal(true);

    // Switch to otherToken — alice loses eligibility (zero balance there).
    //   다른 토큰으로 교체 — alice는 자격 상실.
    await controller.write.setDiscountToken(
      [otherToken.address, 100n * ONE_TOKEN, 500n],
      { account: owner.account },
    );
    expect(await controller.read.isDiscountEligible([alice.account.address]))
      .to.equal(false);
  });

  it("discount applies end-to-end in native register()", async function () {
    const { controller, partnerToken, resolver, owner, alice, publicClient } =
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

    await publicClient.testClient.increaseTime({
      seconds: Number(MIN_COMMITMENT_AGE) + 5,
    });
    await publicClient.testClient.mine({ blocks: 1 });

    const discountedPrice = await controller.read.rentPriceForPayer([
      label, ONE_YEAR, userAddr,
    ]);

    await controller.write.register(
      [label, userAddr, ONE_YEAR, resolver.address, secret],
      { account: alice.account, value: discountedPrice },
    );
  });

  it("non-holder must pay full price in register()", async function () {
    const { controller, partnerToken, resolver, owner, bob, publicClient } =
      await deploy();

    await controller.write.setDiscountToken(
      [partnerToken.address, ONE_MILLION_TOKENS, 1000n],
      { account: owner.account },
    );
    // Bob has zero partner tokens.

    const label = "fullprice";
    const secret = `0x${"66".repeat(32)}` as `0x${string}`;
    const userAddr = bob.account.address;

    const commitment = makeCommitmentFull(
      label, userAddr, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: bob.account });

    await publicClient.testClient.increaseTime({
      seconds: Number(MIN_COMMITMENT_AGE) + 5,
    });
    await publicClient.testClient.mine({ blocks: 1 });

    const basePrice = await controller.read.rentPriceFor([label, ONE_YEAR]);
    const discounted = (basePrice * 9000n) / 10000n;

    // Bob paying discounted amount must fail.
    //   Bob이 할인 금액만 결제 시도 — 실패해야 함.
    await expect(
      controller.write.register(
        [label, userAddr, ONE_YEAR, resolver.address, secret],
        { account: bob.account, value: discounted },
      ),
    ).to.be.rejected;
  });
});
