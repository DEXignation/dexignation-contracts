# Transfer Safety v2 — Design Retrospective

> How a latent fund-loss risk in NFT transfers was identified, reasoned through,
> and resolved across the DEXignation contract suite.

<details><summary>▶ 한국어로 보기</summary>

> DEXignation 컨트랙트 전반에 잠재해 있던 **NFT 전송 시 자금 손실 위험**을
> 어떻게 발견하고, 추론하고, 해결했는지에 대한 설계 회고.

</details>

---

## 1. The problem: a name can outlive its owner

A `.dex` name is an ERC-721 NFT. The whole point of a name is **resolution** —
`roy.dex` should resolve to the address its current owner controls, so that
funds, messages, and agent traffic reach the right party.

In v1, transferring the NFT did **not** transfer that resolution. After a sale
or a wallet move, `roy.dex` kept resolving to the **previous** owner's address.
Anyone paying to `roy.dex` would send funds to someone who no longer owned the
name. This is the most dangerous class of bug a naming service can have: a
silent, on-chain mis-routing of value with no error and no warning.

<details><summary>▶ 한국어로 보기</summary>

`.dex` 이름은 ERC-721 NFT다. 이름의 존재 이유는 **해석(resolution)** 이다 —
`roy.dex`는 현재 소유자가 통제하는 주소로 해석되어야 자금·메시지·에이전트
트래픽이 올바른 상대에게 도달한다.

v1에서는 NFT를 전송해도 그 해석이 따라오지 **않았다**. 판매하거나 지갑을 옮긴
뒤에도 `roy.dex`는 **이전** 소유자의 주소로 계속 해석됐다. `roy.dex`로 송금한
사람은 더 이상 그 이름을 소유하지 않은 사람에게 자금을 보내게 된다. 이는
네이밍 서비스가 가질 수 있는 가장 위험한 부류의 버그다 — 에러도 경고도 없이
가치가 조용히 잘못 라우팅된다.

</details>

---

## 2. Why it happened: three structural gaps in v1

Reviewing the v1 source revealed that the NFT (ownership) and the resolution
(records) were never actually coupled at the contract level.

**Gap 1 — No transfer hook on the registrar.** `DXRegistrar` (the ERC-721) had
no `_update` override. The ERC-721 `ownerOf` changed on transfer, but nothing
propagated that change anywhere else.

**Gap 2 — Registry ownership synced only by hand.** The `DXRegistry` stored its
own `owner(node)` mapping, used for resolver write-permission. It was updated
only via a manual `reclaim(id, owner)` call. A normal NFT transfer never
triggered it, so registry ownership silently drifted away from NFT ownership.

**Gap 3 — Resolver records had no version.** `DXResolver` stored records as
`records[node][...]`. There was no notion of "these records belonged to a past
owner." A transfer left every stale record (address, text, contenthash,
profile, ABI, agent) fully intact and resolving.

The net effect: ownership moved, control and records did not.

<details><summary>▶ 한국어로 보기</summary>

## 2. 왜 발생했나: v1의 세 가지 구조적 공백

v1 소스를 검토한 결과, NFT(소유권)와 해석(레코드)이 컨트랙트 수준에서 실제로
전혀 연결돼 있지 않았다.

**공백 1 — 레지스트라에 전송 훅 없음.** `DXRegistrar`(ERC-721)에 `_update`
오버라이드가 없었다. 전송 시 ERC-721 `ownerOf`는 바뀌지만, 그 변화가 다른
어디에도 전파되지 않았다.

**공백 2 — 레지스트리 소유권이 수동으로만 동기화.** `DXRegistry`는 리졸버 쓰기
권한에 쓰이는 자체 `owner(node)` 매핑을 가졌는데, 오직 수동 `reclaim(id, owner)`
호출로만 갱신됐다. 일반 NFT 전송은 이를 트리거하지 않아, 레지스트리 소유권이
NFT 소유권과 조용히 어긋났다.

**공백 3 — 리졸버 레코드에 버전 없음.** `DXResolver`는 레코드를
`records[node][...]`로 저장했다. "이 레코드가 과거 소유자의 것"이라는 개념이
없었다. 전송이 일어나도 모든 낡은 레코드(주소·텍스트·콘텐트해시·프로필·ABI·
에이전트)가 그대로 남아 계속 해석됐다.

순효과: 소유권은 이동했지만, 제어권과 레코드는 따라오지 않았다.

</details>

---

## 3. The design decision: invalidate by versioning, not deletion

Two questions drove the design.

**Q1 — When should records be cleared?** On every genuine ownership transfer.

**Q2 — How should they be cleared?** This was the key decision. Two options:

- **Delete each record.** Solidity mappings cannot be enumerated, so deletion
  requires knowing every key ever written. That is gas-explosive, error-prone,
  and guaranteed to miss keys eventually.
- **Bump a version counter.** Store records under `[node][version][...]` and
  increment `version` on transfer. Every record kind becomes unreachable in a
  single `O(1)` operation — no enumeration, no omissions.

We chose **versioning**. It invalidates all six record kinds at once, and — a
property explicitly valued for this service — it leaves the old records on chain
under the previous version, preserving a full **ownership and fund-routing
history** for audit and tracing. This mirrors the battle-tested ENS
`PublicResolver` versioning pattern.

<details><summary>▶ 한국어로 보기</summary>

## 3. 설계 결정: 삭제가 아닌 버전 증가로 무효화

두 가지 질문이 설계를 이끌었다.

**Q1 — 언제 레코드를 비워야 하나?** 진짜 소유권 전송이 일어날 때마다.

**Q2 — 어떻게 비워야 하나?** 이것이 핵심 결정이었다. 두 가지 선택지:

- **각 레코드를 삭제.** Solidity 매핑은 순회가 불가능하므로, 삭제하려면 그동안
  기록된 모든 키를 알아야 한다. 가스가 폭발적이고, 실수하기 쉽고, 결국 키를
  빠뜨리게 된다.
- **버전 카운터 증가.** 레코드를 `[node][version][...]`로 저장하고 전송 시
  `version`을 올린다. 모든 레코드 종류가 단일 `O(1)` 연산으로 도달 불가능해진다
  — 순회도, 누락도 없다.

우리는 **버전 방식**을 택했다. 6종 레코드를 한 번에 무효화하며, 이 서비스에서
명시적으로 중시한 속성 — 옛 레코드를 이전 버전 아래 체인에 남겨 **소유권 및
자금 라우팅 이력** 전체를 감사·추적용으로 보존한다. 이는 검증된 ENS
`PublicResolver` 버전 패턴을 따른다.

</details>

---

## 4. What changed in v2

### 4.1 `DXResolver` — versioned records

- Added `mapping(bytes32 => uint64) public recordVersions;` and an internal
  `_ver(node)` helper.
- All six record mappings gained a version dimension:
  `textRecords[node][ver][key]`, `multiLangText[node][ver][key][lang]`,
  `contenthashes[node][ver]`, `addresses[node][ver][coinType]`,
  `abiRecords[node][ver][chainId][contentType]`, `agentRecords[node][ver]`.
- Added `address public registrar`, `setRegistrar(address)` (owner-only), and
  `bumpVersion(bytes32 node)` guarded by `onlyRegistrar`.

### 4.2 `DXRegistrar` — the `_update` hook

Overrode OpenZeppelin's ERC-721 `_update`. On a transfer that is neither a mint
(`from == 0`), a burn (`to == 0`), nor a controller delivery
(`!controllers[from]`), it:

1. moves registry control: `registry.setSubnodeOwner(baseNode, label, to)`;
2. invalidates records: `recordResolver.bumpVersion(node)`.

State changes happen via `super._update` **before** the external calls, and both
callees are trusted, callback-free contracts — so there is no reentrancy vector.

### 4.3 The controller-delivery carve-out

Registration delivers the NFT as: controller mints to **itself**, sets the
initial address record, then `transferFrom`s to the real owner. That final leg
is a real transfer (`from != 0`, `to != 0`) and would otherwise wipe the
freshly-set address. The `!controllers[from]` condition skips invalidation for
controller-originated transfers, so **registration keeps its auto-set record**
while **genuine user-to-user transfers invalidate**.

### 4.4 Deployment wiring and ordering

`registrar.setResolver` ↔ `resolver.setRegistrar` are wired in the Ignition
modules. Because `registrar.setResolver` internally requires the registrar to
already own `baseNode`, `SetRegistrarResolver` is ordered **after**
`GrantTldToRegistrar` via Ignition's `after:` — preventing an `Unauthorized()`
revert that depended on batch ordering luck.

<details><summary>▶ 한국어로 보기</summary>

## 4. v2에서 바뀐 것

### 4.1 `DXResolver` — 버전화된 레코드

- `mapping(bytes32 => uint64) public recordVersions;`와 내부 `_ver(node)` 헬퍼
  추가.
- 6종 레코드 매핑 전부에 버전 차원 추가: `textRecords[node][ver][key]`,
  `multiLangText[node][ver][key][lang]`, `contenthashes[node][ver]`,
  `addresses[node][ver][coinType]`, `abiRecords[node][ver][chainId][contentType]`,
  `agentRecords[node][ver]`.
- `address public registrar`, `setRegistrar(address)`(오너 전용),
  `onlyRegistrar`로 보호되는 `bumpVersion(bytes32 node)` 추가.

### 4.2 `DXRegistrar` — `_update` 훅

OpenZeppelin ERC-721의 `_update`를 오버라이드. mint(`from == 0`)도, burn
(`to == 0`)도, 컨트롤러 배달(`!controllers[from]`)도 아닌 전송에서:

1. 레지스트리 제어권 이전: `registry.setSubnodeOwner(baseNode, label, to)`;
2. 레코드 무효화: `recordResolver.bumpVersion(node)`.

상태 변경은 외부 호출 **이전에** `super._update`로 일어나고, 두 피호출 컨트랙트
모두 콜백 없는 신뢰 컨트랙트이므로 재진입 벡터가 없다.

### 4.3 컨트롤러 배달 예외 처리

등록은 NFT를 이렇게 배달한다: 컨트롤러가 **자신에게** mint → 초기 주소 레코드
설정 → 실제 소유자에게 `transferFrom`. 이 마지막 단계는 진짜 전송
(`from != 0`, `to != 0`)이라, 그대로 두면 방금 설정한 주소가 지워진다.
`!controllers[from]` 조건이 컨트롤러발 전송의 무효화를 건너뛰어, **등록은
자동설정 레코드를 유지**하고 **진짜 유저 간 전송은 무효화**한다.

### 4.4 배포 와이어링과 순서

`registrar.setResolver` ↔ `resolver.setRegistrar`를 Ignition 모듈에서 연결한다.
`registrar.setResolver`가 내부적으로 레지스트라가 이미 `baseNode`를 소유할 것을
요구하므로, `SetRegistrarResolver`를 Ignition의 `after:`로 `GrantTldToRegistrar`
**이후**에 배치한다 — 배치 순서 운에 의존하던 `Unauthorized()` revert를 방지.

</details>

---

## 5. Verification

| Layer | What was checked | Result |
| --- | --- | --- |
| Unit tests | Full suite incl. 7 invalidation + 6 edge-case tests | 155 passing |
| Reentrancy / auth / expiry | Code review of `_update`, `bumpVersion`, `setRegistrar` | No findings |
| Live testnet (Amoy) | Register → set records → transfer → verify | version 0→1, control moved, records empty |
| Mainnet redeploy | 7 contracts deployed + source-verified | Done |
| Mainnet wiring | `registrar.recordResolver` / `resolver.registrar` | Both set |

The transfer-invalidation tests assert that after a user-to-user transfer:
registry owner becomes the new holder; **all six** record kinds read empty; the
old owner can no longer write while the new owner can; resolution resumes once
the new owner sets a fresh record; and the version counter increments while old
records persist on chain.

<details><summary>▶ 한국어로 보기</summary>

## 5. 검증

| 계층 | 확인 내용 | 결과 |
| --- | --- | --- |
| 단위 테스트 | 무효화 7 + 엣지케이스 6 포함 전체 스위트 | 155개 통과 |
| 재진입/권한/만료 | `_update`, `bumpVersion`, `setRegistrar` 코드 리뷰 | 발견 없음 |
| 라이브 테스트넷(Amoy) | 등록 → 레코드 설정 → 전송 → 검증 | version 0→1, 제어권 이전, 레코드 무효화 |
| 메인넷 재배포 | 7개 컨트랙트 배포 + 소스 검증 | 완료 |
| 메인넷 와이어링 | `registrar.recordResolver` / `resolver.registrar` | 둘 다 설정됨 |

전송-무효화 테스트는 유저 간 전송 후 다음을 단언한다: 레지스트리 소유자가 새
보유자로 바뀌고; **6종 전부** 빈 값으로 읽히고; 옛 소유자는 더 이상 쓰지 못하고
새 소유자는 쓸 수 있으며; 새 소유자가 새 레코드를 설정하면 해석이 재개되고;
버전 카운터가 증가하는 동안 옛 레코드는 체인에 남는다.

</details>

---

## 6. Deployed addresses (Polygon mainnet, v2)

| Contract | Address |
| --- | --- |
| DXResolver | `0xb8b44561A52cf2929D3E6BF02d3B18a9e20CdE82` |
| DXRegistrar | `0x1DaDBb206a05b2821935c467015C77fD61e02951` |
| DXRegistry | `0x0eE48aCcB768758Ba509Ef08D4f00d03C1B6e3A9` |
| DXRegistrarController | `0xd456dC842B6c05084a0e884b7247F9ee90472432` |
| DXPriceOracle | `0xc3751923bF9C485Ac927096D42469f6287156B42` |
| DXReverseRegistrar | `0xb6b165eB79E1Acf54eE8acFAf5FCC77241D6Fef0` |
| DXReservations | `0xfB22CE3135e8a0b6c91bb74884Ea73A4caa6b32b` |

All seven are source-verified on PolygonScan and Sourcify.

---

## 7. Follow-ups

- **Reverse records** (address → name) were not part of this change; their
  transfer-time consistency is flagged for a separate review (not fund-loss
  critical).
- **Frontend UX**: prompt a new owner to set their address after receiving a
  transferred name, since v2 intentionally clears it.
- **Admin key**: a single owner key currently administers all seven contracts;
  consider a multisig.

<details><summary>▶ 한국어로 보기</summary>

## 7. 후속 과제

- **역방향 레코드**(주소 → 이름)는 이번 변경 범위가 아니었다. 전송 시 정합성은
  별도 검토 대상으로 표시(자금 손실과 직결되지는 않음).
- **프론트엔드 UX**: v2가 의도적으로 주소를 비우므로, 전송받은 새 소유자에게
  주소 설정을 안내할 것.
- **관리자 키**: 현재 단일 오너 키가 7개 컨트랙트 전부를 관리한다. 멀티시그
  도입 검토.

</details>
