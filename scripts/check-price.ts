import { network } from "hardhat";

const CONTROLLER = "0xD96Eb120BdD051a10E4AdF57EbA3d5a7dFA774F7";
const ORACLE = "0xCA91dCe37d5C49c3d2257006A6D5C7d64450c568";
const ONE_YEAR = 365n * 24n * 60n * 60n;

async function main() {
  const { viem } = await network.connect();
  const controller = await viem.getContractAt("DXRegistrarController", CONTROLLER);

  for (const [label, dur] of [["1년", ONE_YEAR], ["3년", 3n*ONE_YEAR], ["5년", 5n*ONE_YEAR]] as const) {
    try {
      const wei = await controller.read.rentPrice([dur]);
      console.log(`  ${label}: ${wei} wei  (~${Number(wei)/1e18} POL)`);
    } catch (e) {
      console.log(`  ${label}: ❌ revert — ${(e as Error).message.split("\n")[0]}`);
    }
  }

  try {
    const oracle = await viem.getContractAt("DXPriceOracle", ORACLE);
    const atto = await oracle.read.priceAttoUSD([ONE_YEAR]);
    console.log(`  priceAttoUSD(1년): ${atto} (~$${Number(atto)/1e18})`);
  } catch (e) {
    console.log(`  oracle ❌ ${(e as Error).message.split("\n")[0]}`);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });