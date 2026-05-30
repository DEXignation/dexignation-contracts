// SPDX-License-Identifier: MIT
//
// Agent identity & payment-routing record tests for DXResolver (B1).
//
// A `.dex` name can point at an external agent identity (e.g. ERC-8004) and a
// payment endpoint (e.g. x402). The resolver stores pointers only.
//
// Verifies:
//   - setAgent stores the full record; getAgent reads it back
//   - agentPayment returns just (payTo, payToken)
//   - hasAgent reflects configured/!expired
//   - non-owner cannot setAgent
//   - clearAgent removes it
//   - expired node returns empty/zero
//
// `.dex` 이름이 외부 에이전트 신원(ERC-8004)·결제 엔드포인트(x402)를 가리킴.
// 리졸버는 포인터만 저장. set/get, 결제 라우팅 조회, hasAgent, 비소유자 차단,
// clear, 만료 시 공백 검증.

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

// Sample pointers (stand-ins for a real ERC-8004 registry + USDC).
const AGENT_REGISTRY = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const AGENT_ID = 42n;
const CARD_URI = "ipfs://agentcard/alice";
const PAY_TO = "0x2222222222222222222222222222222222222222" as `0x${string}`;
const PAY_TOKEN = "0x3333333333333333333333333333333333333333" as `0x${string}`; // e.g. USDC

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

describe("DXResolver — agent identity & payment routing (B1)", function () {
  async function deploy() {
    const { ignition, viem } = await network.connect();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();
    return { ...deployed, owner, alice, bob, viem, publicClient, testClient };
  }

  async function registerName(deployed: any, registrant: any, label: string) {
    const { controller, resolver, testClient } = deployed;
    const secret = `0x${"d5".repeat(32)}` as `0x${string}`;
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

  it("sets and reads the full agent record", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "agentfull");

    await deployed.resolver.write.setAgent(
      [node, AGENT_REGISTRY, AGENT_ID, CARD_URI, PAY_TO, PAY_TOKEN],
      { account: deployed.alice.account },
    );

    const [reg, id, card, payTo, payToken] =
      await deployed.resolver.read.getAgent([node]);
    expect(reg.toLowerCase()).to.equal(AGENT_REGISTRY.toLowerCase());
    expect(id).to.equal(AGENT_ID);
    expect(card).to.equal(CARD_URI);
    expect(payTo.toLowerCase()).to.equal(PAY_TO.toLowerCase());
    expect(payToken.toLowerCase()).to.equal(PAY_TOKEN.toLowerCase());
  });

  it("agentPayment returns just the routing pair", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "agentpay");

    await deployed.resolver.write.setAgent(
      [node, AGENT_REGISTRY, AGENT_ID, CARD_URI, PAY_TO, PAY_TOKEN],
      { account: deployed.alice.account },
    );

    const [payTo, payToken] = await deployed.resolver.read.agentPayment([node]);
    expect(payTo.toLowerCase()).to.equal(PAY_TO.toLowerCase());
    expect(payToken.toLowerCase()).to.equal(PAY_TOKEN.toLowerCase());
  });

  it("hasAgent reflects whether a record is set", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "agenthas");

    expect(await deployed.resolver.read.hasAgent([node])).to.equal(false);

    await deployed.resolver.write.setAgent(
      [node, AGENT_REGISTRY, AGENT_ID, CARD_URI, PAY_TO, PAY_TOKEN],
      { account: deployed.alice.account },
    );
    expect(await deployed.resolver.read.hasAgent([node])).to.equal(true);
  });

  it("non-owner cannot setAgent", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "agentauth");
    await expectRevert(
      deployed.resolver.write.setAgent(
        [node, AGENT_REGISTRY, AGENT_ID, CARD_URI, PAY_TO, PAY_TOKEN],
        { account: deployed.bob.account },
      ),
      "Not authorized",
    );
  });

  it("clearAgent removes the record", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "agentclear");

    await deployed.resolver.write.setAgent(
      [node, AGENT_REGISTRY, AGENT_ID, CARD_URI, PAY_TO, PAY_TOKEN],
      { account: deployed.alice.account },
    );
    expect(await deployed.resolver.read.hasAgent([node])).to.equal(true);

    await deployed.resolver.write.clearAgent([node], {
      account: deployed.alice.account,
    });
    expect(await deployed.resolver.read.hasAgent([node])).to.equal(false);

    const [reg, id, card, payTo, payToken] =
      await deployed.resolver.read.getAgent([node]);
    expect(reg).to.equal(ZERO_ADDR);
    expect(id).to.equal(0n);
    expect(card).to.equal("");
    expect(payTo).to.equal(ZERO_ADDR);
    expect(payToken).to.equal(ZERO_ADDR);
  });

  it("returns empty/zero after the node expires", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "agentexp");

    await deployed.resolver.write.setAgent(
      [node, AGENT_REGISTRY, AGENT_ID, CARD_URI, PAY_TO, PAY_TOKEN],
      { account: deployed.alice.account },
    );

    // Jump past expiry + grace.
    await deployed.testClient.increaseTime({
      seconds: Number(ONE_YEAR) + 80 * 24 * 60 * 60,
    });
    await deployed.testClient.mine({ blocks: 1 });

    expect(await deployed.resolver.read.hasAgent([node])).to.equal(false);
    const [reg, , , payTo] = await deployed.resolver.read.getAgent([node]);
    expect(reg).to.equal(ZERO_ADDR);
    expect(payTo).to.equal(ZERO_ADDR);
    const [pTo, pTok] = await deployed.resolver.read.agentPayment([node]);
    expect(pTo).to.equal(ZERO_ADDR);
    expect(pTok).to.equal(ZERO_ADDR);
  });
});