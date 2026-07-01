// SPDX-License-Identifier: MIT

import { expect } from "chai";
import { network } from "hardhat";
import { getAddress, parseEventLogs, type Abi, type PublicClient } from "viem";
import DXDeployLocal from "../ignition/modules/DXDeployLocal.js";

const RENT_PRICES = [
  50n * 10n ** 18n,
  135n * 10n ** 18n,
  200n * 10n ** 18n,
  350n * 10n ** 18n,
  500n * 10n ** 18n,
];

async function parsedEvents(publicClient: PublicClient, hash: `0x${string}`, abi: Abi) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return parseEventLogs({ abi, logs: receipt.logs, strict: false });
}

describe("Owner config events", function () {
  it("emits before/after events for registrar controller config changes", async function () {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const publicClient = await viem.getPublicClient();

    const allowHash = await deployed.controller.write.setAllowedPaymentToken([
      deployed.mockUsdc.address,
      false,
    ]);
    const allowEvents = await parsedEvents(publicClient, allowHash, deployed.controller.abi);
    const allowEvent = allowEvents.find(
      (event) => event.eventName === "AllowedPaymentTokenUpdated",
    );

    expect(allowEvent?.args).to.deep.equal({
      token: deployed.mockUsdc.address,
      previousAllowed: true,
      newAllowed: false,
    });

    const ageHash = await deployed.controller.write.setCommitmentAgeSettings([
      45n,
      12n * 60n * 60n,
    ]);
    const ageEvents = await parsedEvents(publicClient, ageHash, deployed.controller.abi);
    const ageEvent = ageEvents.find((event) => event.eventName === "CommitmentAgeSettingsUpdated");

    expect(ageEvent?.args).to.deep.equal({
      previousMinAge: 30n,
      previousMaxAge: 60n * 60n,
      newMinAge: 45n,
      newMaxAge: 12n * 60n * 60n,
    });
  });

  it("emits before/after events for price oracle config changes", async function () {
    const { viem } = await network.getOrCreate();
    const [owner] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    const oracle = await viem.deployContract("DXPriceOracle", [RENT_PRICES, owner.account.address]);
    const polUsd = await viem.deployContract("MockPriceOracle", [8, 100_000_000n]);
    const linkPol = await viem.deployContract("MockPriceOracle", [18, 15n * 10n ** 18n]);
    const linkUsd = await viem.deployContract("MockPriceOracle", [8, 1_500_000_000n]);

    const directHash = await oracle.write.setPolUsdOracle([polUsd.address]);
    const directEvents = await parsedEvents(publicClient, directHash, oracle.abi);
    expect(
      directEvents.find((event) => event.eventName === "PolUsdOracleUpdated")?.args,
    ).to.deep.equal({
      previousOracle: "0x0000000000000000000000000000000000000000",
      newOracle: getAddress(polUsd.address),
    });
    expect(
      directEvents.find((event) => event.eventName === "PriceSourceUpdated")?.args,
    ).to.deep.equal({ previousSource: 0, newSource: 0 });

    const linkHash = await oracle.write.setLinkPolOracle([linkPol.address, linkUsd.address]);
    const linkEvents = await parsedEvents(publicClient, linkHash, oracle.abi);
    expect(
      linkEvents.find((event) => event.eventName === "LinkOraclesUpdated")?.args,
    ).to.deep.equal({
      previousLinkPolOracle: "0x0000000000000000000000000000000000000000",
      previousLinkUsdOracle: "0x0000000000000000000000000000000000000000",
      newLinkPolOracle: getAddress(linkPol.address),
      newLinkUsdOracle: getAddress(linkUsd.address),
    });
    expect(
      linkEvents.find((event) => event.eventName === "PriceSourceUpdated")?.args,
    ).to.deep.equal({ previousSource: 0, newSource: 1 });

    const sourceHash = await oracle.write.setPriceSource([0]);
    const sourceEvents = await parsedEvents(publicClient, sourceHash, oracle.abi);
    expect(
      sourceEvents.find((event) => event.eventName === "PriceSourceUpdated")?.args,
    ).to.deep.equal({ previousSource: 1, newSource: 0 });

    const delayHash = await oracle.write.setMaxoracleDelay([2n * 60n * 60n]);
    const delayEvents = await parsedEvents(publicClient, delayHash, oracle.abi);
    expect(
      delayEvents.find((event) => event.eventName === "MaxOracleDelayUpdated")?.args,
    ).to.deep.equal({
      previousDelay: 26n * 60n * 60n,
      newDelay: 2n * 60n * 60n,
    });
  });
});
