// SPDX-License-Identifier: MIT
//
// MEV scenario tests for the commit-reveal flow.
//
// Verifies that an attacker who observes the reveal transaction cannot
// front-run with the same commitment but different parameters.
//
// reveal 트랜잭션을 관찰한 공격자가 동일 commitment를 다른 파라미터로
// 재현 불가함을 검증.

import { expect } from "chai";
import { network } from "hardhat";
import {
  keccak256,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import DXDeployLocal from "../ignition/modules/DXDeployLocal.js";

const ONE_YEAR = 365n * 24n * 60n * 60n;
const THREE_YEARS = 3n * 365n * 24n * 60n * 60n;
const MIN_COMMITMENT_AGE = 30n;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;

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

describe("MEV — commit-reveal resistance to parameter swapping", function () {
  async function deploy() {
    const { ignition, viem } = await network.connect();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, attacker] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    return { ...deployed, owner, alice, attacker, publicClient, viem };
  }

  /// Scenario: Alice commits with resolver A. Attacker observes the
  /// reveal mempool and tries to front-run with resolver B (under their
  /// control) using the same (label, owner, duration, secret).
  ///
  /// Expected: attacker's register reverts with CommitmentNotFound
  /// because the commitment hash includes resolver.
  ///
  /// 시나리오: Alice가 resolver A로 commit. 공격자가 reveal mempool 관찰 후
  /// 같은 (label, owner, duration, secret)로 resolver B (자기 통제)로 register
  /// 시도. → 기대: commitment 해시에 resolver 포함되므로 CommitmentNotFound
  /// 로 revert.
  it("attacker cannot swap resolver in reveal", async function () {
    const { controller, resolver, alice, attacker, publicClient, viem } =
      await deploy();

    // Attacker controls a different resolver (for this test, just deploy
    // a second DXResolver pointed at the same registry).
    //   공격자가 다른 resolver 통제 (테스트 목적: 같은 registry의 두 번째
    //   DXResolver 배포).
    const { registry } = await deploy();
    const attackerResolver = await viem.deployContract("DXResolver", [
      registry.address,
    ]);

    const label = "victim";
    const secret = `0x${"77".repeat(32)}` as `0x${string}`;

    // Alice commits with the legitimate resolver bound.
    const legitCommitment = makeCommitmentFull(
      label, alice.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([legitCommitment], { account: alice.account });

    await publicClient.testClient.increaseTime({
      seconds: Number(MIN_COMMITMENT_AGE) + 5,
    });
    await publicClient.testClient.mine({ blocks: 1 });

    const price = await controller.read.rentPrice([ONE_YEAR]);

    // ATTACKER attempts the front-run with a different resolver.
    //   공격자가 다른 resolver로 front-run 시도.
    await expect(
      controller.write.register(
        [label, alice.account.address, ONE_YEAR, attackerResolver.address, secret],
        { account: attacker.account, value: price },
      ),
    ).to.be.rejected;

    // Alice's legitimate reveal still works.
    //   Alice의 정상 reveal은 정상 작동.
    await controller.write.register(
      [label, alice.account.address, ONE_YEAR, resolver.address, secret],
      { account: alice.account, value: price },
    );
  });

  /// Scenario: same as above but attacker tries to swap duration.
  ///   같은 시나리오에서 duration 교체 시도.
  it("attacker cannot swap duration in reveal", async function () {
    const { controller, resolver, alice, attacker, publicClient } = await deploy();

    const label = "duration-victim";
    const secret = `0x${"88".repeat(32)}` as `0x${string}`;

    // Alice commits to ONE_YEAR.
    const commitment = makeCommitmentFull(
      label, alice.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: alice.account });

    await publicClient.testClient.increaseTime({
      seconds: Number(MIN_COMMITMENT_AGE) + 5,
    });
    await publicClient.testClient.mine({ blocks: 1 });

    // Attacker tries with THREE_YEARS (would cost more, but they pay it
    // hoping to grief Alice). The commitment binding should reject.
    //   공격자가 THREE_YEARS로 시도 (비용 더 지불해서 Alice 방해). commitment
    //   binding으로 거부되어야 함.
    const tripleYearPrice = await controller.read.rentPrice([THREE_YEARS]);
    await expect(
      controller.write.register(
        [label, alice.account.address, THREE_YEARS, resolver.address, secret],
        { account: attacker.account, value: tripleYearPrice },
      ),
    ).to.be.rejected;
  });

  /// Scenario: attacker tries to swap owner so the NFT lands in their wallet.
  ///   공격자가 owner 교체로 NFT를 자기 지갑으로 빼돌리기 시도.
  it("attacker cannot swap owner in reveal", async function () {
    const { controller, resolver, alice, attacker, publicClient } = await deploy();

    const label = "owner-victim";
    const secret = `0x${"99".repeat(32)}` as `0x${string}`;

    const commitment = makeCommitmentFull(
      label, alice.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: alice.account });

    await publicClient.testClient.increaseTime({
      seconds: Number(MIN_COMMITMENT_AGE) + 5,
    });
    await publicClient.testClient.mine({ blocks: 1 });

    const price = await controller.read.rentPrice([ONE_YEAR]);

    // Attacker tries to redirect ownership to themselves.
    //   공격자가 자기 자신을 owner로 redirect 시도.
    await expect(
      controller.write.register(
        [label, attacker.account.address, ONE_YEAR, resolver.address, secret],
        { account: attacker.account, value: price },
      ),
    ).to.be.rejected;
  });

  /// Scenario: attacker tries to swap paymentToken (e.g. claim it was a
  /// stablecoin payment when it was actually native, or vice versa).
  ///   공격자가 paymentToken 교체 시도 (네이티브를 stablecoin인 척 또는 반대).
  it("attacker cannot swap paymentToken in reveal", async function () {
    const { controller, resolver, mockUsdc, alice, attacker, owner, publicClient } =
      await deploy();

    const label = "payment-victim";
    const secret = `0x${"aa".repeat(32)}` as `0x${string}`;

    // Alice commits to USDC payment.
    const commitment = makeCommitmentFull(
      label, alice.account.address, ONE_YEAR, resolver.address, mockUsdc.address, secret,
    );
    await controller.write.commit([commitment], { account: alice.account });

    await publicClient.testClient.increaseTime({
      seconds: Number(MIN_COMMITMENT_AGE) + 5,
    });
    await publicClient.testClient.mine({ blocks: 1 });

    // Attacker tries to register with native payment (different paymentToken).
    //   공격자가 네이티브 결제로 register 시도 (다른 paymentToken).
    const price = await controller.read.rentPrice([ONE_YEAR]);
    await expect(
      controller.write.register(
        [label, alice.account.address, ONE_YEAR, resolver.address, secret],
        { account: attacker.account, value: price },
      ),
    ).to.be.rejected;
  });

  /// Scenario: legacy `makeCommitment` (3-arg) is no longer accepted.
  /// A legitimate user using the old API would fail at reveal.
  ///   레거시 `makeCommitment` (3-인자)는 더 이상 허용 안 됨.
  it("legacy 3-arg commitment is rejected at reveal", async function () {
    const { controller, resolver, alice, publicClient } = await deploy();

    const label = "legacy-user";
    const secret = `0x${"bb".repeat(32)}` as `0x${string}`;

    // Create the LEGACY commitment hash (only label, owner, secret).
    //   레거시 commitment 해시 생성 (label, owner, secret만).
    const legacyCommitment = keccak256(
      encodeAbiParameters(
        parseAbiParameters("string, address, bytes32"),
        [label, alice.account.address, secret],
      ),
    );
    await controller.write.commit([legacyCommitment], { account: alice.account });

    await publicClient.testClient.increaseTime({
      seconds: Number(MIN_COMMITMENT_AGE) + 5,
    });
    await publicClient.testClient.mine({ blocks: 1 });

    // Register expects the STRICT commitment, so this will revert with
    // CommitmentNotFound (it looks up the strict hash, finds nothing).
    //   register는 STRICT commitment 요구, CommitmentNotFound로 revert.
    const price = await controller.read.rentPrice([ONE_YEAR]);
    await expect(
      controller.write.register(
        [label, alice.account.address, ONE_YEAR, resolver.address, secret],
        { account: alice.account, value: price },
      ),
    ).to.be.rejected;
  });

  /// Scenario: commitment too new (within minCommitmentAge) rejects.
  ///   commitment가 너무 새 것(minCommitmentAge 이내) 거부.
  it("reveal before minCommitmentAge rejects", async function () {
    const { controller, resolver, alice } = await deploy();

    const label = "tooearly2";
    const secret = `0x${"cc".repeat(32)}` as `0x${string}`;
    const commitment = makeCommitmentFull(
      label, alice.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: alice.account });

    // No time skip — try to register immediately.
    const price = await controller.read.rentPrice([ONE_YEAR]);
    await expect(
      controller.write.register(
        [label, alice.account.address, ONE_YEAR, resolver.address, secret],
        { account: alice.account, value: price },
      ),
    ).to.be.rejected;
  });
});

describe("MEV — race conditions on same label", function () {
  async function deploy() {
    const { ignition, viem } = await network.connect();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    return { ...deployed, owner, alice, bob, publicClient };
  }

  /// Both Alice and Bob commit to the same label with their own secrets.
  /// Whoever reveals first wins; the second reveal must fail.
  /// 두 명이 같은 라벨에 각자 secret으로 commit. 먼저 reveal한 사람이 이김;
  /// 두 번째 reveal은 실패해야 함.
  it("first reveal wins; second reveal of same label reverts", async function () {
    const { controller, resolver, alice, bob, publicClient } = await deploy();

    const label = "race";
    const aliceSecret = `0x${"dd".repeat(32)}` as `0x${string}`;
    const bobSecret = `0x${"ee".repeat(32)}` as `0x${string}`;

    // Both commit (each with their own secret/commitment).
    const aliceC = makeCommitmentFull(
      label, alice.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, aliceSecret,
    );
    const bobC = makeCommitmentFull(
      label, bob.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, bobSecret,
    );
    await controller.write.commit([aliceC], { account: alice.account });
    await controller.write.commit([bobC], { account: bob.account });

    await publicClient.testClient.increaseTime({
      seconds: Number(MIN_COMMITMENT_AGE) + 5,
    });
    await publicClient.testClient.mine({ blocks: 1 });

    const price = await controller.read.rentPrice([ONE_YEAR]);

    // Alice reveals first.
    await controller.write.register(
      [label, alice.account.address, ONE_YEAR, resolver.address, aliceSecret],
      { account: alice.account, value: price },
    );

    // Bob's reveal must fail — label is now taken.
    //   Bob의 reveal은 실패해야 함 — 라벨 이미 사용됨.
    await expect(
      controller.write.register(
        [label, bob.account.address, ONE_YEAR, resolver.address, bobSecret],
        { account: bob.account, value: price },
      ),
    ).to.be.rejected;
  });
});
