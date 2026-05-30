import { expect } from "chai";
import { network } from "hardhat";

// NOTE: expiry timestamps are computed from the CURRENT BLOCK TIME, not from
// the wall clock (`Date.now()`). Other test files advance Hardhat's block time
// (e.g. subscription/expiry tests jump ~1 year), and the block time accumulates
// across the run. Anchoring to `Date.now()` made this suite flaky — once an
// earlier test pushed block time past a wall-clock-relative "3 years from now",
// the name read as expired and getSubdomainPrice returned 0. Reading the live
// block timestamp makes these tests order-independent.
//   만료 타임스탬프를 벽시계(`Date.now()`)가 아니라 현재 블록 타임 기준으로
//   계산한다. 다른 테스트가 Hardhat 블록 타임을 앞으로 점프시키고 그 시간은
//   실행 전체에 누적되므로, `Date.now()` 기준은 깨지기 쉬웠다. 라이브 블록
//   타임을 읽으면 실행 순서에 독립적이 된다.

const YEAR = BigInt(365 * 24 * 60 * 60);

async function blockNow(publicClient: any): Promise<bigint> {
  const block = await publicClient.getBlock();
  return BigInt(block.timestamp);
}

describe("SubdomainManager", function () {
  it("deploys successfully", async function () {
    const { viem } = await network.getOrCreate();
    const registryMock = await viem.deployContract("MockDXRegistry");
    const registrarMock = await viem.deployContract("MockDXRegistrar");
    const subdomain = await viem.deployContract("SubdomainManager", [
      registryMock.address,
      registrarMock.address,
    ]);
    expect(subdomain.address).to.not.be.undefined;
  });

  it("creates a subdomain with valid inputs", async function () {
    const { viem } = await network.getOrCreate();
    const [owner] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    const registryMock = await viem.deployContract("MockDXRegistry");
    const registrarMock = await viem.deployContract("MockDXRegistrar");
    const subdomain = await viem.deployContract("SubdomainManager", [
      registryMock.address,
      registrarMock.address,
    ]);

    const parentNode = "0x" + "1".repeat(64);
    const label = "alice";
    const oneEther = BigInt("1000000000000000000");
    const duration = BigInt(365 * 24 * 60 * 60);

    await registryMock.write.setOwner([parentNode, owner.account.address], {
      account: owner.account,
    });

    const now = await blockNow(publicClient);
    const expiresIn10Years = now + 10n * YEAR;
    await registrarMock.write.setExpires([parentNode, expiresIn10Years], {
      account: owner.account,
    });

    const tx = await subdomain.write.createSubdomain(
      [parentNode, label, owner.account.address, duration],
      { account: owner.account, value: oneEther }
    );

    expect(tx).to.not.be.undefined;
  });

  it("returns correct dynamic pricing", async function () {
    const { viem } = await network.getOrCreate();
    const [owner] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    const registryMock = await viem.deployContract("MockDXRegistry");
    const registrarMock = await viem.deployContract("MockDXRegistrar");
    const subdomain = await viem.deployContract("SubdomainManager", [
      registryMock.address,
      registrarMock.address,
    ]);

    const parentNode = "0x" + "1".repeat(64);

    // >= 5 years = 1 ETH
    let now = await blockNow(publicClient);
    await registrarMock.write.setExpires([parentNode, now + 10n * YEAR], {
      account: owner.account,
    });
    let price = await subdomain.read.getSubdomainPrice([parentNode]);
    expect(price).to.equal(BigInt("1000000000000000000"));

    // 2-5 years = 2 ETH
    now = await blockNow(publicClient);
    await registrarMock.write.setExpires([parentNode, now + 3n * YEAR], {
      account: owner.account,
    });
    price = await subdomain.read.getSubdomainPrice([parentNode]);
    expect(price).to.equal(BigInt("2000000000000000000"));

    // < 2 years = 3 ETH
    now = await blockNow(publicClient);
    await registrarMock.write.setExpires([parentNode, now + 1n * YEAR], {
      account: owner.account,
    });
    price = await subdomain.read.getSubdomainPrice([parentNode]);
    expect(price).to.equal(BigInt("3000000000000000000"));
  });
});