// SPDX-License-Identifier: MIT
//
// Tests for DXReservations — owner-only label blocking with optional
// authorised releasers.
//
// DXReservations 테스트. 오너 전용 라벨 차단 + 권한 위임된 releaser 동작.

import { expect } from "chai";
import { network } from "hardhat";
import { keccak256, toBytes } from "viem";

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

describe("DXReservations", function () {
  async function deploy() {
    const { viem } = await network.getOrCreate();
    const [owner, releaser, alice] = await viem.getWalletClients();
    const reservations = await viem.deployContract("DXReservations", [owner.account.address]);
    return { reservations, owner, releaser, alice };
  }

  it("starts with no reservations", async function () {
    const { reservations } = await deploy();
    expect(await reservations.read.isReserved(["samsung"])).to.equal(false);
  });

  it("owner can reserve a single label", async function () {
    const { reservations, owner } = await deploy();
    // ReservationReason.Trademark = 1
    await reservations.write.reserveLabel(
      ["samsung", 1, "0x0000000000000000000000000000000000000000"],
      {
        account: owner.account,
      },
    );
    expect(await reservations.read.isReserved(["samsung"])).to.equal(true);
    expect(await reservations.read.isReserved(["alice"])).to.equal(false);
  });

  it("non-owner cannot reserve", async function () {
    const { reservations, alice } = await deploy();
    await expectRevert(
      reservations.write.reserveLabel(
        ["samsung", 1, "0x0000000000000000000000000000000000000000"],
        { account: alice.account },
      ),
    );
  });

  it("bulk reservation works", async function () {
    const { reservations, owner } = await deploy();
    await reservations.write.reserveLabels([["apple", "google", "amazon"], 1], {
      account: owner.account,
    });
    expect(await reservations.read.isReserved(["apple"])).to.equal(true);
    expect(await reservations.read.isReserved(["google"])).to.equal(true);
    expect(await reservations.read.isReserved(["amazon"])).to.equal(true);
    expect(await reservations.read.isReserved(["facebook"])).to.equal(false);
  });

  it("bulk reservation skips duplicate labels and continues", async function () {
    const { reservations, owner } = await deploy();
    await reservations.write.reserveLabels([["apple", "google", "apple", "amazon"], 1], {
      account: owner.account,
    });

    expect(await reservations.read.isReserved(["apple"])).to.equal(true);
    expect(await reservations.read.isReserved(["google"])).to.equal(true);
    expect(await reservations.read.isReserved(["amazon"])).to.equal(true);
  });

  it("skipping an already-reserved label preserves its original reason (continue, not overwrite)", async function () {
    const { reservations, owner } = await deploy();
    // reserve "apple" as Trademark (1)
    await reservations.write.reserveLabels([["apple"], 1], { account: owner.account });
    // bulk re-reserve including "apple" but as Premium (2). Because the loop
    // `continue`s on an already-reserved label, "apple" must keep reason=Trademark
    // and only the fresh label "kiwi" gets written.
    await reservations.write.reserveLabels([["apple", "kiwi"], 2], { account: owner.account });

    const appleHash = keccak256(toBytes("apple"));
    // reservations(bytes32) => (reserved, reason, claimableBy, createdAt)
    const entry = (await reservations.read.reservations([appleHash])) as unknown[];
    expect(entry[0]).to.equal(true);   // still reserved
    expect(entry[1]).to.equal(1);      // reason unchanged (Trademark), NOT overwritten to Premium(2)
    expect(await reservations.read.isReserved(["kiwi"])).to.equal(true); // fresh label written
  });

  it("rejects duplicate reservation", async function () {
    const { reservations, owner } = await deploy();
    await reservations.write.reserveLabel(
      ["samsung", 1, "0x0000000000000000000000000000000000000000"],
      { account: owner.account },
    );
    await expectRevert(
      reservations.write.reserveLabel(
        ["samsung", 1, "0x0000000000000000000000000000000000000000"],
        { account: owner.account },
      ),
    );
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
    await expectRevert(reservations.write.releaseLabel(["samsung"], { account: alice.account }));
  });

  it("owner can update claimableBy for an existing reservation", async function () {
    const { reservations, owner, alice } = await deploy();
    await reservations.write.reserveLabel(
      ["samsung", 1, "0x0000000000000000000000000000000000000000"],
      { account: owner.account },
    );

    await reservations.write.setClaimableBy(["samsung", alice.account.address], {
      account: owner.account,
    });

    expect(await reservations.read.isClaimableBy(["samsung", alice.account.address])).to.equal(
      true,
    );
    expect(await reservations.read.isClaimableBy(["samsung", owner.account.address])).to.equal(
      false,
    );
  });

  it("owner can clear claimableBy back to fully blocked", async function () {
    const { reservations, owner, alice } = await deploy();
    await reservations.write.reserveLabel(["samsung", 1, alice.account.address], {
      account: owner.account,
    });

    await reservations.write.setClaimableBy(
      ["samsung", "0x0000000000000000000000000000000000000000"],
      { account: owner.account },
    );

    expect(await reservations.read.isClaimableBy(["samsung", alice.account.address])).to.equal(
      false,
    );
  });

  it("non-owner cannot update claimableBy", async function () {
    const { reservations, owner, alice } = await deploy();
    await reservations.write.reserveLabel(
      ["samsung", 1, "0x0000000000000000000000000000000000000000"],
      { account: owner.account },
    );

    await expectRevert(
      reservations.write.setClaimableBy(["samsung", alice.account.address], {
        account: alice.account,
      }),
    );
  });

  it("cannot update claimableBy for an unreserved label", async function () {
    const { reservations, owner, alice } = await deploy();
    await expectRevert(
      reservations.write.setClaimableBy(["samsung", alice.account.address], {
        account: owner.account,
      }),
      "NotReserved",
    );
  });

  it("isClaimableBy returns true only for the recorded claimant", async function () {
    const { reservations, owner, alice } = await deploy();
    await reservations.write.reserveLabel(["samsung", 1, alice.account.address], {
      account: owner.account,
    });
    expect(await reservations.read.isClaimableBy(["samsung", alice.account.address])).to.equal(
      true,
    );
    expect(await reservations.read.isClaimableBy(["samsung", owner.account.address])).to.equal(
      false,
    );
  });
});
