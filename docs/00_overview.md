# 00. DEXignation — System Overview

> This document is the starting point for understanding the DEXignation smart
> contract system as a whole. For per-contract detail see `01_contracts.md`, for
> the v2 transfer-safety work see `02_transfer_safety_v2.md`, and for the test
> suite see `03_tests.md`.

<details><summary>▶ 한국어로 보기</summary>

이 문서는 DEXignation 스마트 컨트랙트 시스템의 전체 그림을 잡기 위한 출발점입니다.
개별 컨트랙트의 상세는 `01_contracts.md`, 전송 안전성 v2 작업은
`02_transfer_safety_v2.md`, 테스트는 `03_tests.md`를 참조하세요.

</details>

---

## 1. What is DEXignation

DEXignation is an **on-chain naming service** running on Polygon. Users register
human-readable names such as `roy.dex` and configure them to **resolve** to their
wallet address, profile, content, agent endpoints, and more.

The core concept is in the same family as ENS (Ethereum Name Service). However,
DEXignation has the following distinctive characteristics:

- **A name is an ERC-721 NFT** — each `.dex` name is minted as an NFT and can be
  owned, transferred, and traded.
- **Term-based registration + tier NFT** — depending on the registration term
  (1–15 years) the NFT is assigned a color tier (charcoal → gold), and its
  on-chain SVG changes dynamically with expiry/renewal.
- **USD-fixed pricing + live POL conversion** — prices are fixed in USD
  ($8/$18/$25/$40/$55) and converted to a live POL amount via a Chainlink oracle
  at payment time.
- **Discount system** — discounts for token holding, SBT holding, and staking.
- **Subname commerce** — a parent name owner can sell child names.
- **Auto-renewal (subscription)** — USDT/USDC-based automatic renewal.
- **Agent identity & payment routing** — record AI agent information and a payment
  path on a name.

<details><summary>▶ 한국어로 보기</summary>

DEXignation은 Polygon 위에서 동작하는 **온체인 네이밍 서비스**입니다. 사용자는
`roy.dex` 같은 사람이 읽을 수 있는 이름을 등록하고, 그 이름이 자신의 지갑 주소,
프로필, 콘텐츠, 에이전트 엔드포인트 등으로 **해석(resolution)** 되도록 설정할 수
있습니다.

핵심 개념은 ENS(Ethereum Name Service)와 같은 계열입니다. 다만 DEXignation은
다음과 같은 독자적 특성을 가집니다.

- **이름 = ERC-721 NFT**: 각 `.dex` 이름은 NFT로 발행되어 소유·양도·거래가 가능합니다.
- **기간제 등록 + 등급 NFT**: 등록 기간(1~15년)에 따라 NFT에 색상 등급(charcoal~gold)이
  부여되고, 만료/갱신에 따라 온체인 SVG가 동적으로 변합니다.
- **USD 고정가 + 실시간 POL 환산**: 가격은 USD로 고정($8/$18/$25/$40/$55)이고,
  Chainlink 오라클로 실시간 POL 수량으로 환산해 결제합니다.
- **할인 체계**: 토큰 보유, SBT 보유, 스테이킹에 따른 할인.
- **서브네임 상거래**: 부모 이름 소유자가 하위 이름을 판매할 수 있습니다.
- **자동 갱신(구독)**: USDT/USDC 기반 자동 갱신.
- **에이전트 식별·결제 라우팅**: 이름에 AI 에이전트 정보와 결제 경로를 기록.

</details>

---

## 2. Architecture at a Glance

The system is composed of several contracts with separated responsibilities. The
"single source of truth" for authority and data is **DXRegistry**; the remaining
contracts cooperate around it.

```
                         ┌─────────────────────────┐
         User  ─────────▶│   DXRegistrarController  │  register/renew/pay/discount entry
                         └───────────┬─────────────┘
                                     │ register / renew
                       ┌─────────────┼──────────────┐
                       ▼             ▼              ▼
              ┌──────────────┐ ┌───────────┐ ┌──────────────┐
              │  DXRegistrar │ │DXPriceOracle│ │ DXReservations│
              │ (ERC-721 NFT)│ │ (USD→POL)  │ │ (reserved)    │
              └──────┬───────┘ └───────────┘ └──────────────┘
                     │ _update hook (v2)
                     │ setSubnodeOwner / bumpVersion
                     ▼
              ┌──────────────┐         ┌──────────────┐
              │  DXRegistry  │◀────────│  DXResolver  │  addr·text·profile·
              │ (authority)  │ owner() │  (records)    │  content·agent resolution
              └──────┬───────┘         └──────────────┘
                     │
                     ▼
              ┌────────────────────┐
              │ DXReverseRegistrar │  reverse resolution (address → name)
              └────────────────────┘

   Extension modules (optional):
     - DXSubscriptionRenewer  : USDT/USDC auto-renewal
     - DXContributionSBT      : contributor badge (SBT)
     - DXNToken / DXNStaking   : native token + staking (for discounts)
     - RevenueDistributor     : revenue distribution
```

The key relationships, in words:

1. The user registers/renews names through **DXRegistrarController**. The
   controller handles price calculation (DXPriceOracle), reservation checks
   (DXReservations), and discount application.
2. The controller delegates NFT minting to **DXRegistrar** (ERC-721). The
   registrar, as the owner of the `.dex` TLD node, has the authority to create
   subnodes (individual names).
3. When an NFT is minted/transferred, the registrar records ownership in
   **DXRegistry** and manages the record version of **DXResolver** (the v2 core).
4. **DXRegistry** is the root of all authority. It stores "who owns this node,"
   and DXResolver judges record-write permission based on this information.
5. **DXResolver** holds the actual resolution data (address, text, content,
   profile, ABI, agent).

<details><summary>▶ 한국어로 보기</summary>

시스템은 역할이 분리된 여러 컨트랙트로 구성됩니다. 권한과 데이터의 "단일 진실
공급원(single source of truth)"은 **DXRegistry**이며, 나머지 컨트랙트들이 이를
중심으로 협력합니다. (위 다이어그램 참조)

핵심 관계를 말로 풀면 다음과 같습니다.

1. 사용자는 **DXRegistrarController**를 통해 이름을 등록/갱신합니다. 컨트롤러는
   가격 계산(DXPriceOracle), 예약 확인(DXReservations), 할인 적용을 담당합니다.
2. 컨트롤러는 **DXRegistrar**(ERC-721)에 NFT 발행을 위임합니다. registrar는
   `.dex` TLD 노드의 소유자로서 서브노드(개별 이름)를 만들 권한이 있습니다.
3. NFT가 발행/이전될 때 registrar는 **DXRegistry**에 소유권을 기록하고,
   **DXResolver**의 레코드 버전을 관리합니다(v2 핵심).
4. **DXRegistry**는 모든 권한의 루트입니다. "이 노드의 소유자가 누구인가"를
   저장하며, DXResolver는 이 정보를 기준으로 레코드 쓰기 권한을 판단합니다.
5. **DXResolver**는 실제 해석 데이터(주소·텍스트·콘텐츠·프로필·ABI·에이전트)를
   보관합니다.

</details>

---

## 3. Node and tokenId — how a name becomes a key

To understand DEXignation you need to know "how a name is turned into a
fixed-length key." It uses the same **namehash** algorithm as ENS.

### 3.1 labelhash

The keccak256 hash of a single label (one piece separated by dots, e.g. `roy`).

```
labelhash("roy") = keccak256("roy")
```

### 3.2 node (namehash)

The recursive hash of the full name. The parent node and the labelhash are
concatenated and hashed again.

```
namehash("")        = 0x0000...0000  (root, 32 zero bytes)
namehash("dex")     = keccak256( namehash("") + labelhash("dex") )
namehash("roy.dex") = keccak256( namehash("dex") + labelhash("roy") )
```

- `namehash("dex")` is called the **baseNode** or **TLD node**. The registrar
  owns this node.
- `namehash("roy.dex")` is the **node** of an individual name, used as the key
  pointing to this name in DXResolver/DXRegistry.

### 3.3 tokenId

The NFT's tokenId is the labelhash converted to uint256.

```
tokenId = uint256(labelhash("roy")) = uint256(keccak256("roy"))
```

Therefore the following relationship always holds:

```
node = keccak256( baseNode + bytes32(tokenId) )
```

This relationship is used critically in the v2 `_update` hook to derive the node
back from the tokenId (see section 5 and the `02` document).

> **Note — implementation difference in namehash computation**: when computing a
> node in scripts/tests, use the form
> `keccak256(encodePacked(["bytes32","bytes32"], [parent, labelhash]))`. Plain
> string concatenation (`parent + labelhash.slice(2)`) produces the same result,
> but for type safety and consistency we standardize on the `encodePacked`
> approach. (Early scripts actually mixed the two approaches and caused confusion;
> we unified on `encodePacked` based on the verification script.)

<details><summary>▶ 한국어로 보기</summary>

DEXignation을 이해하려면 "이름이 어떻게 고정 길이 키로 바뀌는가"를 알아야 합니다.
ENS와 동일한 **namehash** 알고리즘을 씁니다.

**3.1 라벨해시 (labelhash)** — 하나의 라벨(점으로 구분된 한 조각, 예: `roy`)을
keccak256 해시한 값입니다. `labelhash("roy") = keccak256("roy")`

**3.2 노드 (namehash)** — 전체 이름을 재귀적으로 해시한 값입니다. 부모 노드와
라벨해시를 이어 붙여 다시 해시합니다.
- `namehash("dex")`를 **baseNode** 또는 **TLD 노드**라고 부릅니다. registrar가
  이 노드의 소유자입니다.
- `namehash("roy.dex")`가 개별 이름의 **node**이며, DXResolver/DXRegistry에서
  이 이름을 가리키는 키로 쓰입니다.

**3.3 토큰ID** — NFT의 토큰ID는 라벨해시를 uint256으로 변환한 값입니다. 따라서
`node = keccak256(baseNode + bytes32(tokenId))` 관계가 항상 성립합니다. 이 관계는
v2의 `_update` 훅에서 토큰ID로부터 노드를 역산할 때 핵심적으로 사용됩니다.

**주의 — namehash 계산의 구현 차이**: 스크립트/테스트에서 노드를 계산할 때
`keccak256(encodePacked(["bytes32","bytes32"], [parent, labelhash]))` 형태를
써야 합니다. 단순 문자열 연결도 같은 결과를 내지만, 타입 안전성과 일관성을 위해
`encodePacked` 방식을 표준으로 합니다. (실제로 초기 스크립트에서 이 두 방식이
섞여 혼란이 있었고, 검증 스크립트 기준으로 `encodePacked`로 통일했습니다.)

</details>

---

## 4. The full registration flow (commit-reveal)

Name registration is done in two commit-reveal stages to defend against
**front-running**. Understanding this flow is the foundation for understanding the
system's behavior and several of the tests.

```
1. commit stage
   The user submits a commitment that hashes (label, owner, duration,
   resolver, payment token, secret). The actual label is not revealed.

2. wait (minCommitmentAge)
   A minimum wait time must pass before reveal is possible. This window
   blocks front-running. If too long (maxCommitmentAge), it becomes invalid.

3. register stage (reveal)
   The user reveals the actual parameters and registers. The contract
   recomputes the commitment and checks for a match. If it matches:
     a. price calculation (DXPriceOracle, discount applied)
     b. payment received (POL or USDT/USDC)
     c. NFT minted (DXRegistrar) — controller mints to itself
     d. resolver set + initial address recorded (DXResolver)
     e. registry ownership set
     f. NFT transferred to the actual owner (controller → user)
     g. overpayment refunded
```

> **Important (connects to v2)**: in steps (c)–(f) above, the structure where the
> controller **mints the NFT to itself and then transfers it to the user** becomes
> the key issue in the v2 transfer-safety work. This "controller → user" transfer
> is not an ordinary user-to-user transfer but a "registration delivery," so it
> must be handled as an exception in v2's invalidation logic. See the `02`
> document for details.

<details><summary>▶ 한국어로 보기</summary>

이름 등록은 **선점 공격(front-running) 방어**를 위해 2단계 commit-reveal로
이루어집니다. 이 흐름을 이해하는 것이 시스템 동작과 여러 테스트를 이해하는
기반이 됩니다.

1. **commit 단계** — 사용자가 (라벨, 소유자, 기간, 리졸버, 결제토큰, secret)을
   해시한 commitment를 제출. 실제 라벨은 노출되지 않음.
2. **대기 (minCommitmentAge)** — 최소 대기 시간이 지나야 reveal 가능. 이 윈도우가
   선점 공격을 막는다. 너무 오래 지나면(maxCommitmentAge) 무효.
3. **register 단계 (reveal)** — 사용자가 실제 파라미터를 공개하며 등록. 컨트랙트는
   commitment를 재계산해 일치하는지 확인. 일치하면: (a) 가격 계산 (b) 결제 수령
   (c) NFT 발행(컨트롤러가 자신에게) (d) 리졸버 설정 + 초기 주소 기록 (e) Registry
   소유권 설정 (f) NFT를 실제 소유자에게 전송 (g) 초과 결제분 환불.

**중요 (v2와 연결)**: 위 흐름의 (c)~(f)에서 컨트롤러가 NFT를 **자신에게 발행한 뒤
사용자에게 전송**하는 구조가, v2 전송 안전성 작업에서 핵심 쟁점이 됩니다. 이
"컨트롤러 → 사용자" 전송은 일반적인 유저 간 양도가 아니라 "등록 배달"이므로, v2의
무효화 로직에서 예외 처리해야 합니다. (`02` 문서 참조)

</details>

---

## 5. The decisive difference between v1 and v2 — transfer safety

This is the core of this major piece of work. In one sentence:

> **In v1, transferring the NFT did not carry over the name's control and
> resolution records, so even after transfer the name still pointed to the
> previous owner. v2 automatically performs control transfer and record
> invalidation on NFT transfer.**

### The v1 problem

- Even if you sell the NFT to Bob, `roy.dex` still resolves to Alice's address.
- Sending funds to `roy.dex` goes to Alice, who is no longer the owner.
- No error, no warning, no failing test — a silent mis-routing.

### The v2 solution

- An ERC-721 `_update` hook is added to the registrar.
- When a real transfer occurs (excluding mint/burn/registration-delivery), it
  automatically:
  1. transfers ownership in DXRegistry to the new holder, and
  2. increments the record version in DXResolver, invalidating all six record
     kinds at once.
- Old records are preserved on-chain under the previous version, enabling history
  tracking.

The detailed background, reasoning, implementation, and verification of this work
are covered step by step in `02_transfer_safety_v2.md`.

<details><summary>▶ 한국어로 보기</summary>

이번 대규모 작업의 핵심입니다. 한 문장으로 요약하면:

> **v1에서는 NFT를 양도해도 이름의 제어권과 해석 레코드가 따라오지 않아, 양도
> 후에도 이름이 이전 소유자를 가리켰다. v2는 NFT 전송 시 제어권 이전과 레코드
> 무효화를 자동으로 수행한다.**

**v1의 문제** — NFT를 Bob에게 팔아도 `roy.dex`는 여전히 Alice 주소로 해석됨.
`roy.dex`로 송금하면 더 이상 소유자가 아닌 Alice에게 자금이 감. 에러도, 경고도,
실패하는 테스트도 없음 — 조용한 오송금.

**v2의 해결** — registrar에 ERC-721 `_update` 훅을 추가. 진짜 전송(mint·burn·등록
배달 제외)이 일어나면 자동으로: (1) DXRegistry의 소유권을 새 보유자로 이전,
(2) DXResolver의 레코드 버전을 증가시켜 6종 레코드를 일괄 무효화. 옛 레코드는
이전 버전 아래 체인에 보존되어 이력 추적 가능.

이 작업의 상세한 배경·추론·구현·검증은 `02_transfer_safety_v2.md`에서 단계별로
다룹니다.

</details>

---

## 6. Tech stack

| Item | Detail |
| --- | --- |
| Language | Solidity 0.8.28 (EVM target: cancun) |
| Framework | Hardhat 3 + Hardhat Ignition (deployment) |
| Testing | Mocha + viem |
| Libraries | OpenZeppelin 5.x (ERC-721, Ownable, ReentrancyGuard, etc.) |
| Oracle | Chainlink AggregatorV3 (POL/USD) |
| Chains | Polygon mainnet (chain-137), Amoy testnet (chain-80002) |
| Compile options | optimizer enabled (runs 200), viaIR true |

> **Build profile caution**: both the `default` and `production` profiles in
> `hardhat.config.ts` must have `{optimizer:{enabled,runs:200}, viaIR:true,
> evmVersion:"cancun"}`. Ignition uses the `production` profile, so if viaIR etc.
> is missing there, the deployment compile artifacts may differ from the tests.

<details><summary>▶ 한국어로 보기</summary>

| 항목 | 내용 |
| --- | --- |
| 언어 | Solidity 0.8.28 (EVM target: cancun) |
| 프레임워크 | Hardhat 3 + Hardhat Ignition (배포) |
| 테스트 | Mocha + viem |
| 라이브러리 | OpenZeppelin 5.x (ERC-721, Ownable, ReentrancyGuard 등) |
| 오라클 | Chainlink AggregatorV3 (POL/USD) |
| 체인 | Polygon 메인넷(chain-137), Amoy 테스트넷(chain-80002) |
| 컴파일 옵션 | optimizer enabled (runs 200), viaIR true |

**빌드 프로파일 주의**: `hardhat.config.ts`의 `default`와 `production` 프로파일
**둘 다** `{optimizer:{enabled,runs:200}, viaIR:true, evmVersion:"cancun"}`를
가져야 합니다. Ignition은 `production` 프로파일을 사용하므로, 여기에 viaIR 등이
빠지면 배포 시 컴파일 산출물이 테스트와 달라질 수 있습니다.

</details>

---

## 7. Contract list and one-line roles

| Contract | Role |
| --- | --- |
| **DXRegistry** | Root of authority. Per-node owner/resolver mapping. |
| **DXRegistrar** | `.dex` name NFT (ERC-721). Expiry management, tier SVG, v2 transfer hook. |
| **DXResolver** | Resolution records (address/text/content/profile/ABI/agent) + v2 versioning. |
| **DXRegistrarController** | User entry point for registration/renewal/payment/discount. commit-reveal. |
| **DXPriceOracle** | Converts USD-fixed prices to live POL via Chainlink. Staleness guard. |
| **DXReverseRegistrar** | Reverse resolution (address → name) registration. |
| **DXReservations** | Reserved label management (allow a label only for a specific address). |
| **DXRegistry subname issuance** | Parent owner directly issues/reassigns/revokes subnames. |
| **DXSubscriptionRenewer** | USDT/USDC-based auto-renewal (subscription). |
| **DXContributionSBT** | Contributor badge (Soulbound Token), for discount eligibility. |
| **DXNToken / DXNStaking** | Native token and staking (for discount eligibility). |
| **RevenueDistributor** | Revenue distribution. |
| Helper libraries | DXNamehash, StringUtils, EVMCoinUtils, KoreanNormalization, etc. |

For detailed variables/functions/behavior of each contract, see `01_contracts.md`.

<details><summary>▶ 한국어로 보기</summary>

| 컨트랙트 | 역할 |
| --- | --- |
| **DXRegistry** | 권한의 루트. 노드별 소유자·리졸버 매핑. |
| **DXRegistrar** | `.dex` 이름 NFT(ERC-721). 만료 관리, 등급 SVG, v2 전송 훅. |
| **DXResolver** | 해석 레코드(주소·텍스트·콘텐츠·프로필·ABI·에이전트) + v2 버전 관리. |
| **DXRegistrarController** | 등록·갱신·결제·할인의 사용자 진입점. commit-reveal. |
| **DXPriceOracle** | USD 고정가를 Chainlink로 실시간 POL 환산. staleness 가드. |
| **DXReverseRegistrar** | 역방향 해석(주소 → 이름) 등록. |
| **DXReservations** | 예약 라벨 관리(특정 라벨을 특정 주소에만 등록 허용). |
| **DXRegistry 서브네임 발급** | 상위 도메인 소유자가 서브네임을 직접 발급·재지정·회수. |
| **DXSubscriptionRenewer** | USDT/USDC 기반 자동 갱신(구독). |
| **DXContributionSBT** | 기여자 배지(Soulbound Token), 할인 자격용. |
| **DXNToken / DXNStaking** | 자체 토큰 및 스테이킹(할인 자격용). |
| **RevenueDistributor** | 수익 분배. |
| 보조 라이브러리 | DXNamehash, StringUtils, EVMCoinUtils, KoreanNormalization 등. |

각 컨트랙트의 상세한 변수·함수·동작은 `01_contracts.md`를 참조하세요.

</details>

---

## 8. Structure of this document set

| Document | Content |
| --- | --- |
| `00_overview.md` | (this document) The big picture, architecture, core concepts |
| `01_contracts.md` | Per-contract concepts, variables, functions, state flow |
| `02_transfer_safety_v2.md` | The full process from problem discovery to deployment |
| `03_tests.md` | The meaning of each of the 155 tests |
| `04_scripts_and_tests.md` | The method and order in which scripts/tests were built |
| `05_redeployment.md` | The complete step-by-step redeployment procedure |
| `06_upgrade_roadmap.md` | v2.1/v2.2/v3 expansion strategy |

Recommended learning order: `00` → `01` → `02` → `03` → `04` → (when deploying)
`05` → (when extending) `06`.

<details><summary>▶ 한국어로 보기</summary>

개발팀이 이 시스템을 완벽히 이해하고, 테스트를 재현하고, 재배포하고, 향후
업그레이드까지 수행할 수 있도록 다음 순서로 문서를 구성했습니다. 권장 학습 순서:
`00` → `01` → `02` → `03` → `04` → (실습 시) `05` → (확장 시) `06`.

</details>
