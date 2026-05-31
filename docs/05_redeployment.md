# 05. Redeployment Guide (start to finish)

> This is the complete step-by-step procedure for the team to **deploy from
> scratch** after finishing testing. It includes every pitfall we actually hit
> (dead feed, staleness, out of gas, order dependency) and its solution.
>
> Target: mainnet redeployment (fresh). Testnet (Amoy) verification is included.

<details><summary>▶ 한국어로 보기</summary>

이 문서는 개발팀이 테스트를 완료한 뒤 **처음부터 새로 배포**할 때 따를 완전한
단계별 절차입니다. 실제로 겪은 모든 함정(피드 사망, staleness, 가스 부족, 순서
의존성)과 그 해결을 포함합니다. 대상: 메인넷 재배포(신규), 테스트넷(Amoy) 검증 포함.

</details>

---

## 0. Prerequisites checklist

Always confirm before deploying:

- [ ] `.env` configured:
  - `DEPLOYER_PRIVATE_KEY` (deployer private key)
  - `RECIPIENT_ADDRESS` (second address for verification, for Amoy verify)
  - RPC URL (Alchemy, etc.), PolygonScan API key
- [ ] Deployer account balance:
  - Mainnet: sufficient POL (7 contracts deploy + wiring + verify; ~5–10 POL to be
    safe. Plus registration cost if registering roy.dex etc.; a 3-year registration
    can be ~200 POL depending on price)
  - Amoy: faucet POL (including verification registration cost; ~30 POL
    recommended)
- [ ] `hardhat.config.ts` profiles:
  - **Both** `default` and `production` have
    `{optimizer:{enabled,runs:200}, viaIR:true, evmVersion:"cancun"}`
  - (ignition uses the production profile — artifact mismatch if viaIR is missing)
- [ ] Deployment module has v2 wiring + `after` applied (section 1)

<details><summary>▶ 한국어로 보기</summary>

배포 전 확인: `.env`(개인키·RECIPIENT·RPC·PolygonScan 키), 잔액(메인넷 5~10 POL +
등록비, Amoy ~30 POL), `hardhat.config.ts`의 `default`/`production` 둘 다
viaIR/optimizer/cancun, 배포 모듈에 v2 와이어링+`after` 적용.

</details>

---

## 1. Code pre-check

### 1.1 Confirm deployment-module wiring

All three deployment modules (`DXDeployLocal/Amoy/Polygon.ts`) must have:

```typescript
const grantTld = m.call(registry, "setSubnodeOwner",
  [zeroHash, TLD_LABEL_HASH, registrar], { id: "GrantTldToRegistrar" });

m.call(registrar, "setResolver", [resolver],
  { id: "SetRegistrarResolver", after: [grantTld] });   // ← after required
m.call(resolver, "setRegistrar", [registrar],
  { id: "SetResolverRegistrar" });
```

Check command:
```bash
grep -n "after: \[grantTld\]\|SetRegistrarResolver\|SetResolverRegistrar" \
  ignition/modules/DXDeployPolygon.ts
```

> **If this `after` is missing**, deployment stops on mainnet with `Unauthorized()`.
> (A problem we actually hit.)

### 1.2 Confirm the full suite passes

```bash
npx hardhat clean && npm test
```

→ confirm **155 passing**. Do not deploy if this does not pass.

<details><summary>▶ 한국어로 보기</summary>

세 배포 모듈에 `after: [grantTld]` 와이어링이 있어야 합니다(없으면 메인넷에서
`Unauthorized()`로 중단). 그리고 `npx hardhat clean && npm test` → **155 passing**
확인. 통과하지 않으면 배포하지 않습니다.

</details>

---

## 2. Amoy testnet verification (rehearsal before mainnet)

Verify transfer safety on a live network before mainnet.

### 2.1 Feed problem — use the mock module

Amoy's real Chainlink POL/USD feed may be dead (revert on read). Then
`DXDeployAmoy.ts` (real feed) cannot quote prices. Deploy with
**`DXDeployAmoyMock.ts`** (uses MockPriceOracle).

```bash
npx hardhat ignition deploy ignition/modules/DXDeployAmoyMock.ts \
  --network amoy --deployment-id amoy-mock-v2
```

> **Cache caution**: if an old deployment exists under the same deployment-id,
> ignition resumes and references the old ABI, possibly causing an error
> (`Function not found`). Use a **new deployment-id** or move the old deployment
> folder to a backup.

Record the **7 addresses** printed after deployment.

### 2.2 Update verification-script addresses

Replace the `ADDR` in `scripts/verify-transfer-amoy.ts` with the just-deployed
addresses:
```typescript
const ADDR = {
  registrar:  "0x...",   // new DXRegistrar
  resolver:   "0x...",   // new DXResolver
  registry:   "0x...",   // new DXRegistry
  controller: "0x...",   // new DXRegistrarController
  mockPolUsd: "0x...",   // new MockPolUsd
};
```

### 2.3 Mock feed staleness + price adjustment

In step 0 of the verification script, refresh the timestamp via
`mockFeed.updateAnswer([...])` to avoid the staleness guard (26 hours). And adjust
the mock price so the registration cost doesn't exceed the balance.

- mock $0.40 → 1-year registration 20 POL
- mock $8.00 (`800000000`) → 1-year registration 1 POL (saves test balance)

### 2.4 Run verification

```bash
npx hardhat run scripts/verify-transfer-amoy.ts --network amoy
```

Expected output:
```
version: 0 → 1        ✅
registry owner → bob  ✅
addr(POLYGON): 0x     ✅ invalidated
text(email): ""       ✅ invalidated
🎉 transfer-safety verification passed
```

> **RPC instability**: Alchemy Amoy may return "unknown RPC error." A retry
> usually works. But if the error points to insufficient balance (e.g.
> `value 20.4 ETH ... have 2.7`), raise the mock price or top up POL.

<details><summary>▶ 한국어로 보기</summary>

메인넷 전 실네트워크에서 전송 안전성을 검증합니다.

- **2.1 피드 문제**: Amoy 실제 피드가 죽어 있을 수 있어 `DXDeployAmoyMock.ts`(mock)로
  배포. **캐시 주의**: 같은 id로 옛 배포가 있으면 옛 ABI 참조 → 새 deployment-id 사용.
- **2.2 주소 업데이트**: `verify-transfer-amoy.ts`의 `ADDR`를 새 주소로 교체.
- **2.3 staleness + 가격**: `mockFeed.updateAnswer`로 타임스탬프 갱신(26h 가드 회피),
  mock 가격 조정($8 → 1년 1 POL).
- **2.4 검증 실행**: version 0→1, owner→bob, addr/text 무효화 → 🎉 통과. RPC 오류는
  보통 재시도; 잔액 부족이면 mock 가격↑ 또는 POL 충전.

</details>

---

## 3. Mainnet deployment

### 3.1 Run the deploy

The mainnet Chainlink feed is normal, so use `DXDeployPolygon.ts` (real feed).

```bash
npx hardhat ignition deploy ignition/modules/DXDeployPolygon.ts \
  --network polygon --deployment-id polygon-v2-clean
```

> **deployment-id**: recommend a **new id** so it doesn't mix with previous
> deployments (especially failed partial ones). We separated `polygon-v2` (partial
> failure) → `polygon-v2-clean` (success).

### 3.2 If out of gas — resume

If POL runs out mid-deploy, it stops. Since ignition saves progress, **top up POL
and re-run the same command** to continue from where it stopped ("Resuming
existing deployment").

```
have 0.485 POL want 1.077 POL  ← out-of-gas message
→ top up POL and re-run the same command
```

### 3.3 Confirm deployment success

The batch order should look like this:
```
Batch #3: ... GrantTldToRegistrar ...
Batch #4: ... SetRegistrarResolver ... (after GrantTld → no Unauthorized)
```

Record **all 7 addresses** when they are printed.

<details><summary>▶ 한국어로 보기</summary>

- **3.1 배포 실행**: 메인넷 피드는 정상이라 `DXDeployPolygon.ts` 사용. **새
  deployment-id** 권장(`polygon-v2-clean`).
- **3.2 가스 부족 시 resume**: POL 충전 후 같은 명령 재실행 → 멈춘 지점부터 이어짐.
- **3.3 성공 확인**: Batch #3 GrantTld → Batch #4 SetRegistrarResolver 순서면 정상.
  7개 주소 기록.

</details>

---

## 4. Post-deployment verification

### 4.1 Source verification (PolygonScan + Sourcify)

```bash
npx hardhat ignition verify polygon-v2-clean --network polygon
```

> Always include `--network polygon`. 7 contracts are verified on PolygonScan and
> Sourcify. (Blockscout may give a 500 error but it's irrelevant — PolygonScan is
> the key one.)

### 4.2 Wiring check (required)

Confirm via reads that the registrar↔resolver connection actually happened:

```bash
# via hardhat console or a short script
registrar.recordResolver()  → should be the resolver address
resolver.registrar()        → should be the registrar address
```

The wiring-check block at the top of `register-roy.ts` (or a similar script) does
this. **Both must be ✅** for transfer invalidation to work.

<details><summary>▶ 한국어로 보기</summary>

- **4.1 소스 검증**: `ignition verify polygon-v2-clean --network polygon` →
  PolygonScan/Sourcify에 7개 검증.
- **4.2 와이어링 확인(필수)**: `registrar.recordResolver()`→resolver,
  `resolver.registrar()`→registrar. **둘 다 ✅여야** 전송 무효화가 작동.

</details>

---

## 5. Post-deployment doc/code update

A fresh deployment produces **7 new addresses**. Update all of the following:

### 5.1 Bulk address update in the repo

```bash
# find where old addresses are embedded
grep -rn -e "<old registrar>" -e "<old resolver>" ... \
  --include="*.md" --include="*.ts" --include="*.json" \
  . | grep -v node_modules | grep -v ignition/deployments
```

Bulk-replace addresses in the found files (e.g. `README.md`,
`docs/HANDOFF_REPORT.md`, `scripts/*.ts`) with sed:
```bash
for f in <files>; do
  sed -i -e 's/<old>/<new>/g' ... "$f"
done
```

### 5.2 Update target list

- [ ] `README.md` — mainnet address table
- [ ] `docs/HANDOFF_REPORT.md` — address table + OpenSea URL
- [ ] `scripts/*.ts` — hardcoded addresses
- [ ] frontend config (separate if outside this repo)
- [ ] `docs/TRANSFER_SAFETY_V2.md`, `docs/02_*.md`, etc. address tables

<details><summary>▶ 한국어로 보기</summary>

새 배포는 새 주소 7개를 만듭니다. `grep`으로 옛 주소를 찾아 `sed`로 일괄 치환.
갱신 대상: README(주소 표), HANDOFF_REPORT(주소 표+OpenSea), scripts(하드코딩
주소), 프론트엔드 설정, 기타 주소 표가 있는 문서.

</details>

---

## 6. Clean up deployment records (deployments/)

Cleanup policy for the deployment artifacts folder (our repo git-tracks
deployments):

- **Discard**: failed partial deployments (`polygon-v2`), manual backups
  (`*-v1-old`).
- **Include**: the successful final deployment (`polygon-v2-clean`), the
  verification record (`amoy-mock-v2`).
- **Preserve**: previous-version records (`chain-137` v1, etc.) — history
  preservation.

```bash
rm -rf ignition/deployments/<failed partial>
rm -rf ignition/deployments/<manual backup>
git add -A
git status --short   # confirm the list to be committed
```

<details><summary>▶ 한국어로 보기</summary>

deployments 폴더 정리: **버릴 것**(실패한 부분배포, 수동 백업), **넣을 것**(성공한
최종 배포, 검증 기록), **보존**(이전 버전 기록 — 이력).

</details>

---

## 7. Commit

```bash
git add -A
git commit -m "feat: <change summary>

<detailed description>
- new v2 addresses
- N tests passing
- Amoy verification + mainnet deploy/verify"
git push origin main
```

> **Backup file caution**: if a backup like `*.sol.v1bak` remains untracked,
> delete it before committing.

<details><summary>▶ 한국어로 보기</summary>

`git add -A` → 변경 요약 커밋 메시지 → `git push origin main`. **백업 파일 주의**:
`*.sol.v1bak` 같은 백업이 untracked로 남으면 삭제 후 커밋.

</details>

---

## 8. Full flow summary (checklist)

```
[ ] .env / balance / config profile confirmed
[ ] deployment module after-wiring confirmed
[ ] npm test → 155 passing
[ ] (rehearsal) deploy DXDeployAmoyMock → new id
[ ] update verify-transfer-amoy addresses + adjust mock price/staleness
[ ] Amoy verification → 🎉 pass
[ ] deploy DXDeployPolygon to mainnet → new id (resume if out of gas)
[ ] confirm batch order (GrantTld → SetRegistrarResolver)
[ ] ignition verify → PolygonScan/Sourcify
[ ] wiring check (recordResolver/registrar ✅)
[ ] (optional) register a representative name (register-roy, etc.)
[ ] bulk-update old addresses in the repo (README/HANDOFF/scripts)
[ ] clean up deployments (delete failures, include success, preserve v1)
[ ] commit + push
```

---

## 9. Pitfalls we hit (quick reference)

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Function 'setRegistrar' not found` | old deploy resume, old ABI referenced | new deployment-id |
| price lookup revert | Amoy Chainlink feed dead | use DXDeployAmoyMock |
| mock also reverts on price | staleness (26h) exceeded | refresh with `updateAnswer` |
| `value 20 POL ... have 2.7` | mock price too low → excessive cost | raise mock price or top up POL |
| `unknown RPC error` | Alchemy transient error or low balance | retry / check balance |
| `insufficient funds for gas` | deploy out of gas | top up POL and resume |
| `Unauthorized()` (SetRegistrarResolver) | ran before GrantTld | `after: [grantTld]` |

The next document (`06`) covers how to upgrade toward v2.1/v2.2/v3.

<details><summary>▶ 한국어로 보기</summary>

| 증상 | 원인 | 해결 |
| --- | --- | --- |
| `Function 'setRegistrar' not found` | 옛 배포 resume, 옛 ABI 참조 | 새 deployment-id |
| 가격조회 revert | Amoy Chainlink 피드 사망 | DXDeployAmoyMock 사용 |
| mock도 가격 revert | staleness(26h) 초과 | `updateAnswer`로 갱신 |
| `value 20 POL ... have 2.7` | mock 가격 낮아 등록비 과다 | mock 가격↑ 또는 POL 충전 |
| `unknown RPC error` | Alchemy 일시 오류/잔액부족 | 재시도 / 잔액 확인 |
| `insufficient funds for gas` | 배포 가스 부족 | POL 충전 후 resume |
| `Unauthorized()` (SetRegistrarResolver) | GrantTld보다 먼저 실행 | `after: [grantTld]` |

</details>
