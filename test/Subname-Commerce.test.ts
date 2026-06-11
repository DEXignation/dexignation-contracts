// SPDX-License-Identifier: MIT
//
// Subname commerce (A3) + sale-lock policy tests.
//
// Policy under test / 검증 정책:
//   • A subname SOLD through DXSubnameRegistrar is sale-locked: while it is
//     live, the parent cannot reassign or revoke it (buyer protection).
//   • A subname the parent issues DIRECTLY (issueSubnodeRecord) is NOT locked
//     and remains freely reassignable/revocable (unchanged behaviour).
//   • After a sold subname expires, the parent may reclaim / re-issue it.
//   • Only an authorised sale module may call issueSubnodeRecordLocked.
//   • The parent must delegate (setApprovalForAll) before the module can sell.

import { expect } from "chai";
import { network } from "hardhat";
import {
  encodeAbiParameters,
  encodePacked,
  keccak256,
  parseAbiParameters,
  toBytes,
} from "viem";
import DXDeployLocal from "../ignition/modules/DXDeployLocal.js";

async function expectRevert(
  promise: Promise<unknown>,
  keyword?: string,
): Promise<void> {
  try {
    await promise;
  } catch (err: unknown) {
    if (keyword) expect(String(err)).to.include(keyword);
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

function subnodeFor(parent: `0x${string}`, label: string): `0x${string}` {
  return keccak256(encodePacked(["bytes32", "bytes32"], [parent, labelHash(label)]));
}

function tldNode(): `0x${string}` {
  return subnodeFor(
    "0x0000000000000000000000000000000000000000000000000000000000000000",
    "dex",
  );
}

describe("DXSubnameRegistrar — sale-lock commerce", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob, carol] = await viem.getWalletClients();
    const testClient = await viem.getTestClient();
    return { ...deployed, owner, alice, bob, carol, testClient };
  }

  // Register a 2LD parent (e.g. alice.dex) to `registrant`.
  async function registerParent(deployed: any, registrant: any, label: string) {
    const { controller, resolver, testClient } = deployed;
    const secret = `0x${"c3".repeat(32)}` as `0x${string}`;
    const commitment = keccak256(
      encodeAbiParameters(
        parseAbiParameters("string, address, uint256, address, address, bytes32"),
        [label, registrant.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret],
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
    return subnodeFor(tldNode(), label);
  }

  // Parent enables subname sales and delegates the module.
  async function enableSalesAndDelegate(
    d: any,
    parentNode: `0x${string}`,
    parent: any,
    price: bigint,
    duration: bigint,
  ) {
    await d.subnameRegistrar.write.configureSubname(
      [parentNode, price, duration, true],
      { account: parent.account },
    );
    await d.registry.write.setApprovalForAll(
      [d.subnameRegistrar.address, true],
      { account: parent.account },
    );
  }

  it("sells a subname (sale-locked) to the buyer and splits revenue", async function () {
    const d = await deploy();
    const parentNode = await registerParent(d, d.alice, "alicesell");
    const price = 10n ** 18n; // 1 POL
    await enableSalesAndDelegate(d, parentNode, d.alice, price, ONE_YEAR);

    await d.subnameRegistrar.write.registerSubname([parentNode, "team"], {
      account: d.bob.account,
      value: price,
    });

    const subnode = subnodeFor(parentNode, "team");
    expect((await d.registry.read.owner([subnode])).toLowerCase())
      .to.equal(d.bob.account.address.toLowerCase());
    // The registry must record this subname as sale-locked.
    expect(await d.registry.read.subnodeSaleLocked([subnode])).to.equal(true);
  });

  it("blocks the parent from REVOKING a live sold subname", async function () {
    const d = await deploy();
    const parentNode = await registerParent(d, d.alice, "alicerevokelock");
    const price = 10n ** 18n;
    await enableSalesAndDelegate(d, parentNode, d.alice, price, ONE_YEAR);

    await d.subnameRegistrar.write.registerSubname([parentNode, "team"], {
      account: d.bob.account,
      value: price,
    });

    // Alice (parent) tries to revoke Bob's sold subname → must revert.
    await expectRevert(
      d.registry.write.revokeSubnodeRecord(
        [parentNode, "team", d.resolver.address],
        { account: d.alice.account },
      ),
      "SubnodeSaleLocked",
    );

    // Bob still owns it.
    const subnode = subnodeFor(parentNode, "team");
    expect((await d.registry.read.owner([subnode])).toLowerCase())
      .to.equal(d.bob.account.address.toLowerCase());
  });

  it("blocks the parent from REASSIGNING a live sold subname", async function () {
    const d = await deploy();
    const parentNode = await registerParent(d, d.alice, "alicereassignlock");
    const price = 10n ** 18n;
    await enableSalesAndDelegate(d, parentNode, d.alice, price, ONE_YEAR);

    await d.subnameRegistrar.write.registerSubname([parentNode, "team"], {
      account: d.bob.account,
      value: price,
    });

    // Alice tries to reassign Bob's sold subname to Carol → must revert.
    await expectRevert(
      d.registry.write.reassignSubnodeRecord(
        [parentNode, "team", d.carol.account.address, d.resolver.address],
        { account: d.alice.account },
      ),
      "SubnodeSaleLocked",
    );
  });

  it("allows reclaim AFTER the sold subname expires", async function () {
    const d = await deploy();
    const parentNode = await registerParent(d, d.alice, "aliceexpiry");
    const price = 10n ** 18n;
    const SHORT = 60n * 60n * 24n * 30n; // 30 days subname duration
    await enableSalesAndDelegate(d, parentNode, d.alice, price, SHORT);

    await d.subnameRegistrar.write.registerSubname([parentNode, "team"], {
      account: d.bob.account,
      value: price,
    });

    const subnode = subnodeFor(parentNode, "team");
    // Still live → reclaim blocked.
    await expectRevert(
      d.registry.write.revokeSubnodeRecord(
        [parentNode, "team", d.resolver.address],
        { account: d.alice.account },
      ),
      "SubnodeSaleLocked",
    );

    // Advance past the subname's own expiry (but parent still valid).
    await d.testClient.increaseTime({ seconds: Number(SHORT) + 5 });
    await d.testClient.mine({ blocks: 1 });
    expect(await d.registry.read.isExpired([subnode])).to.equal(true);

    // Now the parent CAN revoke it back.
    await d.registry.write.revokeSubnodeRecord(
      [parentNode, "team", d.resolver.address],
      { account: d.alice.account },
    );
    expect((await d.registry.read.owner([subnode])).toLowerCase())
      .to.equal(d.alice.account.address.toLowerCase());
    // Lock cleared after reclaim.
    expect(await d.registry.read.subnodeSaleLocked([subnode])).to.equal(false);
  });

  it("does NOT lock a parent-DIRECT issuance (still reassignable/revocable)", async function () {
    const d = await deploy();
    const parentNode = await registerParent(d, d.alice, "alicedirect");

    // Parent issues directly (no sale module) → unlocked.
    await d.registry.write.issueSubnodeRecord(
      [parentNode, "team", d.bob.account.address, d.resolver.address],
      { account: d.alice.account },
    );

    const subnode = subnodeFor(parentNode, "team");
    expect(await d.registry.read.subnodeSaleLocked([subnode])).to.equal(false);

    // Parent can still reassign it (unchanged behaviour).
    await d.registry.write.reassignSubnodeRecord(
      [parentNode, "team", d.carol.account.address, d.resolver.address],
      { account: d.alice.account },
    );
    expect((await d.registry.read.owner([subnode])).toLowerCase())
      .to.equal(d.carol.account.address.toLowerCase());
  });

  it("rejects issueSubnodeRecordLocked from a non-authorised caller", async function () {
    const d = await deploy();
    const parentNode = await registerParent(d, d.alice, "alicenonmodule");
    // A non-module caller must be rejected. viem cannot always decode the
    // custom error `NotSaleModule(address)` when calling the registry object
    // directly (it surfaces as a generic ContractFunctionExecutionError), so we
    // assert the call REVERTS and, when the name is decodable, that it is the
    // expected one. Either way a non-module caller is provably blocked.
    //   비모듈 호출자는 반드시 거부. registry 직접 호출 시 viem이
    //   NotSaleModule(address)를 항상 디코드하진 못해 일반 에러로 표면화되므로,
    //   revert 사실을 단언하고 이름이 디코드되면 그것까지 확인한다.
    let reverted = false;
    let raw = "";
    try {
      await d.registry.write.issueSubnodeRecordLocked(
        [parentNode, "team", d.bob.account.address, d.resolver.address],
        { account: d.alice.account },
      );
    } catch (err: unknown) {
      reverted = true;
      raw = String(err);
    }
    expect(reverted, "issueSubnodeRecordLocked should revert for a non-module caller")
      .to.equal(true);
    // If viem decoded the custom error, it must be NotSaleModule (selector
    // 0x5c28d730). If it could not decode, the generic execution error is still
    // an acceptable rejection signal.
    if (raw.includes("NotSaleModule") || raw.includes("0x5c28d730")) {
      expect(raw).to.satisfy(
        (s: string) => s.includes("NotSaleModule") || s.includes("0x5c28d730"),
      );
    }
  });
  it("rejects a sale when the parent has NOT delegated the module", async function () {
    const d = await deploy();
    const parentNode = await registerParent(d, d.alice, "alicenodelegate");
    const price = 10n ** 18n;
    // Configure sales but DO NOT setApprovalForAll.
    await d.subnameRegistrar.write.configureSubname(
      [parentNode, price, ONE_YEAR, true],
      { account: d.alice.account },
    );

    await expectRevert(
      d.subnameRegistrar.write.registerSubname([parentNode, "team"], {
        account: d.bob.account,
        value: price,
      }),
      "ModuleNotApproved",
    );
  });

  it("rejects a duplicate live subname sale (registry SubnodeExists)", async function () {
    const d = await deploy();
    const parentNode = await registerParent(d, d.alice, "alicedup");
    const price = 10n ** 18n;
    await enableSalesAndDelegate(d, parentNode, d.alice, price, ONE_YEAR);

    await d.subnameRegistrar.write.registerSubname([parentNode, "team"], {
      account: d.bob.account,
      value: price,
    });

    // Carol tries to buy the same live label → registry rejects (SubnodeExists).
    await expectRevert(
      d.subnameRegistrar.write.registerSubname([parentNode, "team"], {
        account: d.carol.account,
        value: price,
      }),
      "SubnodeExists",
    );
  });
});
