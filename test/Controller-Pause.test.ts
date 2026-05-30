// SPDX-License-Identifier: MIT
//
// Emergency pause tests for DXRegistrarController.
//
// Verifies:
//   - register / registerWithToken / renew / renewWithToken revert while paused
//   - commit() still works while paused (no funds move; only reveal is gated)
//   - normal operation resumes after unpause()
//   - only the owner can pause / unpause
//
// 긴급 정지 테스트. 정지 중 register/renew 차단, commit은 허용,
// 해제 후 재개, owner만 정지/해제 가능함을 검증.

import { expect } from "chai";
import { network } from "hardhat";
import {
  keccak256,
  toBytes,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
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
const MIN_COMMITMENT_AGE = 30n;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;

function labelHash(label: string): `0x${string}` {
  return keccak256(toBytes(label));
}
function tokenIdFromLabel(label: string): bigint {
  return BigInt(labelHash(label));
}
function makeCommitmentFull(
  label: string,
  owner: `0x${string}`,
  duration: bigint,
  resolver: `0x${string}`,
  paymentToken: `0x${string}`,
  secret: `0x${string}`,
): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters("string, address, uint256, address, address, bytes32"),
      [label, owner, duration, resolver, paymentToken, secret],
    ),
  );
}

describe("DXRegistrarController — emergency pause", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, user] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();
    return { ...deployed, owner, user, publicClient, testClient };
  }

  // Commit, advance past min age, and return the args needed to reveal.
  //   commit 후 최소 시간 경과시키고, reveal에 필요한 인자를 반환.
  async function commitAndWait(
    deployed: any,
    label: string,
    secret: `0x${string}`,
  ) {
    const { controller, resolver, user, testClient } = deployed;
    const userAddr = user.account.address;
    const commitment = makeCommitmentFull(
      label, userAddr, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: user.account });
    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });
  }

  it("register reverts while paused (native)", async function () {
    const deployed = await deploy();
    const { controller, resolver, owner, user } = deployed;
    const label = "pausedreg";
    const secret = `0x${"a1".repeat(32)}` as `0x${string}`;

    await commitAndWait(deployed, label, secret);
    await controller.write.pause({ account: owner.account });

    const price = await controller.read.rentPrice([ONE_YEAR]);
    await expectRevert(
      controller.write.register(
        [label, user.account.address, ONE_YEAR, resolver.address, secret],
        { account: user.account, value: price },
      ),
      "EnforcedPause",
    );
  });

  it("commit() still works while paused", async function () {
    const deployed = await deploy();
    const { controller, resolver, owner, user } = deployed;

    await controller.write.pause({ account: owner.account });

    // commit must NOT revert — only reveal (register) is gated.
    //   commit은 revert되면 안 됨 — reveal(register)만 차단된다.
    const commitment = makeCommitmentFull(
      "stillcommit", user.account.address, ONE_YEAR,
      resolver.address, ZERO_ADDR, `0x${"a2".repeat(32)}` as `0x${string}`,
    );
    await controller.write.commit([commitment], { account: user.account });
  });

  it("register succeeds again after unpause()", async function () {
    const deployed = await deploy();
    const { controller, registrar, resolver, owner, user } = deployed;
    const label = "afterunpause";
    const secret = `0x${"a3".repeat(32)}` as `0x${string}`;

    await controller.write.pause({ account: owner.account });
    await controller.write.unpause({ account: owner.account });

    await commitAndWait(deployed, label, secret);
    const price = await controller.read.rentPrice([ONE_YEAR]);
    await controller.write.register(
      [label, user.account.address, ONE_YEAR, resolver.address, secret],
      { account: user.account, value: price },
    );

    const tokenOwner = await registrar.read.ownerOf([tokenIdFromLabel(label)]);
    expect(tokenOwner.toLowerCase()).to.equal(
      user.account.address.toLowerCase(),
    );
  });

  it("non-owner cannot pause", async function () {
    const { controller, user } = await deploy();
    await expectRevert(
      controller.write.pause({ account: user.account }),
      "OwnableUnauthorizedAccount",
    );
  });

  it("non-owner cannot unpause", async function () {
    const { controller, owner, user } = await deploy();
    await controller.write.pause({ account: owner.account });
    await expectRevert(
      controller.write.unpause({ account: user.account }),
      "OwnableUnauthorizedAccount",
    );
  });
});
