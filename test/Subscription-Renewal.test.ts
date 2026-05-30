// SPDX-License-Identifier: MIT
//
// Auto-renewal subscription tests for DXSubscriptionRenewer.
//
// Full flow against the real controller + registrar:
//   1. alice registers alice.dex
//   2. owner allows a mock USDC as a payment token on the controller
//   3. alice approves the module and subscribes with a price cap
//   4. too-early executeRenewal reverts
//   5. time advances into the renewal window
//   6. anyone (here: bob) calls executeRenewal → expiry extends, USDC pulled
//
// Also: price-cap guard, unsubscribe, only-subscriber cancel, isRenewable view.
//
// 실제 controller+registrar 대상 전체 흐름 + 가격상한·해지·권한·뷰 검증.

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
const RENEWAL_WINDOW = 30n * 24n * 60n * 60n; // 30 days
const ONE_TOKEN = 10n ** 18n;
const CAP = 10_000n * ONE_TOKEN; // generous per-renewal cap
const FUNDED = 1_000_000n * ONE_TOKEN;

function labelHash(label: string): `0x${string}` {
  return keccak256(toBytes(label));
}
function tokenIdFromLabel(label: string): bigint {
  return BigInt(labelHash(label));
}

describe("DXSubscriptionRenewer — auto-renewal", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();

    // Mock USDC and the subscription module.
    const usdc = await viem.deployContract("MockERC20", ["USD Coin", "USDC", 18]);
    const module = await viem.deployContract("DXSubscriptionRenewer", [
      deployed.controller.address,
      deployed.registrar.address,
      RENEWAL_WINDOW,
    ]);

    // Allow USDC as a payment token on the controller (owner-only).
    await deployed.controller.write.setAllowedPaymentToken(
      [usdc.address, true],
      { account: owner.account },
    );

    return {
      ...deployed, usdc, module,
      owner, alice, bob, publicClient, testClient, viem,
    };
  }

  async function registerName(deployed: any, registrant: any, label: string) {
    const { controller, resolver, testClient } = deployed;
    const secret = `0x${"e3".repeat(32)}` as `0x${string}`;
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

  // Register, fund alice with USDC, approve the module, and subscribe.
  //   등록 → alice에 USDC 지급 → 모듈 approve → 구독.
  async function setupSubscription(deployed: any, label: string) {
    const { module, usdc, alice } = deployed;
    await registerName(deployed, alice, label);

    await usdc.write.mint([alice.account.address, FUNDED]);
    await usdc.write.approve([module.address, FUNDED], { account: alice.account });

    await module.write.subscribe(
      [label, usdc.address, ONE_YEAR, CAP],
      { account: alice.account },
    );
  }

  it("only the subscriber can unsubscribe", async function () {
    const deployed = await deploy();
    await setupSubscription(deployed, "subauth");
    await expectRevert(
      deployed.module.write.unsubscribe(["subauth"], {
        account: deployed.bob.account,
      }),
      "NotSubscriber",
    );
  });

  it("executeRenewal reverts when called too early", async function () {
    const deployed = await deploy();
    await setupSubscription(deployed, "subearly");
    // Just registered: ~1 year to expiry, well outside the 30-day window.
    await expectRevert(
      deployed.module.write.executeRenewal(["subearly"], {
        account: deployed.bob.account,
      }),
      "TooEarlyToRenew",
    );
  });

  it("isRenewable is false early, true inside the window", async function () {
    const deployed = await deploy();
    await setupSubscription(deployed, "subwindow");

    expect(await deployed.module.read.isRenewable(["subwindow"]))
      .to.equal(false);

    // Advance to ~20 days before expiry (inside the 30-day window).
    await deployed.testClient.increaseTime({
      seconds: Number(ONE_YEAR) - 20 * 24 * 60 * 60,
    });
    await deployed.testClient.mine({ blocks: 1 });

    expect(await deployed.module.read.isRenewable(["subwindow"]))
      .to.equal(true);
  });

  it("anyone can execute renewal inside the window; expiry extends", async function () {
    const deployed = await deploy();
    const { module, registrar, usdc, alice, bob } = deployed;
    await setupSubscription(deployed, "subrenew");

    const id = tokenIdFromLabel("subrenew");
    const expiresBefore = await registrar.read.nameExpires([id]);

    // Move into the renewal window.
    await deployed.testClient.increaseTime({
      seconds: Number(ONE_YEAR) - 10 * 24 * 60 * 60,
    });
    await deployed.testClient.mine({ blocks: 1 });

    const aliceBefore = await deployed.publicClient.readContract({
      address: usdc.address, abi: usdc.abi,
      functionName: "balanceOf", args: [alice.account.address],
    });

    // bob (a third party / keeper stand-in) triggers the renewal.
    await module.write.executeRenewal(["subrenew"], { account: bob.account });

    const expiresAfter = await registrar.read.nameExpires([id]);
    expect(expiresAfter).to.equal(expiresBefore + ONE_YEAR);

    // alice paid (balance decreased).
    const aliceAfter = await deployed.publicClient.readContract({
      address: usdc.address, abi: usdc.abi,
      functionName: "balanceOf", args: [alice.account.address],
    });
    expect(aliceAfter < aliceBefore).to.equal(true);
  });

  it("reverts when the live price exceeds the owner's cap", async function () {
    const deployed = await deploy();
    const { module, usdc, alice, bob } = deployed;
    await registerName(deployed, alice, "subcap");

    await usdc.write.mint([alice.account.address, FUNDED]);
    await usdc.write.approve([module.address, FUNDED], { account: alice.account });

    // Subscribe with an absurdly low cap (1 wei) so the live price exceeds it.
    await module.write.subscribe(
      ["subcap", usdc.address, ONE_YEAR, 1n],
      { account: alice.account },
    );

    await deployed.testClient.increaseTime({
      seconds: Number(ONE_YEAR) - 10 * 24 * 60 * 60,
    });
    await deployed.testClient.mine({ blocks: 1 });

    await expectRevert(
      module.write.executeRenewal(["subcap"], { account: bob.account }),
      "PriceExceedsCap",
    );
  });

  it("unsubscribe stops future renewals", async function () {
    const deployed = await deploy();
    const { module, alice, bob } = deployed;
    await setupSubscription(deployed, "subcancel");

    await module.write.unsubscribe(["subcancel"], { account: alice.account });

    await deployed.testClient.increaseTime({
      seconds: Number(ONE_YEAR) - 10 * 24 * 60 * 60,
    });
    await deployed.testClient.mine({ blocks: 1 });

    // No active subscription → renewal reverts.
    await expectRevert(
      module.write.executeRenewal(["subcancel"], { account: bob.account }),
      "NotSubscribed",
    );
  });
});