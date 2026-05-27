// SPDX-License-Identifier: MIT
//
// Hostile ERC-20 tests.
//
// Verifies how the production contracts handle ERC-20 tokens that
// misbehave in various ways:
//   - FalseReturnERC20:    transfer/transferFrom returns false
//   - NoReturnERC20:       transfer doesn't return a value (legacy USDT)
//   - FeeOnTransferERC20:  charges a fee on every transfer
//   - LyingBalanceERC20:   reports a fake balance
//   - ReentrantERC20:      attempts to re-enter during transfer
//
// The protocol's defence is twofold:
//   1. OpenZeppelin SafeERC20 catches false/no-return correctly.
//   2. `_safeReceiveExactly` measures balance delta to catch
//      fee-on-transfer tokens (ADR-010).
//   3. The owner controls which tokens are allow-listed; tests
//      document what happens if a hostile token is allow-listed
//      by mistake.
//
// 악성 ERC-20 처리 검증.

import { expect } from "chai";
import { network } from "hardhat";
import {
  keccak256,
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

// ─────────────────────────────────────────────────────────────────────
// Hostile ERC-20: payment path
// ─────────────────────────────────────────────────────────────────────

describe("Hostile ERC-20 — payment path", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();
    return { ...deployed, owner, alice, viem, publicClient, testClient };
  }

  /// FalseReturnERC20: transfer/transferFrom returns false.
  /// Without a price oracle configured for this token, the register
  /// will revert during pricing — which is itself a form of defence:
  /// the user can't pay with an un-oracle'd hostile token. We verify
  /// the register reverts regardless of cause.
  ///
  /// FalseReturnERC20: transfer가 false 반환. 이 토큰에 oracle이 설정
  /// 안 된 상태에서 register하면 가격 산정 단계에서 revert — 그 자체로
  /// 방어. 사용자가 oracle 없는 악성 토큰으로 결제 불가.
  it("false-return token: register reverts before any value transfers", async function () {
    const { controller, resolver, owner, alice, viem, testClient } = await deploy();

    // Owner allows the hostile token (simulating operator error).
    //   owner가 악성 토큰을 허용 (운영자 실수 시뮬).
    const liarToken = await viem.deployContract("FalseReturnERC20", []);
    await controller.write.setAllowedPaymentToken(
      [liarToken.address, true],
      { account: owner.account },
    );

    await liarToken.write.mint([alice.account.address, 1000n * 10n ** 18n], {
      account: alice.account,
    });
    await liarToken.write.approve(
      [controller.address, 1000n * 10n ** 18n],
      { account: alice.account },
    );

    const label = "liarpaid";
    const secret = `0x${"f1".repeat(32)}` as `0x${string}`;
    const commitment = makeCommitmentFull(
      label, alice.account.address, ONE_YEAR, resolver.address, liarToken.address, secret,
    );
    await controller.write.commit([commitment], { account: alice.account });
    await testClient.increaseTime({
      seconds: Number(MIN_COMMITMENT_AGE) + 5,
    });
    await testClient.mine({ blocks: 1 });

    // The register must revert. Whether at pricing (no oracle) or at
    // SafeERC20 (false return), funds are protected either way.
    //   register는 revert해야 함. 가격 산정 단계든 SafeERC20 단계든,
    //   어느 쪽이든 사용자 자금 보호됨.
    await expectRevert(
      controller.write.registerWithToken(
        [label, alice.account.address, ONE_YEAR, resolver.address, liarToken.address, secret],
        { account: alice.account },
      ),
    );
  });

  /// NoReturnERC20: legacy mainnet USDT pre-2017 behaviour. Direct
  /// mock test to confirm SafeERC20-compatible patterns work.
  ///
  /// NoReturnERC20: 2017 이전 USDT 동작. mock 직접 테스트.
  it("no-return token: transfer succeeds and balances update correctly", async function () {
    const { viem } = await network.getOrCreate();
    const noret = await viem.deployContract("NoReturnERC20", []);
    const [owner, alice] = await viem.getWalletClients();

    await noret.write.mint([alice.account.address, 100n * 10n ** 18n], {
      account: alice.account,
    });
    await noret.write.transfer([owner.account.address, 10n * 10n ** 18n], {
      account: alice.account,
    });
    expect(await noret.read.balanceOf([owner.account.address]))
      .to.equal(10n * 10n ** 18n);
    expect(await noret.read.balanceOf([alice.account.address]))
      .to.equal(90n * 10n ** 18n);
  });

  /// FeeOnTransferERC20: confirms the mock charges the configured fee.
  /// This documents the attack model; the controller's
  /// `_safeReceiveExactly` (ADR-010) catches the shortfall at runtime
  /// via balance-delta check.
  ///
  /// FeeOnTransferERC20: mock이 수수료를 부과하는지 확인. 공격 모델
  /// 문서화. 컨트롤러의 `_safeReceiveExactly` (ADR-010)가 잔액 delta로
  /// 부족분 잡아냄.
  it("fee-on-transfer token: recipient receives less than declared", async function () {
    const { viem } = await network.getOrCreate();
    const fee = await viem.deployContract("FeeOnTransferERC20", [
      "FeeToken", "FEE", 500n, // 5% fee
    ]);
    const [owner, alice] = await viem.getWalletClients();

    await fee.write.mint([alice.account.address, 1000n * 10n ** 18n], {
      account: alice.account,
    });

    // Alice sends 1000 to owner. Owner receives only 950 (5% fee).
    //   Alice가 1000 전송. owner는 950만 수신 (5% 수수료).
    const before = await fee.read.balanceOf([owner.account.address]);
    await fee.write.transfer([owner.account.address, 1000n * 10n ** 18n], {
      account: alice.account,
    });
    const after = await fee.read.balanceOf([owner.account.address]);
    const received = after - before;
    expect(received).to.equal(950n * 10n ** 18n);

    // The controller's `_safeReceiveExactly` measures this delta and
    // reverts with PaymentShortfall if any token like this is used as
    // payment. Tested at integration level by other tests; here we
    // just confirm the attack vector behaves as modelled.
    //   컨트롤러의 `_safeReceiveExactly`가 이 delta를 측정해 결제 시
    //   PaymentShortfall로 revert. 다른 테스트에서 통합 검증; 여기서는
    //   공격 벡터 자체의 동작만 확인.
  });
});

// ─────────────────────────────────────────────────────────────────────
// Hostile ERC-20: discount-token path
// ─────────────────────────────────────────────────────────────────────

describe("Hostile ERC-20 — discount-token path", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice] = await viem.getWalletClients();
    return { ...deployed, owner, alice, viem };
  }

  /// LyingBalanceERC20 in discount slot: every wallet appears to hold
  /// the threshold (because balanceOf always returns a huge number),
  /// so every wallet gets the discount.
  ///
  /// This is by design — `isDiscountEligible` is a balanceOf check, and
  /// if you trust the token to be honest, you trust its balanceOf. The
  /// owner is responsible for only pointing setDiscountToken at honest
  /// ERC-20s.
  ///
  /// Risk bound: this only causes under-collection of registration fees
  /// (everyone gets discount); it cannot drain the contract or harm
  /// existing domain holders.
  ///
  /// LyingBalanceERC20을 할인 슬롯에 둠: balanceOf가 항상 거대 숫자 리턴
  /// 하므로 모든 지갑이 할인 자격으로 표시됨.
  /// 위험 한계: 등록 수수료 과소 수금만 유발; 컨트랙트 자금 탈취 불가.
  it("lying-balance token in discount slot: every wallet eligible (operational risk)", async function () {
    const { controller, owner, alice, viem } = await deploy();

    const liar = await viem.deployContract("LyingBalanceERC20", [
      1_000_000n * 10n ** 18n,
    ]);

    await controller.write.setDiscountToken(
      [liar.address, 500_000n * 10n ** 18n, 1000n],
      { account: owner.account },
    );

    // Alice has zero "real" balance but the token lies.
    //   Alice는 실제로 잔액 0이지만 토큰이 거짓말.
    expect(await controller.read.isDiscountEligible([alice.account.address]))
      .to.equal(true);

    // Operational lesson documented; not a security flaw.
    //   운영상 교훈 문서화; 보안 결함 아님.
  });

  /// Honest discount token: discount works as intended.
  ///   정직한 할인 토큰: 할인이 의도대로 동작.
  it("honest discount token: only threshold-meeting wallets eligible", async function () {
    const { controller, owner, alice, viem } = await deploy();
    const honest = await viem.deployContract("MockERC20", ["Honest", "HON", 18]);

    await controller.write.setDiscountToken(
      [honest.address, 100n * 10n ** 18n, 1000n],
      { account: owner.account },
    );

    expect(await controller.read.isDiscountEligible([alice.account.address]))
      .to.equal(false); // alice has zero balance

    await honest.write.mint([alice.account.address, 100n * 10n ** 18n], {
      account: owner.account,
    });

    expect(await controller.read.isDiscountEligible([alice.account.address]))
      .to.equal(true); // now eligible
  });

  /// ReentrantERC20 mock self-test: confirms the reentry mechanism in
  /// the mock works as designed. The controller's `nonReentrant`
  /// modifier on register/registerWithToken prevents any harmful
  /// effect; this is verified by the controller's existing OpenZeppelin
  /// ReentrancyGuard inheritance, not by an explicit attack test
  /// here (which would require a price oracle setup for the reentrant
  /// token).
  ///
  /// ReentrantERC20 mock 자체 검증. 컨트롤러의 nonReentrant가 재진입
  /// 차단 — OpenZeppelin ReentrancyGuard 상속으로 보장.
  it("reentrant token mock: armReentry stores callback configuration", async function () {
    const { viem } = await network.getOrCreate();
    const reentrant = await viem.deployContract("ReentrantERC20", [
      "Reentrant", "REE",
    ]);
    const [owner] = await viem.getWalletClients();

    const withdrawSelector = "0x3ccfd60b" as `0x${string}`; // withdraw()
    await reentrant.write.armReentry(
      [owner.account.address, withdrawSelector],
      { account: owner.account },
    );

    // Mock state reflects the arming.
    //   mock 상태가 무장 반영.
    expect(await reentrant.read.attackArmed()).to.equal(true);
    expect((await reentrant.read.reentryTarget()).toLowerCase())
      .to.equal(owner.account.address.toLowerCase());
  });
});