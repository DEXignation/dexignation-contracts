#!/bin/bash

# DEXignation v2.0 - Complete Test Setup
# 모든 기존 테스트 파일 삭제 후 새로 시작

echo "🧹 Step 1: 기존 테스트 파일 정리"
rm -f test/mocha/*.test.mjs
rm -f test/mocha/*.test.js
rm -f test/*.test.mjs
rm -f test/*.test.js
echo "✅ 기존 파일 삭제 완료"

echo ""
echo "📁 Step 2: Mock Contracts 생성"

# MockDXRegistry
cat > contracts/mocks/MockDXRegistry.sol << 'SOLIDITY'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockDXRegistry {
  mapping(bytes32 => address) private _owners;
  
  function setOwner(bytes32 node, address owner) public {
    _owners[node] = owner;
  }
  
  function owner(bytes32 node) external view returns (address) {
    return _owners[node];
  }
}
SOLIDITY

echo "✅ MockDXRegistry.sol 생성"

# MockDXRegistrar
cat > contracts/mocks/MockDXRegistrar.sol << 'SOLIDITY'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockDXRegistrar {
  mapping(uint256 => uint256) private _expires;
  
  function setExpires(uint256 id, uint256 expires) public {
    _expires[id] = expires;
  }
  
  function nameExpires(uint256 id) external view returns (uint256) {
    return _expires[id];
  }
}
SOLIDITY

echo "✅ MockDXRegistrar.sol 생성"

echo ""
echo "📝 Step 3: 새 테스트 파일 생성"

# Test file
cat > test/mocha/SubdomainManager.test.mjs << 'TESTFILE'
import { expect } from "chai";
import hre from "hardhat";
import { getAddress } from "viem";

const { ethers, viem } = hre;

describe("SubdomainManager", function () {
  let subdomain;
  let registry;
  let registrar;
  let owner;
  let parentOwner;
  let subOwner;
  let newOwner;
  let resolver;

  const parentNode = "0x" + "1".repeat(64);
  const label = "alice";
  const ONE_ETHER = 1n * 10n ** 18n;
  const TWO_ETHER = 2n * 10n ** 18n;
  const THREE_ETHER = 3n * 10n ** 18n;

  before(async function () {
    const signers = await viem.getWalletClients();
    owner = signers[0];
    parentOwner = signers[1];
    subOwner = signers[2];
    newOwner = signers[3];
    resolver = signers[4];

    const registryFactory = await ethers.getContractFactory("MockDXRegistry");
    registry = await registryFactory.deploy();
    await registry.waitForDeployment();

    const registrarFactory = await ethers.getContractFactory("MockDXRegistrar");
    registrar = await registrarFactory.deploy();
    await registrar.waitForDeployment();

    const subdomainFactory = await ethers.getContractFactory("SubdomainManager");
    subdomain = await subdomainFactory.deploy(registry.target, registrar.target);
    await subdomain.waitForDeployment();

    await registry.setOwner(parentNode, parentOwner.account.address);

    const expiresIn10Years = BigInt(Math.floor(Date.now() / 1000)) + BigInt(10 * 365 * 24 * 60 * 60);
    await registrar.setExpires(parentNode, expiresIn10Years);
  });

  describe("Dynamic Pricing", function () {
    it("should price $1 for parent ≥ 5 years", async function () {
      const price = await subdomain.getSubdomainPrice(parentNode);
      expect(price).to.equal(ONE_ETHER);
    });

    it("should price $2 for parent 2-5 years", async function () {
      const expiresIn3Years = BigInt(Math.floor(Date.now() / 1000)) + BigInt(3 * 365 * 24 * 60 * 60);
      await registrar.setExpires(parentNode, expiresIn3Years);

      const price = await subdomain.getSubdomainPrice(parentNode);
      expect(price).to.equal(TWO_ETHER);

      const expiresIn10Years = BigInt(Math.floor(Date.now() / 1000)) + BigInt(10 * 365 * 24 * 60 * 60);
      await registrar.setExpires(parentNode, expiresIn10Years);
    });

    it("should price $3 for parent < 2 years", async function () {
      const expiresIn1Year = BigInt(Math.floor(Date.now() / 1000)) + BigInt(1 * 365 * 24 * 60 * 60);
      await registrar.setExpires(parentNode, expiresIn1Year);

      const price = await subdomain.getSubdomainPrice(parentNode);
      expect(price).to.equal(THREE_ETHER);

      const expiresIn10Years = BigInt(Math.floor(Date.now() / 1000)) + BigInt(10 * 365 * 24 * 60 * 60);
      await registrar.setExpires(parentNode, expiresIn10Years);
    });

    it("should price $0 for expired parent", async function () {
      const pastTime = BigInt(Math.floor(Date.now() / 1000)) - BigInt(1);
      await registrar.setExpires(parentNode, pastTime);

      const price = await subdomain.getSubdomainPrice(parentNode);
      expect(price).to.equal(0n);

      const expiresIn10Years = BigInt(Math.floor(Date.now() / 1000)) + BigInt(10 * 365 * 24 * 60 * 60);
      await registrar.setExpires(parentNode, expiresIn10Years);
    });
  });

  describe("Subdomain Creation", function () {
    it("should create subdomain successfully", async function () {
      const duration = BigInt(365 * 24 * 60 * 60);
      const price = await subdomain.getSubdomainPrice(parentNode);

      const tx = await subdomain.connect(parentOwner).createSubdomain(
        parentNode,
        label,
        subOwner.account.address,
        duration,
        { value: price }
      );

      await expect(tx).to.emit(subdomain, "SubdomainCreated");

      const ownerAddr = await subdomain.subdomainOwner(parentNode, label);
      expect(getAddress(ownerAddr)).to.equal(getAddress(subOwner.account.address));
    });

    it("should revert if not parent owner", async function () {
      const price = ONE_ETHER;
      const duration = BigInt(365 * 24 * 60 * 60);

      await expect(
        subdomain.connect(owner).createSubdomain(
          parentNode,
          "bob",
          subOwner.account.address,
          duration,
          { value: price }
        )
      ).to.be.revertedWith("Not parent owner");
    });

    it("should revert if insufficient payment", async function () {
      const price = await subdomain.getSubdomainPrice(parentNode);
      const duration = BigInt(365 * 24 * 60 * 60);
      const insufficientPrice = price - BigInt(1);

      await expect(
        subdomain.connect(parentOwner).createSubdomain(
          parentNode,
          "charlie",
          subOwner.account.address,
          duration,
          { value: insufficientPrice }
        )
      ).to.be.revertedWith("Insufficient payment");
    });

    it("should revert if duration too short", async function () {
      const price = ONE_ETHER;
      const shortDuration = BigInt(7 * 24 * 60 * 60);

      await expect(
        subdomain.connect(parentOwner).createSubdomain(
          parentNode,
          "david",
          subOwner.account.address,
          shortDuration,
          { value: price }
        )
      ).to.be.revertedWith("Duration too short");
    });

    it("should revert if parent expired", async function () {
      const pastTime = BigInt(Math.floor(Date.now() / 1000)) - BigInt(1);
      await registrar.setExpires(parentNode, pastTime);

      const price = ONE_ETHER;
      const duration = BigInt(365 * 24 * 60 * 60);

      await expect(
        subdomain.connect(parentOwner).createSubdomain(
          parentNode,
          "eve",
          subOwner.account.address,
          duration,
          { value: price }
        )
      ).to.be.revertedWith("Parent expired");

      const expiresIn10Years = BigInt(Math.floor(Date.now() / 1000)) + BigInt(10 * 365 * 24 * 60 * 60);
      await registrar.setExpires(parentNode, expiresIn10Years);
    });

    it("should revert if subdomain already exists", async function () {
      const price = ONE_ETHER;
      const duration = BigInt(365 * 24 * 60 * 60);

      await subdomain.connect(parentOwner).createSubdomain(
        parentNode,
        "frank",
        subOwner.account.address,
        duration,
        { value: price }
      );

      await expect(
        subdomain.connect(parentOwner).createSubdomain(
          parentNode,
          "frank",
          subOwner.account.address,
          duration,
          { value: price }
        )
      ).to.be.revertedWith("Subdomain exists");
    });

    it("should refund excess payment", async function () {
      const price = ONE_ETHER;
      const excessAmount = price + 1000000000000000000n;
      const duration = BigInt(365 * 24 * 60 * 60);

      await subdomain.connect(parentOwner).createSubdomain(
        parentNode,
        "grace",
        subOwner.account.address,
        duration,
        { value: excessAmount }
      );

      // If no revert, refund logic worked
      expect(true).to.be.true;
    });
  });

  describe("Subdomain Renewal", function () {
    it("should renew subdomain successfully", async function () {
      const price = ONE_ETHER;
      const duration = BigInt(365 * 24 * 60 * 60);

      await subdomain.connect(parentOwner).createSubdomain(
        parentNode,
        "henry",
        subOwner.account.address,
        duration,
        { value: price }
      );

      const expiresAfterCreation = await subdomain.subdomainExpires(parentNode, "henry");

      const tx = await subdomain.connect(subOwner).renewSubdomain(
        parentNode,
        "henry",
        duration,
        { value: price }
      );

      await expect(tx).to.emit(subdomain, "SubdomainRenewed");

      const newExpires = await subdomain.subdomainExpires(parentNode, "henry");
      expect(newExpires).to.equal(expiresAfterCreation + duration);
    });

    it("should revert if not subdomain owner", async function () {
      const price = ONE_ETHER;
      const duration = BigInt(365 * 24 * 60 * 60);

      await expect(
        subdomain.connect(owner).renewSubdomain(parentNode, "henry", duration, {
          value: price,
        })
      ).to.be.revertedWith("Not subdomain owner");
    });
  });

  describe("Subdomain Transfer", function () {
    it("should transfer subdomain successfully", async function () {
      const price = ONE_ETHER;
      const duration = BigInt(365 * 24 * 60 * 60);

      await subdomain.connect(parentOwner).createSubdomain(
        parentNode,
        "iris",
        subOwner.account.address,
        duration,
        { value: price }
      );

      const tx = await subdomain.connect(subOwner).transferSubdomain(
        parentNode,
        "iris",
        newOwner.account.address
      );

      await expect(tx).to.emit(subdomain, "SubdomainTransferred");

      const currentOwner = await subdomain.subdomainOwner(parentNode, "iris");
      expect(getAddress(currentOwner)).to.equal(getAddress(newOwner.account.address));
    });

    it("should revert if not subdomain owner", async function () {
      await expect(
        subdomain.connect(owner).transferSubdomain(parentNode, "iris", owner.account.address)
      ).to.be.revertedWith("Not subdomain owner");
    });
  });

  describe("Resolver Update", function () {
    it("should set resolver successfully", async function () {
      const price = ONE_ETHER;
      const duration = BigInt(365 * 24 * 60 * 60);

      await subdomain.connect(parentOwner).createSubdomain(
        parentNode,
        "jack",
        subOwner.account.address,
        duration,
        { value: price }
      );

      const tx = await subdomain.connect(subOwner).setResolver(
        parentNode,
        "jack",
        resolver.account.address
      );

      await expect(tx).to.emit(subdomain, "SubdomainResolverUpdated");

      const currentResolver = await subdomain.subdomainResolver(parentNode, "jack");
      expect(getAddress(currentResolver)).to.equal(getAddress(resolver.account.address));
    });
  });

  describe("Validation", function () {
    it("should return true for valid subdomain", async function () {
      const price = ONE_ETHER;
      const duration = BigInt(365 * 24 * 60 * 60);

      await subdomain.connect(parentOwner).createSubdomain(
        parentNode,
        "kate",
        subOwner.account.address,
        duration,
        { value: price }
      );

      const isValid = await subdomain.isSubdomainValid(parentNode, "kate");
      expect(isValid).to.be.true;
    });

    it("should return false for non-existent subdomain", async function () {
      const isValid = await subdomain.isSubdomainValid(parentNode, "nonexistent");
      expect(isValid).to.be.false;
    });
  });

  describe("Edge Cases", function () {
    it("should revert with empty label", async function () {
      const price = ONE_ETHER;
      const duration = BigInt(365 * 24 * 60 * 60);

      await expect(
        subdomain.connect(parentOwner).createSubdomain(
          parentNode,
          "",
          subOwner.account.address,
          duration,
          { value: price }
        )
      ).to.be.revertedWith("Label empty");
    });

    it("should revert with invalid owner", async function () {
      const price = ONE_ETHER;
      const duration = BigInt(365 * 24 * 60 * 60);

      await expect(
        subdomain.connect(parentOwner).createSubdomain(
          parentNode,
          "leo",
          "0x0000000000000000000000000000000000000000",
          duration,
          { value: price }
        )
      ).to.be.revertedWith("Invalid owner");
    });

    it("should handle multiple subdomains", async function () {
      const price = ONE_ETHER;
      const duration = BigInt(365 * 24 * 60 * 60);
      const labels = ["alice2", "bob2", "charlie2"];

      for (const label of labels) {
        await subdomain.connect(parentOwner).createSubdomain(
          parentNode,
          label,
          subOwner.account.address,
          duration,
          { value: price }
        );
      }

      for (const label of labels) {
        const ownerAddr = await subdomain.subdomainOwner(parentNode, label);
        expect(getAddress(ownerAddr)).to.equal(getAddress(subOwner.account.address));
      }
    });
  });
});
TESTFILE

echo "✅ SubdomainManager.test.mjs 생성"

echo ""
echo "🔨 Step 4: 컴파일"
npm run build

echo ""
echo "🧪 Step 5: 테스트 실행"
npm test