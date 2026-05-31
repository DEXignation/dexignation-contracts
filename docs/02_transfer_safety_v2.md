# 02. v2 Transfer Safety — The Full Build Process

> This document records the v2 transfer-safety work in the order it actually
> happened: **problem discovery → root-cause analysis → design decision →
> implementation → testing → live-network verification → mainnet deployment**. The
> goal is to let the development team understand, reproduce, and extend this
> process.

<details><summary>▶ 한국어로 보기</summary>

이 문서는 v2 전송 안전성 작업을 **문제 발견 → 원인 분석 → 설계 결정 → 구현 →
테스트 → 실네트워크 검증 → 메인넷 배포**의 순서로, 실제로 진행한 그대로 상세히
기록합니다. 개발팀이 이 과정을 이해하고 재현·확장할 수 있도록 하는 것이
목표입니다.

</details>

---

## 0. One-line summary

> The **silent mis-routing risk** — where transferring an NFT did not carry over
> the name's control and resolution records, so the name still pointed to the
> previous owner after transfer — was solved in v2 by automatically performing
> control transfer and record invalidation on NFT transfer.

<details><summary>▶ 한국어로 보기</summary>

NFT를 양도해도 이름의 제어권과 해석 레코드가 따라오지 않아 양도 후에도 이름이
이전 소유자를 가리키던 **조용한 오송금 위험**을, NFT 전송 시 제어권 이전과 레코드
무효화를 자동 수행하도록 v2에서 해결했다.

</details>

---

## 1. The problem — why this is dangerous

### 1.1 The nature of a name

A `.dex` name is an ERC-721 NFT, but the reason a name exists is **resolution**.
When you send funds to `roy.dex`, the funds must go to the address controlled by
the name's **current owner**. A name must always have two things agree:

- **NFT** (who owns it)
- **resolution** (where it points)

The moment these two diverge, the name lies.

### 1.2 The dangerous scenario

```
1. Alice owns roy.dex (NFT + resolution both Alice)
2. Alice sells the NFT to Bob (a normal ERC-721 transfer — what every marketplace does)
3. Now Bob is the token holder
4. Someone sends funds to roy.dex
5. In v1, those funds went to Alice ← the problem
```

The NFT moved, but the resolution stayed. No error, no event, no failing test.
Value simply flowed to someone who no longer owned the name. This is **the most
dangerous kind of bug** a naming service can have — silent mis-routing.

### 1.3 Decision-making background

At this point two facts helped the decision:

- The service had not yet officially launched → contracts could be redeployed
  freely.
- Trust was the top priority → "being correct" mattered more than cost.

Therefore, instead of patching the v1 contracts, we decided to **fundamentally
redesign and redeploy**.

<details><summary>▶ 한국어로 보기</summary>

`.dex` 이름은 ERC-721 NFT지만, 이름의 존재 이유는 **해석(resolution)** 입니다.
`roy.dex`로 송금하면 그 이름의 **현재 소유자**가 통제하는 주소로 자금이 가야
합니다. 이름은 항상 **NFT(누가 소유)** 와 **해석(어디를 가리킴)** 이 일치해야 하며,
이 둘이 어긋나는 순간 이름은 거짓말을 합니다.

**위험 시나리오**: Alice가 roy.dex 소유 → Bob에게 NFT 판매(일반 전송) → Bob이
보유자 → 누군가 roy.dex로 송금 → v1에서는 자금이 Alice에게 감. NFT는 이동했지만
해석은 그대로. 에러도, 이벤트도, 실패하는 테스트도 없는 **가장 위험한 버그** —
조용한 오송금.

**의사결정 배경**: ① 서비스가 아직 정식 출시 전 → 자유롭게 재배포 가능,
② 신뢰가 최우선 → "비용보다 제대로 되는 것"이 중요. 따라서 v1을 패치하는 대신
**근본적으로 재설계해 재배포**하기로 했습니다.

</details>

---

## 2. Root cause — three structural gaps in v1

Tracing through the v1 source, the bug was not a single broken line but a
**structural problem where three contracts each worked fine on their own but the
connection between them was missing**.

### Gap 1 — No transfer hook on the registrar

`DXRegistrar` (ERC-721) had no `_update` override. On transfer, only ERC-721's
`ownerOf` changed, and that change propagated nowhere else.

### Gap 2 — Registry ownership synced manually

`DXRegistry` had its own `owner(node)` mapping that determines resolver-write
permission, but it was only updated via a manual `reclaim(id, owner)` call. An
ordinary NFT transfer did not trigger this, so registry ownership silently
diverged from NFT ownership.

### Gap 3 — No version on resolver records

`DXResolver` stored records as `records[node][...]` and had no concept of "these
belonged to a previous owner." Even after a transfer, all stale records (address,
text, content, profile, ABI, agent) survived intact and kept resolving.

### Lesson

> Dangerous bugs often live not *in* a component but *in the assumptions* about
> how components relate to each other.

<details><summary>▶ 한국어로 보기</summary>

v1 소스를 추적한 결과, 버그는 한 줄의 오류가 아니라 **세 컨트랙트가 각자 정상이지만
그 사이의 연결이 빠진** 구조적 문제였습니다.

- **공백 1 — registrar에 전송 훅 없음**: `DXRegistrar`에 `_update` 오버라이드가
  없어, 전송 시 `ownerOf`만 바뀌고 그 변화가 어디에도 전파되지 않았습니다.
- **공백 2 — Registry 소유권 수동 동기화**: `DXRegistry`의 `owner(node)`는 수동
  `reclaim` 호출로만 갱신됐습니다. 일반 NFT 전송은 트리거하지 않아 NFT 소유권과
  조용히 어긋났습니다.
- **공백 3 — 리졸버 레코드에 버전 없음**: `DXResolver`는 "이 레코드가 과거
  소유자의 것"이라는 개념이 없어, 전송 후에도 모든 낡은 레코드가 그대로 해석됐습니다.

**교훈**: 위험한 버그는 종종 컴포넌트 *안*이 아니라, 컴포넌트들이 어떻게 관계
맺는지에 대한 *가정 속*에 산다.

</details>

---

## 3. Design decision — version increment, not deletion

Two questions drove the design.

### Q1. When do we clear a name's records?

→ On every genuine ownership transfer. And we tie that trigger to the **ERC-721
transfer lifecycle (`_update`) itself**, so that "moving the token" *is* "moving
control." There is no separate call to remember, and no way to forget.

### Q2. How do we clear them? (the core decision)

Two options were considered.

**Option A — delete each record**
- Solidity mappings cannot be enumerated → to delete every record you'd have to
  already know every key ever written.
- You'd have to track all keys across address, text, content, profile, ABI, and
  agent records.
- Gas-explosive, error-prone, and one day you'll miss a key.

**Option B — increment a version counter** ✅ adopted
- Store records as `[node][version][...]` and increment `version` on transfer.
- A single O(1) operation makes every record kind unreachable at once.
- No enumeration, no omission.

**Additional benefit of versioning (history preservation)**: old records are not
destroyed but *superseded*. They remain on-chain under the previous version, so
the name's entire **ownership and fund-routing history** is preserved
auditably/traceably. For a service that routes funds, this was something we
actively wanted, not something to discard.

> This pattern is the same proven versioning approach ENS's `PublicResolver` has
> used in production for years.

<details><summary>▶ 한국어로 보기</summary>

두 가지 질문이 설계를 이끌었습니다.

**Q1. 언제 레코드를 비우는가?** → 진짜 소유권 전송이 일어날 때마다. 그 트리거를
**ERC-721 전송 생애주기(`_update`) 자체에 연결**해, "토큰을 옮기는 행위"가 곧
"제어권을 옮기는 행위"가 되도록 합니다. 별도 호출을 기억할 필요도, 잊을 위험도
없습니다.

**Q2. 어떻게 비우는가?** — **선택지 A(각 레코드 삭제)**: 매핑 순회 불가 → 모든 키
추적 필요 → 가스 폭발·누락 위험. **선택지 B(버전 카운터 증가) ✅ 채택**: 레코드를
`[node][version][...]`로 저장하고 전송 시 version 증가 → O(1)로 모든 레코드 일괄
도달 불가, 순회·누락 없음.

**버전 방식의 추가 이점(이력 보존)**: 옛 레코드가 파괴되지 않고 *대체*되어 이전
버전 아래 체인에 남습니다. 이름의 소유권·자금 라우팅 이력 전체가 감사·추적 가능하게
보존됩니다. 자금을 라우팅하는 서비스에서 적극적으로 원하는 속성이었습니다. 이
패턴은 ENS의 `PublicResolver`가 수년간 프로덕션에서 써온 검증된 방식과 동일합니다.

</details>

---

## 4. Implementation — 5 steps

The actual implementation proceeded in 5 steps, with `npm test` verifying for
regressions after each step.

### STEP 1 — DXResolver version counter

- Added `mapping(bytes32 => uint64) public recordVersions;`.
- Added internal helper `_ver(node)`.
- Added a version dimension to all six record mappings (`[node][ver][...]`).
- Modified all 25 read/write sites to use `[node][_ver(node)][...]`.
- Added `address public registrar`, `setRegistrar` (onlyOwner), `bumpVersion`
  (onlyRegistrar), and the `onlyRegistrar` modifier.

Why tests didn't break when changing mappings from `public` to `internal`: tests
read through functions like `addr()`/`text()`, not auto-getters. Only
`recordVersions` was kept `public` (tests use its getter).

**Result: 142 passing** (no existing regressions).

### STEP 2 — DXRegistrar _update hook

- Added `interface IResolverVersion { function bumpVersion(bytes32 node) external; }`.
- Added state `IResolverVersion public recordResolver;`.
- Modified `setResolver(address resolver)` to also set `recordResolver`.
- Added `_update(to, tokenId, auth)` override (exactly matching the OZ ERC-721
  signature).

**Result: 142 passing**.

### STEP 3 — controller-skip correction + deployment wiring

Here came an **important discovery**. Right after STEP 2, running the tests showed
1 failure (141 passing, 1 failing):

```
DXRegistrarController — registration flow
  registers a name end-to-end with native payment:
  AssertionError: expected '0x' to equal '0x70997970...'
```

**Cause tracing**: the registration flow (`_executeRegister`) works like this:

```
1. registrar.register(owner=this)          // controller mints to itself
2. registry.setResolver(subnode, resolver)
3. resolver.setAddr(POLYGON, owner)         // initial address set (version 0)
4. registry.setOwner(subnode, owner)
5. registrar.transferFrom(this → owner)     // ← real transfer! (from=controller, to=owner)
```

Step 5 is a **real transfer** with `from≠0, to≠0`, so STEP 2's `_update` hook
fired and called `bumpVersion` → version 0→1 → the version-0 address set in step 3
was invalidated, reading empty (`0x`).

In other words, our invalidation mechanism worked *perfectly* — it just couldn't
distinguish "delivery to a new owner" from "resale."

**Fix**: add `&& !controllers[from]` to the `_update` condition.

```solidity
if (from != address(0) && to != address(0) && !controllers[from]) { ... }
```

Transfers originating from the controller (registration delivery) skip
invalidation; only ordinary user-to-user transfers invalidate. `controllers` is
the controller whitelist that already existed on the registrar.

Also added deployment wiring: every test deploys via
`ignition.deploy(DXDeployLocal)`, so the module wiring *is* the test setup. Two
lines were added after `WireReservations`:

```typescript
m.call(registrar, "setResolver", [resolver], { id: "SetRegistrarResolver" });
m.call(resolver, "setRegistrar", [registrar], { id: "SetResolverRegistrar" });
```

**Result: 142 passing** (the 1 failing test recovered).

### STEP 4 — transfer scenario tests (7 new)

Wrote `Transfer-Invalidation.test.ts`. Verification items:
1. transfer → registry control moves to the new owner
2. all six record kinds invalidated (addr/text/contenthash/profile/agent)
3. after transfer, old owner cannot setAddr, new owner can
4. resolution resumes when the new owner sets addr
5. version increments + history preserved
6. registration delivery does NOT invalidate (version 0 kept)
7. mint stays at version 0

**Result: 149 passing** (142 + 7).

### STEP 5 — edge-case hardening tests (6 new)

Wrote `Transfer-Edge.test.ts`. Verification items:
1. safeTransferFrom also invalidates (a different path from transferFrom)
2. an unauthorized account cannot call bumpVersion directly
3. not even the contract owner can call bumpVersion (registrar-only)
4. approved-operator transfers also invalidate
5. three sequential transfers bump the version each time
6. records the new owner sets after transfer are preserved

**Result: 155 passing** (149 + 6).

<details><summary>▶ 한국어로 보기</summary>

실제 구현은 5단계로 진행했고, 각 단계마다 `npm test`로 회귀를 확인했습니다.

- **STEP 1 — DXResolver 버전 카운터**: `recordVersions` 매핑 + `_ver()` 헬퍼 +
  6종 매핑에 버전 차원 추가 + 25개 읽기/쓰기 지점 수정 + `setRegistrar`/`bumpVersion`/
  `onlyRegistrar` 추가. → **142개 통과**.
- **STEP 2 — DXRegistrar `_update` 훅**: `IResolverVersion` 인터페이스 +
  `recordResolver` 상태 + `setResolver`가 `recordResolver`도 설정 + `_update`
  오버라이드. → **142개 통과**.
- **STEP 3 — controller 스킵 보정 + 와이어링**: STEP 2 직후 등록 테스트 1개 실패
  발견. 원인: 등록 흐름 5번 `transferFrom(컨트롤러→owner)`이 진짜 전송이라 훅이
  작동해 3번의 초기 주소(version 0)를 무효화 → 빈 값. 해결: 조건에
  `&& !controllers[from]` 추가(배달은 무효화 건너뜀). + 배포 와이어링 2줄 추가.
  → **142개 통과**(1개 복구).
- **STEP 4 — 전송 시나리오 테스트 7개**: `Transfer-Invalidation.test.ts`. 제어권
  이전·6종 무효화·권한 이전·해석 재개·이력·배달 예외·mint 무영향. → **149개 통과**.
- **STEP 5 — 엣지 케이스 6개**: `Transfer-Edge.test.ts`. safeTransferFrom·무권한
  차단·owner 차단·operator·연속 전송·전송 후 보존. → **155개 통과**.

</details>

---

## 5. Additional safety review (code review)

Items checked directly at the code level before deployment.

| # | Check | Result |
| --- | --- | --- |
| 1 | **Reentrancy**: `_update` does `super._update` (state change) before external calls; registry/resolver are trusted contracts with no callbacks | Safe |
| 2 | **Expired-node transfer**: `setSubnodeOwner`'s `authorised` is based on baseNode, and baseNode has expires=0 so it never expires | Pass |
| 3 | **bumpVersion permission**: `onlyRegistrar`, outsiders cannot invalidate | OK |
| 4 | **setRegistrar permission**: `onlyOwner`, registrar cannot be swapped | OK |
| 5 | **Invalidation omission**: all six mappings are version-indexed (verified by 155 tests) | OK |

Check 2 is especially subtle: since `isExpired = expires != 0 && now > expires`,
the baseNode with expires=0 is never judged expired, so `_update`'s
`setSubnodeOwner(baseNode, ...)` always passes authorization.

<details><summary>▶ 한국어로 보기</summary>

배포 전 코드 레벨에서 점검한 항목: ① 재진입(super._update 후 외부호출, 신뢰
컨트랙트) — 안전, ② 만료 노드 전송(authorised는 baseNode 기준, baseNode는
expires=0이라 만료 안 됨) — 통과, ③ bumpVersion 권한(onlyRegistrar) — OK,
④ setRegistrar 권한(onlyOwner) — OK, ⑤ 무효화 누락(6종 전부 버전 인덱스, 155개로
검증) — OK. 특히 ②가 미묘: `isExpired = expires≠0 && now>expires`이므로 expires=0인
baseNode는 절대 만료로 판정되지 않아 `setSubnodeOwner(baseNode)`가 항상 통과합니다.

</details>

---

## 6. Live-network verification (Amoy testnet)

After 155 passing locally, we verified transfer safety on a real network. In this
process we hit **several testnet infrastructure problems**, and each solution
forms the basis of the `05` redeployment document.

### 6.1 Wiring redeploy cache problem

The first Amoy deploy gave `Function 'setRegistrar' not found in contract
DXResolver`. Cause: ignition resumed the existing v1 deployment record
(`chain-80002`) and referenced the old ABI. Fix: deploy cleanly with a new
deployment-id.

### 6.2 Dead Chainlink feed

Amoy's real Chainlink POL/USD feed was dead (revert on read), so price lookups
failed. Fix: wrote `DXDeployAmoyMock.ts` — deploy a `MockPriceOracle` ($0.40
fixed) instead of the real feed. The rest of the logic is identical.

### 6.3 Mock feed staleness

Even the mock feed, after some time, hit the `maxOracleDelay` (26 hours) guard and
reverted. Fix: refresh `updatedAt` to the current time via
`mockFeed.updateAnswer(...)` before price lookups.

### 6.4 Excessive registration cost (mock price too low)

With the mock at $0.40, the one-year registration cost was `$8/$0.40 = 20 POL`,
too expensive — the test wallet had insufficient balance. Fix: raise the mock
price to lower the registration cost (or top up POL via faucet).

### 6.5 Verification success

Verified the actual flow with the `verify-transfer-amoy.ts` script:

```
register → set records → transfer (alice→bob) → verify
result:
  version: 0 → 1        ✅
  registry owner → bob  ✅
  NFT owner → bob       ✅
  addr(POLYGON): 0x     ✅ invalidated
  text(email): ""       ✅ invalidated
```

Transfer safety confirmed on a live network.

<details><summary>▶ 한국어로 보기</summary>

로컬 155개 통과 후, 실제 네트워크에서 검증. 여러 테스트넷 인프라 문제를 겪었고
각각의 해결이 `05` 재배포 문서의 기반이 됩니다.

- **6.1 와이어링 캐시**: `setRegistrar not found` 에러. ignition이 옛 v1 배포를
  resume하며 옛 ABI 참조. → 새 deployment-id로 배포.
- **6.2 Chainlink 피드 사망**: Amoy 실제 피드가 죽어 read 시 revert. →
  `DXDeployAmoyMock.ts`로 `MockPriceOracle`($0.40) 배포.
- **6.3 mock 피드 staleness**: 시간 지나면 26시간 가드에 걸림. → 조회 전
  `mockFeed.updateAnswer(...)`로 타임스탬프 갱신.
- **6.4 등록비 과다**: mock $0.40 → 1년 20 POL로 비쌈. → mock 가격↑ 또는 POL 충전.
- **6.5 검증 성공**: `verify-transfer-amoy.ts`로 version 0→1, owner→bob, addr/text
  무효화 확인. 실네트워크에서 전송 안전성 확인 완료.

</details>

---

## 7. Mainnet redeployment (Polygon)

### 7.1 Out of gas

The first attempt stopped mid-way due to insufficient POL in the deployer
account. Since ignition saves progress, topping up POL and resuming with the same
command continues the deployment.

### 7.2 Wiring order problem (Unauthorized)

After resuming, `SetRegistrarResolver` failed with `Unauthorized()`. Cause:
`SetRegistrarResolver` (= registrar.setResolver → internally requires
registry.setResolver(baseNode), which needs authorised(baseNode)) was in the same
batch as `GrantTldToRegistrar` (which makes the registrar the baseNode owner), and
ignition does not guarantee order, so it ran before GrantTld.

On Amoy the batch order happened to be fine by luck, but the latent bug surfaced
in the mainnet batch arrangement.

### 7.3 Root fix — explicit `after`

Declared the dependency explicitly in all three deployment modules:

```typescript
const grantTld = m.call(registry, "setSubnodeOwner",
    [zeroHash, TLD_LABEL_HASH, registrar], { id: "GrantTldToRegistrar" });

m.call(registrar, "setResolver", [resolver], {
    id: "SetRegistrarResolver",
    after: [grantTld],          // ← guarantees execution after GrantTld
});
```

After the fix, re-confirmed 155 tests with `npm test` → redeployed cleanly with a
new deployment-id (`polygon-v2-clean`) → **all 7 contracts succeeded**. Looking at
the batch order, `SetRegistrarResolver` (Batch #4) ran after
`GrantTldToRegistrar` (Batch #3), and the `Unauthorized` disappeared.

### 7.4 Verification + registration

- Verified all 7 contracts on PolygonScan + Sourcify via `ignition verify`.
- Registered roy.dex for 3 years via `register-roy.ts` (updated to v2 addresses).
- The wiring check at the top of the registration script showed both
  `registrar.recordResolver` and `resolver.registrar` as ✅ — transfer
  invalidation is ready to work on mainnet.

<details><summary>▶ 한국어로 보기</summary>

- **7.1 가스 부족**: 첫 시도 중 POL 부족으로 중단. ignition이 진행 상황을 저장하므로
  POL 충전 후 같은 명령으로 resume.
- **7.2 와이어링 순서 문제(Unauthorized)**: resume 후 `SetRegistrarResolver`가
  `Unauthorized()` 실패. `GrantTldToRegistrar`와 같은 배치에 들어가 ignition이 순서를
  보장하지 않아 GrantTld보다 먼저 실행됨. Amoy는 우연히 통과, 메인넷에서 드러남.
- **7.3 근본 해결 — after 명시**: 세 배포 모듈 전부에 `after: [grantTld]` 추가.
  155개 재확인 → 새 id(`polygon-v2-clean`)로 재배포 → 7개 전부 성공.
- **7.4 검증 + 등록**: PolygonScan+Sourcify 검증, roy.dex 3년 등록,
  recordResolver/registrar 와이어링 ✅ 확인.

</details>

---

## 8. Mainnet v2 deployed addresses (polygon-v2-clean, chain-137)

| Contract | Address |
| --- | --- |
| DXResolver | `0xb8b44561A52cf2929D3E6BF02d3B18a9e20CdE82` |
| DXRegistrar | `0x1DaDBb206a05b2821935c467015C77fD61e02951` |
| DXRegistry | `0x0eE48aCcB768758Ba509Ef08D4f00d03C1B6e3A9` |
| DXRegistrarController | `0xd456dC842B6c05084a0e884b7247F9ee90472432` |
| DXPriceOracle | `0xc3751923bF9C485Ac927096D42469f6287156B42` |
| DXReverseRegistrar | `0xb6b165eB79E1Acf54eE8acFAf5FCC77241D6Fef0` |
| DXReservations | `0xfB22CE3135e8a0b6c91bb74884Ea73A4caa6b32b` |

> The previous v1 addresses are deprecated. The v1 records remain in
> `ignition/deployments/chain-137` for history preservation.

---

## 9. Key lessons

1. **The scariest bug is the polite one** — it doesn't crash, doesn't alert, and
   looks like correct behavior right up until someone loses money.
2. **Question the assumptions between components** — the bug was not inside a
   component but between them.
3. **The right answer for invalidation is version increment, not deletion** —
   O(1), no omissions, history preserved.
4. **A fix can create a new bug** — the controller-delivery skip is the example.
   The test caught it.
5. **Testnet ≠ mainnet** — Amoy feed death, staleness, RPC instability. Mainnet is
   fine.
6. **Don't leave deployment order to luck** — declare it with `after`. Amoy passed
   by luck.

The next document (`03`) explains in detail what each of the 155 tests that passed
in this process means.

<details><summary>▶ 한국어로 보기</summary>

1. **가장 무서운 버그는 정중한 버그다** — 크래시·알림 없이 돈을 잃기 직전까지
   정상처럼 보인다.
2. **컴포넌트 사이의 가정을 의심하라** — 버그는 컴포넌트 안이 아니라 그 사이에 있었다.
3. **무효화의 정답은 삭제가 아니라 버전 증가** — O(1), 누락 없음, 이력 보존.
4. **수정이 새 버그를 만든다** — controller 배달 스킵이 그 예. 테스트가 잡았다.
5. **테스트넷 ≠ 메인넷** — Amoy 피드 사망, staleness, RPC 불안정. 메인넷은 정상.
6. **배포 순서를 운에 맡기지 마라** — `after`로 명시. Amoy는 운으로 통과했었다.

</details>
