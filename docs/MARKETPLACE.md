# DXMarketplace — On-chain Fixed-Price Marketplace for `.dex` Names

A standalone, fully on-chain marketplace for buying and selling `.dex` second-level domain (2LD) NFTs at a fixed stablecoin price. Listings live on-chain, the NFT never leaves the seller's wallet until the moment of sale, and a purchase settles payment and transfer atomically in a single transaction.

<details><summary>▶ 한국어로 보기</summary>

`.dex` 2단계 도메인(2LD) NFT를 고정 스테이블코인 가격으로 사고파는 독립형 완전 온체인 마켓플레이스. 리스팅은 온체인에 기록되고, NFT는 판매 순간까지 판매자 지갑을 떠나지 않으며, 구매는 단일 트랜잭션에서 결제와 이전을 원자적으로 처리한다.

</details>

---

## Design Principles

The marketplace is a **separate contract** from `DXRegistrar` (the domain NFT). Trading logic — pricing, fees, purchase — changes more often than the core asset, so isolating it lets the marketplace be upgraded or replaced without touching deployed domains. This mirrors the architecture used by OpenSea, Blur, and ENS.

Four decisions shape the design:

- **Fixed-price, not auction.** Sellers set a price; a buyer who pays it owns the name immediately. No bidding.
- **Stablecoin payment → no oracle.** Prices are denominated directly in the pay-token's smallest unit (USDC/USDT), so no USD price feed is needed and oracle-staleness risk is eliminated.
- **Fully on-chain listings.** The contract is the storefront; no backend database is required to know what is for sale.
- **Single-token approval.** A seller approves the marketplace for exactly the token being sold — not `setApprovalForAll` — so a compromise of the module cannot reach the seller's other names.

<details><summary>▶ 한국어로 보기</summary>

마켓플레이스는 도메인 NFT(`DXRegistrar`)와 **별도 컨트랙트**다. 거래 로직(가격·수수료·구매)은 핵심 자산보다 자주 바뀌므로, 분리해두면 배포된 도메인을 건드리지 않고 마켓을 업그레이드·교체할 수 있다. OpenSea·Blur·ENS가 쓰는 구조와 같다.

설계를 결정짓는 네 가지:

- **고정가, 경매 아님.** 판매자가 가격을 정하고, 그 가격을 낸 구매자가 즉시 소유. 입찰 없음.
- **스테이블코인 결제 → 오라클 불필요.** 가격을 결제 토큰(USDC/USDT)의 최소 단위로 직접 표기하므로 USD 가격 피드가 필요 없고 오라클 staleness 위험이 사라진다.
- **완전 온체인 리스팅.** 컨트랙트가 곧 진열대다. 무엇이 판매 중인지 알기 위한 백엔드 DB가 필요 없다.
- **단일 토큰 승인.** 판매자는 파는 토큰 하나만 마켓에 approve한다(`setApprovalForAll` 아님). 모듈이 손상돼도 판매자의 다른 이름에는 닿지 못한다.

</details>

---

## How a Sale Works

**Listing (seller, two signatures):**

1. `registrar.approve(marketplace, tokenId)` — grant the marketplace permission to move *this one* token.
2. `marketplace.list(tokenId, payToken, price)` — record the listing on-chain.

The NFT stays in the seller's wallet the whole time. No third signature is needed for the "LISTED" mark to appear — `tokenURI` derives it live.

**Buying (buyer, atomic):**

1. `payToken.approve(marketplace, price)` — allow the marketplace to pull the stablecoin.
2. `marketplace.buy(tokenId)` — in one transaction: pull USDC from the buyer, pay the seller (minus protocol fee), transfer the NFT to the buyer, and close the listing.

If any step fails, the whole transaction reverts. A buyer can never pay without receiving the name; a seller can never lose the name without being paid.

<details><summary>▶ 한국어로 보기</summary>

**리스팅 (판매자, 서명 2번):**

1. `registrar.approve(marketplace, tokenId)` — 마켓이 *이 토큰 하나*를 옮길 권한 부여.
2. `marketplace.list(tokenId, payToken, price)` — 리스팅을 온체인에 기록.

NFT는 내내 판매자 지갑에 있다. "LISTED" 마크 표시를 위한 세 번째 서명은 없다 — `tokenURI`가 실시간으로 파생한다.

**구매 (구매자, 원자적):**

1. `payToken.approve(marketplace, price)` — 마켓이 스테이블코인을 회수하도록 허용.
2. `marketplace.buy(tokenId)` — 한 트랜잭션에서: 구매자에게서 USDC 회수, 판매자에게 지급(프로토콜 수수료 차감), NFT를 구매자에게 이전, 리스팅 종료.

하나라도 실패하면 전체 트랜잭션이 revert된다. 구매자가 이름 없이 지불하거나, 판매자가 대금 없이 이름을 잃는 일이 불가능하다.

</details>

---

## Subnames Follow the Parent

`.dex` subnames (e.g. `pay.roy.dex`) are registry records owned hierarchically by the parent — they are not separate NFTs. When the parent 2LD NFT transfers to a buyer, `DXRegistrar._update` moves registry control to the buyer and the entire subname subtree follows automatically. The marketplace needs no extra logic for this.

The marketplace supports **whole-tree 2LD trades only**. Selling a 2LD sells everything under it, which is safe because the buyer receives the complete tree. Selling a subname *separately* from its parent is intentionally not supported, since that is the only configuration where a later parent sale could strip a subname buyer.

<details><summary>▶ 한국어로 보기</summary>

`.dex` 서브네임(예: `pay.roy.dex`)은 부모가 계층적으로 소유하는 registry 레코드이며 별도 NFT가 아니다. 부모 2LD NFT가 구매자에게 이전되면 `DXRegistrar._update`가 registry 제어권을 구매자로 옮기고, 서브네임 서브트리 전체가 자동으로 따라온다. 마켓에 추가 로직이 필요 없다.

마켓은 **2LD 통째 거래만** 지원한다. 2LD를 팔면 그 아래 전부가 함께 팔리며, 구매자가 완전한 트리를 받으므로 안전하다. 서브네임을 부모와 *분리해서* 파는 것은 의도적으로 미지원이다 — 나중에 부모가 팔릴 때 서브네임 구매자가 통제권을 잃을 수 있는 유일한 구성이기 때문이다.

</details>

---

## The "LISTED" Mark

While a name is listed, its on-chain SVG shows a restrained mint-green `LISTED` label near the bottom of the hexagonal card. It does not cover the name or change the tier-colored border, and it shows **no price** — only the boolean state. `DXRegistrar.tokenURI` queries `marketplace.isListed(tokenId)` at render time, wrapped in `try/catch` so a paused or replaced marketplace can never break metadata rendering. Listing, price-update, cancel, and sale flows call `DXRegistrar.notifyMetadataUpdate(tokenId)`, which emits ERC-4906 `MetadataUpdate` so OpenSea and other indexers can refresh cached metadata. The mark is isolated in a single `_saleMark()` function for easy restyling.

<details><summary>▶ 한국어로 보기</summary>

이름이 리스팅된 동안, 온체인 SVG는 육각 카드 하단에 절제된 민트그린 `LISTED` 라벨을 표시한다. 이름을 가리거나 등급 테두리를 바꾸지 않으며 **가격은 표시하지 않는다** — 불리언 상태만. `DXRegistrar.tokenURI`가 렌더 시점에 `marketplace.isListed(tokenId)`를 조회하며, `try/catch`로 감싸 마켓이 멈추거나 교체돼도 메타데이터 렌더링이 깨지지 않는다. 리스팅, 가격 변경, 취소, 판매 흐름은 `DXRegistrar.notifyMetadataUpdate(tokenId)`를 호출해 ERC-4906 `MetadataUpdate`를 emit하므로 OpenSea 같은 인덱서가 캐시된 메타데이터를 갱신할 수 있다. 마크는 `_saleMark()` 함수 하나에 격리되어 재디자인이 쉽다.

</details>

---

## Contract Interface

| Function | Caller | Description |
|---|---|---|
| `list(tokenId, payToken, price)` | seller | List an owned, approved 2LD at a fixed stablecoin price |
| `updatePrice(tokenId, newPrice)` | seller | Change the listed price and emit a metadata refresh |
| `cancel(tokenId)` | seller | Remove the listing and emit a metadata refresh |
| `buy(tokenId)` | buyer | Atomically pay and receive the name |
| `isListed(tokenId)` | view | True only if listed *and* the seller still owns it |
| `getListing(tokenId)` | view | Returns `(seller, payToken, price, active)` |
| `setPayToken(token, allowed)` | owner | Whitelist a stablecoin for payment |
| `setProtocolFee(bps)` | owner | Set the protocol fee (capped at `MAX_FEE_BPS` = 10%) |
| `setFeeRecipient(addr)` | owner | Set the fee destination (e.g. treasury) |

<details><summary>▶ 한국어로 보기</summary>

| 함수 | 호출자 | 설명 |
|---|---|---|
| `list(tokenId, payToken, price)` | 판매자 | 소유·승인된 2LD를 고정 스테이블코인 가격에 리스팅 |
| `updatePrice(tokenId, newPrice)` | 판매자 | 리스팅 가격 변경 및 메타데이터 갱신 이벤트 emit |
| `cancel(tokenId)` | 판매자 | 리스팅 제거 및 메타데이터 갱신 이벤트 emit |
| `buy(tokenId)` | 구매자 | 원자적으로 결제하고 이름 수령 |
| `isListed(tokenId)` | view | 리스팅됐고 *동시에* 판매자가 여전히 소유할 때만 true |
| `getListing(tokenId)` | view | `(seller, payToken, price, active)` 반환 |
| `setPayToken(token, allowed)` | owner | 결제용 스테이블코인 화이트리스트 |
| `setProtocolFee(bps)` | owner | 프로토콜 수수료 설정 (`MAX_FEE_BPS` = 10% 상한) |
| `setFeeRecipient(addr)` | owner | 수수료 수신처 설정 (예: treasury) |

</details>

---

## Security Properties

- **Atomic settlement** — payment and NFT transfer occur in one transaction (`buy` is `nonReentrant`, follows checks-effects-interactions, closes the listing before any external call).
- **Ownership re-check at purchase** — `buy` re-verifies `ownerOf(tokenId) == seller`; a stale listing (seller moved or let the name expire) reverts.
- **Pay-token whitelist + SafeERC20** — only approved stablecoins; non-standard return values (USDT-style) handled safely.
- **Fee cap** — protocol fee hard-capped at 10% (`MAX_FEE_BPS`).
- **tokenURI defense** — marketplace lookups are `try/catch`-wrapped so metadata never breaks.
- **Minimal approval** — single-token approval keeps the blast radius to the one listed name.

All of the above are covered by the integration test suite (`test/Marketplace.test.ts`, 17 cases).

<details><summary>▶ 한국어로 보기</summary>

- **원자적 정산** — 결제와 NFT 이전이 한 트랜잭션에서 발생 (`buy`는 `nonReentrant`, checks-effects-interactions 준수, 외부 호출 전 리스팅 종료).
- **구매 시점 소유권 재확인** — `buy`가 `ownerOf(tokenId) == seller`를 재검증; stale 리스팅(판매자가 옮겼거나 만료)은 revert.
- **결제 토큰 화이트리스트 + SafeERC20** — 승인된 스테이블코인만; 비표준 반환값(USDT류) 안전 처리.
- **수수료 상한** — 프로토콜 수수료 10% 하드캡 (`MAX_FEE_BPS`).
- **tokenURI 방어** — 마켓 조회를 `try/catch`로 감싸 메타데이터가 깨지지 않음.
- **최소 승인** — 단일 토큰 승인으로 피해 범위를 리스팅된 이름 하나로 제한.

위 전부가 통합 테스트(`test/Marketplace.test.ts`, 17개)로 검증됨.

</details>

---

## Deployment

```bash
# 1. (Re)deploy DXRegistrar with the marketplace-aware tokenURI
# 2. Deploy the marketplace
#    constructor(registrar, feeRecipient, protocolFeeBps)
# 3. Wire the mark:
registrar.setMarketplace(marketplace)
# 4. Whitelist the stablecoin(s):
marketplace.setPayToken(USDC, true)
marketplace.setPayToken(USDT, true)
```

<details><summary>▶ 한국어로 보기</summary>

```bash
# 1. 마켓 연동 tokenURI가 반영된 DXRegistrar 재배포
# 2. 마켓 배포
#    constructor(registrar, feeRecipient, protocolFeeBps)
# 3. 마크 연결:
registrar.setMarketplace(marketplace)
# 4. 스테이블코인 화이트리스트:
marketplace.setPayToken(USDC, true)
marketplace.setPayToken(USDT, true)
```

</details>
