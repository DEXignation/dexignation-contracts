// SPDX-License-Identifier: MIT
//
// Tests for DXNamehash — verifies EIP-137 compliance by cross-checking
// against viem's reference namehash implementation.
//
// DXNamehash 테스트. viem의 참조 namehash 구현과 교차 검증하여
// EIP-137 준수 확인.

import { expect } from "chai";
import { network } from "hardhat";
import { namehash } from "viem/ens";

describe("DXNamehash", function () {
  it("matches viem reference for the empty name", async function () {
    const { viem } = await network.connect();
    const lib = await viem.deployContract("DXNamehashTestHarness");
    const result = await lib.read.namehash([""]);
    expect(result).to.equal(namehash(""));
  });

  it("matches viem for single-label names", async function () {
    const { viem } = await network.connect();
    const lib = await viem.deployContract("DXNamehashTestHarness");
    for (const label of ["dex", "eth", "polygon", "test"]) {
      expect(await lib.read.namehash([label])).to.equal(namehash(label));
    }
  });

  it("matches viem for multi-label names", async function () {
    const { viem } = await network.connect();
    const lib = await viem.deployContract("DXNamehashTestHarness");
    const cases = [
      "alice.dex",
      "bob.alice.dex",
      "deeply.nested.example.dex",
      "addr.reverse",
    ];
    for (const name of cases) {
      expect(await lib.read.namehash([name])).to.equal(namehash(name));
    }
  });

  it("rejects empty labels (e.g. trailing dot, double dot)", async function () {
    const { viem } = await network.connect();
    const lib = await viem.deployContract("DXNamehashTestHarness");

    async function expectEmptyDnsLabel(name: string) {
      try {
        await lib.read.namehash([name]);
        throw new Error(`Expected EmptyDnsLabel revert for ${name}`);
      } catch (err: any) {
        expect(String(err)).to.include("EmptyDnsLabel");
      }
    }

    await expectEmptyDnsLabel("alice..dex");
    await expectEmptyDnsLabel("alice.");
    await expectEmptyDnsLabel(".alice");
  });
});
