// SPDX-License-Identifier: MIT
//
// Voluntary domain burn tests (ADR-012).
//
// Verifies:
//   - burn() reverts before grace period passes
//   - burn() succeeds after expiry + GRACE_PERIOD
//   - Anyone (not just previous owner) can burn an expired token
//   - Implicit burn during register() emits NameBurned for marketplaces
//   - State is fully cleared (expiries, names mappings)
//
// 자발적 도메인 burn 테스트 (ADR-012).

import { expect } from "chai";
import { network } from "hardhat";
import {
  keccak256,
  toBytes,
  encodeAbiParameters,
  parseAbiParameters,
  encodePacked,
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
const GRACE_PERIOD = 30n * 24n * 60n * 60n; // 30 days

function labelHash(label: string): `0x${string}` {
  return keccak256(toBytes(label));
}

function tokenIdFromLabel(label: string): bigint {
  return BigInt(labelHash(label));
}

describe("DXRegistrar — voluntary burn after grace (ADR-012)", function () {
  async function deploy() {
    const { ignition, viem } = await network.connect();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob, carol] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();
    return {
      ...deployed,
      owner,
      alice,
      bob,
      carol,
      viem,
      publicClient,
      testClient,
    };
  }

  async function registerName(deployed: any, registrant: any, label: string) {
    const { controller, resolver, testClient } = deployed;
    const secret = `0x${"c3".repeat(32)}` as `0x${string}`;
    // Commitment must use abi.encode (not encodePacked) to match
    // the contract's keccak256(abi.encode(...)).
    //   commitment는 abi.encode 사용 필수.
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

    return tokenIdFromLabel(label);
  }

  // ── Pre-grace burn rejection ────────────────────────────────────────────

  it("reverts burn() while name is still active", async function () {
    const deployed = await deploy();
    const tokenId = await registerName(deployed, deployed.alice, "burntest1");

    await expectRevert(
      deployed.registrar.write.burn([tokenId], { account: deployed.alice.account }),
      "NotYetBurnable",
    );
  });

  it("reverts burn() during grace period (expired but renewable)", async function () {
    const deployed = await deploy();
    const tokenId = await registerName(deployed, deployed.alice, "burntest2");

    // Fast-forward past expiry but within grace period
    await deployed.testClient.increaseTime({
      seconds: Number(ONE_YEAR) + 15 * 24 * 60 * 60, // expiry + 15 days
    });
    await deployed.testClient.mine({ blocks: 1 });

    await expectRevert(
      deployed.registrar.write.burn([tokenId], { account: deployed.alice.account }),
      "NotYetBurnable",
    );
  });

  // ── Post-grace burn succeeds ────────────────────────────────────────────

  it("allows burn() after expiry + GRACE_PERIOD", async function () {
    const deployed = await deploy();
    const tokenId = await registerName(deployed, deployed.alice, "burntest3");

    // Fast-forward past expiry + grace
    await deployed.testClient.increaseTime({
      seconds: Number(ONE_YEAR + GRACE_PERIOD) + 60,
    });
    await deployed.testClient.mine({ blocks: 1 });

    await deployed.registrar.write.burn([tokenId], {
      account: deployed.alice.account,
    });

    // Token no longer exists — ownerOf reverts
    await expectRevert(
      deployed.registrar.read.ownerOf([tokenId]),
      // After burn, _ownerOf returns address(0) and ownerOf reverts because
      // expiries[id] was deleted (now < block.timestamp) → TokenExpired path.
      // Either error is acceptable; we just confirm it reverts.
    );

    // expiries cleared
    const expiry = await deployed.registrar.read.nameExpires([tokenId]);
    expect(expiry).to.equal(0n);
  });

  // ── Permissionless burn ─────────────────────────────────────────────────

  it("allows any third party to burn after grace (permissionless cleanup)", async function () {
    const deployed = await deploy();
    const tokenId = await registerName(deployed, deployed.alice, "burntest4");

    // Fast-forward past expiry + grace
    await deployed.testClient.increaseTime({
      seconds: Number(ONE_YEAR + GRACE_PERIOD) + 60,
    });
    await deployed.testClient.mine({ blocks: 1 });

    // Carol (not the original owner) burns alice's expired domain.
    //   carol(원 보유자 아님)이 alice의 만료된 도메인을 burn.
    await deployed.registrar.write.burn([tokenId], {
      account: deployed.carol.account,
    });

    const expiry = await deployed.registrar.read.nameExpires([tokenId]);
    expect(expiry).to.equal(0n);
  });

  // ── State cleanup verification ──────────────────────────────────────────

  it("clears both expiries and names mappings on burn", async function () {
    const deployed = await deploy();
    const tokenId = await registerName(deployed, deployed.alice, "burntest5");

    // Verify the name exists before burn
    const expBefore = await deployed.registrar.read.nameExpires([tokenId]);
    expect(expBefore > 0n).to.equal(true);

    // Fast-forward + burn
    await deployed.testClient.increaseTime({
      seconds: Number(ONE_YEAR + GRACE_PERIOD) + 60,
    });
    await deployed.testClient.mine({ blocks: 1 });
    await deployed.registrar.write.burn([tokenId], {
      account: deployed.alice.account,
    });

    // After burn, expiries cleared
    expect(await deployed.registrar.read.nameExpires([tokenId])).to.equal(0n);

    // After burn, available() is true (name can be re-registered)
    expect(await deployed.registrar.read.available([tokenId])).to.equal(true);
  });

  // ── Implicit burn on re-registration ────────────────────────────────────

  it("emits NameBurned during re-registration of an expired name", async function () {
    const deployed = await deploy();
    const tokenId = await registerName(deployed, deployed.alice, "burntest6");

    // Fast-forward past expiry + grace
    await deployed.testClient.increaseTime({
      seconds: Number(ONE_YEAR + GRACE_PERIOD) + 60,
    });
    await deployed.testClient.mine({ blocks: 1 });

    // After such a long time jump (>1 year), the Chainlink mock's stored
    // `updatedAt` is now stale (> 26h old) and rentPrice() would revert with
    // StaleOraclePrice. Refresh the mock by calling updateAnswer with the
    // same price — this updates the timestamp to the current block.
    //   1년 이상 시간 점프 후 mock oracle의 updatedAt이 stale (>26h) 되어
    //   rentPrice가 StaleOraclePrice로 revert함. updateAnswer로 동일 가격
    //   재설정해 타임스탬프 갱신.
    const MOCK_POL_USD_PRICE = 40_000_000n; // $0.40 with 8 decimals
    await deployed.mockPolUsd.write.updateAnswer([MOCK_POL_USD_PRICE], {
      account: deployed.owner.account,
    });

    // Bob re-registers the name. The contract internally _burn()s alice's
    // dead token and emits NameBurned before _minting the new one.
    //   bob이 같은 이름 재등록. 컨트랙트가 alice의 죽은 토큰을 _burn하고
    //   NameBurned를 emit한 뒤 새로 _mint.
    const label = "burntest6";
    const secret = `0x${"d4".repeat(32)}` as `0x${string}`;
    const commitment = keccak256(
      encodeAbiParameters(
        parseAbiParameters("string, address, uint256, address, address, bytes32"),
        [
          label,
          deployed.bob.account.address,
          ONE_YEAR,
          deployed.resolver.address,
          "0x0000000000000000000000000000000000000000",
          secret,
        ],
      ),
    );

    await deployed.controller.write.commit([commitment], {
      account: deployed.bob.account,
    });
    await deployed.testClient.increaseTime({
      seconds: Number(MIN_COMMITMENT_AGE) + 5,
    });
    await deployed.testClient.mine({ blocks: 1 });

    const price = await deployed.controller.read.rentPrice([ONE_YEAR]);
    const txHash = await deployed.controller.write.register(
      [
        label,
        deployed.bob.account.address,
        ONE_YEAR,
        deployed.resolver.address,
        secret,
      ],
      { account: deployed.bob.account, value: price },
    );

    const receipt = await deployed.publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    // Look for NameBurned event in logs (topic[0] = keccak256 of signature)
    // NameBurned(uint256,address) signature hash
    const nameBurnedTopic = keccak256(toBytes("NameBurned(uint256,address)"));
    const burnedLogs = receipt.logs.filter(
      (l: any) => l.topics[0]?.toLowerCase() === nameBurnedTopic.toLowerCase(),
    );
    expect(burnedLogs.length).to.equal(1, "Expected exactly one NameBurned event");
  });

  // ── Edge case: burning a never-minted token ─────────────────────────────

  it("reverts when burning a token that was never minted", async function () {
    const deployed = await deploy();
    const phantomId = BigInt(labelHash("neverminted"));

    await expectRevert(
      deployed.registrar.write.burn([phantomId], {
        account: deployed.alice.account,
      }),
      "TokenOwnerNotFound",
    );
  });
});
