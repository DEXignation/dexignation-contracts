// SPDX-License-Identifier: MIT
//
// USDT (non-standard approve) auto-renewal tests for DXSubscriptionRenewer.
//
// USDT reverts on approve(spender, X) when the current allowance is non-zero
// and X is non-zero. The module uses SafeERC20.forceApprove, which resets to
// zero first, so it must work with USDT — including across CONSECUTIVE renewals
// (where a naive approve would hit the non-zero→non-zero trap on the 2nd cycle).
//
// Verifies:
//   - a single USDT auto-renewal succeeds (expiry extends, USDT pulled)
//   - TWO consecutive USDT renewals succeed (proves forceApprove handles the
//     USDT allowance quirk, not just the first call)
//
// USDT의 비표준 approve(0이 아닌 allowance에서 0이 아닌 값으로 재설정 시 revert)
// 환경에서, 모듈의 forceApprove가 단일 갱신과 *연속* 갱신 모두에서 동작함을 검증.

import { expect } from "chai";
import { network } from "hardhat";
import {
  keccak256,
  toBytes,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import DXDeployLocal from "../ignition/modules/DXDeployLocal.js";

const ONE_YEAR = 365n * 24n * 60n * 60n;
const MIN_COMMITMENT_AGE = 30n;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;
const RENEWAL_WINDOW = 30n * 24n * 60n * 60n; // 30 days
const ONE_TOKEN = 10n ** 18n;
const CAP = 10_000n * ONE_TOKEN;
const FUNDED = 1_000_000n * ONE_TOKEN;

function labelHash(label: string): `0x${string}` {
  return keccak256(toBytes(label));
}
function tokenIdFromLabel(label: string): bigint {
  return BigInt(labelHash(label));
}

describe("DXSubscriptionRenewer — USDT (non-standard approve)", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();

    // USDT mock (non-standard approve) + the subscription module.
    const usdt = await viem.deployContract("MockUSDT", [6]); // USDT uses 6 decimals
    const module = await viem.deployContract("DXSubscriptionRenewer", [
      deployed.controller.address,
      deployed.registrar.address,
      RENEWAL_WINDOW,
      owner.account.address,
    ]);

    await deployed.controller.write.setAllowedPaymentToken(
      [usdt.address, true],
      { account: owner.account },
    );

    return {
      ...deployed, usdt, module,
      owner, alice, bob, publicClient, testClient, viem,
    };
  }

  async function registerName(deployed: any, registrant: any, label: string) {
    const { controller, resolver, testClient } = deployed;
    const secret = `0x${"f7".repeat(32)}` as `0x${string}`;
    const commitment = keccak256(
      encodeAbiParameters(
        parseAbiParameters("string, address, uint256, address, address, bytes32"),
        [
          label,
          registrant.account.address,
          ONE_YEAR,
          resolver.address,
          ZERO_ADDR,
          secret,
        ],
      ),
    );
    await controller.write.commit([commitment], { account: registrant.account });
    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });

    const price = await controller.read.rentPrice([ONE_YEAR]);
    await controller.write.register(
      [label, registrant.account.address, ONE_YEAR, resolver.address, secret],
      { account: registrant.account, value: price },
    );
  }

  async function setupSubscription(deployed: any, label: string) {
    const { module, usdt, alice } = deployed;
    await registerName(deployed, alice, label);
    await usdt.write.mint([alice.account.address, FUNDED]);
    await usdt.write.approve([module.address, FUNDED], { account: alice.account });
    await module.write.subscribe(
      [label, usdt.address, ONE_YEAR, CAP],
      { account: alice.account },
    );
  }

  it("single USDT auto-renewal succeeds (expiry extends, USDT pulled)", async function () {
    const deployed = await deploy();
    const { module, registrar, usdt, alice, bob } = deployed;
    await setupSubscription(deployed, "usdtone");

    const id = tokenIdFromLabel("usdtone");
    const expiresBefore = await registrar.read.nameExpires([id]);

    await deployed.testClient.increaseTime({
      seconds: Number(ONE_YEAR) - 10 * 24 * 60 * 60,
    });
    await deployed.testClient.mine({ blocks: 1 });

    const balBefore = await deployed.publicClient.readContract({
      address: usdt.address, abi: usdt.abi,
      functionName: "balanceOf", args: [alice.account.address],
    });

    await module.write.executeRenewal(["usdtone"], { account: bob.account });

    const expiresAfter = await registrar.read.nameExpires([id]);
    expect(expiresAfter).to.equal(expiresBefore + ONE_YEAR);

    const balAfter = await deployed.publicClient.readContract({
      address: usdt.address, abi: usdt.abi,
      functionName: "balanceOf", args: [alice.account.address],
    });
    expect(balAfter < balBefore).to.equal(true);
  });

  it("TWO consecutive USDT renewals succeed (forceApprove handles the quirk)", async function () {
    const deployed = await deploy();
    const { module, registrar, alice, bob } = deployed;
    await setupSubscription(deployed, "usdttwo");

    const id = tokenIdFromLabel("usdttwo");
    const expires0 = await registrar.read.nameExpires([id]);

    // First renewal: enter the window and renew.
    await deployed.testClient.increaseTime({
      seconds: Number(ONE_YEAR) - 10 * 24 * 60 * 60,
    });
    await deployed.testClient.mine({ blocks: 1 });
    await module.write.executeRenewal(["usdttwo"], { account: bob.account });

    const expires1 = await registrar.read.nameExpires([id]);
    expect(expires1).to.equal(expires0 + ONE_YEAR);

    // Advance again into the next window and renew a SECOND time. With a naive
    // approve this is exactly where USDT would revert (allowance left non-zero
    // from cycle 1). forceApprove resets to zero first, so it must pass.
    //   다시 다음 윈도우로 진입해 2번째 갱신. 단순 approve였다면 1주기에서 남은
    //   non-zero allowance 때문에 USDT가 revert할 지점. forceApprove는 0으로
    //   먼저 리셋하므로 통과해야 한다.
    await deployed.testClient.increaseTime({
      seconds: Number(ONE_YEAR) - 5 * 24 * 60 * 60,
    });
    await deployed.testClient.mine({ blocks: 1 });
    await module.write.executeRenewal(["usdttwo"], { account: bob.account });

    const expires2 = await registrar.read.nameExpires([id]);
    expect(expires2).to.equal(expires1 + ONE_YEAR);
  });
});