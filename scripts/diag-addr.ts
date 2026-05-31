import { network } from "hardhat";
import { keccak256, toBytes } from "viem";
const RESOLVER = "0xd0Fc463c4bAc1B8690Dc468242e79183Ec9D93EA";
const LABEL = "smoke204520"; // ← 방금 등록한 라벨 (직접 지정)
function namehashTld(l:string):`0x${string}`{const lh=keccak256(toBytes(l));return keccak256(("0x"+"00".repeat(32)+lh.slice(2)) as `0x${string}`);}
function subnode(p:`0x${string}`,l:string):`0x${string}`{const lh=keccak256(toBytes(l));return keccak256((p+lh.slice(2)) as `0x${string}`);}
async function main(){
  const { viem } = await network.connect();
  const resolver = await viem.getContractAt("DXResolver", RESOLVER);
  const node = subnode(namehashTld("dex"), LABEL);
  console.log("라벨:", LABEL);
  console.log("node:", node);
  for (const coin of [60n, 137n, 0n]) {
    try {
      const r = await (resolver.read as any).addr([node, coin]);
      console.log(`addr(node, ${coin}) →`, r);
    } catch(e:any){ console.log(`addr(node, ${coin}) ❌`, e?.shortMessage||e?.message); }
  }
}
main().catch(console.error);