// SPDX-License-Identifier: MIT
//
// DXContributionSBT tokenURI metadata regression tests.
// Ensures quote-heavy contribution text still produces valid JSON.

import { expect } from "chai";
import { network } from "hardhat";

function decodeTokenURI(uri: string): { json: any; svg: string } {
  const jsonB64 = uri.replace("data:application/json;base64,", "");
  const jsonText = Buffer.from(jsonB64, "base64").toString("utf8");
  const json = JSON.parse(jsonText);
  const imagePrefix = "data:image/svg+xml;base64,";
  expect(json.image).to.be.a("string");
  expect(json.image).to.match(/^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(
    json.image.slice(imagePrefix.length),
    "base64",
  ).toString("utf8");
  return { json, svg };
}

describe("DXContributionSBT tokenURI", function () {
  it("escapes JSON and SVG metacharacters in tokenURI metadata", async function () {
    const { viem } = await network.getOrCreate();
    const [owner, alice] = await viem.getWalletClients();
    const sbt = await viem.deployContract("DXContributionSBT", [owner.account.address]);

    const category = 'code", "trait_type":"evil <script>&\'';
    const description = 'Fixed "tokenURI" JSON\\SVG edge cases\nand tabs\ttoo';

    await sbt.write.award([alice.account.address, category, description], {
      account: owner.account,
    });

    const uri = await sbt.read.tokenURI([1n]);
    const { json, svg } = decodeTokenURI(uri);

    expect(json.name).to.equal("DEXignation Contributor #1");
    expect(json.description).to.equal(description);
    expect(json.attributes).to.deep.equal([
      { trait_type: "category", value: category },
    ]);
    expect(svg).to.not.include("<script>");
    expect(svg).to.include(
      "code&quot;, &quot;trait_type&quot;:&quot;evil &lt;script&gt;&amp;&apos;",
    );
  });
});
