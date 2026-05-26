// SPDX-License-Identifier: MIT
//
// Tests for DXNStaking v2 — stake DXN, accrue rewards from notifyReward.
// v2 changes covered:
//   - Reward assets must be registered via addRewardAsset before notify.
//   - stake/unstake auto-settle pending rewards (prevents "history-theft" bug).
//   - notifyReward measures actual balance delta (over-reporting is capped).
//
// DXNStaking v2 테스트. v2 변경점:
//   - notify 전 addRewardAsset로 보상 자산 등록 필수.
//   - stake/unstake 시 미수령 보상 자동 정산 (역사 절도 방지).
//   - notifyReward는 실측 잔액 변동 기준 (부풀린 보고는 자동 cap).

import { expect } from "chai";
import { network } from "hardhat";

const ONE_DXN = 10n ** 18n;
const ONE_USDC = 10n ** 6n;

describe("DXNStaking (v2)", function () {
  async function deploy() {
    const { viem } = await network.connect();
    const [owner, alice, bob, notifier] = await viem.getWalletClients();

    const dxn = await viem.deployContract("DXNToken", [
      "DEXignation", "DXN", 100_000_000n * ONE_DXN,
    ]);
    const usdc = await viem.deployContract("MockERC20", ["USD Coin", "USDC", 6]);

    const staking = await viem.deployContract("DXNStaking", [dxn.address]);

    // Mint DXN to alice/bob, USDC to notifier.
    await dxn.write.mint([alice.account.address, 1000n * ONE_DXN], { account: owner.account });
    await dxn.write.mint([bob.account.address, 1000n * ONE_DXN], { account: owner.account });
    await usdc.write.mint([notifier.account.address, 10_000n * ONE_USDC], { account: owner.account });

    // Register USDC as a reward asset (required in v2 before notifyReward).
    //   v2에서는 notifyReward 전에 보상 자산 등록 필수.
    await staking.write.addRewardAsset([usdc.address], { account: owner.account });
    await staking.write.setNotifier([notifier.account.address, true], { account: owner.account });

    return { staking, dxn, usdc, owner, alice, bob, notifier };
  }

  it("starts with zero totalStaked and one reward asset", async function () {
    const { staking } = await deploy();
    expect(await staking.read.totalStaked()).to.equal(0n);
    expect(await staking.read.rewardAssetsLength()).to.equal(1n);
  });

  it("addRewardAsset is owner-only and rejects duplicates", async function () {
    const { staking, usdc, alice, owner } = await deploy();
    await expect(
      staking.write.addRewardAsset([usdc.address], { account: alice.account }),
    ).to.be.rejected;
    await expect(
      staking.write.addRewardAsset([usdc.address], { account: owner.account }),
    ).to.be.rejected; // already registered
  });

  it("notifyReward of unregistered asset reverts", async function () {
    const { viem } = await network.connect();
    const [owner, , , notifier] = await viem.getWalletClients();
    const dxn = await viem.deployContract("DXNToken", ["DEXignation", "DXN", 100_000_000n * ONE_DXN]);
    const other = await viem.deployContract("MockERC20", ["Other", "OTH", 18]);
    const staking = await viem.deployContract("DXNStaking", [dxn.address]);
    await staking.write.setNotifier([notifier.account.address, true], { account: owner.account });

    // No addRewardAsset for `other` → must revert.
    await expect(
      staking.write.notifyReward([other.address, 1n], { account: notifier.account }),
    ).to.be.rejected;
  });

  it("notifyReward without notifier permission reverts", async function () {
    const { staking, usdc, alice } = await deploy();
    await expect(
      staking.write.notifyReward([usdc.address, 10n * ONE_USDC], { account: alice.account }),
    ).to.be.rejected;
  });

  it("stake then notify: single staker gets full reward", async function () {
    const { staking, dxn, usdc, alice, notifier } = await deploy();

    await dxn.write.approve([staking.address, 100n * ONE_DXN], { account: alice.account });
    await staking.write.stake([100n * ONE_DXN], { account: alice.account });

    const reward = 100n * ONE_USDC;
    await usdc.write.transfer([staking.address, reward], { account: notifier.account });
    await staking.write.notifyReward([usdc.address, reward], { account: notifier.account });

    expect(
      await staking.read.pendingReward([alice.account.address, usdc.address]),
    ).to.equal(reward);

    const before = await usdc.read.balanceOf([alice.account.address]);
    await staking.write.claim([usdc.address], { account: alice.account });
    const after = await usdc.read.balanceOf([alice.account.address]);
    expect(after - before).to.equal(reward);
  });

  it("two stakers split reward by weight", async function () {
    const { staking, dxn, usdc, alice, bob, notifier } = await deploy();

    await dxn.write.approve([staking.address, 100n * ONE_DXN], { account: alice.account });
    await staking.write.stake([100n * ONE_DXN], { account: alice.account });
    await dxn.write.approve([staking.address, 300n * ONE_DXN], { account: bob.account });
    await staking.write.stake([300n * ONE_DXN], { account: bob.account });

    const reward = 400n * ONE_USDC;
    await usdc.write.transfer([staking.address, reward], { account: notifier.account });
    await staking.write.notifyReward([usdc.address, reward], { account: notifier.account });

    expect(
      await staking.read.pendingReward([alice.account.address, usdc.address]),
    ).to.equal(100n * ONE_USDC);
    expect(
      await staking.read.pendingReward([bob.account.address, usdc.address]),
    ).to.equal(300n * ONE_USDC);
  });

  // ── v2 critical fix: history-theft prevention ──────────────────────────────
  it("CRITICAL: late staker does NOT steal historical rewards", async function () {
    const { staking, dxn, usdc, alice, bob, notifier } = await deploy();

    // Alice stakes 100 DXN early.
    await dxn.write.approve([staking.address, 100n * ONE_DXN], { account: alice.account });
    await staking.write.stake([100n * ONE_DXN], { account: alice.account });

    // 200 USDC reward distributed while only Alice is staking.
    const reward1 = 200n * ONE_USDC;
    await usdc.write.transfer([staking.address, reward1], { account: notifier.account });
    await staking.write.notifyReward([usdc.address, reward1], { account: notifier.account });

    // Alice's pending: 200 USDC (full share).
    expect(
      await staking.read.pendingReward([alice.account.address, usdc.address]),
    ).to.equal(reward1);

    // NOW Bob stakes 100 DXN.
    await dxn.write.approve([staking.address, 100n * ONE_DXN], { account: bob.account });
    await staking.write.stake([100n * ONE_DXN], { account: bob.account });

    // BUG SHOULD NOT TRIGGER: Bob's pending must be 0, NOT 100 USDC.
    //   버그가 살아있으면 Bob의 pending이 100 USDC로 잘못 표시됨.
    expect(
      await staking.read.pendingReward([bob.account.address, usdc.address]),
    ).to.equal(0n);

    // Alice's pending must still be 200 (unchanged).
    expect(
      await staking.read.pendingReward([alice.account.address, usdc.address]),
    ).to.equal(reward1);
  });

  // ── v2 critical fix: balance delta capping ─────────────────────────────────
  it("CRITICAL: notifier cannot inflate accRewardPerShare beyond actual deposit", async function () {
    const { staking, dxn, usdc, alice, notifier } = await deploy();

    await dxn.write.approve([staking.address, 100n * ONE_DXN], { account: alice.account });
    await staking.write.stake([100n * ONE_DXN], { account: alice.account });

    // Transfer only 50 USDC but claim 500 USDC in notifyReward.
    //   실제로는 50 USDC만 보내고 notifyReward에는 500을 보고.
    await usdc.write.transfer([staking.address, 50n * ONE_USDC], { account: notifier.account });
    await staking.write.notifyReward([usdc.address, 500n * ONE_USDC], { account: notifier.account });

    // Pending should reflect the ACTUAL delta (50), not the claimed 500.
    //   pending은 실제 delta (50)을 반영해야 함, 보고된 500이 아님.
    const pending = await staking.read.pendingReward([alice.account.address, usdc.address]);
    expect(pending).to.equal(50n * ONE_USDC);
  });

  it("reward arriving while totalStaked=0 is carried over to first staker", async function () {
    const { staking, dxn, usdc, alice, notifier } = await deploy();

    // No stakers yet — notify 100 USDC. Should be carried over.
    //   staker 없음 — 100 USDC notify. carry-over로 보관됨.
    await usdc.write.transfer([staking.address, 100n * ONE_USDC], { account: notifier.account });
    await staking.write.notifyReward([usdc.address, 100n * ONE_USDC], { account: notifier.account });

    // accRewardPerShare must still be 0 (no division by zero).
    expect(await staking.read.accRewardPerShare([usdc.address])).to.equal(0n);

    // Alice stakes; first NEW notify should include the carry-over.
    //   Alice stake; 다음 notify에서 carry-over 합쳐 분배.
    await dxn.write.approve([staking.address, 100n * ONE_DXN], { account: alice.account });
    await staking.write.stake([100n * ONE_DXN], { account: alice.account });

    // Trigger a fresh notify with 0 new amount — the carry-over alone is
    // not flushed, so send a tiny extra to trigger.
    //   carry-over 단독 플러시 안 되므로 작은 추가 notify로 트리거.
    await usdc.write.transfer([staking.address, 1n], { account: notifier.account });
    await staking.write.notifyReward([usdc.address, 1n], { account: notifier.account });

    // Alice should now be entitled to ~100 USDC + 1 unit (the carry-over + new).
    //   Alice에게 carry-over + 신규 = 100 USDC + 1 단위 만큼 권리.
    const pending = await staking.read.pendingReward([alice.account.address, usdc.address]);
    expect(pending).to.equal(100n * ONE_USDC + 1n);
  });
});
