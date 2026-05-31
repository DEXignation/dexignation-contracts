// SPDX-License-Identifier: MIT
//
// Amoy 스모크 테스트 (Mock 피드 사용판).
//   죽은 Chainlink Amoy POL/USD 피드를, 레포의 MockPriceOracle로 교체한 뒤
//   가격 환산 → 등록 → NFT → 해석 → 텍스트 레코드 전체 흐름을 검증한다.
//
//   교체하는 것은 "외부 가격 피드" 하나뿐. 나머지(환산 로직·등록·NFT·해석)는
//   전부 진짜 프로덕션 코드 그대로 검증된다. 메인넷에선 이 자리에 진짜
//   Chainlink 피드(0xAB594600...)가 들어간다.
//
// 실행: npx hardhat run scripts/smoke-amoy-mockfeed.ts --network amoy
// 주의: priceOracle / controller 의 owner 가 실행 계정이어야 setPolUsdOracle 가능.

import { network } from "hardhat";
import {
  keccak256, toBytes, encodeAbiParameters, parseAbiParameters, formatEther,
} from "viem";

const ADDR = {
  priceOracle: "0x1B7c881daF3f6a673CBfc57E24715b17b15EFf01",
  registrar:   "0x38B5a089708d134860bbB00d78E0411B8FdDC9Bd",
  resolver:    "0xd0Fc463c4bAc1B8690Dc468242e79183Ec9D93EA",
  controller:  "0x7b68C1755469E9F5C485D7EA83f8B00a7EB4E4bE",
} as const;

const TLD = "dex";
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const YEAR = 365n * 24n * 60n * 60n;
const LABEL = "smoke" + Math.floor(Date.now() / 1000).toString().slice(-6);

// Mock POL/USD: $0.40, 8 decimals (= 40_000_000). 로컬 배포 모듈과 동일값.
const MOCK_DECIMALS = 8;
const MOCK_POL_USD = 40_000_000n;

function sleep(ms: number){ return new Promise((r)=>setTimeout(r, ms)); }
function namehashTld(label: string): `0x${string}` {
  const lh = keccak256(toBytes(label));
  return keccak256(("0x" + "00".repeat(32) + lh.slice(2)) as `0x${string}`);
}
function subnode(parent: `0x${string}`, label: string): `0x${string}` {
  const lh = keccak256(toBytes(label));
  return keccak256((parent + lh.slice(2)) as `0x${string}`);
}

async function main(){
  const { viem } = await network.connect();
  const pub = await viem.getPublicClient();
  const [wallet] = await viem.getWalletClients();
  const me = wallet.account.address;

  console.log("════════════════════════════════════════════");
  console.log(" DEXignation — Amoy 스모크 (Mock 피드)");
  console.log("════════════════════════════════════════════");
  console.log("계정:", me);
  console.log("POL 잔액:", formatEther(await pub.getBalance({address:me})), "POL");
  console.log("라벨:", LABEL + "." + TLD, "\n");

  const oracle     = await viem.getContractAt("DXPriceOracle", ADDR.priceOracle);
  const controller = await viem.getContractAt("DXRegistrarController", ADDR.controller);
  const registrar  = await viem.getContractAt("DXRegistrar", ADDR.registrar);
  const resolver   = await viem.getContractAt("DXResolver", ADDR.resolver);

  // ── 0. owner 확인 ───────────────────────────────────────────────────────
  console.log("── 0. 소유권 확인 ──");
  try {
    const oOwner = await oracle.read.owner();
    console.log("  오라클 owner:", oOwner);
    console.log("  내가 owner:", (oOwner as string).toLowerCase() === me.toLowerCase() ? "✅" : "❌ (피드 교체 불가)");
  } catch(e:any){ console.log("  owner 조회 실패:", e?.shortMessage||e?.message); }
  console.log("");

  // ── 1. Mock 피드 배포 ───────────────────────────────────────────────────
  console.log("── 1. Mock POL/USD 피드 배포 ──");
  const mock = await viem.deployContract("MockPriceOracle", [MOCK_DECIMALS, MOCK_POL_USD]);
  console.log("  배포됨:", mock.address, `($0.40, ${MOCK_DECIMALS} decimals)\n`);

  // ── 2. 오라클 피드 교체 ─────────────────────────────────────────────────
  console.log("── 2. setPolUsdOracle(mock) ──");
  const setTx = await oracle.write.setPolUsdOracle([mock.address]);
  await pub.waitForTransactionReceipt({ hash: setTx });
  console.log("  교체 완료:", setTx, "\n");

  // ── 3. 가격 조회 ────────────────────────────────────────────────────────
  console.log("── 3. 가격 조회 (POL 환산) ──");
  const durs: [string,bigint][] = [["1년",YEAR],["3년",3n*YEAR],["5년",5n*YEAR],["10년",10n*YEAR],["15년",15n*YEAR]];
  for (const [name,d] of durs) {
    try { console.log(`  ${name.padEnd(4)}: ${formatEther((await controller.read.rentPrice([d])) as bigint)} POL`); }
    catch(e:any){ console.log(`  ${name.padEnd(4)}: ❌ ${e?.shortMessage||e?.message}`); }
  }
  const price1y = (await controller.read.rentPrice([YEAR])) as bigint;
  console.log("  → 15년까지 가격 나오면 5-배열 오라클 + 환산 정상\n");

  // ── 4. 등록 ─────────────────────────────────────────────────────────────
  console.log("── 4. 등록 (commit → reveal) ──");
  const secret = ("0x" + "ab".repeat(32)) as `0x${string}`;
  const commitment = keccak256(encodeAbiParameters(
    parseAbiParameters("string, address, uint256, address, address, bytes32"),
    [LABEL, me, YEAR, ADDR.resolver, ZERO, secret],
  ));
  console.log("  커밋...");
  await pub.waitForTransactionReceipt({ hash: await controller.write.commit([commitment]) });
  let waitSec = 65;
  try { waitSec = Number(await controller.read.minCommitmentAge()) + 10; } catch {}
  console.log(`  ${waitSec}초 대기...`);
  await sleep(waitSec*1000);
  console.log("  등록 (결제", formatEther(price1y), "POL)...");
  await pub.waitForTransactionReceipt({ hash: await controller.write.register(
    [LABEL, me, YEAR, ADDR.resolver, secret], { value: price1y })});
  console.log("  ✅ 등록 완료\n");

  // ── 5. NFT tokenURI ─────────────────────────────────────────────────────
  console.log("── 5. NFT tokenURI (등급 카드) ──");
  const tokenId = BigInt(keccak256(toBytes(LABEL)));
  try {
    const uri = (await registrar.read.tokenURI([tokenId])) as string;
    const json = Buffer.from(uri.replace("data:application/json;base64,",""),"base64").toString("utf8");
    const m = json.match(/data:image\/svg\+xml;base64,([^"]+)/);
    const svg = m ? Buffer.from(m[1],"base64").toString("utf8") : "";
    const tierM = json.match(/"Tier","value":"([^"]+)"/);
    console.log("  등급:", tierM?tierM[1]:"(파싱실패)", "(1년 → Charcoal 기대)");
    console.log("  Charcoal(#888f93):", svg.includes("#888f93")?"✅":"❌");
    console.log("  라벨 포함:", svg.includes(LABEL)?"✅":"❌");
    console.log("  육각형:", svg.includes("<polygon")?"✅":"❌");
  } catch(e:any){ console.log("  ❌ tokenURI:", e?.shortMessage||e?.message); }
  console.log("");

  // ── 6. 정방향 해석 ──────────────────────────────────────────────────────
  console.log("── 6. addr(node) 해석 ──");
  const node = subnode(namehashTld(TLD), LABEL);
  try {
    const r = (await resolver.read.addr([node])) as string;
    console.log("  해석:", r, r.toLowerCase()===me.toLowerCase()?"✅":"❌(resolver 미설정일 수 있음)");
  } catch(e:any){ console.log("  ❌ addr:", e?.shortMessage||e?.message); }
  console.log("");

  // ── 7. 텍스트 레코드 ────────────────────────────────────────────────────
  console.log("── 7. 텍스트 레코드 ──");
  try {
    await pub.waitForTransactionReceipt({ hash: await resolver.write.setText([node,"url","https://dexignation.example"])});
    const v = (await resolver.read.text([node,"url"])) as string;
    console.log("  url:", v, v==="https://dexignation.example"?"✅":"❌");
  } catch(e:any){ console.log("  ❌ text:", e?.shortMessage||e?.message); }

  console.log("\n════════════════════════════════════════════");
  console.log(" 스모크 종료");
  console.log("  Registrar:", "https://amoy.polygonscan.com/address/"+ADDR.registrar);
  console.log("════════════════════════════════════════════");
}
main().catch((e)=>{ console.error(e); process.exitCode=1; });