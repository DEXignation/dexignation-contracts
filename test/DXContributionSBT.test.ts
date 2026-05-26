// SPDX-License-Identifier: MIT
//
// Tests for DXContributionSBT — non-transferable contributor recognition NFT.
//
// Covers:
//   - Owner-only award and revoke.
//   - Token IDs are monotonic from 1.
//   - Soulbound: any transfer attempt reverts.
//   - tokenURI returns valid base64 data: URI.
//   - badgesOf reports holdings correctly.
//
// DXContributionSBT 테스트.

import { expect } from "chai";
import { network } from "hardhat";

describe("DXContributionSBT", function () {
  async function deploy() {
    const { viem } = await network.connect();
    const [owner, alice, bob, charlie] = await viem.getWalletClients();
    const sbt = await viem.deployContract("DXContributionSBT", []);
    return { sbt, owner, alice, bob, charlie };
  }

  it("has correct name and symbol", async function () {
    const { sbt } = await deploy();
    expect(await sbt.read.name()).to.equal("DEXignation Contributor");
    expect(await sbt.read.symbol()).to.equal("DEXC");
  });

  it("owner can award badges; tokenIds start at 1 and increment", async function () {
    const { sbt, owner, alice, bob } = await deploy();

    await sbt.write.award(
      [alice.account.address, "code", "Wrote initial Polygon deployment scripts"],
      { account: owner.account },
    );
    await sbt.write.award(
      [bob.account.address, "translation", "Translated docs into Korean"],
      { account: owner.account },
    );

    expect(await sbt.read.ownerOf([1n])).to.equal(
      alice.account.address,
    );
    expect(await sbt.read.ownerOf([2n])).to.equal(
      bob.account.address,
    );
    expect(await sbt.read.category([1n])).to.equal("code");
    expect(await sbt.read.category([2n])).to.equal("translation");
  });

  it("non-owner cannot award", async function () {
    const { sbt, alice, bob } = await deploy();
    await expect(
      sbt.write.award(
        [bob.account.address, "code", "trying to self-award"],
        { account: alice.account },
      ),
    ).to.be.rejected;
  });

  it("badgesOf returns holding count", async function () {
    const { sbt, owner, alice } = await deploy();
    expect(await sbt.read.badgesOf([alice.account.address])).to.equal(0n);

    await sbt.write.award([alice.account.address, "code", "first"], { account: owner.account });
    await sbt.write.award([alice.account.address, "design", "second"], { account: owner.account });
    await sbt.write.award([alice.account.address, "content", "third"], { account: owner.account });

    expect(await sbt.read.badgesOf([alice.account.address])).to.equal(3n);
  });

  // ── Soulbound enforcement ───────────────────────────────────────────────────

  it("SOULBOUND: transferFrom reverts", async function () {
    const { sbt, owner, alice, bob } = await deploy();
    await sbt.write.award([alice.account.address, "code", "first"], { account: owner.account });

    await expect(
      sbt.write.transferFrom(
        [alice.account.address, bob.account.address, 1n],
        { account: alice.account },
      ),
    ).to.be.rejected;
  });

  it("SOULBOUND: safeTransferFrom reverts", async function () {
    const { sbt, owner, alice, bob } = await deploy();
    await sbt.write.award([alice.account.address, "code", "first"], { account: owner.account });

    await expect(
      // viem's `safeTransferFrom` overload signature:
      sbt.write.safeTransferFrom(
        [alice.account.address, bob.account.address, 1n],
        { account: alice.account },
      ),
    ).to.be.rejected;
  });

  it("SOULBOUND: approval + transferFrom still reverts", async function () {
    const { sbt, owner, alice, bob, charlie } = await deploy();
    await sbt.write.award([alice.account.address, "code", "first"], { account: owner.account });

    // Alice approves Charlie.
    await sbt.write.approve([charlie.account.address, 1n], { account: alice.account });

    // Charlie tries to transfer — still must revert.
    //   Charlie가 transfer 시도 — 여전히 revert.
    await expect(
      sbt.write.transferFrom(
        [alice.account.address, bob.account.address, 1n],
        { account: charlie.account },
      ),
    ).to.be.rejected;
  });

  // ── Revocation ──────────────────────────────────────────────────────────────

  it("owner can revoke (burn) a badge", async function () {
    const { sbt, owner, alice } = await deploy();
    await sbt.write.award([alice.account.address, "code", "first"], { account: owner.account });
    expect(await sbt.read.ownerOf([1n])).to.equal(alice.account.address);

    await sbt.write.revoke([1n], { account: owner.account });

    // ownerOf on a burned token reverts in ERC-721.
    //   소각된 토큰의 ownerOf는 ERC-721에서 revert.
    await expect(sbt.read.ownerOf([1n])).to.be.rejected;
    expect(await sbt.read.badgesOf([alice.account.address])).to.equal(0n);
  });

  it("revoking a non-existent badge reverts", async function () {
    const { sbt, owner } = await deploy();
    await expect(sbt.write.revoke([999n], { account: owner.account })).to.be.rejected;
  });

  it("non-owner cannot revoke", async function () {
    const { sbt, owner, alice, bob } = await deploy();
    await sbt.write.award([alice.account.address, "code", "first"], { account: owner.account });
    await expect(sbt.write.revoke([1n], { account: bob.account })).to.be.rejected;
  });

  // ── Metadata ────────────────────────────────────────────────────────────────

  it("tokenURI returns a base64-encoded data URI", async function () {
    const { sbt, owner, alice } = await deploy();
    await sbt.write.award(
      [alice.account.address, "code", "Wrote initial deployment scripts"],
      { account: owner.account },
    );

    const uri = await sbt.read.tokenURI([1n]);
    expect(uri).to.match(/^data:application\/json;base64,/);
  });
});
