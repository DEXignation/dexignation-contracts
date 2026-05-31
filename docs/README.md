# DEXignation — Technical Documentation

DEXignation is an **on-chain naming service on Polygon**. Users register
human-readable names such as `roy.dex` as ERC-721 NFTs, and those names resolve to
wallet addresses, profiles, content, and AI-agent payment endpoints.

This documentation set covers the entire system — architecture, every contract,
the v2 transfer-safety work, all 155 tests, the build process, redeployment, and
the upgrade roadmap. **English is the primary content; Korean is available in the
collapsible blocks (`▶ 한국어로 보기`) under each section.**

<details><summary>▶ 한국어로 보기</summary>

DEXignation은 **Polygon 위의 온체인 네이밍 서비스**입니다. 사용자는 `roy.dex` 같은
사람이 읽을 수 있는 이름을 ERC-721 NFT로 등록하고, 그 이름이 지갑 주소·프로필·콘텐츠·
AI 에이전트 결제 엔드포인트로 해석되도록 합니다.

이 문서 묶음은 전체 시스템 — 아키텍처, 모든 컨트랙트, v2 전송 안전성 작업, 155개
테스트, 제작 과정, 재배포, 업그레이드 로드맵 — 을 다룹니다. **영문이 본문이며,
한국어는 각 섹션 아래 collapsible 블록(`▶ 한국어로 보기`)에서 볼 수 있습니다.**

</details>

---

## What makes v2 important

In one sentence: **in v1, transferring a name's NFT did not carry over the name's
control and resolution records, so the name still pointed to the previous owner —
a silent fund mis-routing risk. v2 automatically transfers control and invalidates
records on NFT transfer.**

This was solved with a record version counter in the resolver plus an ERC-721
`_update` hook in the registrar, verified across 155 tests and a live deployment.
See [`02_transfer_safety_v2.md`](./02_transfer_safety_v2.md) for the full story.

<details><summary>▶ 한국어로 보기</summary>

한 문장으로: **v1에서는 이름 NFT를 양도해도 제어권과 해석 레코드가 따라오지 않아
양도 후에도 이름이 이전 소유자를 가리키던 조용한 오송금 위험을, v2는 NFT 전송 시
제어권 이전과 레코드 무효화를 자동 수행하도록 해결했습니다.**

리졸버의 레코드 버전 카운터 + registrar의 ERC-721 `_update` 훅으로 구현했고, 155개
테스트와 실네트워크 배포로 검증했습니다. 자세한 내용은
[`02_transfer_safety_v2.md`](./02_transfer_safety_v2.md)를 참조하세요.

</details>

---

## Documentation index

| # | Document | Content |
| --- | --- | --- |
| 00 | [System Overview](./00_overview.md) | The big picture, architecture, namehash, commit-reveal, v1↔v2, tech stack |
| 01 | [Contract Reference](./01_contracts.md) | Per-contract concepts, variables, functions, and state flow (12 contracts) |
| 02 | [v2 Transfer Safety](./02_transfer_safety_v2.md) | The full process: problem → 3 gaps → version design → 5-step build → verification → deployment |
| 03 | [Test Reference](./03_tests.md) | The meaning of each of the 155 tests, grouped |
| 04 | [Scripts & Tests](./04_scripts_and_tests.md) | The method and order in which scripts/tests were built |
| 05 | [Redeployment Guide](./05_redeployment.md) | The complete step-by-step redeployment procedure + pitfalls |
| 06 | [Upgrade Roadmap](./06_upgrade_roadmap.md) | v2.1 → v2.2 → v3 expansion strategy |

**Recommended reading order**: 00 → 01 → 02 → 03 → 04 → (when deploying) 05 →
(when extending) 06.

<details><summary>▶ 한국어로 보기</summary>

| # | 문서 | 내용 |
| --- | --- | --- |
| 00 | [시스템 개요](./00_overview.md) | 전체 그림, 아키텍처, namehash, commit-reveal, v1↔v2, 기술 스택 |
| 01 | [컨트랙트 레퍼런스](./01_contracts.md) | 컨트랙트별 개념·변수·함수·상태 흐름 (12개) |
| 02 | [v2 전송 안전성](./02_transfer_safety_v2.md) | 문제 → 3개 공백 → 버전 설계 → 5단계 구현 → 검증 → 배포 |
| 03 | [테스트 레퍼런스](./03_tests.md) | 155개 테스트 각각의 의미(그룹별) |
| 04 | [스크립트·테스트 제작](./04_scripts_and_tests.md) | 스크립트·테스트를 만든 방법과 순서 |
| 05 | [재배포 가이드](./05_redeployment.md) | 완전한 단계별 재배포 절차 + 함정 |
| 06 | [업그레이드 로드맵](./06_upgrade_roadmap.md) | v2.1 → v2.2 → v3 확장 전략 |

**권장 학습 순서**: 00 → 01 → 02 → 03 → 04 → (배포 시) 05 → (확장 시) 06.

</details>

---

## Architecture at a glance

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
              └──────────────┘         └──────────────┘
```

The single source of truth for authority is **DXRegistry**. The core invariant —
**`DXRegistrar.ownerOf(id) == DXRegistry.owner(node)` for every registered name** —
is maintained automatically by the v2 `_update` hook on transfer.

<details><summary>▶ 한국어로 보기</summary>

권한의 단일 진실 공급원은 **DXRegistry**입니다. 핵심 불변식 — **모든 등록된 이름에
대해 `DXRegistrar.ownerOf(id) == DXRegistry.owner(node)`** — 은 v2 `_update` 훅이
전송 시 자동으로 유지합니다.

</details>

---

## Tech stack

| Item | Detail |
| --- | --- |
| Language | Solidity 0.8.28 (EVM target: cancun) |
| Framework | Hardhat 3 + Hardhat Ignition |
| Testing | Mocha + viem (155 passing) |
| Libraries | OpenZeppelin 5.x |
| Oracle | Chainlink AggregatorV3 (POL/USD) |
| Chains | Polygon mainnet (chain-137), Amoy testnet (chain-80002) |

<details><summary>▶ 한국어로 보기</summary>

| 항목 | 내용 |
| --- | --- |
| 언어 | Solidity 0.8.28 (EVM target: cancun) |
| 프레임워크 | Hardhat 3 + Hardhat Ignition |
| 테스트 | Mocha + viem (155 passing) |
| 라이브러리 | OpenZeppelin 5.x |
| 오라클 | Chainlink AggregatorV3 (POL/USD) |
| 체인 | Polygon 메인넷(chain-137), Amoy 테스트넷(chain-80002) |

</details>

---

## Mainnet v2 addresses (polygon-v2-clean, chain-137)

| Contract | Address |
| --- | --- |
| DXResolver | `0xb8b44561A52cf2929D3E6BF02d3B18a9e20CdE82` |
| DXRegistrar | `0x1DaDBb206a05b2821935c467015C77fD61e02951` |
| DXRegistry | `0x0eE48aCcB768758Ba509Ef08D4f00d03C1B6e3A9` |
| DXRegistrarController | `0xd456dC842B6c05084a0e884b7247F9ee90472432` |
| DXPriceOracle | `0xc3751923bF9C485Ac927096D42469f6287156B42` |
| DXReverseRegistrar | `0xb6b165eB79E1Acf54eE8acFAf5FCC77241D6Fef0` |
| DXReservations | `0xfB22CE3135e8a0b6c91bb74884Ea73A4caa6b32b` |

All contracts are verified on PolygonScan and Sourcify.

<details><summary>▶ 한국어로 보기</summary>

위 표는 메인넷 v2 배포 주소(polygon-v2-clean, chain-137)입니다. 7개 컨트랙트 모두
PolygonScan과 Sourcify에 소스 검증되어 있습니다. 이전 v1 주소는 폐기되었습니다.

</details>

---

## Running the tests

```bash
npx hardhat clean && npm test
```

Expect **155 passing**. See [`03_tests.md`](./03_tests.md) for what each test
verifies, and [`04_scripts_and_tests.md`](./04_scripts_and_tests.md) for how they
were built.

<details><summary>▶ 한국어로 보기</summary>

`npx hardhat clean && npm test` → **155 passing** 기대. 각 테스트가 무엇을 검증하는지는
[`03_tests.md`](./03_tests.md), 어떻게 만들었는지는
[`04_scripts_and_tests.md`](./04_scripts_and_tests.md)를 참조하세요.

</details>
