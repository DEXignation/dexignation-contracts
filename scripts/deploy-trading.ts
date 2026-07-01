// SPDX-License-Identifier: MIT
//
// 거래 레이어(마켓 + 경매 2종) 배포 + 연결 스크립트.
//   이미 배포된 DXRegistrar 위에 DXMarketplace / DXEnglishAuction /
//   DXDutchAuction 를 배포하고, 상호 배타·SVG 마크에 필요한 모든 연결을 건다.
//
// 실행:
//   npx hardhat run scripts/deploy-trading.ts --network amoy
//   npx hardhat run scripts/deploy-trading.ts --network polygon
//
// 사전 준비:
//   • REGISTRAR_ADDRESS — 배포된 DXRegistrar 주소
//   • USDC_ADDRESS / USDT_ADDRESS — 결제 허용할 스테이블코인
//   • FEE_RECIPIENT — 수수료 수신처 (treasury). 미설정 시 배포 계정 사용.
//   • registrar 의 owner 가 배포 계정이어야 setMarketplace/setAuctions 가능.
//
//   ※ 메인넷도 테스트넷처럼 재배포 자유 (Roy 운용 방침). 감사 후 실서비스 전환.

import { network } from "hardhat";

// ── 채워 넣기 ───────────────────────────────────────────────────────────────
const REGISTRAR_ADDRESS = (process.env.REGISTRAR_ADDRESS || "") as `0x${string}`;
const USDC_ADDRESS = (process.env.USDC_ADDRESS || "") as `0x${string}`;
const USDT_ADDRESS = (process.env.USDT_ADDRESS || "") as `0x${string}`;

// ── 거래 레이어 파라미터 ─────────────────────────────────────────────────────
const FEE_BPS = 250n;             // 2.5%
const MIN_INCREMENT_BPS = 500n;   // 영국식 최소 입찰 증가 +5%
const EXTEND_WINDOW = 600n;       // 마감 10분 이내 입찰 시 …
const EXTEND_BY = 1200n;          //   … +20분 연장

const ZERO = "0x0000000000000000000000000000000000000000" as const;

async function main() {
  const { viem } = await network.connect();
  const pub = await viem.getPublicClient();
  const [wallet] = await viem.getWalletClients();
  const me = wallet.account.address;
  const feeRecipient = (process.env.FEE_RECIPIENT || me) as `0x${string}`;

  if (!REGISTRAR_ADDRESS) throw new Error("REGISTRAR_ADDRESS 미설정");
  if (!USDC_ADDRESS && !USDT_ADDRESS) throw new Error("USDC_ADDRESS 또는 USDT_ADDRESS 중 하나는 필요");

  console.log("════════════════════════════════════════════");
  console.log(" 거래 레이어 배포 (마켓 + 경매 2종)");
  console.log("════════════════════════════════════════════");
  console.log("배포 계정:", me);
  console.log("registrar:", REGISTRAR_ADDRESS);
  console.log("feeRecipient:", feeRecipient, "\n");

  // ── 1. 배포 ────────────────────────────────────────────────────────────────
  console.log("── 1. 컨트랙트 배포 ──");
  const marketplace = await viem.deployContract("DXMarketplace",
    [REGISTRAR_ADDRESS, feeRecipient, FEE_BPS]);
  console.log("  DXMarketplace:", marketplace.address);

  const english = await viem.deployContract("DXEnglishAuction",
    [REGISTRAR_ADDRESS, feeRecipient, FEE_BPS, MIN_INCREMENT_BPS, EXTEND_WINDOW, EXTEND_BY]);
  console.log("  DXEnglishAuction:", english.address);

  const dutch = await viem.deployContract("DXDutchAuction",
    [REGISTRAR_ADDRESS, feeRecipient, FEE_BPS]);
  console.log("  DXDutchAuction:", dutch.address, "\n");

  // ── 2. SVG 마크 연결 (registrar) ──────────────────────────────────────────
  console.log("── 2. SVG 마크 연결 ──");
  const registrar = await viem.getContractAt("DXRegistrar", REGISTRAR_ADDRESS);
  await pub.waitForTransactionReceipt({ hash: await registrar.write.setMarketplace([marketplace.address]) });
  console.log("  registrar.setMarketplace ✓ (LISTED 마크)");
  await pub.waitForTransactionReceipt({ hash: await registrar.write.setAuctions([english.address, dutch.address]) });
  console.log("  registrar.setAuctions ✓ (AUCTION 마크)\n");

  // ── 3. 상호 배타 연결 (양방향) ──────────────────────────────────────────────
  console.log("── 3. 상호 배타 연결 ──");
  await pub.waitForTransactionReceipt({ hash: await marketplace.write.setAuctionContracts([english.address, dutch.address]) });
  console.log("  marketplace.setAuctionContracts ✓ (경매 중이면 list 거부)");
  await pub.waitForTransactionReceipt({ hash: await english.write.setMarketplace([marketplace.address]) });
  console.log("  english.setMarketplace ✓ (리스팅 중이면 경매 거부)");
  await pub.waitForTransactionReceipt({ hash: await dutch.write.setMarketplace([marketplace.address]) });
  console.log("  dutch.setMarketplace ✓");
  await pub.waitForTransactionReceipt({ hash: await english.write.setPeerAuction([dutch.address]) });
  console.log("  english.setPeerAuction ✓ (네덜란드식 경매 중이면 영국식 거부)");
  await pub.waitForTransactionReceipt({ hash: await dutch.write.setPeerAuction([english.address]) });
  console.log("  dutch.setPeerAuction ✓ (영국식 경매 중이면 네덜란드식 거부)\n");

  // ── 4. 결제 토큰 화이트리스트 ────────────────────────────────────────────────
  console.log("── 4. 결제 토큰 화이트리스트 ──");
  for (const [name, addr] of [["USDC", USDC_ADDRESS], ["USDT", USDT_ADDRESS]] as [string, `0x${string}`][]) {
    if (!addr) continue;
    await pub.waitForTransactionReceipt({ hash: await marketplace.write.setPayToken([addr, true]) });
    await pub.waitForTransactionReceipt({ hash: await english.write.setPayToken([addr, true]) });
    await pub.waitForTransactionReceipt({ hash: await dutch.write.setPayToken([addr, true]) });
    console.log(`  ${name} 화이트리스트 ✓ (마켓·영국식·네덜란드식)`);
  }

  console.log("\n════════════════════════════════════════════");
  console.log(" 🎉 거래 레이어 배포 + 연결 완료");
  console.log("════════════════════════════════════════════");
  console.log("DXMarketplace   :", marketplace.address);
  console.log("DXEnglishAuction:", english.address);
  console.log("DXDutchAuction  :", dutch.address);
  console.log("\n검증: 한 이름은 LISTED · AUCTION 중 하나만 — 마크/상호배타 양방향 연결됨");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
