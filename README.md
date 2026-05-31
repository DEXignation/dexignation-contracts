# DEXignation

> A Polygon-native Web3 naming service. Replace unreadable wallet addresses with human-readable `.dex` names — with duration-tier NFT cards, multi-coin resolution, localized profiles, subname commerce, AI-agent payment routing, and permissionless auto-renewal, all in one stack.

<details><summary>▶ 한국어로 보기</summary>

Polygon 네이티브 Web3 네임 서비스. 읽기 어려운 지갑 주소를 사람이 읽는 `.dex` 이름으로 대체합니다 — 만료 등급형 NFT 카드, 다중 코인 해석, 다국어 프로필, 서브네임 커머스, AI 에이전트 결제 라우팅, 무허가 자동 갱신을 단일 스택에 통합했습니다.

</details>

---

## Status

Live on **Polygon Mainnet** (chainId 137). 142 unit tests passing, full end-to-end mainnet verification, source verified on PolygonScan + Sourcify.

<details><summary>▶ 한국어로 보기</summary>

**Polygon 메인넷**(chainId 137)에 라이브. 단위 테스트 142건 통과, 메인넷 end-to-end 검증 완료, PolygonScan + Sourcify 소스 검증.

</details>

## Deployed Contracts (Polygon Mainnet)

| Contract | Address |
|---|---|
| DXRegistrar (NFT) | `0x1DaDBb206a05b2821935c467015C77fD61e02951` |
| DXRegistry | `0x0eE48aCcB768758Ba509Ef08D4f00d03C1B6e3A9` |
| DXRegistrarController | `0xd456dC842B6c05084a0e884b7247F9ee90472432` |
| DXResolver | `0xb8b44561A52cf2929D3E6BF02d3B18a9e20CdE82` |
| DXPriceOracle | `0xc3751923bF9C485Ac927096D42469f6287156B42` |
| DXReverseRegistrar | `0xb6b165eB79E1Acf54eE8acFAf5FCC77241D6Fef0` |
| DXReservations | `0xfB22CE3135e8a0b6c91bb74884Ea73A4caa6b32b` |

## Features

- **ENS-standard resolution** — Text Records (EIP-634), Contenthash (EIP-1577), multi-coin addresses (ENSIP-9/SLIP-44), reverse resolution.
- **Duration-tier NFT cards** — fully on-chain SVG. Card color reflects committed duration (charcoal → gold), ratchets up on renewal, never down with time, red when expired.
- **Localized profiles** — 12 languages with per-field English fallback.
- **AI-agent payment routing** — bridges `.dex` names to ERC-8004 identity and x402 payment endpoints.
- **Subname commerce** — owners sell subnames with token/SBT access gating.
- **Permissionless auto-renewal** — pre-approve a stablecoin; anyone can trigger renewal, with on-chain time-window and price-cap re-validation.
- **Polygon-native** — low gas, native USDC/USDT payment.
- **Discounts** — ERC-20 holding / SBT / staking (non-stacking, max 50%).

<details><summary>▶ 한국어로 보기</summary>

- **ENS 표준 해석** — 텍스트 레코드(EIP-634), 콘텐츠 해시(EIP-1577), 다중 코인 주소(ENSIP-9/SLIP-44), 역방향 해석.
- **만료 등급형 NFT 카드** — 완전 온체인 SVG. 카드 색이 약속한 보유 기간을 반영(charcoal→gold), 갱신 시 상승, 시간 경과로 불변, 만료 시 빨강.
- **다국어 프로필** — 12개 언어, 필드별 영어 폴백.
- **AI 에이전트 결제 라우팅** — `.dex` 이름을 ERC-8004 신원·x402 결제처에 연결.
- **서브네임 커머스** — 소유자가 토큰/SBT 게이팅으로 서브네임 판매.
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
npm test                 # 142 tests
```

Deploy:
```bash
npx hardhat ignition deploy ignition/modules/DXDeployLocal.ts    # local
npx hardhat ignition deploy ignition/modules/DXDeployAmoy.ts --network amoy
npx hardhat ignition deploy ignition/modules/DXDeployPolygon.ts --network polygon
```

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
```

Optional modules (deployed separately, core untouched): DXSubnameRegistrar, DXSubscriptionRenewer, RevenueDistributor.

## Tech Stack

Solidity 0.8.28 · Hardhat 3 · viem · OpenZeppelin 5.x · Chainlink Data Feeds · Polygon PoS.

## License

MIT
