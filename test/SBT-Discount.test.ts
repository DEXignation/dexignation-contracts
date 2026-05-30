// SPDX-License-Identifier: MIT
//
// Contribution-SBT discount tests for DXRegistrarController (A1).
//
// Verifies:
//   - holding an SBT badge yields the configured discount
//   - non-holders pay full price
//   - token discount and SBT discount do NOT stack (larger wins)
//   - only owner can configure the SBT discount
//   - rate is capped at MAX_DISCOUNT_BPS
//
// 기여-SBT 할인 테스트. 배지 보유 시 할인, 미보유 시 정가,
// 토큰·SBT 할인 비중첩(큰 쪽), owner만 설정, 상한 강제 검증.

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

describe("SBT-gated discount (A1)", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();

    // Deploy a fresh contribution SBT for the test. Constructor takes no
    // args (name/symbol are hardcoded in the contract).
    //   테스트용 기여 SBT 신규 배포. 생성자는 무인자.
    const sbt = await viem.deployContract("DXContributionSBT", []);

    return { ...deployed, sbt, owner, alice, bob, publicClient, testClient, viem };
  }

  it("non-owner cannot configure the SBT discount", async function () {
    const { controller, sbt, alice } = await deploy();
    await expectRevert(
      controller.write.setSBTDiscount([sbt.address, 1000n], {
        account: alice.account,
      }),
      "OwnableUnauthorizedAccount",
    );
  });

  it("rejects SBT discount above MAX_DISCOUNT_BPS", async function () {
    const { controller, sbt, owner } = await deploy();
    await expectRevert(
      controller.write.setSBTDiscount([sbt.address, MAX_DISCOUNT_BPS + 1n], {
        account: owner.account,
      }),
      "DiscountRateTooHigh",
    );
  });

  it("SBT holder is discount-eligible; non-holder is not", async function () {
    const { controller, sbt, owner, alice, bob } = await deploy();

    // Configure a 20% SBT discount.
    await controller.write.setSBTDiscount([sbt.address, 2000n], {
      account: owner.account,
    });

    // Award a badge to alice only.
    await sbt.write.award([alice.account.address, "code", "Core contributor"], {
      account: owner.account,
    });

    expect(
      await controller.read.isDiscountEligible([alice.account.address]),
    ).to.equal(true);
    expect(
      await controller.read.effectiveDiscountBps([alice.account.address]),
    ).to.equal(2000n);

    expect(
      await controller.read.isDiscountEligible([bob.account.address]),
    ).to.equal(false);
    expect(
      await controller.read.effectiveDiscountBps([bob.account.address]),
    ).to.equal(0n);
  });

  it("SBT holder pays a discounted quote", async function () {
    const { controller, sbt, owner, alice } = await deploy();

    const base = await controller.read.rentPriceFor(["sbtuser", ONE_YEAR]);

    await controller.write.setSBTDiscount([sbt.address, 2000n], {
      account: owner.account,
    });
    await sbt.write.award([alice.account.address, "code", "Core contributor"], {
      account: owner.account,
    });

    const quote = await controller.read.rentPriceForPayer([
      "sbtuser",
      ONE_YEAR,
      alice.account.address,
    ]);

    // 20% off → quote == base * 0.8 (allow exact integer math).
    expect(quote).to.equal(base - (base * 2000n) / 10000n);
  });

  it("token and SBT discounts do not stack (larger wins)", async function () {
    const { controller, sbt, owner, alice, viem } = await deploy();

    // Token discount: 10% for holding >= 1 token of partnerToken.
    const partnerToken = await viem.deployContract("MockERC20", [
      "Partner",
      "PRT",
      18,
    ]);
    await partnerToken.write.mint([alice.account.address, ONE_TOKEN], {
      account: owner.account,
    });
    await controller.write.setDiscountToken(
      [partnerToken.address, ONE_TOKEN, 1000n],
      { account: owner.account },
    );

    // SBT discount: 20%.
    await controller.write.setSBTDiscount([sbt.address, 2000n], {
      account: owner.account,
    });
    await sbt.write.award([alice.account.address, "code", "Core"], {
      account: owner.account,
    });

    // Alice qualifies for both 10% and 20% → effective is 20% (max), NOT 30%.
    //   alice가 둘 다 충족 → 유효 할인은 max인 20% (30% 아님).
    expect(
      await controller.read.effectiveDiscountBps([alice.account.address]),
    ).to.equal(2000n);
  });

  it("disabling the SBT discount (zero address) zeroes the rate", async function () {
    const { controller, sbt, owner, alice } = await deploy();

    await controller.write.setSBTDiscount([sbt.address, 2000n], {
      account: owner.account,
    });
    await sbt.write.award([alice.account.address, "code", "Core"], {
      account: owner.account,
    });
    expect(
      await controller.read.effectiveDiscountBps([alice.account.address]),
    ).to.equal(2000n);

    // Disable.
    await controller.write.setSBTDiscount(
      ["0x0000000000000000000000000000000000000000", 0n],
      { account: owner.account },
    );
    expect(
      await controller.read.effectiveDiscountBps([alice.account.address]),
    ).to.equal(0n);
  });
});
