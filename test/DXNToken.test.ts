// SPDX-License-Identifier: MIT
//
// Tests for DXNToken — ERC20Votes governance token with minter
// authorisation and supply cap.
//
// DXNToken 테스트. ERC20Votes 거버넌스 토큰의 minter 권한 및 supply cap.

import { expect } from "chai";
import { network } from "hardhat";

const TOTAL_CAP = 100_000_000n * 10n ** 18n; // 100M DXN

describe("DXNToken", function () {
  async function deploy() {
    const { viem } = await network.connect();
    const [owner, alice, bob] = await viem.getWalletClients();
    const token = await viem.deployContract("DXNToken", [
      "DEXignation",
      "DXN",
      TOTAL_CAP,
    ]);
    return { token, owner, alice, bob };
  }

  it("has correct name, symbol, decimals, cap", async function () {
    const { token } = await deploy();
    expect(await token.read.name()).to.equal("DEXignation");
    expect(await token.read.symbol()).to.equal("DXN");
    expect(await token.read.decimals()).to.equal(18);
    expect(await token.read.cap()).to.equal(TOTAL_CAP);
  });

  it("deployer is initial minter", async function () {
    const { token, owner } = await deploy();
    expect(await token.read.minters([owner.account.address])).to.equal(true);
  });

  it("initial minter can mint", async function () {
    const { token, owner, alice } = await deploy();
    const amount = 1_000n * 10n ** 18n;
    await token.write.mint([alice.account.address, amount], {
      account: owner.account,
    });
    expect(await token.read.balanceOf([alice.account.address])).to.equal(amount);
    expect(await token.read.totalSupply()).to.equal(amount);
  });

  it("non-minter cannot mint", async function () {
    const { token, alice, bob } = await deploy();
    await expect(
      token.write.mint([bob.account.address, 1n * 10n ** 18n], {
        account: alice.account,
      }),
    ).to.be.rejected;
  });

  it("owner can authorise a new minter", async function () {
    const { token, owner, alice, bob } = await deploy();
    await token.write.setMinter([alice.account.address, true], {
      account: owner.account,
    });
    await token.write.mint([bob.account.address, 5n * 10n ** 18n], {
      account: alice.account,
    });
    expect(await token.read.balanceOf([bob.account.address])).to.equal(
      5n * 10n ** 18n,
    );
  });

  it("revoking minter takes effect", async function () {
    const { token, owner, alice, bob } = await deploy();
    await token.write.setMinter([alice.account.address, true], {
      account: owner.account,
    });
    await token.write.setMinter([alice.account.address, false], {
      account: owner.account,
    });
    await expect(
      token.write.mint([bob.account.address, 1n * 10n ** 18n], {
        account: alice.account,
      }),
    ).to.be.rejected;
  });

  it("rejects mint that would exceed cap", async function () {
    const { token, owner, alice } = await deploy();
    await expect(
      token.write.mint([alice.account.address, TOTAL_CAP + 1n], {
        account: owner.account,
      }),
    ).to.be.rejected;
  });

  it("supports voting unit tracking after delegation", async function () {
    const { token, owner, alice } = await deploy();
    const amount = 1_000n * 10n ** 18n;
    await token.write.mint([alice.account.address, amount], {
      account: owner.account,
    });
    // ERC20Votes requires explicit delegation to activate voting power.
    // ERC20Votes는 명시적 delegate가 있어야 의결권이 활성화된다.
    await token.write.delegate([alice.account.address], {
      account: alice.account,
    });
    const votes = await token.read.getVotes([alice.account.address]);
    expect(votes).to.equal(amount);
  });
});
