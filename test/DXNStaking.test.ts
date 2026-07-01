// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { network } from "hardhat";

async function expectRevert(promise: Promise<unknown>, keyword?: string): Promise<void> {
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

const ONE_TOKEN = 10n ** 18n;
const ACC_PRECISION = 10n ** 18n;
const MIN_TOTAL_STAKE = 3000n * ONE_TOKEN;
const REWARD = 100n * ONE_TOKEN;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;

describe("DXNStaking", function () {
  function sameAddress(left: string, right: string) {
    expect(left.toLowerCase()).to.equal(right.toLowerCase());
  }

  async function deploy() {
    const { viem } = await network.getOrCreate();
    const [owner, alice, treasury, other] = await viem.getWalletClients();

    const stakingToken = await viem.deployContract("MockERC20", ["DXN", "DXN", 18]);
    const rewardToken = await viem.deployContract("MockERC20", ["Reward", "RWD", 18]);
    const staking = await viem.deployContract("DXNStaking", [
      stakingToken.address,
      treasury.account.address,
      owner.account.address,
    ]);

    await staking.write.addRewardAsset([rewardToken.address], {
      account: owner.account,
    });
    await staking.write.setNotifier([owner.account.address, true], {
      account: owner.account,
    });
    return { owner, alice, treasury, other, stakingToken, rewardToken, staking };
  }

  async function stakeFor(deployed: Awaited<ReturnType<typeof deploy>>, amount: bigint) {
    const { alice, stakingToken, staking } = deployed;
    await stakingToken.write.mint([alice.account.address, amount]);
    await stakingToken.write.approve([staking.address, amount], {
      account: alice.account,
    });
    await staking.write.stake([amount], { account: alice.account });
  }

  it("sets the constructor treasury and minimum total stake to 3,000 DXN", async function () {
    const { treasury, staking } = await deploy();

    sameAddress(await staking.read.treasury(), treasury.account.address);
    expect(await staking.read.minTotalStakeForRewards()).to.equal(MIN_TOTAL_STAKE);
  });

  it("only owner can update treasury and minimum total stake", async function () {
    const { owner, staking, treasury, other } = await deploy();

    await expectRevert(
      staking.write.setTreasury([other.account.address], {
        account: other.account,
      }),
      "OwnableUnauthorizedAccount",
    );
    await expectRevert(
      staking.write.setMinTotalStakeForRewards([1n], {
        account: other.account,
      }),
      "OwnableUnauthorizedAccount",
    );
    await expectRevert(
      staking.write.setTreasury([ZERO_ADDR], {
        account: owner.account,
      }),
      "ZeroAddress",
    );

    await staking.write.setTreasury([treasury.account.address], {
      account: owner.account,
    });
    await staking.write.setMinTotalStakeForRewards([1n], {
      account: owner.account,
    });

    sameAddress(await staking.read.treasury(), treasury.account.address);
    expect(await staking.read.minTotalStakeForRewards()).to.equal(1n);
  });

  it("redirects rewards to treasury when total stake is below the threshold", async function () {
    const deployed = await deploy();
    const { owner, treasury, staking, rewardToken } = deployed;

    await staking.write.setTreasury([treasury.account.address], {
      account: owner.account,
    });
    await stakeFor(deployed, MIN_TOTAL_STAKE - ONE_TOKEN);
    await rewardToken.write.mint([staking.address, REWARD]);

    await staking.write.notifyReward([rewardToken.address, REWARD], {
      account: owner.account,
    });

    expect(await rewardToken.read.balanceOf([treasury.account.address])).to.equal(REWARD);
    expect(
      await staking.read.pendingReward([deployed.alice.account.address, rewardToken.address]),
    ).to.equal(0n);
    expect(await staking.read.pendingNotify([rewardToken.address])).to.equal(0n);
  });

  it("distributes rewards normally when total stake meets the threshold", async function () {
    const deployed = await deploy();
    const { alice, owner, staking, rewardToken } = deployed;

    await stakeFor(deployed, MIN_TOTAL_STAKE);
    await rewardToken.write.mint([staking.address, REWARD]);

    await staking.write.notifyReward([rewardToken.address, REWARD], {
      account: owner.account,
    });

    const expectedDistributed =
      (MIN_TOTAL_STAKE * ((REWARD * ACC_PRECISION) / MIN_TOTAL_STAKE)) / ACC_PRECISION;

    expect(await staking.read.pendingReward([alice.account.address, rewardToken.address])).to.equal(
      expectedDistributed,
    );

    await staking.write.claim([rewardToken.address], { account: alice.account });
    expect(await rewardToken.read.balanceOf([alice.account.address])).to.equal(expectedDistributed);
  });
});
