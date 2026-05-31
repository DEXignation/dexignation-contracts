// SPDX-License-Identifier: MIT
//
// roy.dex 1년 등록 (Polygon 메인넷 v2, POL 결제).
//   커밋 → 대기 → 등록 → setAddr 자동 설정 → tokenURI 확인.
//
// 실행: npx hardhat run scripts/register-roy.ts --network polygon
//
// 개인키는 .env 의 DEPLOYER_PRIVATE_KEY 사용 (배포에 쓴 그 키).
// 실제 POL 이 소비됩니다. 등록비 + 가스.

import { network } from "hardhat";
import {
  keccak256, toBytes, encodePacked, encodeAbiParameters,
  parseAbiParameters, formatEther,
} from "viem";

// ── Polygon 메인넷 v2 배포 주소 (polygon-v2-clean) ────────────────────────
const ADDR = {
  registrar:  "0x1DaDBb206a05b2821935c467015C77fD61e02951",
  resolver:   "0xb8b44561A52cf2929D3E6BF02d3B18a9e20CdE82",
  controller: "0xd456dC842B6c05084a0e884b7247F9ee90472432",
} as const;

const LABEL = "roy";              // ← roy.dex
const TLD = "dex";
const DURATION = 3n * 365n * 24n * 60n * 60n;  // 3년 (mud 등급)
const ZERO = "0x0000000000000000000000000000000000000000" as const;

// 등록 시 컨트롤러가 COIN_TYPE_POLYGON 으로 주소를 자동 설정하므로,
// 검증·재설정도 같은 coinType 을 쓴다 (검증 스크립트와 일치).
const COIN_TYPE_POLYGON = (1n << 31n) | 137n;

// 커밋-리빌 secret. 32바이트, 본인만 알면 됨.
const SECRET = ("0x" + "de".repeat(32)) as `0x${string}`;

function sleep(ms: number){ return new Promise((r)=>setTimeout(r, ms)); }
// 검증 스크립트와 동일한 namehash 계산 (encodePacked 사용).
function namehashTld(l: string): `0x${string}` {
  const lh = keccak256(toBytes(l));
  return keccak256(encodePacked(["bytes32","bytes32"],
    ["0x0000000000000000000000000000000000000000000000000000000000000000", lh]));
}
function subnode(parent: `0x${string}`, l: string): `0x${string}` {
  return keccak256(encodePacked(["bytes32","bytes32"],[parent, keccak256(toBytes(l))]));
}

async function main(){
  const { viem } = await network.connect();
  const pub = await viem.getPublicClient();
  const [wallet] = await viem.getWalletClients();
  const me = wallet.account.address;

  console.log("════════════════════════════════════════════");
  console.log(" roy.dex 등록 (Polygon 메인넷 v2)");
  console.log("════════════════════════════════════════════");
  console.log("계정:", me);
  console.log("POL 잔액:", formatEther(await pub.getBalance({address:me})), "POL\n");

  const controller = await viem.getContractAt("DXRegistrarController", ADDR.controller);
  const registrar  = await viem.getContractAt("DXRegistrar", ADDR.registrar);
  const resolver   = await viem.getContractAt("DXResolver", ADDR.resolver);

  // ── v2 와이어링 확인 (전송 무효화가 작동하려면 필수) ──
  console.log("── v2 와이어링 확인 ──");
  try {
    const rr = await (registrar.read as any).recordResolver();
    const rg = await (resolver.read as any).registrar();
    console.log("  registrar.recordResolver →", rr,
      (rr as string).toLowerCase()===ADDR.resolver.toLowerCase() ? "✅" : "❌");
    console.log("  resolver.registrar       →", rg,
      (rg as string).toLowerCase()===ADDR.registrar.toLowerCase() ? "✅" : "❌");
  } catch(e:any){ console.log("  (확인 실패)", e?.shortMessage||e?.message); }
  console.log("");

  // 0. 사용 가능 여부 + 가격
  console.log("── 사전 확인 ──");
  const available = await controller.read.available([LABEL]);
  console.log(`  ${LABEL}.${TLD} 등록 가능:`, available ? "✅" : "❌ (이미 등록됨)");
  if (!available) { console.log("  이미 등록된 이름입니다. 중단."); return; }

  const price = (await controller.read.rentPrice([DURATION])) as bigint;
  console.log("  3년 등록비:", formatEther(price), "POL\n");

  // 1. 커밋
  console.log("── 1. 커밋 ──");
  const commitment = keccak256(encodeAbiParameters(
    parseAbiParameters("string, address, uint256, address, address, bytes32"),
    [LABEL, me, DURATION, ADDR.resolver, ZERO, SECRET],
  ));
  const commitTx = await controller.write.commit([commitment]);
  await pub.waitForTransactionReceipt({ hash: commitTx });
  console.log("  커밋 완료:", commitTx);

  // 2. 대기
  let waitSec = 70;
  try { waitSec = Number(await controller.read.minCommitmentAge()) + 15; } catch {}
  console.log(`  ${waitSec}초 대기 (선점 방어 윈도우)...`);
  await sleep(waitSec * 1000);

  // 3. 등록 (POL 결제, +2% 버퍼 — 초과분 환불)
  console.log("\n── 2. 등록 ──");
  const value = price + price / 50n;
  console.log("  결제 전송:", formatEther(value), "POL (과오납 환불됨)...");
  const regTx = await controller.write.register(
    [LABEL, me, DURATION, ADDR.resolver, SECRET], { value },
  );
  await pub.waitForTransactionReceipt({ hash: regTx });
  console.log("  ✅ 등록 완료:", regTx);

  // 4. 주소 자동설정 확인 (등록 시 컨트롤러가 POLYGON coinType 자동 설정)
  console.log("\n── 3. 주소 해석 확인 ──");
  const node = subnode(namehashTld(TLD), LABEL);
  const resolved = await (resolver.read as any).addr([node, COIN_TYPE_POLYGON]);
  console.log("  addr(roy.dex, POLYGON) →", resolved,
    (resolved as string).toLowerCase()===me.toLowerCase() ? "✅ 자동설정됨" : "(미설정)");

  // 5. NFT 확인
  console.log("\n── 4. NFT 확인 ──");
  const tokenId = BigInt(keccak256(toBytes(LABEL)));
  console.log("  tokenId:", tokenId.toString());
  try {
    const uri = (await registrar.read.tokenURI([tokenId])) as string;
    const json = Buffer.from(uri.replace("data:application/json;base64,",""),"base64").toString("utf8");
    const tierM = json.match(/"Tier","value":"([^"]+)"/);
    console.log("  등급:", tierM ? tierM[1] : "(파싱)", "(3년 → Mud)");
  } catch(e:any){ console.log("  tokenURI:", e?.shortMessage||e?.message); }

  console.log("\n════════════════════════════════════════════");
  console.log(" 🎉 roy.dex 등록 완료!");
  console.log("  OpenSea: https://opensea.io/assets/matic/" + ADDR.registrar + "/" + tokenId.toString());
  console.log("  PolygonScan: https://polygonscan.com/token/" + ADDR.registrar + "?a=" + tokenId.toString());
  console.log("════════════════════════════════════════════");
}
main().catch((e)=>{ console.error(e); process.exitCode=1; });