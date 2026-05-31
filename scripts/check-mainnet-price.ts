import { network } from "hardhat";
import { formatEther } from "viem";
const CONTROLLER = "0xd456dC842B6c05084a0e884b7247F9ee90472432";
const YEAR = 365n*24n*60n*60n;
async function main(){
  const { viem } = await network.connect();
  const c = await viem.getContractAt("DXRegistrarController", CONTROLLER);
  console.log("메인넷 가격 조회 (실제 Chainlink POL/USD 환산):");
  for (const [n,d] of [["1년",YEAR],["3년",3n*YEAR],["5년",5n*YEAR],["10년",10n*YEAR],["15년",15n*YEAR]] as [string,bigint][]) {
    try { console.log(`  ${n.padEnd(4)}: ${formatEther((await c.read.rentPrice([d])) as bigint)} POL`); }
    catch(e:any){ console.log(`  ${n.padEnd(4)}: ❌ ${e?.shortMessage||e?.message}`); }
  }
}
main().catch(console.error);