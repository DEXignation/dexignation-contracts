// SPDX-License-Identifier: MIT
//
// Tests for DXReservations — owner-only label blocking with optional
// authorised releasers.
//
// DXReservations 테스트. 오너 전용 라벨 차단 + 권한 위임된 releaser 동작.

import { expect } from "chai";
import { network } from "hardhat";

describe("DXReservations", function () {
  async function deploy() {
    const { viem } = await network.connect();
    const [owner, releaser, alice] = await viem.getWalletClients();
    const reservations = await viem.deployContract("DXReservations", []);
    return { reservations, owner, releaser, alice };
  }

  it("starts with no reservations", async function () {
    const { reservations } = await deploy();
    expect(await reservations.read.isReserved(["samsung"])).to.equal(false);
  });

  it("owner can reserve a single label", async function () {
    const { reservations, owner } = await deploy();
    // ReservationReason.Trademark = 1
    await reservations.write.reserveLabel(["samsung", 1, "0x0000000000000000000000000000000000000000"], {
      account: owner.account,
    });
    expect(await reservations.read.isReserved(["samsung"])).to.equal(true);
    expect(await reservations.read.isReserved(["alice"])).to.equal(false);
  });

  it("non-owner cannot reserve", async function () {
    const { reservations, alice } = await deploy();
    await expect(
      reservations.write.reserveLabel(
        ["samsung", 1, "0x0000000000000000000000000000000000000000"],
        { account: alice.account },
      ),
    ).to.be.rejected;
  });

  it("bulk reservation works", async function () {
    const { reservations, owner } = await deploy();
    await reservations.write.reserveLabels(
      [["apple", "google", "amazon"], 1],
      { account: owner.account },
    );
    expect(await reservations.read.isReserved(["apple"])).to.equal(true);
    expect(await reservations.read.isReserved(["google"])).to.equal(true);
    expect(await reservations.read.isReserved(["amazon"])).to.equal(true);
    expect(await reservations.read.isReserved(["facebook"])).to.equal(false);
  });

  it("rejects duplicate reservation", async function () {
    const { reservations, owner } = await deploy();
    await reservations.write.reserveLabel(
      ["samsung", 1, "0x0000000000000000000000000000000000000000"],
      { account: owner.account },
    );
    await expect(
      reservations.write.reserveLabel(
        ["samsung", 1, "0x0000000000000000000000000000000000000000"],
        { account: owner.account },
      ),
    ).to.be.rejected;
  });

  it("owner can release", async function () {
    const { reservations, owner } = await deploy();
    await reservations.write.reserveLabel(
      ["samsung", 1, "0x0000000000000000000000000000000000000000"],
      { account: owner.account },
    );
    await reservations.write.releaseLabel(["samsung"], { account: owner.account });
    expect(await reservations.read.isReserved(["samsung"])).to.equal(false);
  });

  it("authorised releaser can release", async function () {
    const { reservations, owner, releaser } = await deploy();
    await reservations.write.reserveLabel(
      ["samsung", 1, "0x0000000000000000000000000000000000000000"],
      { account: owner.account },
    );
    await reservations.write.setReleaser([releaser.account.address, true], {
      account: owner.account,
    });
    await reservations.write.releaseLabel(["samsung"], {
      account: releaser.account,
    });
    expect(await reservations.read.isReserved(["samsung"])).to.equal(false);
  });

  it("non-authorised cannot release", async function () {
    const { reservations, owner, alice } = await deploy();
    await reservations.write.reserveLabel(
      ["samsung", 1, "0x0000000000000000000000000000000000000000"],
      { account: owner.account },
    );
    await expect(
      reservations.write.releaseLabel(["samsung"], { account: alice.account }),
    ).to.be.rejected;
  });

  it("isClaimableBy returns true only for the recorded claimant", async function () {
    const { reservations, owner, alice } = await deploy();
    await reservations.write.reserveLabel(
      ["samsung", 1, alice.account.address],
      { account: owner.account },
    );
    expect(
      await reservations.read.isClaimableBy(["samsung", alice.account.address]),
    ).to.equal(true);
    expect(
      await reservations.read.isClaimableBy(["samsung", owner.account.address]),
    ).to.equal(false);
  });
});
