import { network } from "hardhat";
const FEED = "0x001382149eBa3441043c1c66972b4772963f5D43";
const ABI = [
  {inputs:[],name:"latestRoundData",outputs:[
    {name:"roundId",type:"uint80"},{name:"answer",type:"int256"},
    {name:"startedAt",type:"uint256"},{name:"updatedAt",type:"uint256"},
    {name:"answeredInRound",type:"uint80"}],stateMutability:"view",type:"function"},
  {inputs:[],name:"decimals",outputs:[{name:"",type:"uint8"}],stateMutability:"view",type:"function"},
] as const;
async function main(){
  const { viem } = await network.connect();
  const pub = await viem.getPublicClient();
  try {
    const dec = await pub.readContract({address:FEED,abi:ABI,functionName:"decimals"});
    console.log("decimals:", dec);
    const r = await pub.readContract({address:FEED,abi:ABI,functionName:"latestRoundData"}) as any[];
    const answer = r[1], updatedAt = r[3];
    console.log("answer(가격):", answer.toString());
    console.log("updatedAt:", updatedAt.toString());
    const now = Math.floor(Date.now()/1000);
    const ageHours = (now - Number(updatedAt))/3600;
    console.log("마지막 업데이트로부터:", ageHours.toFixed(1), "시간 전");
    console.log(answer <= 0n ? "❌ 가격이 0 이하 — 피드 죽음" : "✅ 가격 유효");
    console.log(ageHours > 24 ? "⚠️ 24시간 넘게 미갱신 — stale 가능성" : "✅ 최근 갱신됨");
  } catch(e:any){ console.log("❌ 피드 호출 실패:", e?.shortMessage||e?.message); }
}
main().catch(console.error);