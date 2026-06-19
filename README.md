# DEXignation

> A Polygon-native Web3 naming service. Replace unreadable wallet addresses with human-readable `.dex` names — with duration-tier NFT cards, multi-coin resolution, localized profiles, subname commerce, AI-agent payment routing, fixed-price + auction trading, and permissionless auto-renewal, all in one stack.

<details><summary>▶ 한국어로 보기</summary>

Polygon 네이티브 Web3 네임 서비스. 읽기 어려운 지갑 주소를 사람이 읽는 `.dex` 이름으로 대체합니다 — 만료 등급형 NFT 카드, 다중 코인 해석, 다국어 프로필, 서브네임 커머스, AI 에이전트 결제 라우팅, 고정가·경매 거래, 무허가 자동 갱신을 단일 스택에 통합했습니다.

</details>

---

## Status

Live on **Polygon Mainnet** (chainId 137). 218 unit tests passing, full end-to-end mainnet verification. All 16 contracts (12 core + 4 trading) deployed deterministically via CreateX to `0xdeed…` vanity addresses, owner-controlled. Source verification on PolygonScan + Sourcify is in progress.

<details><summary>▶ 한국어로 보기</summary>

**Polygon 메인넷**(chainId 137)에 라이브. 단위 테스트 218건 통과, 메인넷 end-to-end 검증 완료. 16개 컨트랙트(코어 12 + 트레이딩 4) 모두 CreateX로 `0xdeed…` 베니티 주소에 결정론적으로 배포되었으며 owner가 제어합니다. PolygonScan + Sourcify 소스 검증은 진행 중입니다.

</details>

## Deployed Contracts (Polygon Mainnet)

**Core**

| Contract | Address |
|---|---|
| DXRegistry | `0xdEED0a23B6a57d81c69782E2333ab429BA10C332` |
| DXNToken | `0xDEED17AD8aF17Dc6D967B39009b16F484aAf4285` |
| DXRegistrar (NFT) | `0xDEed2BC23B99610b1928eEa27f332f5c8e9d90aC` |
| DXPriceOracle | `0xDeED39E1B5dFEDD2322919E67697FBa392d45113` |
| DXResolver | `0xdEED4150C60d0861116E0b742Ab6D4f66a77Cb4F` |
| DXReverseRegistrar | `0xdeed57479A57218D80E246AA378bc2580637aa67` |
| DXReservations | `0xDeed6B6Ae907B2c5266aDBB0Cc85e75B8bCb5d9C` |
| DXContributionSBT | `0xDeed7Eb1B1895CEfebBd295d8E75B962E558C9F8` |
| DXNStaking | `0xdeED8a3189771B452aCD890b29e592B4f47D125d` |
| RevenueDistributor | `0xdEEd9070Ae32135D91e2B42758e6ea936Dd31F7E` |
| DXRegistrarController | `0xdeEd10f4cea4a7E77c370d5aFf3078D86d1394eE` |
| DXSubnameRegistrar | `0xDEeD113cc1A2cD3995f29525b0ba7Abf43eb1F3C` |

**Trading & commerce**

| Contract | Address |
|---|---|
| DXMarketplace | `0xdEED12D92639696Df4EfF29526FF952F52F67C47` |
| DXEnglishAuction | `0xdeEd13e0283366f1E7F85261C4064A5933D19858` |
| DXDutchAuction | `0xDeEd149C56702EA4514282C75E40B14F67Ad9551` |
| DXSubscriptionRenewer | `0xdEEd150e11499D6170154d01F96A89757c1F2F93` |

Owner of all contracts: `0xd32BEFBB3deBDa5D1Eb43Ccf3Ce46aFE82732572`.
Full deployment record (tx hashes, constructor args, wiring) — see [DEPLOYMENT.md](./DEPLOYMENT.md).

## Features

- **ENS-standard resolution** — Text Records (EIP-634), Contenthash (EIP-1577), multi-coin addresses (ENSIP-9/SLIP-44), reverse resolution.
- **Duration-tier NFT cards** — fully on-chain SVG. Card color reflects committed duration (charcoal → gold), ratchets up on renewal, never down with time, red when expired.
- **Localized profiles** — 12 languages with per-field English fallback.
- **AI-agent payment routing** — bridges `.dex` names to ERC-8004 identity and x402 payment endpoints.
- **Subname commerce** — owners sell subnames with token/SBT access gating.
- **Trading** — fixed-price marketplace plus English (ascending, escrow + anti-snipe) and Dutch (descending) auctions, paid in USDC/USDT, with on-chain LISTED/AUCTION marks.
- **Permissionless auto-renewal** — pre-approve a stablecoin; anyone can trigger renewal, with on-chain time-window and price-cap re-validation.
- **Polygon-native** — low gas, native USDC/USDT payment.
- **Discounts** — ERC-20 holding / SBT / staking (non-stacking, max 50%).

<details><summary>▶ 한국어로 보기</summary>

- **ENS 표준 해석** — 텍스트 레코드(EIP-634), 콘텐츠 해시(EIP-1577), 다중 코인 주소(ENSIP-9/SLIP-44), 역방향 해석.
- **만료 등급형 NFT 카드** — 완전 온체인 SVG. 카드 색이 약속한 보유 기간을 반영(charcoal→gold), 갱신 시 상승, 시간 경과로 불변, 만료 시 빨강.
- **다국어 프로필** — 12개 언어, 필드별 영어 폴백.
- **AI 에이전트 결제 라우팅** — `.dex` 이름을 ERC-8004 신원·x402 결제처에 연결.
- **서브네임 커머스** — 소유자가 토큰/SBT 게이팅으로 서브네임 판매.
- **거래** — 고정가 마켓플레이스 + 영국식(상승, 에스크로·스나이핑 방지)·네덜란드식(하락) 경매. USDC/USDT 결제, 온체인 LISTED/AUCTION 마크.
- **무허가 자동 갱신** — 스테이블코인 사전 승인 후 누구나 갱신 트리거, 온체인 시점·가격상한 재검증.
- **Polygon 네이티브** — 저가스, USDC/USDT 네이티브 결제.
- **할인** — ERC-20 보유/SBT/스테이킹 (비중첩, 최대 50%).

</details>

## Pricing

| Duration | Price (USD) | NFT Tier |
|---|---|---|
| 1 year | $8 | Charcoal |
| 3 years | $18 | Mud |
| 5 years | $25 | Burnt Orange |
| 10 years | $40 | Yellow |
| 15 years | $55 | Gold |

Paid in POL (via Chainlink POL/USD) or directly in USDC/USDT.

## Quick Start

```bash
npm install
npx hardhat compile
npm test                 # 218 tests
```

Deploy:
```bash
npx hardhat ignition deploy ignition/modules/DXDeployLocal.ts    # local
npx hardhat ignition deploy ignition/modules/DXDeployAmoy.ts --network amoy
npx hardhat ignition deploy ignition/modules/DXDeployPolygon.ts --network polygon
```

> The mainnet contracts above were deployed deterministically via CreateX (not
> the Ignition modules) so that every contract carries a `0xdeed…` vanity
> address and an explicit owner. The Ignition modules remain the supported path
> for local and Amoy deployments. See [DEPLOYMENT.md](./DEPLOYMENT.md) for the
> mainnet deployment details.

## Integration

Resolve a name (read-only):
```
node = namehash("alice.dex")
DXResolver.addr(node, 60)        // ETH/EVM address
DXResolver.text(node, "avatar")  // text record
DXRegistrar.tokenURI(tokenId)    // on-chain NFT card
```

Register (commit-reveal):
```
1. commitment = keccak256(label, owner, duration, resolver, paymentToken, secret)
2. controller.commit(commitment)
3. wait minCommitmentAge
4. controller.register(label, owner, duration, resolver, secret) { value: rentPrice }
5. resolver.setAddr(node, 60, owner)   // recommended UX
```

The `test/` directory contains working examples for every function — read the relevant test before integrating.

<details><summary>▶ 한국어로 보기</summary>

`test/` 디렉토리에 모든 함수의 동작 예제가 있습니다. 연동 전 해당 테스트를 먼저 읽으세요.

이름 해석(읽기 전용), 등록(커밋-리빌) 흐름은 위 영문 코드 블록을 참조하세요. 등록 후 `setAddr`를 호출해야 주소가 해석됩니다(ENS 표준).

</details>

## Architecture

```
User → Controller (register/pay/discount) → Registrar (mint NFT) → Registry (authority)
                                                  ↓
                                             Resolver (name → data)
       Controller → PriceOracle (USD→POL, Chainlink)

Trading:  Marketplace / EnglishAuction / DutchAuction → Registrar (NFT transfer + SVG mark)
          fees → RevenueDistributor.  SubscriptionRenewer → Controller.renew
```

## Tech Stack

Solidity 0.8.28 · Hardhat 3 · viem · OpenZeppelin 5.x · Chainlink Data Feeds · Polygon PoS.

## License

MIT