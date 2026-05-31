import { network } from "hardhat";
const ORACLE = "0x1B7c881daF3f6a673CBfc57E24715b17b15EFf01";
const YEAR = 365n*24n*60n*60n;
async function main(){
  const { viem } = await network.connect();
  const o = await viem.getContractAt("DXPriceOracle", ORACLE);
  // 1) USD 가격(피드 없이) 먼저 — 함수명은 ABI에 맞게
  for (const fn of ["price","rentPrice","priceInUsd","price1Year"]) {
    try { console.log(fn, "→", await (o.read as any)[fn]([YEAR])); }
    catch(e:any){ console.log(fn, "❌", e?.shortMessage||e?.message); }
  }
  // 2) Chainlink 피드 주소·최신 응답 확인
  for (const fn of ["polUsdOracle","polUsdFeed","priceFeed"]) {
    try { console.log(fn, "→", await (o.read as any)[fn]()); }
    catch(e:any){ console.log(fn, "❌"); }
  }
}
main().catch(console.error);