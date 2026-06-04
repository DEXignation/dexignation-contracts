// scripts/test-register.ts
import { network } from "hardhat";

const CONTROLLER = "0xD96Eb120BdD051a10E4AdF57EbA3d5a7dFA774F7";
const RESOLVER = "0x54546aD59081E2f05F9e0175da80444e0826Dbe9";
const ONE_YEAR = 365n * 24n * 60n * 60n;
const ZERO = "0x0000000000000000000000000000000000000000";

async function main() {
  const { viem } = await network.connect();
  const [wallet] = await viem.getWalletClients();
  const pub = await viem.getPublicClient();
  const c = await viem.getContractAt("DXRegistrarController", CONTROLLER);

  const label = "mytest" + Date.now().toString().slice(-5); // 충돌 방지
  const me = wallet.account.address;
  const secret = ("0x" + "aa".repeat(32)) as `0x${string}`;

  // 1) commit
  const commitment = await c.read.makeCommitmentFull([label, me, ONE_YEAR, RESOLVER, ZERO, secret]);
  await c.write.commit([commitment]);
  console.log("commit 완료, minCommitmentAge 대기...");

  // 2) 대기 (minCommitmentAge 만큼 — 실제 시간. 보통 30~60초)
  await new Promise((r) => setTimeout(r, 70_000));

  // 3) register
  const price = await c.read.rentPrice([ONE_YEAR]);
  const hash = await c.write.register([label, me, ONE_YEAR, RESOLVER, secret], { value: price });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`✅ 등록 성공: ${label}.dex → ${me}`);
  console.log(`   가격: ${Number(price)/1e18} POL`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });