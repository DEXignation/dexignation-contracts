// SPDX-License-Identifier: MIT
//
// Amoy v2 전송 안전성 실네트워크 검증.
//   등록 → 레코드 설정 → 전송 → 무효화 확인 → 새 소유자 재설정 → 재개.
//
// 실행: npx hardhat run scripts/verify-transfer-amoy.ts --network amoy
//
// 두 개의 지갑이 필요합니다:
//   - DEPLOYER_PRIVATE_KEY (.env): 등록자(alice 역할), POL 보유 필요
//   - RECIPIENT_ADDRESS (.env 또는 아래 상수): 전송받을 주소(bob 역할)
//     ※ bob의 키는 필요 없음 — alice가 전송하고, 검증은 읽기로 함.
//        단 "새 소유자 setAddr 재개"는 bob 키가 있어야 실제 실행 가능하므로,
//        bob 키가 없으면 그 단계는 건너뛰고 무효화까지만 검증.

import { network } from "hardhat";
import {
  keccak256, toBytes, encodeAbiParameters, parseAbiParameters,
  encodePacked, formatEther,
} from "viem";

// ── Amoy v2 배포 주소 ──────────────────────────────────────────────────────
const ADDR = {
  registrar:  "0x6f4bf113A41EbB36e0A6E5D1Ca47832158D94955",
  resolver:   "0xD8Ae1697190C0d30EE9e892d26CEdA57e8dbd791",
  registry:   "0x274791B37ed8e81290792Ad0032fDEE18BfE7127",
  controller: "0x58Ca5cC49e7A196B0D4Dd4265d67914DAb943072",
  mockPolUsd: "0x16f3c1a0E397dc0E3fE52D86Ac64CCa2D37129f1",
} as const;

const LABEL = "xfertest" + Math.floor(Math.random() * 10000); // 매번 새 라벨
const TLD = "dex";
const DURATION = 365n * 24n * 60n * 60n;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const COIN_EVM = 60n;
const COIN_TYPE_POLYGON = (1n << 31n) | 137n;
const SECRET = ("0x" + "a7".repeat(32)) as `0x${string}`;

// 전송받을 주소 (bob). 본인의 두 번째 주소를 넣으세요.
const RECIPIENT = (process.env.RECIPIENT_ADDRESS ||
  "0x000000000000000000000000000000000000dEaD") as `0x${string}`;

function sleep(ms: number){ return new Promise((r)=>setTimeout(r, ms)); }
function namehashTld(l: string): `0x${string}` {
  const lh = keccak256(toBytes(l));
  return keccak256(("0x" + "00".repeat(32) + lh.slice(2)) as `0x${string}`);
}
function subnode(parent: `0x${string}`, l: string): `0x${string}` {
  return keccak256(encodePacked(["bytes32","bytes32"],[parent, keccak256(toBytes(l))]));
}

async function main(){
  const { viem } = await network.connect();
  const pub = await viem.getPublicClient();
  const [wallet] = await viem.getWalletClients();
  const me = wallet.account.address;
  const node = subnode(namehashTld(TLD), LABEL);
  const tokenId = BigInt(keccak256(toBytes(LABEL)));

  console.log("════════════════════════════════════════════════════");
  console.log(" Amoy v2 전송 안전성 검증");
  console.log("════════════════════════════════════════════════════");
  console.log("등록자(alice):", me);
  console.log("수령자(bob):  ", RECIPIENT);
  console.log("라벨:", LABEL + ".dex");
  console.log("POL 잔액:", formatEther(await pub.getBalance({address:me})), "\n");

  const controller = await viem.getContractAt("DXRegistrarController", ADDR.controller);
  const registrar  = await viem.getContractAt("DXRegistrar", ADDR.registrar);
  const resolver   = await viem.getContractAt("DXResolver", ADDR.resolver);
  const registry   = await viem.getContractAt("DXRegistry", ADDR.registry);

  // 0. mock 피드 갱신 (staleness 방지) + 가격조회
  console.log("── 0. mock 피드 갱신 + 가격조회 ──");
  try {
    const mockFeed = await viem.getContractAt("MockPriceOracle", ADDR.mockPolUsd);
    await pub.waitForTransactionReceipt({ hash: await mockFeed.write.updateAnswer([40000000n]) });
    console.log("  mock 피드 updatedAt 갱신 완료 ($0.40)");
  } catch (e:any) {
    console.log("  mock 피드 갱신 시도:", e?.shortMessage||e?.message);
  }
  let price: bigint;
  try {
    price = (await controller.read.rentPrice([DURATION])) as bigint;
    console.log("  1년 가격:", formatEther(price), "POL ✅ 피드 정상\n");
  } catch (e:any) {
    console.log("  ❌ 가격조회 실패 — Amoy Chainlink 피드가 죽어있을 수 있음:", e?.shortMessage||e?.message);
    console.log("  → MockPriceOracle 버전 배포 모듈이 필요합니다. 중단.");
    return;
  }

  // 1. 등록
  console.log("── 1. 등록 (alice) ──");
  const commitment = keccak256(encodeAbiParameters(
    parseAbiParameters("string, address, uint256, address, address, bytes32"),
    [LABEL, me, DURATION, ADDR.resolver, ZERO, SECRET],
  ));
  await pub.waitForTransactionReceipt({ hash: await controller.write.commit([commitment]) });
  console.log("  커밋 완료, 70초 대기...");
  await sleep(70000);
  await pub.waitForTransactionReceipt({ hash: await controller.write.register(
    [LABEL, me, DURATION, ADDR.resolver, SECRET], { value: price + price/50n },
  )});
  console.log("  ✅ 등록 완료");

  // 2. 레코드 설정 (alice가 여러 종류)
  console.log("\n── 2. 레코드 설정 (alice) ──");
  await pub.waitForTransactionReceipt({ hash: await resolver.write.setText([node, "email", "alice@dex.test"]) });
  console.log("  setText(email) 완료");
  const verBefore = await resolver.read.recordVersions([node]);
  const addrBefore = await (resolver.read as any).addr([node, COIN_TYPE_POLYGON]);
  const textBefore = await resolver.read.text([node, "email"]);
  console.log("  version:", verBefore.toString());
  console.log("  addr(POLYGON):", addrBefore, "(등록 시 자동설정 = alice)");
  console.log("  text(email):", textBefore);

  // 3. 전송 (alice → bob)
  console.log("\n── 3. 전송 (alice → bob) ──");
  if (RECIPIENT.toLowerCase() === "0x000000000000000000000000000000000000dead") {
    console.log("  ⚠️ RECIPIENT_ADDRESS 미설정 — 0xdead로 전송하면 복구 불가하므로 중단.");
    console.log("  .env에 RECIPIENT_ADDRESS=0x...(본인 두번째 주소) 설정 후 재실행하세요.");
    return;
  }
  await pub.waitForTransactionReceipt({ hash: await registrar.write.transferFrom([me, RECIPIENT, tokenId]) });
  console.log("  ✅ 전송 완료");

  // 4. 무효화 검증
  console.log("\n── 4. 전송 후 검증 (핵심) ──");
  const verAfter = await resolver.read.recordVersions([node]);
  const addrAfter = await (resolver.read as any).addr([node, COIN_TYPE_POLYGON]);
  const textAfter = await resolver.read.text([node, "email"]);
  const regOwner = await registry.read.owner([node]);
  const nftOwner = await registrar.read.ownerOf([tokenId]);

  console.log("  registry owner:", regOwner, regOwner.toLowerCase()===RECIPIENT.toLowerCase()?"✅ bob":"❌");
  console.log("  NFT owner:", nftOwner, nftOwner.toLowerCase()===RECIPIENT.toLowerCase()?"✅ bob":"❌");
  console.log("  version:", verBefore.toString(), "→", verAfter.toString(), verAfter===verBefore+1n?"✅ +1":"❌");
  console.log("  addr(POLYGON):", addrAfter, (addrAfter==="0x"||addrAfter==="")?"✅ 무효화됨":"❌ 아직 남음!");
  console.log("  text(email):", JSON.stringify(textAfter), (textAfter==="")?"✅ 무효화됨":"❌ 아직 남음!");

  const ok = regOwner.toLowerCase()===RECIPIENT.toLowerCase()
    && (addrAfter==="0x"||addrAfter==="") && textAfter==="";
  console.log("\n════════════════════════════════════════════════════");
  console.log(ok ? " 🎉 전송 안전성 검증 통과 — 제어권 이전 + 레코드 무효화 확인"
                 : " ❌ 검증 실패 — 위 항목 확인 필요");
  console.log("════════════════════════════════════════════════════");
  console.log("\n참고: 새 소유자(bob)가 setAddr로 재설정하면 해석이 재개됩니다.");
  console.log("      bob 키로 resolver.setAddr(node, coinType, bobAddr) 호출 시 정상 동작.");
}
main().catch((e)=>{ console.error(e); process.exitCode=1; });