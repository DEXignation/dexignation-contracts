// SPDX-License-Identifier: MIT
//
// Tests for DXNStaking — stake DXN, accrue rewards from notifyReward calls.
// DXNStaking 테스트. DXN stake → notifyReward로 보상 누적.

import { expect } from "chai";
import { network } from "hardhat";

const ONE_DXN = 10n ** 18n;
const ONE_USDC = 10n ** 6n;

describe("DXNStaking", function () {
  async function deploy() {
    const { viem } = await network.connect();
    const [owner, alice, bob, notifier] = await viem.getWalletClients();

    const dxn = await viem.deployContract("DXNToken", [
      "DEXignation",
      "DXN",
      100_000_000n * ONE_DXN,
    ]);
    const usdc = await viem.deployContract("MockERC20", [
      "USD Coin",
      "USDC",
      6,
    ]);

    const staking = await viem.deployContract("DXNStaking", [dxn.address]);

    // Mint DXN to alice and bob, USDC to notifier.
    await dxn.write.mint([alice.account.address, 1000n * ONE_DXN], {
      account: owner.account,
    });
    await dxn.write.mint([bob.account.address, 1000n * ONE_DXN], {
      account: owner.account,
    });
    await usdc.write.mint([notifier.account.address, 1000n * ONE_USDC], {
      account: owner.account,
    });

    // Authorise notifier.
    await staking.write.setNotifier([notifier.account.address, true], {
      account: owner.account,
    });

    return { staking, dxn, usdc, owner, alice, bob, notifier };
  }

  it("starts with zero totalStaked", async function () {
    const { staking } = await deploy();
    expect(await staking.read.totalStaked()).to.equal(0n);
  });

  it("stake increases totalStaked and per-user balance", async function () {
    const { staking, dxn, alice } = await deploy();
    await dxn.write.approve([staking.address, 100n * ONE_DXN], {
      account: alice.account,
    });
    await staking.write.stake([100n * ONE_DXN], { account: alice.account });
    expect(await staking.read.totalStaked()).to.equal(100n * ONE_DXN);
    expect(await staking.read.stakedOf([alice.account.address])).to.equal(
      100n * ONE_DXN,
    );
  });

  it("unstake decreases balance and refunds DXN", async function () {
    const { staking, dxn, alice } = await deploy();
    await dxn.write.approve([staking.address, 100n * ONE_DXN], {
      account: alice.account,
    });
    await staking.write.stake([100n * ONE_DXN], { account: alice.account });

    const dxnBefore = await dxn.read.balanceOf([alice.account.address]);
    await staking.write.unstake([40n * ONE_DXN], { account: alice.account });
    const dxnAfter = await dxn.read.balanceOf([alice.account.address]);

    expect(dxnAfter - dxnBefore).to.equal(40n * ONE_DXN);
    expect(await staking.read.stakedOf([alice.account.address])).to.equal(
      60n * ONE_DXN,
    );
  });

  it("cannot unstake more than staked", async function () {
    const { staking, dxn, alice } = await deploy();
    await dxn.write.approve([staking.address, 100n * ONE_DXN], {
      account: alice.account,
    });
    await staking.write.stake([100n * ONE_DXN], { account: alice.account });
    await expect(
      staking.write.unstake([200n * ONE_DXN], { account: alice.account }),
    ).to.be.rejected;
  });

  it("notifyReward by non-notifier reverts", async function () {
    const { staking, usdc, alice } = await deploy();
    await expect(
      staking.write.notifyReward([usdc.address, 10n * ONE_USDC], {
        account: alice.account,
      }),
    ).to.be.rejected;
  });

  it("single staker receives full reward", async function () {
    const { staking, dxn, usdc, alice, notifier } = await deploy();

    // Alice stakes 100 DXN.
    await dxn.write.approve([staking.address, 100n * ONE_DXN], {
      account: alice.account,
    });
    await staking.write.stake([100n * ONE_DXN], { account: alice.account });

    // Notifier transfers 100 USDC to staking and calls notifyReward.
    const reward = 100n * ONE_USDC;
    await usdc.write.transfer([staking.address, reward], {
      account: notifier.account,
    });
    await staking.write.notifyReward([usdc.address, reward], {
      account: notifier.account,
    });

    // Alice's pending reward should be the full 100 USDC (modulo precision).
    const pending = await staking.read.pendingReward([
      alice.account.address,
      usdc.address,
    ]);
    expect(pending).to.equal(reward);

    // Claim returns the same amount.
    const aliceUsdcBefore = await usdc.read.balanceOf([alice.account.address]);
    await staking.write.claim([usdc.address], { account: alice.account });
    const aliceUsdcAfter = await usdc.read.balanceOf([alice.account.address]);
    expect(aliceUsdcAfter - aliceUsdcBefore).to.equal(reward);
  });

  it("two stakers split reward by stake weight", async function () {
    const { staking, dxn, usdc, alice, bob, notifier } = await deploy();

    // Alice stakes 100, Bob stakes 300. Total = 400.
    await dxn.write.approve([staking.address, 100n * ONE_DXN], {
      account: alice.account,
    });
    await staking.write.stake([100n * ONE_DXN], { account: alice.account });
    await dxn.write.approve([staking.address, 300n * ONE_DXN], {
      account: bob.account,
    });
    await staking.write.stake([300n * ONE_DXN], { account: bob.account });

    // 400 USDC reward.
    const reward = 400n * ONE_USDC;
    await usdc.write.transfer([staking.address, reward], {
      account: notifier.account,
    });
    await staking.write.notifyReward([usdc.address, reward], {
      account: notifier.account,
    });

    // Alice should be entitled to 100/400 = 25% = 100 USDC.
    // Bob should be entitled to 300/400 = 75% = 300 USDC.
    expect(
      await staking.read.pendingReward([alice.account.address, usdc.address]),
    ).to.equal(100n * ONE_USDC);
    expect(
      await staking.read.pendingReward([bob.account.address, usdc.address]),
    ).to.equal(300n * ONE_USDC);
  });

  it("reward with zero stake is a no-op", async function () {
    const { staking, usdc, notifier } = await deploy();
    await usdc.write.transfer([staking.address, 10n * ONE_USDC], {
      account: notifier.account,
    });
    // Should not revert; reward stays in the contract.
    await staking.write.notifyReward([usdc.address, 10n * ONE_USDC], {
      account: notifier.account,
    });
    // Per-share accumulator should still be zero.
    expect(await staking.read.accRewardPerShare([usdc.address])).to.equal(0n);
  });
});
