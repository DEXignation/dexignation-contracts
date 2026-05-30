// SPDX-License-Identifier: MIT
//
// Localized profile tests for DXResolver (B2).
//
// Verifies:
//   - setProfile stores all fields for a language in one call
//   - getProfile returns them, with per-field English fallback
//   - requesting an unsupported language reverts
//   - non-owner cannot setProfile
//   - expired node returns empty profile
//
// 현지화 프로필 테스트. 한 번에 설정/조회, 필드별 영어 폴백,
// 미지원 언어 revert, 비소유자 차단, 만료 시 공백 검증.

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

describe("DXResolver — localized profile (B2)", function () {
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
    const secret = `0x${"a1".repeat(32)}` as `0x${string}`;
    const commitment = keccak256(
      encodeAbiParameters(
        parseAbiParameters("string, address, uint256, address, address, bytes32"),
        [
          label,
          registrant.account.address,
          ONE_YEAR,
          resolver.address,
          "0x0000000000000000000000000000000000000000",
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

  it("stores and reads a full profile in one call (Korean)", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "profilekr");

    await deployed.resolver.write.setProfile(
      [node, "ko", "김로이", "Web3 개발자", "ipfs://avatar", "https://roy.dex"],
      { account: deployed.alice.account },
    );

    const [name_, bio, avatar, url] =
      await deployed.resolver.read.getProfile([node, "ko"]);
    expect(name_).to.equal("김로이");
    expect(bio).to.equal("Web3 개발자");
    expect(avatar).to.equal("ipfs://avatar");
    expect(url).to.equal("https://roy.dex");
  });

  it("falls back to English per field when a language is missing", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "profilefb");

    // English profile set; Korean only overrides the name.
    await deployed.resolver.write.setProfile(
      [node, "en", "Roy Kim", "Web3 dev", "ipfs://en", "https://en.dex"],
      { account: deployed.alice.account },
    );
    await deployed.resolver.write.setProfile(
      [node, "ko", "김로이", "", "", ""],
      { account: deployed.alice.account },
    );

    const [name_, bio, avatar, url] =
      await deployed.resolver.read.getProfile([node, "ko"]);
    // name comes from ko; the empty fields fall back to en.
    expect(name_).to.equal("김로이");
    expect(bio).to.equal("Web3 dev");
    expect(avatar).to.equal("ipfs://en");
    expect(url).to.equal("https://en.dex");
  });

  it("reverts setProfile for an unsupported language", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "profilexx");
    await expectRevert(
      deployed.resolver.write.setProfile(
        [node, "xx", "n", "b", "a", "u"],
        { account: deployed.alice.account },
      ),
      "Language not supported",
    );
  });

  it("non-owner cannot setProfile", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "profileauth");
    await expectRevert(
      deployed.resolver.write.setProfile(
        [node, "en", "n", "b", "a", "u"],
        { account: deployed.bob.account },
      ),
    );
  });

  it("returns empty profile after the node expires", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "profileexp");

    await deployed.resolver.write.setProfile(
      [node, "en", "Roy", "bio", "ipfs://a", "https://u"],
      { account: deployed.alice.account },
    );

    // Jump past expiry + grace so the registry reports the node as expired.
    //   만료+유예를 지나도록 점프해 registry가 만료로 보고하게 한다.
    await deployed.testClient.increaseTime({
      seconds: Number(ONE_YEAR) + 80 * 24 * 60 * 60,
    });
    await deployed.testClient.mine({ blocks: 1 });

    const [name_, bio, avatar, url] =
      await deployed.resolver.read.getProfile([node, "en"]);
    expect(name_).to.equal("");
    expect(bio).to.equal("");
    expect(avatar).to.equal("");
    expect(url).to.equal("");
  });
});
