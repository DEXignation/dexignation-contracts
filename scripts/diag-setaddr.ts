import { network } from "hardhat";
import { keccak256, toBytes } from "viem";
const RESOLVER = "0xd0Fc463c4bAc1B8690Dc468242e79183Ec9D93EA";
const LABEL = "smoke204520";
function namehashTld(l:string):`0x${string}`{const lh=keccak256(toBytes(l));return keccak256(("0x"+"00".repeat(32)+lh.slice(2)) as `0x${string}`);}
function subnode(p:`0x${string}`,l:string):`0x${string}`{const lh=keccak256(toBytes(l));return keccak256((p+lh.slice(2)) as `0x${string}`);}
async function main(){
  const { viem } = await network.connect();
  const pub = await viem.getPublicClient();
  const [w] = await viem.getWalletClients();
  const me = w.account.address;
  const resolver = await viem.getContractAt("DXResolver", RESOLVER);
  const node = subnode(namehashTld("dex"), LABEL);

  // setAddr(node, coinType, bytes addr) — coinType 60(ETH/EVM), 주소는 bytes로
  console.log("setAddr(node, 60, me) 전송...");
  const tx = await (resolver.write as any).setAddr([node, 60n, me as `0x${string}`]);
  await pub.waitForTransactionReceipt({ hash: tx });
  console.log("완료:", tx);

  const r = await (resolver.read as any).addr([node, 60n]);
  console.log("addr(node,60) →", r);
  console.log("내 주소와 일치:", (r as string).toLowerCase()===me.toLowerCase()?"✅":"❌");
}
main().catch(console.error);