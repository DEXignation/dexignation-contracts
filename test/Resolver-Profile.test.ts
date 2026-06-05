// SPDX-License-Identifier: MIT
//
// Multilingual text-record tests for DXResolver.
//
// NOTE: The old setProfile/getProfile wrapper was removed in favour of the
// EIP-634 standard keys. Profile fields now live under standard keys via the
// multi-language text mechanism:
//   name        → key "name"
//   bio         → key "description"   (EIP-634 standard)
//   avatar      → key "avatar"        (EIP-634 standard)
//   website url → key "url"           (EIP-634 standard)
//
// These tests preserve the original B2 coverage (one-language set/read,
// per-field English fallback, unsupported-language revert, non-owner block,
// expired node returns empty) but exercise setMultiLangText/getMultiLangText.
//
// 기존 setProfile/getProfile 래퍼는 제거되고 EIP-634 표준 키로 일원화되었다.
// 프로필 필드는 표준 키(name/description/avatar/url) 아래 다국어 text로 저장된다.
// 본 테스트는 원래 B2 커버리지를 표준 키 기반으로 그대로 재현한다.

import { expect } from "chai";
import { network } from "hardhat";
import { keccak256, toBytes, encodePacked, encodeAbiParameters, parseAbiParameters } from "viem";
import DXDeployLocal from "../ignition/modules/DXDeployLocal.js";

async function expectRevert(promise: Promise<unknown>, keyword?: string): Promise<void> {
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

// Standard EIP-634 profile keys (replaces the old profile.* keys).
const K_NAME = "name";
const K_BIO = "description";
const K_AVATAR = "avatar";
const K_URL = "url";

function labelHash(label: string): `0x${string}` {
  return keccak256(toBytes(label));
}
function subnodeFor(parent: `0x${string}`, label: string): `0x${string}` {
  return keccak256(encodePacked(["bytes32", "bytes32"], [parent, labelHash(label)]));
}
function tldNode(): `0x${string}` {
  return subnodeFor("0x0000000000000000000000000000000000000000000000000000000000000000", "dex");
}

describe("DXResolver — multilingual text records (standard keys)", function () {
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

  // Helper: set all four profile fields for one language (replaces setProfile).
  //   한 언어의 네 필드를 한 번에 설정 (setProfile 대체).
  async function setProfileFields(
    deployed: any,
    account: any,
    node: `0x${string}`,
    lang: string,
    name_: string,
    bio: string,
    avatar: string,
    url: string,
  ) {
    const r = deployed.resolver;
    await r.write.setMultiLangText([node, K_NAME, lang, name_], { account });
    await r.write.setMultiLangText([node, K_BIO, lang, bio], { account });
    await r.write.setMultiLangText([node, K_AVATAR, lang, avatar], { account });
    await r.write.setMultiLangText([node, K_URL, lang, url], { account });
  }

  async function readProfileFields(deployed: any, node: `0x${string}`, lang: string) {
    const r = deployed.resolver;
    const name_ = await r.read.getMultiLangText([node, K_NAME, lang]);
    const bio = await r.read.getMultiLangText([node, K_BIO, lang]);
    const avatar = await r.read.getMultiLangText([node, K_AVATAR, lang]);
    const url = await r.read.getMultiLangText([node, K_URL, lang]);
    return { name_, bio, avatar, url };
  }

  it("stores and reads all standard profile keys for one language (Korean)", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "profilekr");

    await setProfileFields(
      deployed, deployed.alice.account, node, "ko",
      "김로이", "Web3 개발자", "ipfs://avatar", "https://roy.dex",
    );

    const { name_, bio, avatar, url } = await readProfileFields(deployed, node, "ko");
    expect(name_).to.equal("김로이");
    expect(bio).to.equal("Web3 개발자");
    expect(avatar).to.equal("ipfs://avatar");
    expect(url).to.equal("https://roy.dex");
  });

  it("falls back to English per field when a language is missing", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "profilefb");

    // English fully set; Korean only overrides the name (others left empty).
    await setProfileFields(
      deployed, deployed.alice.account, node, "en",
      "Roy Kim", "Web3 dev", "ipfs://en", "https://en.dex",
    );
    await deployed.resolver.write.setMultiLangText([node, K_NAME, "ko", "김로이"], {
      account: deployed.alice.account,
    });

    const { name_, bio, avatar, url } = await readProfileFields(deployed, node, "ko");
    // name comes from ko; the unset ko fields fall back to en.
    expect(name_).to.equal("김로이");
    expect(bio).to.equal("Web3 dev");
    expect(avatar).to.equal("ipfs://en");
    expect(url).to.equal("https://en.dex");
  });

  it("reads standard text() for the same keys (EIP-634 interop)", async function () {
    // A wallet/explorer reading the plain EIP-634 text() must see the value
    // when only an English multilang value exists (getMultiLangText falls back
    // to textRecords; here we verify the standard single-value path too).
    //   외부 지갑/익스플로러가 표준 text()로 읽는 경로도 확인.
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "profileinterop");

    await deployed.resolver.write.setText([node, K_AVATAR, "ipfs://std"], {
      account: deployed.alice.account,
    });
    // Standard text() returns the single-value record.
    expect(await deployed.resolver.read.text([node, K_AVATAR])).to.equal("ipfs://std");
    // And getMultiLangText falls through to it when no per-language value set.
    expect(await deployed.resolver.read.getMultiLangText([node, K_AVATAR, "ko"])).to.equal(
      "ipfs://std",
    );
  });

  it("reverts setMultiLangText for an unsupported language", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "profilexx");
    await expectRevert(
      deployed.resolver.write.setMultiLangText([node, K_BIO, "xx", "bio"], {
        account: deployed.alice.account,
      }),
      "Language not supported",
    );
  });

  it("non-owner cannot setMultiLangText", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "profileauth");
    await expectRevert(
      deployed.resolver.write.setMultiLangText([node, K_BIO, "en", "bio"], {
        account: deployed.bob.account,
      }),
    );
  });

  it("returns empty after the node expires", async function () {
    const deployed = await deploy();
    const node = await registerName(deployed, deployed.alice, "profileexp");

    await setProfileFields(
      deployed, deployed.alice.account, node, "en",
      "Roy", "bio", "ipfs://a", "https://u",
    );

    // Jump past expiry + grace so the registry reports the node as expired.
    //   만료+유예를 지나도록 점프해 registry가 만료로 보고하게 한다.
    await deployed.testClient.increaseTime({
      seconds: Number(ONE_YEAR) + 80 * 24 * 60 * 60,
    });
    await deployed.testClient.mine({ blocks: 1 });

    const { name_, bio, avatar, url } = await readProfileFields(deployed, node, "en");
    expect(name_).to.equal("");
    expect(bio).to.equal("");
    expect(avatar).to.equal("");
    expect(url).to.equal("");
  });
});
