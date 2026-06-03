# DEXignation Auctions — English & Dutch

Two standalone auction contracts for selling `.dex` second-level domain (2LD) NFTs, complementing the fixed-price `DXMarketplace`. **DXEnglishAuction** is a timed ascending auction for price discovery on premium names; **DXDutchAuction** is a step descending-price auction that works without competition, ideal for an initial premium release.

<details><summary>▶ 한국어로 보기</summary>

`.dex` 2단계 도메인(2LD) NFT를 판매하는 독립형 경매 컨트랙트 2종으로, 고정가 `DXMarketplace`를 보완한다. **DXEnglishAuction**은 프리미엄 이름의 가격 발견을 위한 시간제 올려부르기 경매이고, **DXDutchAuction**은 경쟁 없이도 작동하는 계단식 내려부르기 경매로 초기 프리미엄 분양에 적합하다.

</details>

---

## Mutual Exclusion

A name is in exactly one sale state at a time: **LISTED** (fixed price), **on English auction**, **on Dutch auction**, or none. An NFT is a single token and cannot occupy two sale paths at once; single-token approval already points at only one contract. Each contract cross-checks the others at creation (wrapped in `try/catch`), `DXMarketplace.list` rejects names already on auction, and `DXRegistrar` renders a single mark accordingly. State transitions (cancel one, then list/auction the other) are allowed.

<details><summary>▶ 한국어로 보기</summary>

한 이름은 한 시점에 정확히 하나의 판매 상태만 갖는다: **LISTED**(고정가), **영국식 경매**, **네덜란드식 경매**, 또는 없음. NFT는 단일 토큰이라 두 판매 경로에 동시에 둘 수 없고, 단일 토큰 approve도 한 컨트랙트만 가리킨다. 각 컨트랙트가 생성 시 다른 경로를 교차 조회하고(try/catch), `DXMarketplace.list`는 경매 중인 이름을 거부하며, `DXRegistrar`는 그에 맞는 단일 마크를 표시한다. 상태 전환(하나 취소 후 다른 방식으로 등록)은 허용된다.

</details>

---

## DXEnglishAuction — Timed Ascending

Follows the NFT-market standard: escrowed bids, pull refunds, anti-snipe extension, and a minimum bid increment.

- **Escrow** — a bid pulls the bidder's stablecoin into the contract, so a winner can never be unable to pay.
- **Pull refunds** — an outbid bidder is credited to a ledger and withdraws themselves; funds are never auto-sent, avoiding a malicious-receiver DoS.
- **Anti-snipe** — a bid inside the closing window pushes the deadline out, so last-second sniping cannot end a live contest.
- **Minimum increment** — a new bid must beat the current top by a set percentage.

Settlement is callable by **anyone** after close, so an auction can never be stuck. If at settlement the seller no longer owns the name, the auction ends gracefully and credits the winner for refund — it does **not** revert (a revert would roll back the credit and trap the escrow).

<details><summary>▶ 한국어로 보기</summary>

NFT 시장 표준을 따른다: 입찰금 에스크로, Pull 환불, 마감 자동연장(anti-snipe), 최소 입찰 증가.

- **에스크로** — 입찰 시 스테이블코인을 컨트랙트로 회수해, 낙찰자가 대금이 없을 수 없다.
- **Pull 환불** — 밀린 입찰자는 장부에 적립되고 본인이 인출한다. 자동 송금하지 않아 악성 수신자 DoS를 피한다.
- **Anti-snipe** — 마감 임박 입찰은 마감을 연장해, 막판 스나이핑이 경쟁을 끝내지 못한다.
- **최소 증가** — 새 입찰은 직전 최고가를 정해진 비율만큼 넘어야 한다.

정산은 마감 후 **누구나** 호출할 수 있어 경매가 묶이지 않는다. 정산 시점에 판매자가 더는 이름을 소유하지 않으면, 경매를 정상 종료하며 낙찰자에게 환불을 적립한다 — **revert하지 않는다**(revert는 적립을 롤백해 에스크로를 가둔다).

</details>

### Interface

| Function | Caller | Description |
|---|---|---|
| `createAuction(tokenId, payToken, reservePrice, duration)` | seller | Open an auction on an owned, approved 2LD |
| `bid(tokenId, amount)` | bidder | Escrow a bid; must beat reserve / top + increment |
| `withdraw(payToken)` | outbid bidder | Withdraw refunds owed to you |
| `settle(tokenId)` | anyone | After close: pay seller, transfer name, or refund winner |
| `cancelAuction(tokenId)` | seller | Cancel — only before any bid exists |
| `isOnAuction(tokenId)` | view | True while a live auction exists |

---

## DXDutchAuction — Step Descending

The price holds for `stepInterval`, then drops by a fixed **whole** amount each step down to a floor. The first buyer to call `buy` pays the current step price and wins immediately — no bidding, no escrow, so it works with very few users.

Every step price is an exact integer. The per-step drop is set in one of two modes:

- **Rate mode** — `dropPerStep = startPrice * stepDropBps / 10000`, rejected at creation (`IndivisibleDrop`) unless it divides evenly.
- **Fixed mode** — `dropPerStep` is a whole amount the caller specifies.

Exactly one mode must be set. At the floor the price holds and the name stays buyable. `buy` takes a `maxPrice` slippage guard and settles payment and transfer atomically.

<details><summary>▶ 한국어로 보기</summary>

가격이 `stepInterval` 동안 유지된 뒤 매 계단 고정 **정수**액씩 바닥가까지 떨어진다. 처음 `buy`를 부른 구매자가 그 계단 가격에 즉시 낙찰 — 입찰·에스크로가 없어 유저가 적어도 작동한다.

모든 계단 가격은 정확한 정수다. 계단당 하락은 두 모드 중 하나로 지정:

- **비율 모드** — `dropPerStep = 시작가 * stepDropBps / 10000`, 나누어떨어지지 않으면 생성 시 `IndivisibleDrop`으로 거부.
- **정액 모드** — `dropPerStep`을 호출자가 정수로 지정.

정확히 한 모드만 지정해야 한다. 바닥가에 도달하면 가격이 고정되고 이름은 계속 구매 가능하다. `buy`는 `maxPrice` 슬리피지 가드를 받고 결제·이전을 원자적으로 정산한다.

</details>

### Interface

| Function | Caller | Description |
|---|---|---|
| `createAuction(tokenId, payToken, startPrice, floorPrice, stepInterval, stepDropBps, stepDropAmount)` | seller | Open a step Dutch auction (rate OR fixed mode) |
| `currentPrice(tokenId)` | view | The current step price (integer, floor-clamped) |
| `buy(tokenId, maxPrice)` | buyer | Buy at the current price; atomic, slippage-guarded |
| `cancelAuction(tokenId)` | seller | Cancel an unsold auction |
| `isOnAuction(tokenId)` | view | True while a live auction exists |

---

## The AUCTION Mark

While a name is on either auction, its on-chain SVG shows a restrained **AUCTION** label in amber (`#FFB020`) near the bottom of the card — same position and font as the mint **LISTED** mark, distinguished only by color. Because the states are mutually exclusive, at most one mark ever appears. `DXRegistrar._saleState` resolves the state (0 none / 1 LISTED / 2 AUCTION), querying the marketplace then the two auctions, all wrapped in `try/catch` so a paused contract never breaks metadata.

<details><summary>▶ 한국어로 보기</summary>

경매 중인 이름은 온체인 SVG 카드 하단에 절제된 **AUCTION** 라벨을 호박색(`#FFB020`)으로 표시한다 — 민트 **LISTED** 마크와 같은 위치·폰트, 색으로만 구분. 상태가 상호 배타라 최대 하나만 표시된다. `DXRegistrar._saleState`가 상태(0=없음/1=LISTED/2=AUCTION)를 판정하며, 마켓을 먼저 조회한 뒤 두 경매를 조회한다. 모두 `try/catch`로 감싸 멈춘 컨트랙트가 메타데이터를 깨뜨리지 않는다.

</details>

---

## Deployment

Use the Ignition module `DXDeployTrading` or the script `scripts/deploy-trading.ts`; both deploy all three contracts and perform every wiring call.

```bash
# 1. Deploy Registrar (redeploy) + Marketplace + English + Dutch
# 2. registrar.setMarketplace(marketplace)            # LISTED mark
# 3. registrar.setAuctions(english, dutch)            # AUCTION mark
# 4. marketplace.setAuctionContracts(english, dutch)  # list ↔ auction mutual-excl
# 5. english.setMarketplace(marketplace)              # createAuction ↔ listing mutual-excl
# 6. dutch.setMarketplace(marketplace)
# 7. {marketplace,english,dutch}.setPayToken(USDC/USDT, true)
```

<details><summary>▶ 한국어로 보기</summary>

Ignition 모듈 `DXDeployTrading` 또는 스크립트 `scripts/deploy-trading.ts`를 쓰면 세 컨트랙트 배포와 모든 연결 호출이 자동으로 수행되어 수동 연결 누락을 방지한다.

</details>
