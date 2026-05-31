// SPDX-License-Identifier: MIT
//
// Subname access-gating tests for DXSubnameRegistrar (A3 extension).
//
// A parent owner can require buyers to hold a token/SBT to register a subname.
// One interface (balanceOf) covers both:
//   - ERC-20 gate: threshold is a token amount
//   - SBT/ERC-721 gate: threshold is a badge count (set to 1)
//
// Verifies:
//   - only the parent owner can set the gate
//   - ERC-20 gate: holder passes, non-holder reverts (GateNotMet)
//   - SBT gate: badge holder passes, non-holder reverts
//   - clearing the gate (zero address) re-opens to everyone
//   - meetsGate view reflects eligibility
//
// 부모 소유자가 구매자에게 토큰/SBT 보유를 요구. balanceOf 하나로 ERC-20(수량)·
// SBT(개수=1) 모두 처리. 소유자만 설정, 보유자 통과/미보유 revert, 해제 시 재개방,
// meetsGate view 검증.

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
const ONE_TOKEN = 10n ** 18n;
const GATE_AMOUNT = 50n * ONE_TOKEN; // ERC-20 gate: hold >= 50 tokens

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

describe("DXSubnameRegistrar — access gating (A3 ext)", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob, carol] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();

    const module = await viem.deployContract("DXSubnameRegistrar", [
      deployed.registry.address,
      deployed.resolver.address,
      owner.account.address, // feeRecipient
      FEE_BPS,
    ]);

    return {
      ...deployed, module,
      owner, alice, bob, carol,
      publicClient, testClient, viem,
    };
  }

  async function registerParent(deployed: any, registrant: any, label: string) {
    const { controller, resolver, testClient } = deployed;
    const secret = `0x${"c9".repeat(32)}` as `0x${string}`;
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

  // Register parent, configure sales, delegate the module.
  //   부모 등록 → 판매 설정 → 모듈 위임.
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

  it("only the parent owner can set the gate", async function () {
    const deployed = await deploy();
    const parentNode = await setupCommerce(deployed, "gateauth");
    await expectRevert(
      deployed.module.write.setSubnameGate(
        [parentNode, deployed.module.address, 1n],
        { account: deployed.bob.account },
      ),
      "NotParentOwner",
    );
  });

  it("ERC-20 gate: holder can buy, non-holder reverts", async function () {
    const deployed = await deploy();
    const { module, owner, alice, bob, carol, viem } = deployed;
    const parentNode = await setupCommerce(deployed, "gateerc20");

    const gateToken = await viem.deployContract("MockERC20", ["Gate", "GATE", 18]);
    // bob holds enough; carol holds nothing.
    await gateToken.write.mint([bob.account.address, GATE_AMOUNT]);

    await module.write.setSubnameGate(
      [parentNode, gateToken.address, GATE_AMOUNT],
      { account: alice.account },
    );

    // carol (no tokens) is rejected.
    await expectRevert(
      module.write.registerSubname([parentNode, "carol"], {
        account: carol.account,
        value: PRICE,
      }),
      "GateNotMet",
    );

    // bob (holds threshold) succeeds.
    await module.write.registerSubname([parentNode, "bob"], {
      account: bob.account,
      value: PRICE,
    });
    const sub = subnodeFor(parentNode, "bob");
    const subOwner = await deployed.registry.read.owner([sub]);
    expect(subOwner.toLowerCase()).to.equal(bob.account.address.toLowerCase());
  });

  it("SBT gate: badge holder can buy, non-holder reverts", async function () {
    const deployed = await deploy();
    const { module, owner, alice, bob, carol, viem } = deployed;
    const parentNode = await setupCommerce(deployed, "gatesbt");

    const sbt = await viem.deployContract("DXContributionSBT", []);
    // bob gets a badge; carol does not.
    await sbt.write.award([bob.account.address, "code", "Contributor"], {
      account: owner.account,
    });

    // SBT gate: threshold = 1 badge.
    await module.write.setSubnameGate([parentNode, sbt.address, 1n], {
      account: alice.account,
    });

    await expectRevert(
      module.write.registerSubname([parentNode, "carol"], {
        account: carol.account,
        value: PRICE,
      }),
      "GateNotMet",
    );

    await module.write.registerSubname([parentNode, "bob"], {
      account: bob.account,
      value: PRICE,
    });
    const sub = subnodeFor(parentNode, "bob");
    const subOwner = await deployed.registry.read.owner([sub]);
    expect(subOwner.toLowerCase()).to.equal(bob.account.address.toLowerCase());
  });

  it("clearing the gate (zero address) re-opens to everyone", async function () {
    const deployed = await deploy();
    const { module, alice, carol, viem } = deployed;
    const parentNode = await setupCommerce(deployed, "gateclear");

    const gateToken = await viem.deployContract("MockERC20", ["Gate", "GATE", 18]);
    await module.write.setSubnameGate(
      [parentNode, gateToken.address, GATE_AMOUNT],
      { account: alice.account },
    );
    // carol holds none → blocked.
    await expectRevert(
      module.write.registerSubname([parentNode, "carol1"], {
        account: carol.account, value: PRICE,
      }),
      "GateNotMet",
    );

    // Clear the gate.
    await module.write.setSubnameGate([parentNode, ZERO_ADDR, 0n], {
      account: alice.account,
    });
    // Now carol can buy.
    await module.write.registerSubname([parentNode, "carol2"], {
      account: carol.account, value: PRICE,
    });
    const sub = subnodeFor(parentNode, "carol2");
    const subOwner = await deployed.registry.read.owner([sub]);
    expect(subOwner.toLowerCase()).to.equal(carol.account.address.toLowerCase());
  });

  it("meetsGate view reflects eligibility", async function () {
    const deployed = await deploy();
    const { module, alice, bob, carol, viem } = deployed;
    const parentNode = await setupCommerce(deployed, "gateview");

    // No gate → everyone passes.
    expect(await module.read.meetsGate([parentNode, carol.account.address]))
      .to.equal(true);

    const gateToken = await viem.deployContract("MockERC20", ["Gate", "GATE", 18]);
    await gateToken.write.mint([bob.account.address, GATE_AMOUNT]);
    await module.write.setSubnameGate(
      [parentNode, gateToken.address, GATE_AMOUNT],
      { account: alice.account },
    );

    expect(await module.read.meetsGate([parentNode, bob.account.address]))
      .to.equal(true);
    expect(await module.read.meetsGate([parentNode, carol.account.address]))
      .to.equal(false);
  });
});