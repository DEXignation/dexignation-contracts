# DEXignation — 개발팀 인수인계 기술 리포트

> Polygon 메인넷에 배포·검증 완료된 `.dex` Web3 네임 서비스. 본 문서는 컨트랙트 연동을 담당할 개발팀을 위한 전체 기술 레퍼런스입니다. 각 컨트랙트의 역할, 주요 함수·변수, 그리고 연동 시 참조할 테스트 파일을 매핑합니다.

---

## 0. 배포 정보 (Polygon Mainnet, chainId 137)

| 컨트랙트 | 주소 | 역할 |
|---|---|---|
| **DXRegistrar** (NFT) | `0xc5D439c39b66FF81aDAd518ADa4Ba4C012eE98fD` | ERC-721 이름 NFT, 만료 관리 |
| DXRegistry | `0x5e0b02ec270A31a6040B76c2cd3b0D5eA6282555` | 권한 루트 (소유권·리졸버 매핑) |
| DXRegistrarController | `0xcDAA5f0b1AD56F9bAf87D6f9E6a154f0828db8a6` | 등록·갱신·결제·할인 진입점 |
| DXResolver | `0x60639A64285C6F3F977132a25954D47E3938371D` | 주소·텍스트·콘텐츠·에이전트 해석 |
| DXPriceOracle | `0x1882d078B730418e1817eCf309D30032B80A29d3` | USD→POL 가격 환산 (Chainlink) |
| DXReverseRegistrar | `0x32382a26d1b6dd4389E90C8befd055645EE388A2` | 역방향 해석 (주소→이름) |
| DXReservations | `0x08e130D338b45C6cdB1196f77a385eBf68519C33` | 예약 라벨 관리 |

모든 컨트랙트는 PolygonScan + Sourcify에 소스 검증 완료. NFT는 OpenSea `https://opensea.io/assets/matic/0xc5D439c39b66FF81aDAd518ADa4Ba4C012eE98fD/{tokenId}` 에서 확인 (tokenId = `uint256(keccak256(label))`).

가격 (USD, immutable): 1년 $8 / 3년 $18 / 5년 $25 / 10년 $40 / 15년 $55. 결제 시 Chainlink POL/USD 피드로 POL 환산. USDC/USDT 직접 결제도 지원.

---

## 1. 시스템 아키텍처

DEXignation은 ENS 모델을 계승한 모듈형 구조입니다. 핵심 흐름:

```
사용자 → Controller (등록/결제/할인) → Registrar (NFT 발급) → Registry (권한 기록)
                                              ↓
                                         Resolver (이름→데이터 해석)
         Controller → PriceOracle (USD→POL 환산, Chainlink)
```

- **Registry**가 권한의 루트입니다. "누가 이 노드의 소유자인가"를 기록합니다.
- **Registrar**가 `.dex` TLD를 관장하며, 이름을 ERC-721 NFT로 발급합니다.
- **Controller**가 사용자 진입점입니다. 커밋-리빌 등록, 결제, 할인을 처리합니다.
- **Resolver**가 이름을 실제 데이터(주소, 텍스트, 콘텐츠, 에이전트)로 변환합니다.
- **PriceOracle**가 USD 고정가를 실시간 POL로 환산합니다.

확장 모듈(별도 배포 가능, 코어 무수정):
- **DXSubnameRegistrar** — 서브네임 판매·접근 제어
- **DXSubscriptionRenewer** — 무허가 자동 갱신
- **RevenueDistributor** — 수익 분배

---

## 2. 컨트랙트별 상세

### 2.1 DXRegistrar — 이름 NFT (ERC-721)

핵심 컨트랙트. 각 `.dex` 이름이 하나의 NFT입니다.

**주요 변수**
- `expiries[tokenId]` — 이름의 만료 시각 (Unix timestamp)
- `names[tokenId]` — 원본 라벨 문자열 (tokenURI 렌더링용)
- `highestTier[tokenId]` — NFT 등급 색 (0=charcoal ~ 4=gold). "역대 최고" 배지
- `gracePeriod` — 만료 후 갱신 유예 기간 (70일)
- `controllers[address]` — 등록·갱신 권한을 위임받은 컨트롤러 화이트리스트

**주요 함수**
- `available(id)` — 등록 가능 여부 (미등록이거나 만료+유예 경과)
- `nameExpires(id)` — 만료 시각 조회
- `tokenURI(id)` — 온체인 SVG 등급 카드 (base64 JSON). 만료 시 빨강, 아니면 등급 색
- `burn(id)` — 만료+유예 경과한 이름 영구 소각 (누구나 가능, permissionless 정리)
- `reclaim(id, owner)` — Registry 소유권 재설정
- `addController/removeController` — 컨트롤러 관리 (onlyOwner)
- `setGracePeriod` — 유예 기간 조정 (onlyOwner, 7~365일)

**등급 규칙 (중요)**: 등급은 등록 시 구매 기간으로 설정, 갱신 시 더 길어지면 상향, 시간 경과로는 하향 안 됨. 만료 시에만 빨강 표시. 경계: `<=1년` charcoal, `<=3년` mud, `<=5년` orange, `<=10년` yellow, 그 이상(15년) gold.

→ **참조 테스트**: `Registrar-SVG.test.ts` (tokenURI 디코딩·등급 색), `Registrar-Burn.test.ts` (소각)

### 2.2 DXRegistrarController — 등록·결제 진입점

사용자가 직접 호출하는 컨트랙트. 모든 등록·갱신이 여기를 거칩니다.

**등록 흐름 (커밋-리빌, MEV 방어)**
1. `commit(commitment)` — 등록 의도를 해시로 먼저 제출
2. `minCommitmentAge` 대기 (이름 선점 공격 방지)
3. `register(label, owner, duration, resolver, secret)` payable — 실제 등록 + 결제

**주요 함수**
- `commit(commitment)` — 커밋 제출. commitment = `keccak256(label, owner, duration, resolver, paymentToken, secret)`
- `register(...)` payable — 네이티브(POL) 결제 등록
- `registerWithToken(...)` — USDC/USDT 등 ERC-20 결제 등록
- `renew(label, duration)` payable / `renewWithToken(...)` — 갱신
- `rentPrice(duration)` — POL 가격 조회 (Chainlink 환산)
- `rentPriceInToken(duration, token)` — 토큰 가격 조회
- `available(label)` / `isValidLabel(label)` — 등록 가능·유효성
- `effectiveDiscountBps(user)` / `isDiscountEligible(user)` — 할인율 조회
- `setAllowedPaymentToken(token, bool)` — 결제 토큰 화이트리스트 (onlyOwner)
- `setSBTDiscount / setStakeDiscount / setDiscountToken` — 할인 설정 (onlyOwner)
- `pause() / unpause()` — 긴급 정지 (onlyOwner)
- `withdraw() / withdrawToken(token)` — 수익 인출 (onlyOwner)

**할인 엔진**: ERC-20 보유 / SBT 보유 / 스테이킹 3종 소스. 중첩 안 됨(최댓값 적용), 최대 50%.

→ **참조 테스트**: `DXRegistrarController.test.ts` (등록 흐름), `Holder discount`·`SBT-gated discount`·`Staking discount` (할인), `MEV.test.ts` (선점 방어), `Hostile ERC-20` (악성 토큰 방어)

### 2.3 DXResolver — 이름 해석

이름을 실제 데이터로 변환. 모든 읽기는 **만료 인지(expiry-aware)** — 만료된 이름은 빈 값 반환.

**주요 함수**
- `addr(node, coinType)` — 다중 코인 주소 해석 (ENSIP-9/SLIP-44). ETH/EVM = coinType 60
- `setAddr(node, coinType, addrBytes)` — 주소 설정 (소유자/승인자)
- `text(node, key)` / `setText(node, key, value)` — 텍스트 레코드 (EIP-634). 아바타·이메일·소셜 등
- `contenthash(node)` / `setContenthash(node, hash)` — 콘텐츠 해시 (EIP-1577). IPFS 등
- `setProfile / getProfile` — 12개 언어 현지화 프로필 (언어별 폴백)
- `getAgent / setAgent / agentPayment / hasAgent / clearAgent` — AI 에이전트 신원·결제 라우팅 (ERC-8004/x402)
- `setApprovalForAll(operator, bool)` — 운영자 위임
- `supportsInterface(id)` — ERC-165
- `isCoinSupported / getCoinName` — 지원 코인 조회

**중요 — 등록 ≠ 자동 해석**: 이름을 등록해도 주소는 자동 설정되지 않습니다. 소유자가 `setAddr`를 따로 호출해야 합니다 (ENS 표준 설계). **프론트엔드에서 register 직후 setAddr를 자동 호출**하는 UX 권장.

→ **참조 테스트**: `Resolver-Text.test.ts`, `Resolver-Contenthash.test.ts`, `DXResolver — localized profile`, `DXResolver — agent identity` (각 기능별)

### 2.4 DXPriceOracle — 가격 환산

USD 고정가를 Chainlink POL/USD 피드로 실시간 POL 환산.

**주요 변수**
- `price1Year ~ price15Year` — 각 기간 USD 가격 (attoUSD, immutable)
- `polUsdOracle` — Chainlink POL/USD 피드 주소

**주요 함수**
- `price(duration)` — 해당 기간의 POL 가격 반환 (USD × Chainlink 환산)
- `setPolUsdOracle(addr)` — 피드 주소 교체 (onlyOwner)
- `setMaxoracleDelay(delay)` — 피드 staleness 허용 시간 (onlyOwner)

**중요**: 허용 기간은 1/3/5/10/15년만. 다른 기간은 `InvalidDuration` revert. 가격은 immutable (배포 후 변경 불가).

→ 컨트롤러의 `rentPrice`가 내부적으로 이 컨트랙트를 호출

### 2.5 DXRegistry — 권한 루트

"누가 이 노드의 소유자/리졸버인가"를 기록하는 ENS형 레지스트리.

**주요 함수**
- `owner(node)` / `setOwner(node, owner)` — 노드 소유권
- `resolver(node)` / `setResolver(node, resolver)` — 노드의 리졸버
- `setSubnodeOwner(node, label, owner)` — 서브노드 소유권 부여
- `isExpired(node)` — 만료 여부

### 2.6 DXReverseRegistrar — 역방향 해석

주소 → 이름 (UI에 사람이 읽는 이름 표시용).

- `claim(owner)` — 역방향 노드 소유권 주장
- `setName(name)` — 내 주소의 기본 이름 설정

→ **참조 테스트**: 역방향 해석 관련 테스트

### 2.7 DXReservations — 예약 라벨

상표·프리미엄 이름을 사전 예약·보호.

- `isReserved(label)` / `isClaimableBy(...)` — 예약 상태
- `reserve / bulkReserve` — 예약 (onlyOwner)
- `releaseLabel(label)` — 예약 해제
- `setReleaser(addr, bool)` — 해제 권한 위임

→ **참조 테스트**: `DXReservations` 스위트

---

## 3. 확장 모듈 (선택적, 별도 배포)

### 3.1 DXSubnameRegistrar — 서브네임 커머스

이름 소유자가 서브네임(예: `shop.alice.dex`)을 판매·접근 제어.

- `configureSubname(...)` — 부모 소유자가 판매 설정 (가격 등)
- `registerSubname(...)` payable — 구매자가 서브네임 구매
- `setSubnameGate(parentNode, token, threshold)` — 토큰/SBT 보유 조건 게이팅
- `quote / isPurchasable / meetsGate` — 조회
- `setProtocolFee / setFeeRecipient` — 프로토콜 수수료 (최대 20%)

연동 패턴: 부모 소유자가 `setApprovalForAll(module, true)`로 모듈에 권한 위임 → 모듈이 서브네임 발급.

→ **참조 테스트**: `DXSubnameRegistrar — subname commerce`, `access gating`

### 3.2 DXSubscriptionRenewer — 무허가 자동 갱신

소유자가 스테이블코인 사전 승인 → 누구나 갱신 트리거 (백엔드 크론 등).

- `subscribe(label, paymentToken, duration, maxPricePerRenewal)` — 구독 등록
- `executeRenewal(label)` — 갱신 실행 (permissionless, 시점·가격상한 재검증)
- `isRenewable(label)` — 갱신 가능 시점 여부
- `unsubscribe(label)` — 구독 해지

운영: 백엔드가 주기적으로 `isRenewable` 확인 → true면 `executeRenewal` 호출. USDT 비표준 approve도 처리.

→ **참조 테스트**: `DXSubscriptionRenewer — auto-renewal`, `USDT`

### 3.3 RevenueDistributor — 수익 분배

- `setShares(shares)` — 분배 비율 설정
- `distributeNative() / distributeToken(token)` — 분배 실행
- `notifyReward(...)` — 보상 알림

---

## 4. 개발팀 연동 가이드

### 4.1 읽기 전용 연동 (가장 쉬움, 지갑·익스플로러)

해석만 하면 되는 경우 (송금 주소 조회 등) — 컨트랙트 호출만, 트랜잭션 불필요:

```
이름 → 주소:   DXResolver.addr(node, 60)
주소 → 이름:   역방향 해석
텍스트 조회:   DXResolver.text(node, "avatar")
NFT 카드:     DXRegistrar.tokenURI(tokenId)
```

`node` 계산: `namehash("alice.dex")` = `keccak256(namehash("dex") ++ keccak256("alice"))`. 표준 ENS namehash 알고리즘 사용.

### 4.2 등록 연동 (커밋-리빌 2단계)

```
1. commitment = keccak256(label, owner, duration, resolver, paymentToken, secret)
2. controller.commit(commitment)
3. minCommitmentAge 대기 (실제 시간)
4. controller.register(label, owner, duration, resolver, secret) { value: rentPrice }
5. (권장) resolver.setAddr(node, 60, owner)  ← UX 자동화
```

### 4.3 테스트 코드 = 연동 레퍼런스

각 기능의 정확한 호출법은 `test/` 디렉토리가 살아있는 예제입니다. 연동 전 해당 테스트를 먼저 읽으세요:

| 기능 | 참조 테스트 파일 |
|---|---|
| 등록·결제 | `DXRegistrarController.test.ts` |
| NFT tokenURI·등급 | `Registrar-SVG.test.ts` |
| 텍스트 레코드 | `Resolver-Text.test.ts` |
| 콘텐츠 해시 | `Resolver-Contenthash.test.ts` |
| 다중 코인 주소 | (Resolver addr 관련) |
| 다국어 프로필 | `DXResolver — localized profile` |
| 에이전트 라우팅 | `DXResolver — agent identity` |
| 할인 | `Holder discount`, `SBT-gated discount`, `Staking discount` |
| 서브네임 | `DXSubnameRegistrar` 스위트 |
| 자동 갱신 | `DXSubscriptionRenewer` 스위트 |
| 소각 | `Registrar-Burn.test.ts` |
| MEV 방어 | `MEV.test.ts` |
| 악성 토큰 방어 | `Hostile ERC-20` |

---

## 5. 검증 현황

**단위 테스트 142건 전수 통과** + **실제 메인넷 end-to-end 검증 완료**:
- 가격 환산 (Chainlink POL/USD, 1~15년) ✅
- 이름 등록 (커밋-리빌) ✅
- NFT 등급 카드 (온체인 SVG) ✅
- 다중 코인 주소 (setAddr/addr) ✅
- 텍스트 레코드 ✅
- 컨트랙트 소스 검증 (PolygonScan + Sourcify) ✅

테스트 영역: 등록·결제·할인·갱신·소각·해석·NFT·구독·서브네임·MEV 저항·악성 토큰 방어·시스템 불변식(invariants)·퍼즈 테스트.

---

## 6. 운영 시 주의사항

- **owner 키 = 7개 컨트랙트 전체의 관리 권한** (가격 피드 교체, 긴급 정지, 수익 인출). 안전 보관 필수.
- **가격은 immutable** — 배포된 가격은 변경 불가. 가격 정책 변경 시 오라클 재배포 필요.
- **등록 ≠ 자동 해석** — 프론트엔드에서 setAddr 자동 호출 UX 필요.
- **긴급 정지** — 사고 시 `controller.pause()`로 신규 등록 일시 중단 가능 (기존 이름 영향 없음).
- **확장은 모듈로** — 코어는 동결 상태. 신규 기능은 별도 모듈로 추가 (서브네임·구독처럼).
