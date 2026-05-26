// SPDX-License-Identifier: MIT
//
// Tests for RevenueDistributor — bps-validated splitter for native + ERC-20.
// RevenueDistributor 테스트. bps 검증 및 native/ERC-20 분배 동작.

import { expect } from "chai";
import { network } from "hardhat";
import { parseEther } from "viem";

const BURN_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;

describe("RevenueDistributor", function () {
  async function deploy() {
    const { viem } = await network.connect();
    const [owner, treasury, staking, buffer, alice] =
      await viem.getWalletClients();

    // Default split: 70% treasury / 20% staking / 5% burn / 5% buffer
    const shares = {
      treasury: treasury.account.address,
      staking: staking.account.address,
      burnAddress: BURN_ADDRESS,
      buffer: buffer.account.address,
      treasuryBps: 7000,
      stakingBps: 2000,
      burnBps: 500,
      bufferBps: 500,
    };

    const distributor = await viem.deployContract("RevenueDistributor", [shares]);
    const publicClient = await viem.getPublicClient();
    return {
      distributor,
      owner,
      treasury,
      staking,
      buffer,
      alice,
      shares,
      publicClient,
    };
  }

  it("constructs with valid bps", async function () {
    const { distributor, treasury } = await deploy();
    const s = await distributor.read.shares();
    // viem returns tuple-shaped struct
    expect(s[0].toLowerCase()).to.equal(treasury.account.address.toLowerCase());
    expect(s[4]).to.equal(7000); // treasuryBps
  });

  it("rejects bps that do not sum to 10000", async function () {
    const { viem } = await network.connect();
    const [, treasury, staking, buffer] = await viem.getWalletClients();
    const bad = {
      treasury: treasury.account.address,
      staking: staking.account.address,
      burnAddress: BURN_ADDRESS,
      buffer: buffer.account.address,
      treasuryBps: 7000,
      stakingBps: 2000,
      burnBps: 500,
      bufferBps: 400, // total = 9900, not 10000
    };
    await expect(viem.deployContract("RevenueDistributor", [bad])).to.be.rejected;
  });

  it("distributes native balance proportionally", async function () {
    const { distributor, treasury, staking, buffer, alice, publicClient } =
      await deploy();

    // Alice sends 1 ETH to the distributor.
    await alice.sendTransaction({
      to: distributor.address,
      value: parseEther("1"),
    });

    const treasuryBefore = await publicClient.getBalance({
      address: treasury.account.address,
    });
    const stakingBefore = await publicClient.getBalance({
      address: staking.account.address,
    });
    const burnBefore = await publicClient.getBalance({ address: BURN_ADDRESS });
    const bufferBefore = await publicClient.getBalance({
      address: buffer.account.address,
    });

    await distributor.write.distributeNative();

    const treasuryAfter = await publicClient.getBalance({
      address: treasury.account.address,
    });
    const stakingAfter = await publicClient.getBalance({
      address: staking.account.address,
    });
    const burnAfter = await publicClient.getBalance({ address: BURN_ADDRESS });
    const bufferAfter = await publicClient.getBalance({
      address: buffer.account.address,
    });

    expect(treasuryAfter - treasuryBefore).to.equal(parseEther("0.7"));
    expect(stakingAfter - stakingBefore).to.equal(parseEther("0.2"));
    expect(burnAfter - burnBefore).to.equal(parseEther("0.05"));
    expect(bufferAfter - bufferBefore).to.equal(parseEther("0.05"));
  });

  it("distributing zero balance is a no-op", async function () {
    const { distributor } = await deploy();
    // Should not revert.
    await distributor.write.distributeNative();
  });

  it("distributes ERC-20 balance proportionally", async function () {
    const { viem } = await network.connect();
    const [owner, treasury, staking, buffer] = await viem.getWalletClients();

    const shares = {
      treasury: treasury.account.address,
      staking: staking.account.address,
      burnAddress: BURN_ADDRESS,
      buffer: buffer.account.address,
      treasuryBps: 7000,
      stakingBps: 2000,
      burnBps: 500,
      bufferBps: 500,
    };

    const distributor = await viem.deployContract("RevenueDistributor", [shares]);
    const usdc = await viem.deployContract("MockERC20", [
      "USD Coin",
      "USDC",
      6,
    ]);

    // Mint 1,000,000.000000 USDC (6 decimals) to distributor.
    const amount = 1_000_000n * 10n ** 6n;
    await usdc.write.mint([distributor.address, amount], {
      account: owner.account,
    });

    await distributor.write.distributeToken([usdc.address]);

    expect(await usdc.read.balanceOf([treasury.account.address])).to.equal(
      (amount * 7000n) / 10000n,
    );
    expect(await usdc.read.balanceOf([staking.account.address])).to.equal(
      (amount * 2000n) / 10000n,
    );
    expect(await usdc.read.balanceOf([BURN_ADDRESS])).to.equal(
      (amount * 500n) / 10000n,
    );
    expect(await usdc.read.balanceOf([buffer.account.address])).to.equal(
      (amount * 500n) / 10000n,
    );
    // Distributor should be empty.
    expect(await usdc.read.balanceOf([distributor.address])).to.equal(0n);
  });

  it("owner can update shares", async function () {
    const { distributor, owner, treasury, staking, buffer } = await deploy();
    const newShares = {
      treasury: treasury.account.address,
      staking: staking.account.address,
      burnAddress: BURN_ADDRESS,
      buffer: buffer.account.address,
      treasuryBps: 5000,
      stakingBps: 4000,
      burnBps: 500,
      bufferBps: 500,
    };
    await distributor.write.setShares([newShares], { account: owner.account });
    const s = await distributor.read.shares();
    expect(s[4]).to.equal(5000);
  });

  it("non-owner cannot update shares", async function () {
    const { distributor, alice, treasury, staking, buffer } = await deploy();
    await expect(
      distributor.write.setShares(
        [
          {
            treasury: treasury.account.address,
            staking: staking.account.address,
            burnAddress: BURN_ADDRESS,
            buffer: buffer.account.address,
            treasuryBps: 5000,
            stakingBps: 4000,
            burnBps: 500,
            bufferBps: 500,
          },
        ],
        { account: alice.account },
      ),
    ).to.be.rejected;
  });
});
