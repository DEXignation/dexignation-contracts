// SPDX-License-Identifier: MIT
//
// Amoy 테스트넷 스모크 테스트 — 실제 배포된 컨트랙트가 작동하는지 확인.
//   1) 가격 조회 (1/3/5/10/15년, 특히 15년=55USD)
//   2) 커밋 → 대기 → 등록 (실제 트랜잭션)
//   3) tokenURI → 등급 색·이름 확인
//   4) 정방향 해석 (이름 → 주소)
//   5) 텍스트 레코드 set/get
//
// 실행: npx hardhat run scripts/smoke-amoy.ts --network amoy
//
// 주의: register는 commit-reveal이라 두 트랜잭션 사이에 실제 대기(minCommitmentAge)가
//       있다. Amoy 블록타임(~2초) 기준 자동 대기한다. POL 잔액이 충분해야 한다.

import { network } from "hardhat";
import {
  keccak256,
  toBytes,
  encodeAbiParameters,
  parseAbiParameters,
  formatEther,
} from "viem";

// ── 배포된 컨트랙트 주소 (Amoy, 2026 배포) ────────────────────────────────
const ADDR = {
  priceOracle:  "0x1B7c881daF3f6a673CBfc57E24715b17b15EFf01",
  registry:     "0xd456dC842B6c05084a0e884b7247F9ee90472432",
  reservations: "0xb6b165eB79E1Acf54eE8acFAf5FCC77241D6Fef0",
  testUsdc:     "0xc4fCB2e6783dDA5f6CbcD848B272795B53F97Bf0",
  testUsdt:     "0x9beD11e8E8de095fb86F5ce3Fd07Ead3e36308C7",
  registrar:    "0x38B5a089708d134860bbB00d78E0411B8FdDC9Bd",
  resolver:     "0xd0Fc463c4bAc1B8690Dc468242e79183Ec9D93EA",
  controller:   "0x7b68C1755469E9F5C485D7EA83f8B00a7EB4E4bE",
  reverse:      "0xF6e39b7f0335f315582a77fbe124652f655Ae4F1",
} as const;

const TLD = "dex";
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const YEAR = 365n * 24n * 60n * 60n;

// 고유 라벨 (재실행 충돌 방지: 시간 기반 suffix)
const LABEL = "smoke" + Math.floor(Date.now() / 1000).toString().slice(-6);

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

function namehashTld(label: string): `0x${string}` {
  // node = keccak256(0x00..00 ++ keccak256(label))
  const labelHash = keccak256(toBytes(label));
  return keccak256(
    ("0x" + "00".repeat(32) + labelHash.slice(2)) as `0x${string}`,
  );
}
function subnode(parentNode: `0x${string}`, label: string): `0x${string}` {
  const labelHash = keccak256(toBytes(label));
  return keccak256((parentNode + labelHash.slice(2)) as `0x${string}`);
}

async function main() {
  const { viem } = await network.connect();
  const pub = await viem.getPublicClient();
  const [wallet] = await viem.getWalletClients();
  const me = wallet.account.address;

  console.log("════════════════════════════════════════════");
  console.log(" DEXignation — Amoy 스모크 테스트");
  console.log("════════════════════════════════════════════");
  console.log("계정:", me);
  const bal = await pub.getBalance({ address: me });
  console.log("POL 잔액:", formatEther(bal), "POL");
  console.log("테스트 라벨:", LABEL + "." + TLD);
  console.log("");

  const controller = await viem.getContractAt("DXRegistrarController", ADDR.controller);
  const registrar  = await viem.getContractAt("DXRegistrar", ADDR.registrar);
  const resolver   = await viem.getContractAt("DXResolver", ADDR.resolver);

  // ── 1. 가격 조회 ────────────────────────────────────────────────────────
  console.log("── 1. 가격 조회 (POL 환산) ──");
  const durs: [string, bigint][] = [
    ["1년", YEAR], ["3년", 3n*YEAR], ["5년", 5n*YEAR],
    ["10년", 10n*YEAR], ["15년", 15n*YEAR],
  ];
  for (const [name, d] of durs) {
    try {
      const price = await controller.read.rentPrice([d]);
      console.log(`  ${name.padEnd(4)} : ${formatEther(price as bigint)} POL`);
    } catch (e: any) {
      console.log(`  ${name.padEnd(4)} : ❌ 실패 — ${e?.shortMessage || e?.message}`);
    }
  }
  console.log("  → 15년이 가격 나오면 5-배열 오라클 정상\n");

  // 등록 비용 (1년)
  const price1y = (await controller.read.rentPrice([YEAR])) as bigint;

  // ── 2. 커밋 → 대기 → 등록 ───────────────────────────────────────────────
  console.log("── 2. 등록 (commit → reveal) ──");
  const secret = ("0x" + "ab".repeat(32)) as `0x${string}`;
  const commitment = keccak256(
    encodeAbiParameters(
      parseAbiParameters("string, address, uint256, address, address, bytes32"),
      [LABEL, me, YEAR, ADDR.resolver, ZERO, secret],
    ),
  );

  console.log("  커밋 전송...");
  const commitTx = await controller.write.commit([commitment]);
  await pub.waitForTransactionReceipt({ hash: commitTx });
  console.log("  커밋 완료:", commitTx);

  // minCommitmentAge 조회 후 그만큼 대기 (+여유 5초)
  let waitSec = 65;
  try {
    const minAge = await controller.read.minCommitmentAge();
    waitSec = Number(minAge) + 10;
  } catch { /* 함수명 다르면 기본 65초 */ }
  console.log(`  ${waitSec}초 대기 (minCommitmentAge)...`);
  await sleep(waitSec * 1000);

  console.log("  등록 전송 (결제:", formatEther(price1y), "POL)...");
  const regTx = await controller.write.register(
    [LABEL, me, YEAR, ADDR.resolver, secret],
    { value: price1y },
  );
  await pub.waitForTransactionReceipt({ hash: regTx });
  console.log("  ✅ 등록 완료:", regTx);
  console.log("");

  // ── 3. tokenURI → 등급 색·이름 ──────────────────────────────────────────
  console.log("── 3. NFT tokenURI (등급 카드) ──");
  const tldNode = namehashTld(TLD);
  const node = subnode(tldNode, LABEL);
  const tokenId = BigInt(keccak256(toBytes(LABEL)));
  try {
    const uri = (await registrar.read.tokenURI([tokenId])) as string;
    const jsonB64 = uri.replace("data:application/json;base64,", "");
    const json = Buffer.from(jsonB64, "base64").toString("utf8");
    const m = json.match(/data:image\/svg\+xml;base64,([^"]+)/);
    const svg = m ? Buffer.from(m[1], "base64").toString("utf8") : "";
    const tierM = json.match(/"Tier","value":"([^"]+)"/);
    console.log("  등급:", tierM ? tierM[1] : "(파싱 실패)");
    console.log("  1년 등록 → Charcoal(#888f93) 기대");
    console.log("  SVG에 #888f93 포함:", svg.includes("#888f93") ? "✅" : "❌");
    console.log("  SVG에 라벨 포함:", svg.includes(LABEL) ? "✅" : "❌");
    console.log("  SVG에 육각형(polygon):", svg.includes("<polygon") ? "✅" : "❌");
  } catch (e: any) {
    console.log("  ❌ tokenURI 실패:", e?.shortMessage || e?.message);
  }
  console.log("");

  // ── 4. 정방향 해석 (이름 → 주소) ────────────────────────────────────────
  console.log("── 4. 정방향 해석 addr(node) ──");
  try {
    const resolved = (await resolver.read.addr([node])) as string;
    console.log("  해석된 주소:", resolved);
    console.log("  내 주소와 일치:", resolved.toLowerCase() === me.toLowerCase() ? "✅" : "❌ (resolver 미설정일 수 있음)");
  } catch (e: any) {
    console.log("  ❌ addr 실패:", e?.shortMessage || e?.message);
  }
  console.log("");

  // ── 5. 텍스트 레코드 set/get ────────────────────────────────────────────
  console.log("── 5. 텍스트 레코드 ──");
  try {
    const setTx = await resolver.write.setText([node, "url", "https://dexignation.example"]);
    await pub.waitForTransactionReceipt({ hash: setTx });
    const val = (await resolver.read.text([node, "url"])) as string;
    console.log("  설정한 url:", val);
    console.log("  일치:", val === "https://dexignation.example" ? "✅" : "❌");
  } catch (e: any) {
    console.log("  ❌ 텍스트 레코드 실패:", e?.shortMessage || e?.message);
  }

  console.log("\n════════════════════════════════════════════");
  console.log(" 스모크 테스트 종료");
  console.log(" 익스플로러:");
  console.log("   https://amoy.polygonscan.com/address/" + ADDR.registrar);
  console.log("════════════════════════════════════════════");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });