import { expect } from "chai";
import { network } from "hardhat";

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

    const expiresIn10Years = BigInt(Math.floor(Date.now() / 1000)) + BigInt(10 * 365 * 24 * 60 * 60);
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
    
    const registryMock = await viem.deployContract("MockDXRegistry");
    const registrarMock = await viem.deployContract("MockDXRegistrar");
    const subdomain = await viem.deployContract("SubdomainManager", [
      registryMock.address,
      registrarMock.address,
    ]);

    const parentNode = "0x" + "1".repeat(64);

    // >= 5 years = 1 ETH
    const expiresIn10Years = BigInt(Math.floor(Date.now() / 1000)) + BigInt(10 * 365 * 24 * 60 * 60);
    await registrarMock.write.setExpires([parentNode, expiresIn10Years], { account: owner.account });
    let price = await subdomain.read.getSubdomainPrice([parentNode]);
    expect(price).to.equal(BigInt("1000000000000000000"));

    // 2-5 years = 2 ETH
    const expiresIn3Years = BigInt(Math.floor(Date.now() / 1000)) + BigInt(3 * 365 * 24 * 60 * 60);
    await registrarMock.write.setExpires([parentNode, expiresIn3Years], { account: owner.account });
    price = await subdomain.read.getSubdomainPrice([parentNode]);
    expect(price).to.equal(BigInt("2000000000000000000"));

    // < 2 years = 3 ETH
    const expiresIn1Year = BigInt(Math.floor(Date.now() / 1000)) + BigInt(1 * 365 * 24 * 60 * 60);
    await registrarMock.write.setExpires([parentNode, expiresIn1Year], { account: owner.account });
    price = await subdomain.read.getSubdomainPrice([parentNode]);
    expect(price).to.equal(BigInt("3000000000000000000"));
  });
});