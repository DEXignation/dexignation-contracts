// SPDX-License-Identifier: MIT
//
// Staking discount tests for DXRegistrarController (A2).
//
// Verifies:
//   - staking >= threshold yields the configured discount
//   - staking below threshold pays full price
//   - token / SBT / stake discounts do NOT stack (largest wins)
//   - only owner can configure; rate capped at MAX_DISCOUNT_BPS
//   - disabling (zero address) zeroes the rate
//
// 스테이킹 할인 테스트. 임계치 이상 스테이크 시 할인, 미달 시 정가,
// 토큰·SBT·스테이크 비중첩(최대값), owner만 설정·상한, 비활성화 검증.

import { expect } from "chai";
import { network } from "hardhat";
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
const ONE_TOKEN = 10n ** 18n;
const MAX_DISCOUNT_BPS = 5000n;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;
const THRESHOLD = 100n * ONE_TOKEN; // must stake >= 100 tokens

describe("Staking discount (A2)", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();

    // Staking token + staking contract for the test.
    //   테스트용 스테이킹 토큰 + 스테이킹 컨트랙트.
    const stakeToken = await viem.deployContract("MockERC20", [
      "Stake", "STK", 18,
    ]);
    const staking = await viem.deployContract("DXNStaking", [
      stakeToken.address,
    ]);

    return {
      ...deployed, stakeToken, staking,
      owner, alice, bob, publicClient, testClient, viem,
    };
  }

  // Mint to `who`, approve staking, and stake `amount`.
  //   `who`에게 민트 → staking에 approve → `amount` 스테이크.
  async function stakeFor(deployed: any, who: any, amount: bigint) {
    const { stakeToken, staking } = deployed;
    await stakeToken.write.mint([who.account.address, amount]);
    await stakeToken.write.approve([staking.address, amount], {
      account: who.account,
    });
    await staking.write.stake([amount], { account: who.account });
  }

  it("non-owner cannot configure the staking discount", async function () {
    const { controller, staking, alice } = await deploy();
    await expectRevert(
      controller.write.setStakeDiscount([staking.address, THRESHOLD, 1500n], {
        account: alice.account,
      }),
      "OwnableUnauthorizedAccount",
    );
  });

  it("rejects staking discount above MAX_DISCOUNT_BPS", async function () {
    const { controller, staking, owner } = await deploy();
    await expectRevert(
      controller.write.setStakeDiscount(
        [staking.address, THRESHOLD, MAX_DISCOUNT_BPS + 1n],
        { account: owner.account },
      ),
      "DiscountRateTooHigh",
    );
  });

  it("staker above threshold is eligible; below is not", async function () {
    const deployed = await deploy();
    const { controller, owner, alice, bob } = deployed;

    await controller.write.setStakeDiscount(
      [deployed.staking.address, THRESHOLD, 1500n],
      { account: owner.account },
    );

    await stakeFor(deployed, alice, THRESHOLD);            // exactly threshold
    await stakeFor(deployed, bob, THRESHOLD - ONE_TOKEN);  // just below

    expect(
      await controller.read.effectiveDiscountBps([alice.account.address]),
    ).to.equal(1500n);
    expect(
      await controller.read.effectiveDiscountBps([bob.account.address]),
    ).to.equal(0n);
  });

  it("staker pays a discounted quote", async function () {
    const deployed = await deploy();
    const { controller, owner, alice } = deployed;

    const base = await controller.read.rentPriceFor(["stakeuser", ONE_YEAR]);

    await controller.write.setStakeDiscount(
      [deployed.staking.address, THRESHOLD, 1500n],
      { account: owner.account },
    );
    await stakeFor(deployed, alice, THRESHOLD);

    const quote = await controller.read.rentPriceForPayer([
      "stakeuser", ONE_YEAR, alice.account.address,
    ]);
    expect(quote).to.equal(base - (base * 1500n) / 10000n);
  });

  it("token / SBT / stake discounts do not stack (largest wins)", async function () {
    const deployed = await deploy();
    const { controller, owner, alice, viem } = deployed;

    // Token discount 10%.
    const partnerToken = await viem.deployContract("MockERC20", [
      "Partner", "PRT", 18,
    ]);
    await partnerToken.write.mint([alice.account.address, ONE_TOKEN]);
    await controller.write.setDiscountToken(
      [partnerToken.address, ONE_TOKEN, 1000n],
      { account: owner.account },
    );

    // SBT discount 20%.
    const sbt = await viem.deployContract("DXContributionSBT", []);
    await controller.write.setSBTDiscount([sbt.address, 2000n], {
      account: owner.account,
    });
    await sbt.write.award([alice.account.address, "code", "Core"], {
      account: owner.account,
    });

    // Stake discount 30%.
    await controller.write.setStakeDiscount(
      [deployed.staking.address, THRESHOLD, 3000n],
      { account: owner.account },
    );
    await stakeFor(deployed, alice, THRESHOLD);

    // Alice qualifies for 10% + 20% + 30% → effective is 30% (max), NOT 60%.
    //   alice가 셋 다 충족 → 유효 할인은 최대값 30% (60% 아님).
    expect(
      await controller.read.effectiveDiscountBps([alice.account.address]),
    ).to.equal(3000n);
  });

  it("disabling the staking discount (zero address) zeroes the rate", async function () {
    const deployed = await deploy();
    const { controller, owner, alice } = deployed;

    await controller.write.setStakeDiscount(
      [deployed.staking.address, THRESHOLD, 1500n],
      { account: owner.account },
    );
    await stakeFor(deployed, alice, THRESHOLD);
    expect(
      await controller.read.effectiveDiscountBps([alice.account.address]),
    ).to.equal(1500n);

    await controller.write.setStakeDiscount([ZERO_ADDR, 0n, 0n], {
      account: owner.account,
    });
    expect(
      await controller.read.effectiveDiscountBps([alice.account.address]),
    ).to.equal(0n);
  });
});
