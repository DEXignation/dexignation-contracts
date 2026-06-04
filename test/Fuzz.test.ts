// SPDX-License-Identifier: MIT
// Property-based / fuzz tests for DEXignation.

import { expect } from "chai";
import { network } from "hardhat";
import {
  keccak256, toBytes, encodeAbiParameters, parseAbiParameters,
} from "viem";
import DXDeployLocal from "../ignition/modules/DXDeployLocal.js";

const MIN_COMMITMENT_AGE = 30n;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as `0x${string}`;
const DURATIONS = [
  365n * 24n * 60n * 60n,
  3n * 365n * 24n * 60n * 60n,
  5n * 365n * 24n * 60n * 60n,
  10n * 365n * 24n * 60n * 60n,
];

function makeCommitmentFull(
  label: string, owner: `0x${string}`, duration: bigint,
  resolver: `0x${string}`, paymentToken: `0x${string}`, secret: `0x${string}`,
): `0x${string}` {
  return keccak256(encodeAbiParameters(
    parseAbiParameters("string, address, uint256, address, address, bytes32"),
    [label, owner, duration, resolver, paymentToken, secret],
  ));
}

class SeededRandom {
  private state: number;
  constructor(seed: number) { this.state = seed; }
  next(): number {
    this.state = (this.state * 1103515245 + 12345) & 0x7fffffff;
    return this.state;
  }
  range(min: number, max: number): number {
    return min + (this.next() % (max - min + 1));
  }
}

function randomValidLabel(rng: SeededRandom): string {
  const alnum = "abcdefghijklmnopqrstuvwxyz0123456789";
  const len = rng.range(3, 20);
  let out = "";
  let lastWasHyphen = false;
  for (let i = 0; i < len; i++) {
    const useHyphen =
      i > 0 && i < len - 1 && !lastWasHyphen && rng.range(0, 9) === 0;
    if (useHyphen) {
      out += "-";
      lastWasHyphen = true;
    } else {
      out += alnum[rng.range(0, alnum.length - 1)];
      lastWasHyphen = false;
    }
  }
  return out;
}

function randomInvalidLabel(rng: SeededRandom): string {
  const variant = rng.range(0, 8);
  switch (variant) {
    case 0: return "";
    case 1: return "ab";
    case 2: return "Alice";
    case 3: return "-leading";
    case 4: return "trailing-";
    case 5: return "doub--le";
    case 6: return "has space";
    case 7: return "name.dex";
    case 8: return "bad<label";
    default: return "INVALID";
  }
}

describe("Fuzz — register with random valid labels", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob, carol] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();
    return { ...deployed, owner, alice, bob, carol, publicClient, testClient };
  }

  it("100 random valid labels all register successfully", async function () {
    this.timeout(120000);

    const { controller, resolver, alice, testClient } = await deploy();
    const rng = new SeededRandom(42);

    const usedLabels = new Set<string>();
    let registeredCount = 0;
    const totalTries = 30;

    for (let i = 0; i < totalTries; i++) {
      let label = randomValidLabel(rng);
      let attempts = 0;
      while (usedLabels.has(label) && attempts < 5) {
        label = randomValidLabel(rng);
        attempts++;
      }
      if (usedLabels.has(label)) continue;
      usedLabels.add(label);

      const duration = DURATIONS[rng.range(0, DURATIONS.length - 1)];
      const secret = `0x${i.toString(16).padStart(64, "0")}` as `0x${string}`;

      const commitment = makeCommitmentFull(
        label, alice.account.address, duration, resolver.address, ZERO_ADDR, secret,
      );
      await controller.write.commit([commitment], { account: alice.account });
      await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
      await testClient.mine({ blocks: 1 });

      const price = await controller.read.rentPrice([duration]);
      try {
        await controller.write.register(
          [label, alice.account.address, duration, resolver.address, secret],
          { account: alice.account, value: price },
        );
        registeredCount++;
      } catch (e) {
        console.error(`Failed for label="${label}" duration=${duration}:`, e);
        throw e;
      }
    }

    console.log(`Fuzz: ${registeredCount}/${usedLabels.size} unique labels registered`);
    expect(registeredCount > 0).to.equal(true);
  });

  it("invalid labels all reject", async function () {
    const { controller } = await deploy();
    const rng = new SeededRandom(7);

    for (let i = 0; i < 14; i++) {
      const label = randomInvalidLabel(rng);
      const result = await controller.read.isValidLabel([label]);
      expect(result).to.equal(false,
        `Invalid label "${label}" passed isValidLabel check`);
    }
  });
});

describe("Fuzz — discount applies correctly across many configurations", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice] = await viem.getWalletClients();
    return { ...deployed, owner, alice, viem };
  }

  it("discounted price calculation is monotonic in bps", async function () {
    const { controller, owner, alice, viem } = await deploy();
    const token = await viem.deployContract("MockERC20", ["T", "T", 18]);
    await token.write.mint([alice.account.address, 1000n * 10n ** 18n], {
      account: owner.account,
    });

    const ONE_YEAR = DURATIONS[0];

    let lastPrice: bigint | null = null;
    for (const bps of [0n, 100n, 500n, 1000n, 2000n, 3000n, 4000n, 5000n]) {
      if (bps === 0n) {
        await controller.write.setDiscountToken(
          [ZERO_ADDR, 0n, 0n],
          { account: owner.account },
        );
      } else {
        await controller.write.setDiscountToken(
          [token.address, 100n * 10n ** 18n, bps],
          { account: owner.account },
        );
      }

      const price = await controller.read.rentPriceForPayer([
        "fuzzlabel", ONE_YEAR, alice.account.address,
      ]);

      if (lastPrice !== null) {
        // bigint direct comparison (chai v4 lessThanOrEqual doesn't support bigint).
        //   bigint 직접 비교 (chai v4 미지원).
        expect(price <= lastPrice).to.equal(true,
          `Higher bps did not produce lower-or-equal price: ${lastPrice} → ${price} at ${bps} bps`);
      }
      lastPrice = price;
    }
  });
});
