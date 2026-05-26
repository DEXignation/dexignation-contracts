// SPDX-License-Identifier: MIT
//
// Tests for RevenueDistributor v2.
//   - Shares struct now includes `nativeStakingProxy`.
//   - distributeToken atomically calls staking.notifyReward when wired.
//   - distributeNative routes the staking share to nativeStakingProxy
//     (NOT the ERC-20 staking contract, which lacks receive()).
//
// RevenueDistributor v2 테스트.

import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "viem";

const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;
const ONE_DXN = 10n ** 18n;
const ONE_USDC = 10n ** 6n;

describe("RevenueDistributor (v2)", function () {
  async function deploy() {
    const { viem } = await network.connect();
    const [owner, treasury, buffer, alice, nativeProxy] = await viem.getWalletClients();

    // Deploy real DXNStaking so we can test the notifier integration.
    //   notifier 통합 테스트를 위해 실제 DXNStaking 배포.
    const dxn = await viem.deployContract("DXNToken", [
      "DEXignation", "DXN", 100_000_000n * ONE_DXN,
    ]);
    const usdc = await viem.deployContract("MockERC20", ["USD Coin", "USDC", 6]);
    const staking = await viem.deployContract("DXNStaking", [dxn.address]);

    const shares = {
      treasury: treasury.account.address,
      staking: staking.address,
      nativeStakingProxy: nativeProxy.account.address,
      burnAddress: BURN_ADDRESS,
      buffer: buffer.account.address,
      treasuryBps: 7000,
      stakingBps: 2000,
      burnBps: 500,
      bufferBps: 500,
    };
    const distributor = await viem.deployContract("RevenueDistributor", [shares]);

    // Wire staking to accept rewards from the distributor.
    //   distributor가 보낸 보상을 staking이 받도록 연결.
    await staking.write.addRewardAsset([usdc.address], { account: owner.account });
    await staking.write.setNotifier([distributor.address, true], { account: owner.account });
    await distributor.write.setStakingNotifier([staking.address], { account: owner.account });

    const publicClient = await viem.getPublicClient();
    return { distributor, staking, dxn, usdc, owner, treasury, buffer, alice, nativeProxy, shares, publicClient };
  }

  it("constructs with valid bps", async function () {
    const { distributor, treasury } = await deploy();
    const s = await distributor.read.shares();
    expect(s[0].toLowerCase()).to.equal(treasury.account.address.toLowerCase());
    expect(s[5]).to.equal(7000); // treasuryBps (index shifted by nativeStakingProxy)
  });

  it("rejects bps that do not sum to 10000", async function () {
    const { viem } = await network.connect();
    const [, treasury, buffer, , nativeProxy] = await viem.getWalletClients();
    const dxn = await viem.deployContract("DXNToken", ["DEXignation", "DXN", 100_000_000n * ONE_DXN]);
    const staking = await viem.deployContract("DXNStaking", [dxn.address]);
    const bad = {
      treasury: treasury.account.address,
      staking: staking.address,
      nativeStakingProxy: nativeProxy.account.address,
      burnAddress: BURN_ADDRESS,
      buffer: buffer.account.address,
      treasuryBps: 7000, stakingBps: 2000, burnBps: 500, bufferBps: 400, // sum 9900
    };
    await expect(viem.deployContract("RevenueDistributor", [bad])).to.be.rejected;
  });

  it("rejects shares with zero nativeStakingProxy when stakingBps > 0", async function () {
    const { viem } = await network.connect();
    const [, treasury, buffer] = await viem.getWalletClients();
    const dxn = await viem.deployContract("DXNToken", ["DEXignation", "DXN", 100_000_000n * ONE_DXN]);
    const staking = await viem.deployContract("DXNStaking", [dxn.address]);
    const bad = {
      treasury: treasury.account.address,
      staking: staking.address,
      nativeStakingProxy: "0x0000000000000000000000000000000000000000",
      burnAddress: BURN_ADDRESS,
      buffer: buffer.account.address,
      treasuryBps: 7000, stakingBps: 2000, burnBps: 500, bufferBps: 500,
    };
    await expect(viem.deployContract("RevenueDistributor", [bad])).to.be.rejected;
  });

  it("distributes native balance proportionally, staking share to proxy", async function () {
    const { distributor, treasury, buffer, alice, nativeProxy, publicClient } = await deploy();

    await alice.sendTransaction({ to: distributor.address, value: parseEther("1") });

    const treasuryBefore = await publicClient.getBalance({ address: treasury.account.address });
    const proxyBefore = await publicClient.getBalance({ address: nativeProxy.account.address });
    const burnBefore = await publicClient.getBalance({ address: BURN_ADDRESS });
    const bufferBefore = await publicClient.getBalance({ address: buffer.account.address });

    await distributor.write.distributeNative();

    expect(
      (await publicClient.getBalance({ address: treasury.account.address })) - treasuryBefore,
    ).to.equal(parseEther("0.7"));
    expect(
      (await publicClient.getBalance({ address: nativeProxy.account.address })) - proxyBefore,
    ).to.equal(parseEther("0.2"));
    expect(
      (await publicClient.getBalance({ address: BURN_ADDRESS })) - burnBefore,
    ).to.equal(parseEther("0.05"));
    expect(
      (await publicClient.getBalance({ address: buffer.account.address })) - bufferBefore,
    ).to.equal(parseEther("0.05"));
  });

  it("distributeToken transfers + atomically notifies staking", async function () {
    const { distributor, staking, dxn, usdc, owner, treasury, buffer } = await deploy();

    // Stake some DXN so the reward has somewhere to go.
    //   stake가 있어야 보상이 누적됨.
    const [, , , , , alice] = await (await network.connect()).viem.getWalletClients();
    await dxn.write.mint([alice.account.address, 1000n * ONE_DXN], { account: owner.account });
    await dxn.write.approve([staking.address, 1000n * ONE_DXN], { account: alice.account });
    await staking.write.stake([1000n * ONE_DXN], { account: alice.account });

    // Send 1,000,000 USDC to the distributor.
    const amount = 1_000_000n * ONE_USDC;
    await usdc.write.mint([distributor.address, amount], { account: owner.account });

    await distributor.write.distributeToken([usdc.address]);

    // Treasury, burn, buffer get their cuts.
    expect(await usdc.read.balanceOf([treasury.account.address])).to.equal((amount * 7000n) / 10000n);
    expect(await usdc.read.balanceOf([BURN_ADDRESS])).to.equal((amount * 500n) / 10000n);
    expect(await usdc.read.balanceOf([buffer.account.address])).to.equal((amount * 500n) / 10000n);

    // Staking received its share AND has the reward attributed (acc>0).
    //   staking이 몫을 받았고 acc도 갱신됨.
    expect(await usdc.read.balanceOf([staking.address])).to.equal((amount * 2000n) / 10000n);
    expect(await staking.read.accRewardPerShare([usdc.address])).to.be.greaterThan(0n);

    // Alice's pending reward equals the staking share (single staker).
    //   유일한 staker라 staking 몫 전체가 alice 보상.
    const pending = await staking.read.pendingReward([alice.account.address, usdc.address]);
    expect(pending).to.equal((amount * 2000n) / 10000n);
  });

  it("distributeToken reverts if token is not a registered staking asset", async function () {
    const { distributor, staking, owner } = await deploy();

    const { viem } = await network.connect();
    const unknown = await viem.deployContract("MockERC20", ["Unknown", "UNK", 18]);

    // Send some unknown token to the distributor.
    await unknown.write.mint([distributor.address, 1000n * 10n ** 18n], { account: owner.account });

    // Distributing it should revert because staking has not registered it.
    //   staking이 등록하지 않은 자산이므로 분배 시 revert.
    await expect(distributor.write.distributeToken([unknown.address])).to.be.rejected;
  });

  it("disabling stakingNotifier still transfers but does not auto-notify", async function () {
    const { distributor, staking, usdc, owner } = await deploy();

    // Disable auto-notify.
    await distributor.write.setStakingNotifier(["0x0000000000000000000000000000000000000000"], { account: owner.account });

    // Send tokens; distribution must still succeed (no notifier call).
    const amount = 100_000n * ONE_USDC;
    await usdc.write.mint([distributor.address, amount], { account: owner.account });
    await distributor.write.distributeToken([usdc.address]);

    // Staking received its share but accRewardPerShare is still 0 (no notify).
    //   staking이 몫은 받았지만 notify 안 되어 acc는 0.
    expect(await usdc.read.balanceOf([staking.address])).to.equal((amount * 2000n) / 10000n);
    expect(await staking.read.accRewardPerShare([usdc.address])).to.equal(0n);
  });

  it("distributing zero balance is a no-op", async function () {
    const { distributor } = await deploy();
    await distributor.write.distributeNative();
  });
});
