# 06. Upgrade Roadmap (v2.1 → v2.2 → v3)

> This document presents the strategy for **how to split versions and how to
> upgrade** when adding features in the future. Since smart-contract code is
> immutable once deployed, "how you change it" matters far more than in ordinary
> software.

<details><summary>▶ 한국어로 보기</summary>

이 문서는 향후 기능 추가 시 **버전을 어떻게 나누고, 어떤 방식으로 업그레이드해
나가야 하는지** 전략을 제시합니다. 스마트 컨트랙트는 한 번 배포하면 코드가
불변이므로, "어떻게 바꾸는가"가 일반 소프트웨어보다 훨씬 중요합니다.

</details>

---

## 1. Fundamental constraints of smart-contract upgrades

Premises you must understand first:

1. **Deployed code cannot be changed.** To fix a bug, you must deploy a new
   contract.
2. **State is bound to the contract.** A new contract starts with empty state. It
   does not automatically know existing registered names/records.
3. **When an address changes, all references must be updated.** Frontend, other
   contracts, docs, etc.

Therefore the core questions of an upgrade strategy are always two:

- **Does this change require state migration?**
- **Which contracts need replacing? (the whole thing, or just part?)**

<details><summary>▶ 한국어로 보기</summary>

전제: ① 배포된 코드는 바꿀 수 없다(버그 수정 = 새 컨트랙트 배포). ② 상태는
컨트랙트에 묶여 있다(새 컨트랙트는 빈 상태). ③ 주소가 바뀌면 모든 참조를 갱신해야
한다. 핵심 질문: **상태 마이그레이션이 필요한가?** / **전체인가 일부 교체인가?**

</details>

---

## 2. The flexibility our architecture provides

Fortunately, the current architecture allows substantial partial replacement
thanks to **separation of responsibilities**.

```
DXRegistry (state root: ownership)  ← hardest to replace (holds core state)
DXResolver (resolution records)     ← replaceable per node (registry.setResolver)
DXRegistrar (NFT + transfer hook)   ← state migration to consider on replacement
DXRegistrarController (entry point) ← easiest to replace (logic, little state)
DXPriceOracle, DXReservations       ← independent, easy to replace
extension modules                   ← add/replace like plugins
```

### 2.1 Replacement difficulty

| Contract | Difficulty | Reason |
| --- | --- | --- |
| DXRegistrarController | Easy | Logic-centric. Just add a new controller to the registrar (`addController`) |
| DXResolver | Medium | A new resolver can be assigned per node via `registry.setResolver`. But existing records aren't in the new resolver |
| DXPriceOracle / Reservations | Easy | Just update the address the controller/registrar references |
| Extension modules | Easy | Independent, delegation-based |
| DXRegistrar | Hard | Holds NFT ownership/expiry state. Migration needed on replacement |
| DXRegistry | Hardest | The root of all ownership |

### 2.2 Core insight

> **Avoid touching the state-holding contracts (Registry, Registrar) as much as
> possible, and extend features by replacing the logic-holding contracts
> (Controller, Resolver, modules).**

<details><summary>▶ 한국어로 보기</summary>

현재 아키텍처는 **역할 분리** 덕분에 부분 교체가 상당히 가능합니다. 교체 난이도:
Controller(쉬움) < Oracle/Reservations/모듈(쉬움) < Resolver(중간) <
Registrar(어려움) < Registry(가장 어려움). **핵심 통찰: 상태를 가진 컨트랙트(Registry,
Registrar)는 가급적 건드리지 말고, 로직을 가진 컨트랙트(Controller, Resolver,
모듈)를 교체하는 방향으로 확장하라.**

</details>

---

## 3. Version strategy — applying Semantic Versioning

| Version | Meaning | Examples |
| --- | --- | --- |
| **v2.x (patch/minor)** | Compatible with existing contracts; logic additions/improvements. Mainly Controller·Resolver·module replacement or new modules | new discount type, new record type, new payment token |
| **v3.0 (major)** | Structural change to core contracts (Registry/Registrar); state migration needed | new namehash scheme, multi-chain, ownership-model change |

<details><summary>▶ 한국어로 보기</summary>

| 버전 | 의미 | 예시 |
| --- | --- | --- |
| **v2.x (패치/마이너)** | 기존 컨트랙트 호환, 로직 추가/개선 | 새 할인·레코드·결제 토큰 |
| **v3.0 (메이저)** | 핵심 컨트랙트 구조 변경, 마이그레이션 필요 | namehash 체계·멀티체인·소유권 모델 |

</details>

---

## 4. v2.1 — non-disruptive feature additions (recommended priority)

Things you can add without touching existing state. The **safest** kind of
extension.

### 4.1 Add a new extension module

Deploy the new feature as an independent contract and delegate only the needed
permissions. The existing 7 contracts are not redeployed.

Candidate examples:
- **DXMarketplace**: a name-NFT exchange (safe, since v2 invalidation works
  automatically on transfer).
- **DXBatchRegistrar**: a bulk-registration tool.
- **DXNameWrapper**: an extra permission layer on names (similar to ENS
  NameWrapper).

Work: deploy the new contract → `addController` on the registrar (if needed) →
document.

### 4.2 Add a new payment token / discount

Possible via existing controller setters (no redeploy needed):
- `setAllowedPaymentToken(token, true)` — a new stablecoin.
- `setDiscountToken / setSBTDiscount / setStakeDiscount` — a new discount.

### 4.3 reverseRegistrar transfer consistency (flagged follow-up)

v2 solved forward transfer safety, but **reverse records (address → name)** were
not separately handled for consistency on transfer. A good candidate for v2.1.

Approaches:
- Option A: also clean up reverse records in the registrar `_update` hook (extra
  external call).
- Option B: deploy a new DXReverseRegistrar with consistency logic and replace.

> Not directly tied to fund loss (reverse is for display), but recommended for
> completeness.

<details><summary>▶ 한국어로 보기</summary>

기존 상태를 건드리지 않고 추가하는 **가장 안전한 확장**.

- **4.1 신규 모듈 추가**: 새 기능을 독립 컨트랙트로 배포, 필요 권한만 위임(기존 7개
  무수정). 후보: DXMarketplace(거래소), DXBatchRegistrar(대량 등록),
  DXNameWrapper(권한 레이어).
- **4.2 새 결제 토큰/할인**: 기존 컨트롤러 setter로 가능(재배포 불필요).
- **4.3 reverseRegistrar 전송 정합성**: v2는 정방향만 해결. 역방향(주소→이름) 정합성은
  v2.1 후보. 옵션 A(`_update`에서 정리) / 옵션 B(새 reverse 배포·교체). 자금 손실과
  직결되지 않으나 완성도를 위해 권장.

</details>

---

## 5. v2.2 — Resolver extension (adding record types)

When adding a new resolution record type. v2's **version-counter design shines
here.**

### 5.1 The must-follow rule when adding a new record type

> **Every newly added record mapping must include a version dimension in the form
> `[node][version][...]`.**

Only then will a single `bumpVersion` on transfer also invalidate the new record.
If you add it without a version dimension, a **new mis-routing hole** appears where
only that record remains the old owner's after transfer. (Repeating the v1
mistake.)

Example (adding a new "DNS record" type):
```solidity
// CORRECT ✅ — includes the version dimension
mapping(bytes32 => mapping(uint64 => mapping(string => bytes))) dnsRecords;
function setDns(bytes32 node, string calldata name, bytes calldata data)
    external onlyTokenOwner(node) {
    dnsRecords[node][_ver(node)][name] = data;   // ← _ver(node) required
}
function dns(bytes32 node, string calldata name) external view returns (bytes memory) {
    return dnsRecords[node][_ver(node)][name];   // ← _ver(node) required
}
```

### 5.2 Resolver replacement method

Deploy a DXResolver v2.2 with the new record type, then:
- Change the controller default so new registrations use the new resolver.
- Existing names move via `registry.setResolver(node, newResolver)` when the owner
  wants.
- But since the new resolver is empty, the owner must re-set records (or provide a
  migration tool).

### 5.3 Test obligations when adding a record

Per the `03` document's pattern, a new record type must have:
- CRUD, permission, expiry, and boundary tests
- **and a "new record also invalidated on transfer" case added to
  `Transfer-Invalidation`**

Omitting this creates a hole in transfer safety.

<details><summary>▶ 한국어로 보기</summary>

새 해석 레코드 타입을 추가하는 경우. v2의 **버전 카운터 설계가 빛을 발합니다.**

**5.1 반드시 지킬 것**: 새로 추가하는 모든 레코드 매핑은 반드시
`[node][version][...]` 형태로 버전 차원을 포함해야 합니다. 없으면 전송 후 그 레코드만
옛 소유자 것이 남는 **새 오송금 구멍**이 생깁니다(v1 실수 반복). 위 코드 예시처럼
`_ver(node)`를 읽기/쓰기에 반드시 포함.

**5.2 Resolver 교체**: 새 리졸버 배포 → 신규 등록은 새 리졸버 사용 → 기존 이름은
`registry.setResolver`로 이전(빈 상태이므로 재설정 또는 마이그레이션 도구 필요).

**5.3 테스트 의무**: 새 레코드 타입은 CRUD·권한·만료·경계 + **`Transfer-Invalidation`에
"새 레코드도 전송 시 무효화" 케이스 추가** 필수.

</details>

---

## 6. v3.0 — core structural change (major, with caution)

When you must change a state-holding contract such as Registry/Registrar. **State
migration** is needed and it is the most dangerous.

### 6.1 When v3 is needed

- namehash scheme change (different TLD structure, multi-TLD).
- multi-chain expansion (to L2/another chain).
- fundamental ownership-model change (e.g. partial-permission delegation for
  names).
- NFT standard change (ERC-721 → ERC-721A, etc. gas optimization).

### 6.2 State-migration strategies

Ways to move existing registered names/ownership/records to a new contract:

**Strategy A — snapshot + re-register (off-chain driven)**
- Index all registration events from the existing contract (snapshot).
- An operator bulk re-registers into the new contract (`registerInventoryNames`
  style).
- Pro: clean start. Con: gas cost, trust assumption.

**Strategy B — dual operation + gradual migration**
- Run v2 and v3 simultaneously. New goes to v3, existing stays on v2.
- Users migrate when they want (provide a migration tool).
- Pro: no disruption. Con: complexity, maintaining two systems.

**Strategy C — introduce a proxy pattern (requires upfront design)**
- Adopt an upgradeable proxy (UUPS/Transparent) from v3.
- Subsequent logic upgrades are possible while preserving state.
- Con: since the current v2 is not a proxy, the v3 transition itself needs
  migration.

> **Recommendation**: if you design v3, **seriously consider introducing a proxy
> pattern**. Then upgrades after v3 (v3.1, v3.2…) can replace only logic while
> preserving state, so you don't have to repeat full redeployment + address updates
> as now.

### 6.3 v3 transition checklist

```
[ ] decide migration strategy (A/B/C)
[ ] tool to snapshot/index existing state
[ ] migration function in the new contract (operator-only, bulk)
[ ] dual-operation period policy
[ ] user migration UX
[ ] decide whether to adopt a proxy
[ ] full tests + migration tests
[ ] large-scale Amoy rehearsal (simulating real data volume)
[ ] phased mainnet transition
```

<details><summary>▶ 한국어로 보기</summary>

Registry/Registrar 같은 상태 보유 컨트랙트를 바꿔야 하는 경우. **상태 마이그레이션**이
필요하며 가장 위험합니다.

**6.1 언제 필요한가**: namehash 체계 변경, 멀티체인, 소유권 모델 변경, NFT 표준 변경.

**6.2 마이그레이션 전략**: A(스냅샷+재등록, off-chain 주도 — 깨끗하나 가스·신뢰),
B(듀얼 운영+점진 이전 — 무중단이나 복잡), C(프록시 패턴 — 이후 상태 보존 업그레이드
가능). **권장: v3 설계 시 프록시 패턴을 진지하게 검토** → 이후 v3.1, v3.2는 상태
보존하며 로직만 교체 가능.

**6.3 v3 체크리스트**: 전략 결정 → 스냅샷 도구 → 마이그레이션 함수 → 듀얼 운영 정책
→ 마이그레이션 UX → 프록시 결정 → 전체+마이그레이션 테스트 → 대규모 Amoy 리허설 →
단계적 메인넷 전환.

</details>

---

## 7. Principles to follow in every upgrade

### 7.1 Preserve the transfer-safety invariant (top priority)

In any version, **control transfer + invalidation of all records on NFT transfer**
must not break. Specifically:

- New record types must include the version dimension
  (`[node][_ver(node)][...]`).
- If you replace the registrar, confirm the `_update` hook is intact and that it
  is connected to the new resolver via `setRegistrar`.
- Extend the `Transfer-Invalidation`/`Transfer-Edge` tests to fit the new feature.
- Confirm the core invariant test (`NFT owner == registry owner`) still passes.

### 7.2 Follow the deployment procedure

Follow the `05` document's procedure exactly. In particular:
- wiring + `after` order in all three deployment modules.
- Amoy (mock) rehearsal → mainnet.
- new deployment-id, gas headroom, source verification, wiring check.

### 7.3 Update docs/tests together

- Reflect new features in `01` (contracts) and `03` (tests).
- On address changes, update `README`, `HANDOFF_REPORT`, scripts.
- Record the upgrade itself in this `06` document (version history).

### 7.4 Consider backward compatibility

- Changing an interface (IDX*.sol) affects everything that depends on it.
- Where possible, keep existing function signatures and add new functions.

<details><summary>▶ 한국어로 보기</summary>

**7.1 전송 안전성 불변식 보존(최우선)**: 새 레코드는 버전 차원 포함, registrar 교체
시 `_update` 훅·`setRegistrar` 연결 확인, Transfer 테스트 확장, `NFT owner == registry
owner` 통과 확인. **7.2 배포 절차 준수**(`05` 문서). **7.3 문서·테스트 동반 갱신**.
**7.4 하위 호환성**: 인터페이스 변경은 의존처에 영향 → 기존 시그니처 유지, 새 함수 추가.

</details>

---

## 8. Version history (managed in this document)

| Version | Date | Major change | Deployment |
| --- | --- | --- | --- |
| v1 | (pre-launch) | Initial system (registration·resolution·NFT·discount·subname·subscription·agent) | chain-137 (deprecated) |
| **v2** | 2026-05 | **Transfer safety: record version counter + _update hook. Control transfer + 6-kind invalidation on transfer. 155 tests.** | polygon-v2-clean |
| v2.1 | (planned) | reverseRegistrar consistency, new modules (exchange, etc.) | — |
| v2.2 | (planned) | new record types (version dimension required) | — |
| v3.0 | (under review) | core structural change + proxy review | — |

> Add a row to this table for each future upgrade.

<details><summary>▶ 한국어로 보기</summary>

| 버전 | 날짜 | 주요 변경 | 배포 |
| --- | --- | --- | --- |
| v1 | (출시 전) | 초기 시스템 | chain-137 (폐기) |
| **v2** | 2026-05 | **전송 안전성: 버전 카운터 + _update 훅, 6종 무효화, 155 테스트** | polygon-v2-clean |
| v2.1 | (예정) | reverseRegistrar 정합성, 신규 모듈 | — |
| v2.2 | (예정) | 새 레코드 타입(버전 차원 필수) | — |
| v3.0 | (검토) | 핵심 구조 변경 + 프록시 검토 | — |

향후 업그레이드 시 이 표에 한 줄씩 추가하세요.

</details>

---

## 9. Quick decision guide

When a new feature request comes in:

```
Can this feature be separated into a new contract?
  ├─ Yes → v2.1: add a module (safest, no changes to existing)
  └─ No →
       Can it be done by changing only Controller/Oracle/Reservations logic?
         ├─ Yes → v2.x: replace that contract + update references
         └─ No →
              Is it a new record type?
                ├─ Yes → v2.2: extend Resolver (version dimension required!)
                └─ No (Registry/Registrar structural change) →
                     v3.0: state migration + proxy review (with caution)
```

The key: **solve it with the lowest version possible (= the smallest change)**, and
keep replacing state-holding contracts as a last resort.

<details><summary>▶ 한국어로 보기</summary>

새 기능 요청 시: 새 컨트랙트로 분리 가능? → 예: **v2.1 모듈 추가**(가장 안전). 아니오 →
Controller/Oracle/Reservations 로직만? → 예: **v2.x 해당 컨트랙트 교체**. 아니오 →
새 레코드 타입? → 예: **v2.2 Resolver 확장**(버전 차원 필수!). 아니오(구조 변경) →
**v3.0 마이그레이션+프록시 검토**. 핵심: **가능한 한 낮은 버전(작은 변경)으로 해결**,
상태 보유 컨트랙트 교체는 최후의 수단.

</details>
