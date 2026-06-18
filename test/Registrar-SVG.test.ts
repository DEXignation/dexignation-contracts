// SPDX-License-Identifier: MIT
//
// On-chain SVG / tokenURI tests for DXRegistrar — hexagonal tier-colored card.
//
// Color model ("best ever" badge):
//   - The card tier is set from the PURCHASED duration at registration and
//     ratchets UP on renewal when the total guaranteed duration reaches a
//     higher tier. It NEVER ratchets down as time passes.
//   - Once the name is actually expired, the card shows red regardless of tier.
//
// Allowed durations (oracle): 1, 3, 5, 10, 15 years.
// Tier by duration:  <1y charcoal · <3y mud · <5y orange · <10y yellow · >=10y gold
//
// 색 모델("역대 최고" 배지): 등록 시 구매 기간으로 등급 설정, 갱신으로 총 보장
// 기간이 더 높은 등급에 도달하면 상승, 시간 경과로는 안 내려감. 실제 만료 시 red.

import { expect } from "chai";
import { network } from "hardhat";
import {
  keccak256,
  toBytes,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
import DXDeployLocal from "../ignition/modules/DXDeployLocal.js";

const YEAR = 365n * 24n * 60n * 60n;
const MIN_COMMITMENT_AGE = 30n;
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

const D1Y = YEAR;
const D3Y = 3n * YEAR;
const D5Y = 5n * YEAR;
const D10Y = 10n * YEAR;
const D15Y = 15n * YEAR;

const RED = "#ff3226";
const CHARCOAL = "#888f93";
const MUD = "#a37842";
const ORANGE = "#ff7a12";
const YELLOW = "#ffd02c";
const GOLD = "#ffd875";
const METADATA_UPDATE_TOPIC = keccak256(toBytes("MetadataUpdate(uint256)"));

function labelHash(label) {
  return keccak256(toBytes(label));
}
function tokenIdFromLabel(label) {
  return BigInt(labelHash(label));
}

function decodeTokenURI(uri) {
  const jsonB64 = uri.replace("data:application/json;base64,", "");
  const json = Buffer.from(jsonB64, "base64").toString("utf8");
  const m = json.match(/data:image\/svg\+xml;base64,([^"]+)/);
  if (!m) throw new Error("no svg in tokenURI json");
  const svg = Buffer.from(m[1], "base64").toString("utf8");
  return { json, svg };
}

describe("DXRegistrar — on-chain SVG (hexagonal tier card)", function () {
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();
    return { ...deployed, owner, alice, publicClient, testClient, viem };
  }

  async function registerFor(deployed, label, duration) {
    const { controller, resolver, testClient, alice } = deployed;
    const secret = `0x${"ab".repeat(32)}`;
    const commitment = keccak256(
      encodeAbiParameters(
        parseAbiParameters("string, address, uint256, address, address, bytes32"),
        [label, alice.account.address, duration, resolver.address, ZERO_ADDR, secret],
      ),
    );
    await controller.write.commit([commitment], { account: alice.account });
    await testClient.increaseTime({ seconds: Number(MIN_COMMITMENT_AGE) + 5 });
    await testClient.mine({ blocks: 1 });
    const price = await controller.read.rentPrice([duration]);
    await controller.write.register(
      [label, alice.account.address, duration, resolver.address, secret],
      { account: alice.account, value: price },
    );
    return tokenIdFromLabel(label);
  }

  async function renewFor(deployed, label, duration) {
    const { controller, alice } = deployed;
    const price = await controller.read.rentPrice([duration]);
    return controller.write.renew([label, duration], {
      account: alice.account,
      value: price,
    });
  }

  async function expectMetadataUpdate(deployed, hash, tokenId) {
    const receipt = await deployed.publicClient.waitForTransactionReceipt({ hash });
    const encodedTokenId = encodeAbiParameters(parseAbiParameters("uint256"), [tokenId]);
    const logs = receipt.logs.filter(
      (log) =>
        log.address.toLowerCase() === deployed.registrar.address.toLowerCase() &&
        log.topics[0] === METADATA_UPDATE_TOPIC &&
        log.data === encodedTokenId,
    );
    expect(logs.length).to.equal(1);
  }

  async function advance(deployed, seconds) {
    await deployed.testClient.increaseTime({ seconds: Number(seconds) });
    await deployed.testClient.mine({ blocks: 1 });
  }

  async function svgFor(deployed, label) {
    const id = tokenIdFromLabel(label);
    const uri = await deployed.registrar.read.tokenURI([id]);
    return decodeTokenURI(uri).svg;
  }

  it("1-year purchase → charcoal", async function () {
    const deployed = await deploy();
    await registerFor(deployed, "buy1y", D1Y);
    const svg = await svgFor(deployed, "buy1y");
    expect(svg).to.include(CHARCOAL);
    expect(svg).to.not.include(RED);
  });

  it("3-year purchase → mud", async function () {
    const deployed = await deploy();
    await registerFor(deployed, "buy3y", D3Y);
    const svg = await svgFor(deployed, "buy3y");
    expect(svg).to.include(MUD);
  });

  it("5-year purchase → burnt orange", async function () {
    const deployed = await deploy();
    await registerFor(deployed, "buy5y", D5Y);
    const svg = await svgFor(deployed, "buy5y");
    expect(svg).to.include(ORANGE);
  });

  it("10-year purchase → yellow", async function () {
    const deployed = await deploy();
    await registerFor(deployed, "buy10y", D10Y);
    const svg = await svgFor(deployed, "buy10y");
    expect(svg).to.include(YELLOW);
    expect(svg).to.not.include(GOLD);
  });

  it("15-year purchase → gold", async function () {
    const deployed = await deploy();
    await registerFor(deployed, "buy15y", D15Y);
    const svg = await svgFor(deployed, "buy15y");
    expect(svg).to.include(GOLD);
    expect(svg).to.not.include(YELLOW);
  });

  it("tier ratchets UP on renewal: 3y then +3y → mud climbs to yellow", async function () {
    const deployed = await deploy();
    await registerFor(deployed, "climb", D3Y);
    let svg = await svgFor(deployed, "climb");
    expect(svg).to.include(MUD);

    const renewHash = await renewFor(deployed, "climb", D3Y); // total guaranteed ~6y → yellow
    await expectMetadataUpdate(deployed, renewHash, tokenIdFromLabel("climb"));
    svg = await svgFor(deployed, "climb");
    expect(svg).to.include(YELLOW);
    expect(svg).to.not.include(MUD);
  });

  it("tier does NOT ratchet down as time passes (gold stays gold)", async function () {
    const deployed = await deploy();
    await registerFor(deployed, "stays", D15Y); // gold
    let svg = await svgFor(deployed, "stays");
    expect(svg).to.include(GOLD);

    // 5 years pass → ~10y remaining. Tier must NOT drop to yellow.
    await advance(deployed, 5n * YEAR);
    svg = await svgFor(deployed, "stays");
    expect(svg).to.include(GOLD);
    expect(svg).to.not.include(YELLOW);
  });

  it("expired name shows red regardless of tier", async function () {
    const deployed = await deploy();
    await registerFor(deployed, "lapsed", D1Y);
    await advance(deployed, YEAR + 60n); // past expiry (within grace, still readable)
    const svg = await svgFor(deployed, "lapsed");
    expect(svg).to.include(RED);
  });

  it("includes the tier name and full domain in the JSON (gold)", async function () {
    const deployed = await deploy();
    const id = await registerFor(deployed, "goldjson", D15Y);
    const uri = await deployed.registrar.read.tokenURI([id]);
    const { json } = decodeTokenURI(uri);
    expect(json).to.include('"Tier"');
    expect(json).to.include("Gold");
    expect(json).to.include("goldjson.dex");
  });

  it("shows the full label in the SVG, even a 50-char name", async function () {
    const deployed = await deploy();
    const long = "the-quick-brown-fox-jumps-over-the-lazy-dog-123456"; // 50 chars
    expect(long.length).to.equal(50);
    await registerFor(deployed, long, D1Y);
    const svg = await svgFor(deployed, long);
    // The name wraps into up to 3 lines, so the full string isn't contiguous.
    // Verify representative fragments that survive any reasonable wrapping:
    // the start and the end of the label both appear somewhere in the SVG.
    //   이름은 최대 3줄로 줄바꿈되므로 전체 문자열이 연속이 아니다. 시작과 끝
    //   조각이 SVG 어딘가에 나타나는지 검증.
    expect(svg).to.include("the-quick");
    expect(svg).to.include("123456");
  });

  it("renders a hexagon (polygon), not a rectangle card", async function () {
    const deployed = await deploy();
    await registerFor(deployed, "hexshape", D1Y);
    const svg = await svgFor(deployed, "hexshape");
    expect(svg).to.include('viewBox="0 0 400 400"');
    expect(svg).to.include("<polygon");
    expect(svg).to.include("200,20 340,110");
  });
});
