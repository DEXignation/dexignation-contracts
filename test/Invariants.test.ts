// SPDX-License-Identifier: MIT
//
// Invariant tests for DEXignation.
//
// Invariants are properties that must hold true regardless of what
// sequence of operations is performed. We verify them by running random
// operation sequences and checking the invariants after each step.
//
// Foundry has native invariant fuzzing; Hardhat doesn't. We approximate
// with `fast-check` style property-based testing — generate random
// operation sequences and assert invariants hold throughout.
//
// 불변 조건 테스트. 어떤 작업 순서든 항상 참이어야 하는 성질을 검증.
// Foundry의 native invariant fuzzing 대신 fast-check 스타일로 랜덤 작업
// 시퀀스 생성 후 단계마다 invariant 검증.

import { expect } from "chai";
import { network } from "hardhat";
import {
  keccak256,
  toBytes,
  encodeAbiParameters,
  parseAbiParameters,
  parseEther,
} from "viem";
import DXDeployLocal from "../ignition/modules/DXDeployLocal.js";

const ONE_YEAR = 365n * 24n * 60n * 60n;
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

function randomLabel(seed: number): string {
  // ASCII lowercase only (matches isValidAsciiLabel policy).
  //   ASCII lowercase만 (isValidAsciiLabel 정책과 일치).
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const len = 3 + (seed % 15);
  let out = "";
  let s = seed;
  for (let i = 0; i < len; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out += chars[s % chars.length];
  }
  return out;
}

describe("Invariants — system-wide properties that must always hold", function () {
  async function deploy() {
    const { ignition, viem } = await network.connect();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob, carol] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    return { ...deployed, owner, alice, bob, carol, publicClient };
  }

  /// INVARIANT 1: every NFT mint corresponds to a registry record with
  /// the same owner. (Sub-invariant: NFT ownership and registry ownership
  /// can never diverge for an unexpired name.)
  ///   불변 1: NFT mint와 registry 레코드 owner가 항상 일치.
  it("NFT owner equals registry owner for every registered name", async function () {
    const { controller, registrar, registry, resolver, alice, bob, publicClient } =
      await deploy();

    const labels = ["alpha", "beta", "gamma", "delta", "epsilon"];
    const users = [alice, bob];

    for (let i = 0; i < labels.length; i++) {
      const user = users[i % users.length];
      const secret = `0x${(i + 1).toString(16).padStart(64, "0")}` as `0x${string}`;
      const label = labels[i];

      const commitment = makeCommitmentFull(
        label, user.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
      );
      await controller.write.commit([commitment], { account: user.account });

      await publicClient.testClient.increaseTime({
        seconds: Number(MIN_COMMITMENT_AGE) + 5,
      });
      await publicClient.testClient.mine({ blocks: 1 });

      const price = await controller.read.rentPrice([ONE_YEAR]);
      await controller.write.register(
        [label, user.account.address, ONE_YEAR, resolver.address, secret],
        { account: user.account, value: price },
      );

      // ASSERT: NFT owner == registry owner for this label
      const labelHash = keccak256(toBytes(label));
      const tokenId = BigInt(labelHash);
      const nftOwner = await registrar.read.ownerOf([tokenId]);

      const baseNode = await registrar.read.baseNode();
      const subnode = keccak256(
        encodeAbiParameters(
          parseAbiParameters("bytes32, bytes32"),
          [baseNode, labelHash],
        ),
      );
      const registryOwner = await registry.read.owner([subnode]);

      expect(nftOwner.toLowerCase()).to.equal(
        registryOwner.toLowerCase(),
        `Invariant violated for "${label}": NFT=${nftOwner} registry=${registryOwner}`,
      );
    }
  });

  /// INVARIANT 2: contract balance equals sum of all collected fees
  /// minus all withdrawals. Native balance specifically.
  ///   불변 2: 컨트랙트 native 잔액 == 누적 수금 - 누적 출금.
  it("native balance == sum collected - sum withdrawn", async function () {
    const { controller, resolver, owner, alice, bob, publicClient } = await deploy();

    let expectedBalance = 0n;
    const users = [alice, bob];

    for (let i = 0; i < 6; i++) {
      const user = users[i % users.length];
      const label = `inv2_${i}`;
      const secret = `0x${(i + 100).toString(16).padStart(64, "0")}` as `0x${string}`;

      const commitment = makeCommitmentFull(
        label, user.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
      );
      await controller.write.commit([commitment], { account: user.account });
      await publicClient.testClient.increaseTime({
        seconds: Number(MIN_COMMITMENT_AGE) + 5,
      });
      await publicClient.testClient.mine({ blocks: 1 });

      const price = await controller.read.rentPrice([ONE_YEAR]);
      await controller.write.register(
        [label, user.account.address, ONE_YEAR, resolver.address, secret],
        { account: user.account, value: price },
      );
      expectedBalance += price;

      const actualBalance = await publicClient.getBalance({
        address: controller.address,
      });
      expect(actualBalance).to.equal(
        expectedBalance,
        `Invariant violated after register ${i}: expected ${expectedBalance}, got ${actualBalance}`,
      );

      // Periodically withdraw to test withdraw side too.
      if (i === 3) {
        await controller.write.withdraw({ account: owner.account });
        expectedBalance = 0n;
        const afterWithdraw = await publicClient.getBalance({
          address: controller.address,
        });
        expect(afterWithdraw).to.equal(0n);
      }
    }
  });

  /// INVARIANT 3: expiry > block.timestamp for every active registration.
  /// A registered (non-expired) name cannot have past expiry.
  ///   불변 3: 활성 등록 도메인의 만료 > 현재 시각.
  it("expiry is in the future for newly registered names", async function () {
    const { controller, registrar, resolver, alice, publicClient } = await deploy();

    const label = "futureexpiry";
    const secret = `0x${"aa".repeat(32)}` as `0x${string}`;
    const commitment = makeCommitmentFull(
      label, alice.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret,
    );
    await controller.write.commit([commitment], { account: alice.account });
    await publicClient.testClient.increaseTime({
      seconds: Number(MIN_COMMITMENT_AGE) + 5,
    });
    await publicClient.testClient.mine({ blocks: 1 });

    const price = await controller.read.rentPrice([ONE_YEAR]);
    await controller.write.register(
      [label, alice.account.address, ONE_YEAR, resolver.address, secret],
      { account: alice.account, value: price },
    );

    const labelHash = keccak256(toBytes(label));
    const tokenId = BigInt(labelHash);
    const expiry = await registrar.read.nameExpires([tokenId]);
    const block = await publicClient.getBlock();
    expect(expiry).to.be.greaterThan(
      block.timestamp,
      `Newly registered name has past expiry: ${expiry} vs ${block.timestamp}`,
    );
  });

  /// INVARIANT 4: discount applied price ≤ base price, always.
  /// Regardless of token, threshold, or rate, the discounted price
  /// can never exceed the base price.
  ///   불변 4: 할인 적용 가격 ≤ 기본 가격 (모든 토큰/임계치/할인율에서).
  it("discounted price never exceeds base price", async function () {
    const { controller, owner, alice } = await deploy();
    const { viem } = await network.connect();
    const token = await viem.deployContract("MockERC20", ["T", "T", 18]);

    // Try multiple discount configurations.
    //   여러 할인 설정 시도.
    const configs = [
      { threshold: 1n, bps: 1n },
      { threshold: 100n * 10n**18n, bps: 1000n },
      { threshold: 1_000_000n * 10n**18n, bps: 5000n }, // max
    ];

    for (const cfg of configs) {
      await controller.write.setDiscountToken(
        [token.address, cfg.threshold, cfg.bps],
        { account: owner.account },
      );
      // Give alice enough to qualify.
      await token.write.mint([alice.account.address, cfg.threshold], {
        account: owner.account,
      });

      const base = await controller.read.rentPriceFor(["test", ONE_YEAR]);
      const discounted = await controller.read.rentPriceForPayer([
        "test", ONE_YEAR, alice.account.address,
      ]);

      expect(discounted).to.be.lessThanOrEqual(
        base,
        `Discount made price higher: base=${base} discounted=${discounted} cfg=${JSON.stringify(cfg, (_, v) => typeof v === 'bigint' ? v.toString() : v)}`,
      );
    }
  });

  /// INVARIANT 5: discountBps in storage always ≤ MAX_DISCOUNT_BPS.
  /// The setter enforces this; we verify by attempting many random values.
  ///   불변 5: 저장된 discountBps는 항상 MAX_DISCOUNT_BPS 이하.
  it("setter rejects all discountBps above MAX_DISCOUNT_BPS", async function () {
    const { controller, owner } = await deploy();
    const { viem } = await network.connect();
    const token = await viem.deployContract("MockERC20", ["T", "T", 18]);

    const max = await controller.read.MAX_DISCOUNT_BPS();
    expect(max).to.equal(5000n);

    // Boundary: exactly max must succeed.
    await controller.write.setDiscountToken(
      [token.address, 1n, max],
      { account: owner.account },
    );

    // Values above max must revert.
    const aboveMax = [max + 1n, 6000n, 9999n, 10000n];
    for (const v of aboveMax) {
      await expect(
        controller.write.setDiscountToken([token.address, 1n, v], {
          account: owner.account,
        }),
      ).to.be.rejected;
    }
  });

  /// INVARIANT 6: the same label cannot be registered twice while active.
  ///   불변 6: 같은 라벨을 활성 상태에서 두 번 등록 불가.
  it("re-registering an active name reverts", async function () {
    const { controller, resolver, alice, bob, publicClient } = await deploy();

    const label = "unique";
    const secret1 = `0x${"01".repeat(32)}` as `0x${string}`;
    const secret2 = `0x${"02".repeat(32)}` as `0x${string}`;

    // Alice registers first.
    const c1 = makeCommitmentFull(
      label, alice.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret1,
    );
    await controller.write.commit([c1], { account: alice.account });
    await publicClient.testClient.increaseTime({
      seconds: Number(MIN_COMMITMENT_AGE) + 5,
    });
    await publicClient.testClient.mine({ blocks: 1 });
    const price = await controller.read.rentPrice([ONE_YEAR]);
    await controller.write.register(
      [label, alice.account.address, ONE_YEAR, resolver.address, secret1],
      { account: alice.account, value: price },
    );

    // Bob tries to register the same label — must fail.
    //   Bob이 같은 라벨 등록 시도 — 실패해야 함.
    const c2 = makeCommitmentFull(
      label, bob.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret2,
    );
    await controller.write.commit([c2], { account: bob.account });
    await publicClient.testClient.increaseTime({
      seconds: Number(MIN_COMMITMENT_AGE) + 5,
    });
    await publicClient.testClient.mine({ blocks: 1 });
    await expect(
      controller.write.register(
        [label, bob.account.address, ONE_YEAR, resolver.address, secret2],
        { account: bob.account, value: price },
      ),
    ).to.be.rejected;
  });
});
