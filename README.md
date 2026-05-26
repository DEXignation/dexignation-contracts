<div align="center">

# DEXignation

**Human-readable names for blockchain addresses on Polygon.**

블록체인 주소를 사람이 읽을 수 있는 이름으로 — Polygon 네이티브 네임 서비스.

[![Website](https://img.shields.io/badge/Website-dexignation.com-00DC82.svg)](https://dexignation.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.28-363636.svg)](https://docs.soliditylang.org/en/v0.8.28/)
[![Polygon](https://img.shields.io/badge/Network-Polygon-8247E5.svg)](https://polygon.technology/)
[![Built on ENS](https://img.shields.io/badge/Built%20on-ENS%20architecture-5298FF.svg)](https://ens.domains/)

</div>

---

## What is DEXignation? / DEXignation이란?

DEXignation maps long hexadecimal blockchain addresses to memorable
human-readable names under the `.dex` TLD. Instead of sending POL to
`0x71C7656EC7ab88b098defB751B7401B5f6d8976F`, a user sends it to
`alice.dex`. The on-chain mapping is owned by the user as an ERC-721 NFT.

DEXignation은 긴 16진 블록체인 주소를 `.dex` TLD 하위의 사람이 읽을 수 있는
이름으로 매핑합니다. POL을 `0x71C7656EC7...`로 보내는 대신 `alice.dex`로 보낼
수 있습니다. 온체인 매핑은 ERC-721 NFT로 사용자가 직접 소유합니다.

### Why on Polygon? / 왜 Polygon인가?

| Reason | Detail |
|---|---|
| **Low fees** | Registration on Polygon costs cents, not tens of dollars. Naming should be affordable. |
| **Stablecoin payments** | USDT and USDC on Polygon are highly liquid. Users pay in stablecoins, not in volatile native gas tokens. |
| **EVM compatibility** | Tooling, wallets, and SDKs are mature. Integration is straightforward. |
| **Korean ecosystem** | Strong wallet & exchange presence in Korea (KuCoin, Upbit listings, Klaytn↔Polygon bridges). |

---

## Highlights / 핵심 특징

- 🪪 **ERC-721 ownership** — every name is a transferable NFT with
  fully on-chain SVG metadata. No reliance on external image hosting.
  모든 이름은 양도 가능한 ERC-721 NFT이며, 메타데이터(SVG)는 100% 온체인.
- 💵 **USD-pegged pricing across POL, USDT, USDC** — register and renew in
  the native asset or in approved stablecoins. Prices are quoted in
  `attoUSD` and converted to wei via Chainlink at read time.
  USD 페그 가격으로 POL/USDT/USDC 결제 지원. attoUSD 가격을 Chainlink로
  변환.
- 🛡 **Front-running protection** — registration is commit-reveal: callers
  pre-commit a hash, wait, and only then reveal the label.
  프론트러닝 방지 commit-reveal 등록 플로우.
- 🔁 **Dual-path price oracle** — `Direct` (POL/USD) or `ViaLink`
  (LINK/USD ÷ LINK/POL). The fallback path is useful on networks where a
  direct POL/USD feed is unavailable or less liquid.
  dual-path 가격 오라클로 POL/USD 피드가 없거나 신뢰도가 낮은 환경 대비.
- 🌐 **Multi-chain resolution** — per-name `coinType → addrBytes` records
  following ENSIP-9 (SLIP-44) and ENSIP-11 (`0x80000000 | chainId` for
  EVM chains). One `.dex` name can hold a BTC, ETH, TRX, and Polygon
  address simultaneously.
  ENSIP-9/11에 따라 이름 하나에 BTC/ETH/TRX/POL 등 멀티체인 주소 동시 보유.
- ↩️ **Reverse resolution** — claim `{addr}.addr.reverse` so wallets can
  show `alice.dex` instead of an address.
  역방향 해결 지원.
- 🇰🇷 **UTF-8 aware label length** — Korean, Japanese, and Chinese names
  are counted by character, not byte.
  한글/일본어/한자 라벨도 문자 단위 길이로 검증.

---

## Built on ENS, optimised for Polygon / ENS 위에서 빌드, Polygon에 최적화

DEXignation is **transparently built on the architectural patterns and the
MIT-licensed reference implementation of the [Ethereum Name Service
(ENS)](https://ens.domains/)** by Nick Johnson and the ENS Labs team. We are
deeply grateful for their work and for open-sourcing it under terms that
allow ecosystem-wide reuse.

DEXignation은 Nick Johnson과 ENS Labs 팀이 만든 [Ethereum Name Service
(ENS)](https://ens.domains/)의 아키텍처 패턴과 MIT 라이선스 참조 구현 위에서
**투명하게** 빌드되었습니다. 깊이 감사드립니다.

### What we keep / 차용한 부분

- The registry / registrar / resolver / reverse-registrar separation.
  레지스트리 / Registrar / 리졸버 / 역방향 Registrar의 분리 구조.
- The commit-reveal registration pattern.
  commit-reveal 등록 패턴.
- EIP-137 `namehash`, EIP-181 reverse-resolution, ENSIP-9 / ENSIP-11
  coin-type encoding.
  EIP-137 namehash, EIP-181 역방향 해결, ENSIP-9/11 coin-type 인코딩.

### What we add or change / 추가/변경한 부분

- **Fixed-tier pricing** (1 / 3 / 5 / 10 years) instead of per-second
  pricing with premium decay. Simpler UX, clearer roadmap economics.
  premium decay 대신 1/3/5/10년 고정 구간 가격. 단순한 UX, 명확한 경제 모델.
- **ERC-20 stablecoin payments** with an owner-managed allow-list and
  ceiling-division decimals conversion.
  ERC-20 스테이블코인 결제, 화이트리스트 기반, 올림 변환.
- **Dual-path price oracle** for network-portability.
  네트워크 이식성을 위한 dual-path 가격 오라클.
- **Fully on-chain `tokenURI`** — SVG generated and Base64-encoded
  in-contract.
  완전한 온체인 `tokenURI` (SVG를 컨트랙트 내부에서 생성/인코딩).
- **Atomic resolver wiring at registration** — the initial Polygon address
  record is written in the same transaction as registration, so the name
  resolves immediately.
  등록 시 초기 Polygon 주소 레코드를 동일 트랜잭션에서 기록 → 즉시 사용 가능.
- **`registerInventoryNames`** for owner-side pre-registration of reserved
  / premium labels.
  예약어/프리미엄 이름 사전 등록.

For full attribution and license texts, see
[`THIRD-PARTY-LICENSES.md`](./THIRD-PARTY-LICENSES.md).

자세한 출처 표기와 라이선스 본문은
[`THIRD-PARTY-LICENSES.md`](./THIRD-PARTY-LICENSES.md) 참고.

---

## Architecture / 아키텍처

```
                    ┌────────────────────────────────────┐
                    │      DXRegistrarController         │  ← User entry
                    │  • commit / reveal                  │
                    │  • register / renew  (POL)          │
                    │  • registerWithToken / renewWithToken (USDT/USDC) │
                    │  • registerInventoryNames (owner)   │
                    │  • withdraw / withdrawToken         │
                    └────┬──────────┬──────────┬─────────┘
                         │          │          │
                  rentPrice    register/   setResolver
                   /priceInToken renew     setAddr
                         │          │          │
                         ▼          ▼          ▼
                ┌─────────────┐ ┌──────────┐ ┌──────────┐
                │DXPriceOracle│ │DXRegistrar│ │DXResolver│
                │  Direct OR  │ │ ERC-721   │ │ coinType │
                │  ViaLink    │ │ + on-chain│ │  → bytes │
                │  (Chainlink)│ │    SVG    │ │ reverse  │
                └──────┬──────┘ └─────┬────┘ └────┬─────┘
                       │              │           │
                       │       setSubnodeOwner    │
                       │       setSubnodeExpires  │
                       │              ▼           ▼
                       │      ┌──────────────────────┐
                       │      │      DXRegistry      │
                       │      │  records[node]:      │
                       │      │   owner, resolver,   │
                       │      │   expires            │
                       │      └──────────────────────┘
                       │
                       ▼ (external)
                ┌──────────────────────────────┐
                │ Chainlink AggregatorV3       │
                │  POL/USD  OR  LINK feeds     │
                └──────────────────────────────┘
```

### Contracts at a glance / 컨트랙트 한눈에

**Core (always deployed):**

| Contract | Responsibility | 책임 |
|---|---|---|
| `DXRegistry` | namehash tree of `(owner, resolver, expires)` records | namehash 트리의 owner/resolver/expires 원장 |
| `DXRegistrar` | ERC-721 NFT minting, expiry, EIP-2981 royalty | `.dex` 2LD의 ERC-721 발행, 만료, EIP-2981 royalty |
| `DXRegistrarController` | User-facing entry: commit-reveal, payment, holder discount, atomic resolver setup | 사용자 진입점: commit-reveal, 결제, 보유자 할인, 리졸버 원자적 설정 |
| `DXResolver` | `(node, coinType) → addrBytes` and reverse names | coinType→addr 매핑 및 역방향 이름 |
| `DXReverseRegistrar` | Claim `{addr}.addr.reverse` | 역방향 노드 클레임 |
| `DXPriceOracle` | attoUSD → wei + premium decay | attoUSD → wei 변환 + 만료 후 premium 감쇠 |
| `DXReservations` | Owner-managed reserved label registry | 오너 관리형 예약 라벨 레지스트리 |

**Utilities:**

| Contract | Responsibility | 책임 |
|---|---|---|
| `DXNamehash` | EIP-137 namehash + EIP-181 helpers | namehash 및 역방향 헬퍼 |
| `EVMCoinUtils` | ENSIP-11 coin-type encoding | coin-type 인코딩 |
| `StringUtils` | UTF-8-aware `strlen` + strict ASCII label validator | UTF-8 인식 길이 + strict ASCII 라벨 검증 |

> **Design note.** This codebase intentionally has **no governance token,
> no staking, no revenue distributor, and no separate contributor token**.
> The `.dex` domain NFTs themselves are the unit of value — they are
> useful (resolve to wallets), transferable, and tradeable on standard
> marketplaces. Contributor incentives are handled by funding contributors
> with USDT so they can register .dex domains in their own name. The
> `DXRegistrarController.setDiscountToken` hook lets the owner attach any
> ERC-20 (e.g. a partner project's token) for a flat holder discount, but
> the discount is policy — not a revenue share — so it does not change
> the legal character of the service.
>
> **설계 노트.** 이 코드베이스는 의도적으로 **거버넌스 토큰·스테이킹·
> RevenueDistributor·별도 기여자 토큰을 두지 않는다.** `.dex` 도메인 NFT
> 자체가 가치 단위 — 실사용(지갑 resolve)이 가능하고 양도·거래 가능.
> 기여자 인센티브는 USDT를 지급해 기여자 본인 명의로 .dex 도메인을 등록할
> 수 있게 하는 방식. `DXRegistrarController.setDiscountToken`은 owner가
> 임의의 ERC-20을 보유자 할인 대상으로 지정하는 후크일 뿐, 수익 분배가
> 아니므로 서비스의 법적 성격을 바꾸지 않음.

For deeper architectural narrative, see
[`docs/architecture.md`](./docs/architecture.md).

자세한 아키텍처 설명은
[`docs/architecture.md`](./docs/architecture.md) 참고.

---

## Pricing / 가격

Rent prices are stored in `attoUSD` (1 USD = 1e18) and converted to the
payment asset's units at quote time.

가격은 attoUSD($1=1e18) 단위로 저장되고 결제 시점에 자산 단위로 변환됩니다.

| Duration | Price | Discount |
|---:|---:|---:|
| 1 year   | $8  | — |
| 3 years  | $18 | 25% off vs 3 × 1y |
| 5 years  | $25 | 37.5% off vs 5 × 1y |
| 10 years | $40 | 50% off vs 10 × 1y |

Minimum label length: **3 UTF-8 characters**.

최소 라벨 길이: **UTF-8 3자**.

### Holder discount / 보유자 할인

`DXRegistrarController` includes a single-slot **holder discount** hook:
the owner picks one ERC-20, a minimum balance, and a discount rate
(capped at 50%). Any wallet that holds at least the threshold of that
token at registration time gets the discount on every register and
renewal — both native (POL) and ERC-20 (USDC/USDT) payment paths.

`DXRegistrarController`에는 단일 슬롯 **보유자 할인** 후크가 있습니다.
오너가 ERC-20 한 종류, 최소 보유량, 할인율(상한 50%)을 지정하면, 그
토큰을 임계치 이상 보유한 지갑은 모든 등록·갱신에서 할인 적용 — 네이티브
(POL) / ERC-20 (USDC/USDT) 결제 모두 동일.

The balance is read directly from the caller's on-chain holdings at
registration time — no snapshot, no escrow, no second transaction.

할인 자격은 등록 시점의 온체인 잔액을 직접 조회 — 스냅샷·에스크로·
추가 트랜잭션 없음.

```typescript
// Owner: enable the discount (one-time setup or whenever the policy changes)
await controller.setDiscountToken(
  PARTNER_TOKEN_ADDRESS,    // any ERC-20 on the same chain
  1_000_000n * 10n ** 18n,  // minimum holding (token's smallest unit)
  1000n,                    // 10% discount (bps; max 5000 = 50%)
);

// Owner: disable
await controller.setDiscountToken(ZERO_ADDRESS, 0n, 0n);

// Wallet UI: base quote vs personalised quote
const basePrice = await controller.rentPriceFor("alice", ONE_YEAR);
const yourPrice = await controller.rentPriceForPayer(
  "alice", ONE_YEAR, walletAddress,
);

// Wallet UI: show "X% off" badge
const eligible = await controller.isDiscountEligible(walletAddress);
```

The hook is **disabled by default** (`discountToken == address(0)`).
The owner activates it after deciding which token to honour — for
example, a partner project's token like [MolePin](https://molepin.com)
(MOL) on Polygon, or a community token issued separately.

후크는 **기본 비활성** (`discountToken == 0`). owner가 어떤 토큰을
인정할지 결정한 뒤 활성화 — 예: Polygon의 파트너 토큰 MOL
([MolePin](https://molepin.com)) 또는 별도로 발행한 커뮤니티 토큰.

Setter constraints (enforced on-chain):
| Constraint | Reason |
|---|---|
| `discountBps ≤ 5000` | Discount can never exceed 50% (prevents misconfig burning the entire rent). |
| `requiredHoldAmount > 0` when enabling | A zero threshold would grant the discount to every wallet (since `balanceOf >= 0` always). |
| Owner-only | Only the contract owner can change discount policy. |

setter 제약 (온체인 강제):
| 제약 | 사유 |
|---|---|
| `discountBps ≤ 5000` | 할인이 50%를 절대 넘지 않음 (오설정으로 임대료 전액 손실 방지). |
| 활성화 시 `requiredHoldAmount > 0` | 0이면 모든 지갑이 자격 충족 (`balanceOf >= 0`이 항상 참). |
| Owner 전용 | 컨트랙트 owner만 할인 정책 변경 가능. |

### Contributor incentives / 기여자 인센티브

DEXignation rewards contributors (developers, designers, translators,
community moderators, etc.) by funding them with USDT so they can register
`.dex` domains in their own name. No separate token contract is needed —
the `.dex` NFT itself is a useful, transferable asset that contributors
can hold, use, or resell on standard marketplaces.

DEXignation은 기여자(개발자·디자이너·번역자·커뮤니티 운영자 등)에게 USDT를
지원하여 본인 명의로 `.dex` 도메인을 등록할 수 있게 하는 방식으로 인센티브를
제공합니다. 별도 토큰 컨트랙트 불필요 — `.dex` NFT 자체가 실사용·양도·일반
마켓플레이스 거래가 가능한 가치 자산.

Typical flow / 일반적 흐름:

```
1. Owner sends USDT (e.g. $250) and a bit of POL (e.g. 10) to a
   contributor's wallet.

2. Contributor uses dexignation.com to register .dex domains in their
   own name (commit-reveal flow, standard register() call).

3. USDT flows from contributor → DXRegistrarController → back to owner
   via withdrawToken(). The net effect is the contributor receives
   .dex NFTs at the owner's expense (gas only).

4. Contributor can hold the names, use them as wallet aliases, or list
   them on a marketplace.
```

```
1. Owner가 기여자 지갑에 USDT(예: $250) + POL(예: 10) 송금.

2. 기여자는 dexignation.com에서 본인 명의로 .dex 도메인을 직접 등록
   (commit-reveal 일반 register() 호출).

3. USDT는 기여자 → DXRegistrarController → withdrawToken()을 통해 owner로
   돌아옴. 순 효과: 기여자는 owner의 비용(가스만)으로 .dex NFT 수령.

4. 기여자는 도메인을 보유, 지갑 별칭으로 사용, 또는 마켓플레이스 판매 가능.
```

Why this approach? Because the `.dex` NFT is already a real, tradeable
digital good. Issuing a separate "contributor token" would add a token
contract, a market price, and regulatory questions — for no additional
benefit to the contributor. Funding contributors in USDT and letting
them mint `.dex` names keeps the legal surface of the project minimal
while delivering real value.

이 방식의 이유: `.dex` NFT가 이미 실제로 거래 가능한 디지털 자산이기 때문.
별도 "기여자 토큰" 발행은 토큰 컨트랙트·시장가격·규제 이슈를 추가할 뿐,
기여자에게 별 이득 없음. USDT를 지급해 `.dex` 이름을 직접 mint하게 하는
방식은 법적 표면을 최소화하면서 실질 가치는 그대로 전달.

---

## Project layout / 프로젝트 구조

```
dexignation/
├── contracts/
│   ├── registry/        # DXRegistry, IDXRegistry
│   ├── registrar/       # DXRegistrar, DXRegistrarController, DXReverseRegistrar, DXReservations
│   ├── resolver/        # DXResolver
│   ├── oracle/          # DXPriceOracle
│   ├── utils/           # DXNamehash, EVMCoinUtils, StringUtils
│   └── mocks/           # MockERC20, MockPriceOracle  (test-only)
├── docs/
│   ├── architecture.md  # Deep-dive on every contract
│   └── medium/          # Public-facing articles
├── LICENSE              # MIT (DEXignation)
├── NOTICE
├── THIRD-PARTY-LICENSES.md
├── README.md            # this file
├── SECURITY.md
└── CONTRIBUTING.md
```

---

## Development / 개발

This repository contains the smart-contract layer only. The web front-end
(`Next.js` + `wagmi` + `viem`) lives in a separate repository.

본 저장소는 스마트 컨트랙트 레이어만 포함합니다. 웹 프론트엔드는 별도 저장소.

### Prerequisites / 사전 요구사항

- Node.js v22+
- Hardhat 3
- An RPC URL for Polygon (Mainnet or Amoy)

### Quick start / 빠른 시작

```bash
git clone https://github.com/DEXignation/dexignation-contracts
cd dexignation-contracts
npm install
npx hardhat compile
npx hardhat test
```

### Local deployment / 로컬 배포

```bash
# Terminal 1: start a local Hardhat node
npx hardhat node

# Terminal 2: deploy the full system including mocks
npm run deploy:local
```

This deploys `MockERC20` (USDT/USDC stand-ins) and `MockPriceOracle`
alongside the protocol contracts so you can exercise the full payment
flow locally.

로컬에서 전체 결제 플로우를 시험할 수 있도록 `MockERC20` (USDT/USDC
대용)과 `MockPriceOracle`을 함께 배포합니다.

### Testnet & mainnet deployment / 테스트넷·메인넷 배포

```bash
# Amoy testnet
npm run deploy:amoy

# Polygon mainnet (audit completed only)
npm run deploy:polygon
```

Both require `DEPLOYER_PRIVATE_KEY` and a `*_RPC_URL` in `.env`. See
`.env.example`.

둘 다 `.env`에 `DEPLOYER_PRIVATE_KEY`와 `*_RPC_URL` 설정이 필요합니다.
`.env.example` 참고.

---

## Deployment / 배포

**Polygon Mainnet**: _addresses to be published after audit._
**Polygon Amoy (Testnet)**: _addresses to be published with first public testnet._

**메인넷**: _감사 완료 후 공개._
**테스트넷**: _최초 퍼블릭 테스트넷과 함께 공개._

All deployed contracts will be verified on Polygonscan and linked here.

모든 배포된 컨트랙트는 Polygonscan에서 verified 처리되며 여기에 링크됩니다.

---

## Security / 보안

- DEXignation **has not yet been audited**. Do not deposit significant value
  until at least one independent audit is published.
  DEXignation은 **아직 감사받지 않았습니다.** 최소 1회 이상의 독립 감사가
  공개될 때까지 큰 가치를 예치하지 마십시오.
- See [`SECURITY.md`](./SECURITY.md) for our vulnerability-disclosure policy.
  취약점 제보 정책은 [`SECURITY.md`](./SECURITY.md) 참고.
- Re-entrancy is mitigated via OpenZeppelin's `ReentrancyGuard` on every
  state-changing controller entry point.
  모든 state 변경 함수에 OpenZeppelin `ReentrancyGuard` 적용.
- Stablecoin transfers use `SafeERC20` to support non-standard tokens
  (notably USDT mainnet).
  스테이블코인 전송에 `SafeERC20` 사용 (USDT 메인넷 등 비표준 토큰 대응).
- Oracle reads enforce a configurable freshness window (`maxOracleDelay`,
  default 26 hours).
  오라클 read에 staleness 가드 (`maxOracleDelay`, 기본 26시간).

---

## Roadmap / 로드맵

**Phase 1 — Core protocol (current)**
- [x] Registry / Registrar / Resolver / Controller / PriceOracle
- [x] Native + ERC-20 payment
- [x] Reverse resolution
- [ ] Audit
- [ ] Mainnet deployment

**Phase 2 — Ecosystem**
- [ ] Subdomain support with per-name policy
- [ ] Text records (avatar, description, url, etc.)
- [ ] Off-chain resolution (CCIP-Read)
- [ ] Wallet integrations

**Phase 3 — Beyond**
- [ ] DAO governance for protocol parameters
- [ ] Bridge to other chains as resolver clients

---

## Contributing / 기여

We welcome bug reports, pull requests, and ideas. Please read
[`CONTRIBUTING.md`](./CONTRIBUTING.md) before opening a PR.

버그 리포트, PR, 아이디어 모두 환영합니다. PR 전에
[`CONTRIBUTING.md`](./CONTRIBUTING.md)를 읽어주세요.

---

## Related repositories / 관련 저장소

DEXignation is organised as a small monorepo-of-repos under the
[`DEXignation`](https://github.com/DEXignation) GitHub organisation.

DEXignation은 [`DEXignation`](https://github.com/DEXignation) GitHub
조직 하의 여러 저장소로 구성됩니다.

| Repo | Purpose | 역할 |
|---|---|---|
| [`dexignation-contracts`](https://github.com/DEXignation/dexignation-contracts) | Smart contracts (this repo) | 스마트 컨트랙트 (본 저장소) |
| [`dexignation-api`](https://github.com/DEXignation/dexignation-api) | Core backend services | 핵심 백엔드 서비스 |
| [`dexignation-snap`](https://github.com/DEXignation/dexignation-snap) | MetaMask Snap for `.dex` resolution | `.dex` 해결용 MetaMask Snap |
| [`dexignation-docs`](https://github.com/DEXignation/dexignation-docs) | Official protocol documentation | 공식 프로토콜 문서 |

---

## Contact / 연락처

- **Website**: https://dexignation.com
- **GitHub**: https://github.com/DEXignation
- **General inquiries**: `help@dexignation.com`
- **Security disclosures**: `security@dexignation.com`
  (see [`SECURITY.md`](./SECURITY.md) for details)

---

## License / 라이선스

DEXignation is released under the **MIT License**. ENS-derived portions
remain under the original MIT terms. See [`LICENSE`](./LICENSE) and
[`THIRD-PARTY-LICENSES.md`](./THIRD-PARTY-LICENSES.md).

DEXignation은 **MIT License** 하에 공개됩니다. ENS 파생 부분은 원본 MIT
조건이 유지됩니다. [`LICENSE`](./LICENSE) 및
[`THIRD-PARTY-LICENSES.md`](./THIRD-PARTY-LICENSES.md) 참고.

---

<div align="center">

**Built with appreciation for the open Ethereum ecosystem.**

Ethereum 오픈 생태계에 감사하며.

</div>
