# 배포 주소 (Deployments)

DEXignation 컨트랙트의 배포 주소 기록. `ignition/deployments/` 빌드 캐시는 git에서 제외(`.gitignore`)되므로, 운영에 필요한 주소는 이 문서로 관리한다.

> 소스 검증(verify)은 audit 완료 후 최종 코드 기준으로 일괄 진행 예정.

---

## Polygon Mainnet (chain 137)

배포일: 2026-06-12
배포 모듈: `DXDeployPolygon.ts` (core) + `DXDeployTradingPolygon.ts` (trading)

### Core

| 컨트랙트 | 주소 | 역할 |
|----------|------|------|
| DXRegistry | `0xCF223951E5bc4fdc6020B13841164063EB3f8BD2` | 네임 레지스트리 (소유권·만료·판매잠금의 진실 원천) |
| DXRegistrar | `0x955e12C3FbEED058794078726DcAA2f984194e7B` | `.dex` 2LD 발급·NFT·만료 관리 |
| DXResolver | `0x67f1986B4be10F2504A4028B560cAC10A105d359` | 레코드 해석 (addr/text/contenthash/agent/다국어) |
| DXRegistrarController | `0x6aEe51C1D1B7493223c005BEf23D7368093d0FA7` | 등록 진입점 (commit-reveal·결제·할인) |
| DXPriceOracle | `0x4431afFF966288794e157fAC4E2a38d9A8cC8835` | 렌트 가격·POL/USD 환산 |
| DXReverseRegistrar | `0xe75Bc8FA45544c0F42B534D8271D279296e640F0` | 역방향 해석 (addr → name) |
| DXReservations | `0xdCB2d72a601701826eac1B18cE6d2959e345858D` | 상표/프리미엄 라벨 예약 |
| **DXSubnameRegistrar** | `0x78De395499ADE08b091d1F0f71bcFeE3b3C58e29` | **서브네임 판매-잠금 커머스 모듈** |
| RevenueDistributor | `0x5A3638Df11feF62076fEe45C8E95D751c7eD671a` | 수익 분배 (treasury/staking/burn/buffer) |
| DXNToken | `0x60E7A992bE5cCA6b674350588A1eE9E1eF5047C1` | DXN 거버넌스/유틸리티 토큰 |
| DXNStaking | `0x90f3636D853DD54dcD96D1E37B419C70cE522fb6` | DXN 스테이킹 (할인·보상) |
| DXContributionSBT | `0xf091Cc297256DcD24702bAC7D5B9009616e4caeA` | 기여자 SBT (양도불가 배지) |

### Trading

| 컨트랙트 | 주소 | 역할 |
|----------|------|------|
| DXMarketplace | `0x8a432bDf993871badBe591347F425750Ba182B95` | 고정가 2차 거래 |
| DXEnglishAuction | `0xC2AE35d59Db850A723178Ed35A28dfCD068FaFbb` | 영국식(상승) 경매 |
| DXDutchAuction | `0x4B5F75c9e348711C56aAd45aC2a8EFCD68657719` | 더치(하락) 경매 |
| DXSubscriptionRenewer | `0x511e04A19fA0a61FC36348a332Ca057FfDB49e63` | 구독 자동 갱신 |

### 외부 의존성 (Polygon mainnet)

| 항목 | 주소 |
|------|------|
| Chainlink POL/USD feed | `0xAB594600376Ec9fD91F8e885dADF0CE036862dE0` |
| USDC | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |

---

## Polygon Amoy Testnet (chain 80002)

배포일: 2026-06-12
배포 모듈: `DXDeployAmoyMock.ts` (mock 가격 피드 — Amoy 실 Chainlink 피드가 죽어 있어 대체)

> 테스트넷 검증용. 코어 + 서브네임 모듈만 포함하며, RevenueDistributor·DXN·trading은 미포함.

| 컨트랙트 | 주소 |
|----------|------|
| DXRegistry | `0x60E7A992bE5cCA6b674350588A1eE9E1eF5047C1` |
| DXRegistrar | `0x955e12C3FbEED058794078726DcAA2f984194e7B` |
| DXResolver | `0x67f1986B4be10F2504A4028B560cAC10A105d359` |
| DXRegistrarController | `0x6aEe51C1D1B7493223c005BEf23D7368093d0FA7` |
| DXPriceOracle | `0xf091Cc297256DcD24702bAC7D5B9009616e4caeA` |
| DXReverseRegistrar | `0xe75Bc8FA45544c0F42B534D8271D279296e640F0` |
| DXReservations | `0x4431afFF966288794e157fAC4E2a38d9A8cC8835` |
| DXSubnameRegistrar | `0x55f54f515B1778352428B7BfF93659312013f29a` |
| MockPolUsd (가격 피드) | `0xCF223951E5bc4fdc6020B13841164063EB3f8BD2` |
| TestUSDC | `0xdCB2d72a601701826eac1B18cE6d2959e345858D` |
| TestUSDT | `0xD4f9D757662e6fd9C33EbCE83384EFbE2a17a762` |

---

## 배포 후 운영 메모

### 서브네임 판매를 열려면 (부모 도메인 소유자가 직접)

판매 모듈 인가(`setSaleModule`)는 배포 시 자동 처리됨. 각 부모는 판매 전 **위임**만 하면 된다:

```
registry.setApprovalForAll(<DXSubnameRegistrar>, true)
```

그다음 `DXSubnameRegistrar.configureSubname(node, price, duration, enabled)`로 판매를 설정한다.

### 권한 점검 항목

- `DXRegistry`의 루트(0x0) 소유자 = 관리자 지갑 (`setSaleModule` 호출 권한 보유)
- `RevenueDistributor`의 treasury/feeRecipient = 의도한 지갑
- 정기 fund sweeping 대상 일치 확인

### 검증(verify) 시 생성자 인자 참고

verify 시 생성자 인자가 필요한 주요 컨트랙트:

- DXSubnameRegistrar: `(registry, resolver, revenueDistributor, 500)`
- DXRegistrar: `(registry, TLD_NODE, "dex")`
- DXRegistrarController: `(registrar, registry, priceOracle)`
- DXResolver: `(registry)`
- RevenueDistributor: 분배 설정 구조체 (treasury/staking/burn/buffer BPS 포함)
