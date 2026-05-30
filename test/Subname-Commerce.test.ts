// SPDX-License-Identifier: MIT
//
// Subname commerce tests for DXSubnameRegistrar (A3).
//
// Exercises the full Pattern-1 flow against the REAL registry:
//   1. alice registers alice.dex (becomes parent owner)
//   2. alice configures a subname price + enables sales
//   3. alice delegates the module via registry.setApprovalForAll
//   4. bob buys team.alice.dex; revenue splits to feeRecipient + alice
//
// Also checks the guards: sales disabled, module not approved, wrong payment,
// non-owner config, protocol-fee cap.
//
// 실제 registry 대상 패턴1 전체 흐름 검증 + 각종 가드.

import { expect } from "chai";
import { network } from "hardhat";
import {
  keccak256,
  toBytes,
  encodePacked,
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
const PRICE = 10n ** 17n; // 0.1 native
const FEE_BPS = 500n; // 5%
const MAX_FEE_BPS = 2000n;

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

describe("DXSubnameRegistrar — subname commerce (A3)", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob, carol] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();

    // Deploy the module against the real registry + resolver.
    //   실제 registry + resolver 대상 모듈 배포.
    const module = await viem.deployContract("DXSubnameRegistrar", [
      deployed.registry.address,
      deployed.resolver.address,
      owner.account.address, // feeRecipient (use owner as a stand-in treasury)
      FEE_BPS,
    ]);

    return {
      ...deployed, module,
      owner, alice, bob, carol,
      publicClient, testClient, viem,
    };
  }

  // Register `label`.dex to `registrant`; returns the parent node hash.
  //   `label`.dex를 `registrant`에게 등록; 부모 노드 해시 반환.
  async function registerParent(deployed: any, registrant: any, label: string) {
    const { controller, resolver, testClient } = deployed;
    const secret = `0x${"b7".repeat(32)}` as `0x${string}`;
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
    return subnodeFor(tldNode(), label);
  }

  // Full happy-path setup: register parent, configure, delegate.
  //   해피패스 셋업: 부모 등록 → 설정 → 위임.
  async function setupCommerce(deployed: any, parentLabel: string) {
    const { module, registry, alice } = deployed;
    const parentNode = await registerParent(deployed, alice, parentLabel);

    await module.write.configureSubname(
      [parentNode, PRICE, ONE_YEAR, true],
      { account: alice.account },
    );
    await registry.write.setApprovalForAll([module.address, true], {
      account: alice.account,
    });
    return parentNode;
  }

  it("constructor rejects a protocol fee above MAX_FEE_BPS", async function () {
    const { viem, registry, resolver, owner } = await deploy();
    await expectRevert(
      viem.deployContract("DXSubnameRegistrar", [
        registry.address,
        resolver.address,
        owner.account.address,
        MAX_FEE_BPS + 1n,
      ]),
      "FeeTooHigh",
    );
  });

  it("only the parent owner can configure subname commerce", async function () {
    const deployed = await deploy();
    const parentNode = await registerParent(deployed, deployed.alice, "acme");
    await expectRevert(
      deployed.module.write.configureSubname(
        [parentNode, PRICE, ONE_YEAR, true],
        { account: deployed.bob.account },
      ),
      "NotParentOwner",
    );
  });

  it("reverts a purchase when sales are disabled", async function () {
    const deployed = await deploy();
    const parentNode = await registerParent(deployed, deployed.alice, "acme2");
    // Configured but not enabled.
    await deployed.module.write.configureSubname(
      [parentNode, PRICE, ONE_YEAR, false],
      { account: deployed.alice.account },
    );
    await expectRevert(
      deployed.module.write.registerSubname([parentNode, "team"], {
        account: deployed.bob.account,
        value: PRICE,
      }),
      "SalesDisabled",
    );
  });

  it("reverts a purchase when the module is not delegated", async function () {
    const deployed = await deploy();
    const parentNode = await registerParent(deployed, deployed.alice, "acme3");
    await deployed.module.write.configureSubname(
      [parentNode, PRICE, ONE_YEAR, true],
      { account: deployed.alice.account },
    );
    // No setApprovalForAll → module cannot write to the registry.
    await expectRevert(
      deployed.module.write.registerSubname([parentNode, "team"], {
        account: deployed.bob.account,
        value: PRICE,
      }),
      "ModuleNotApproved",
    );
  });

  it("reverts on incorrect payment", async function () {
    const deployed = await deploy();
    const parentNode = await setupCommerce(deployed, "acme4");
    await expectRevert(
      deployed.module.write.registerSubname([parentNode, "team"], {
        account: deployed.bob.account,
        value: PRICE - 1n,
      }),
      "IncorrectPayment",
    );
  });

  it("isPurchasable reflects the full precondition set", async function () {
    const deployed = await deploy();
    const parentNode = await registerParent(deployed, deployed.alice, "acme5");

    // Not configured yet → not purchasable.
    expect(await deployed.module.read.isPurchasable([parentNode])).to.equal(false);

    await deployed.module.write.configureSubname(
      [parentNode, PRICE, ONE_YEAR, true],
      { account: deployed.alice.account },
    );
    // Enabled but not delegated → still not purchasable.
    expect(await deployed.module.read.isPurchasable([parentNode])).to.equal(false);

    await deployed.registry.write.setApprovalForAll([deployed.module.address, true], {
      account: deployed.alice.account,
    });
    // Now all preconditions met.
    expect(await deployed.module.read.isPurchasable([parentNode])).to.equal(true);
  });

  it("buys a subname end-to-end and registers it to the buyer", async function () {
    const deployed = await deploy();
    const { module, registry, bob } = deployed;
    const parentNode = await setupCommerce(deployed, "acme6");

    // viem's `write` returns a tx hash, not the function's return value, so
    // we verify the outcome by reading the registry directly.
    //   viem `write`는 함수 반환값이 아니라 tx 해시를 주므로, registry를
    //   직접 읽어 결과를 검증한다.
    await module.write.registerSubname(
      [parentNode, "team"],
      { account: bob.account, value: PRICE },
    );

    const expected = subnodeFor(parentNode, "team");
    const subOwner = await registry.read.owner([expected]);
    expect(subOwner.toLowerCase()).to.equal(bob.account.address.toLowerCase());
  });

  it("splits revenue between fee recipient and parent owner", async function () {
    const deployed = await deploy();
    const { module, owner, alice, bob, publicClient } = deployed;
    const parentNode = await setupCommerce(deployed, "acme7");

    const feeRecipient = owner.account.address; // set in constructor
    const before = await publicClient.getBalance({ address: alice.account.address });
    const feeBefore = await publicClient.getBalance({ address: feeRecipient });

    await module.write.registerSubname([parentNode, "team"], {
      account: bob.account,
      value: PRICE,
    });

    const expectedFee = (PRICE * FEE_BPS) / 10000n;
    const expectedOwner = PRICE - expectedFee;

    const after = await publicClient.getBalance({ address: alice.account.address });
    const feeAfter = await publicClient.getBalance({ address: feeRecipient });

    // alice is the parent owner (she didn't pay gas here — bob did), so her
    // balance should increase by exactly ownerProceeds.
    //   alice는 부모 소유자이며 이 트랜잭션 가스를 내지 않음(bob이 냄) →
    //   잔액이 정확히 ownerProceeds만큼 증가.
    expect(after - before).to.equal(expectedOwner);
    expect(feeAfter - feeBefore).to.equal(expectedFee);
  });
});
