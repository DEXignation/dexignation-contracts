# On-Chain SVG Name Cards — Duration Tiers

> Every `.dex` name is a fully on-chain NFT whose artwork is a hexagonal card colored by how long the owner has committed to it. The color is a durable status symbol: it ratchets up when you buy or renew for longer, never fades with time, and only turns red once the name has actually lapsed.

---

## The idea

The card color encodes commitment. A one-year holder gets a quiet charcoal card; someone who registers for fifteen years gets gold. Because the hexagon matches the DEX logo, the NFT reads as a membership badge whose tier is visible at a glance in any wallet or marketplace.

Crucially, the tier is a "best ever" badge, not a live countdown:
- It **ratchets up** when a registration or renewal extends the total guaranteed duration into a higher tier (buy 3 years, renew another 3 → the card climbs from mud to yellow).
- It **never ratchets down** as time passes — a fifteen-year gold card stays gold even years later, so the badge keeps its meaning.
- The one exception: once the name is **actually expired**, the card turns red, clearly flagging a lapsed name regardless of its earned tier.

<details><summary>▶ 한국어로 보기</summary>

카드 색은 "약속한 보유 기간"을 나타낸다. 1년 보유자는 차분한 차콜, 15년 등록자는 골드. 육각형이 DEX 로고와 같아 NFT가 등급이 한눈에 보이는 멤버십 배지처럼 읽힌다.

핵심은 등급이 실시간 카운트다운이 아니라 "역대 최고" 배지라는 점:
- 등록·갱신으로 총 보장 기간이 더 높은 등급에 도달하면 **상승** (3년 + 3년 갱신 → mud에서 yellow로).
- 시간이 지나도 **내려가지 않음** — 15년 골드 카드는 수년 뒤에도 골드 유지.
- 단 하나의 예외: 실제로 **만료되면 red**로 바뀌어 등급과 무관하게 만료를 명확히 표시.

</details>

---

## Tiers

| Committed duration | Tier | Card |
|---|---|---|
| Expired (lapsed) | Red | warning |
| 1 year | Charcoal | base |
| up to 3 years | Mud | |
| up to 5 years | Burnt Orange | |
| up to 10 years | Yellow | |
| 15 years | Gold | top |

The available registration durations are 1, 3, 5, 10, and 15 years. Gold is reserved for the 15-year commitment — deliberately scarce, so it reads as "in it for the long haul." Renewing shorter terms still climbs the ladder: two 3-year terms reach the yellow band.

<details><summary>▶ 한국어로 보기</summary>

등록 가능 기간은 1·3·5·10·15년. 골드는 15년 약속 전용 — 의도적으로 희소해 "장기 보유"의 상징이 된다. 짧은 기간 갱신도 사다리를 오른다: 3년을 두 번 갱신하면 yellow 구간 도달.

</details>

---

## Color palette

Each card uses a three-stop gradient (light highlight → main → dark base), a same-family glow border, a soft radial shine, and the DEX hexagon. Light cards (yellow/gold) use dark text; dark cards use light text.

```
Tier          Main      Mid       Dark
Red           #ff3226   #9e0907   #280303
Charcoal      #888f93   #202326   #050607
Mud           #a37842   #5a3f22   #160d05
Burnt Orange  #ff7a12   #c64b00   #2f0e00
Yellow        #ffd02c   #d6a300   #382800
Gold          #ffd875   #b68427   #352100
```

The artwork uses gradients and a radial shine but deliberately **no SVG `<filter>`** (no grain or drop-shadow). Filters render inconsistently across wallets and marketplaces and cost more gas; omitting them keeps the card identical everywhere and cheap to generate, while the gradients carry the premium look.

<details><summary>▶ 한국어로 보기</summary>

각 카드는 3단 그라데이션(밝은 하이라이트 → 메인 → 어두운 바닥) + 같은 계열 글로우 테두리 + 부드러운 radial shine + DEX 육각형. 밝은 카드(yellow/gold)는 어두운 글자, 어두운 카드는 밝은 글자.

아트는 그라데이션·shine을 쓰되 **SVG `<filter>`는 의도적으로 제외**(grain·shadow 없음). 필터는 지갑·마켓플레이스마다 렌더가 들쭉날쭉하고 가스도 더 든다. 제외하면 어디서나 동일하게 보이고 생성도 저렴하며, 그라데이션이 프리미엄 느낌을 담당한다.

</details>

---

## Names of any length

The full name is always shown — never truncated. Font size and line count scale with the label length (a short name fills the card at large size; a long one shrinks and wraps onto up to three lines), so even a 50-character label fits inside the hexagon.

<details><summary>▶ 한국어로 보기</summary>

전체 이름은 항상 표시 — 잘리지 않는다. 폰트 크기와 줄 수가 라벨 길이에 맞춰 조절되어(짧은 이름은 크게, 긴 이름은 작아지며 최대 3줄로 줄바꿈), 50자 라벨도 육각형 안에 들어간다.

</details>

---

## How the tier is stored

The registrar keeps one extra mapping, `highestTier[tokenId]` (0=charcoal … 4=gold):
- On `register`, it is set from the purchased duration.
- On `renew`, it is recomputed from the new total guaranteed duration and only updated if higher (ratchet up).
- On `burn`, it is cleared.
- `tokenURI` reads it, but shows red first if the name is currently expired.

This is the only registrar state added for the feature; the expiry, renewal, and burn logic are untouched, and `tokenURI` remains a `view`. Tier boundaries use `<=`, so an exact-N-year purchase lands in the intended tier.

<details><summary>▶ 한국어로 보기</summary>

레지스트라는 매핑 하나(`highestTier[tokenId]`, 0=charcoal…4=gold)만 추가한다:
- `register` 시 구매 기간으로 설정.
- `renew` 시 새 총 보장 기간으로 재계산해 더 높을 때만 갱신(상승).
- `burn` 시 삭제.
- `tokenURI`가 이를 읽되, 현재 만료 상태면 red 우선.

이 기능을 위해 추가된 레지스트라 상태는 이것뿐이고, 만료·갱신·소각 로직은 그대로이며 `tokenURI`는 `view`로 유지. 등급 경계는 `<=`라 정확히 N년 구매가 의도한 등급에 들어간다.

</details>

---

## Tests

```
DXRegistrar — on-chain SVG (hexagonal tier card)   11 passing
  ✔ 1-year purchase → charcoal
  ✔ 3-year purchase → mud
  ✔ 5-year purchase → burnt orange
  ✔ 10-year purchase → yellow
  ✔ 15-year purchase → gold
  ✔ tier ratchets UP on renewal: 3y then +3y → mud climbs to yellow
  ✔ tier does NOT ratchet down as time passes (gold stays gold)
  ✔ expired name shows red regardless of tier
  ✔ includes the tier name and full domain in the JSON
  ✔ shows the full label in the SVG, even a 50-char name
  ✔ renders a hexagon (polygon), not a rectangle card
```

Each test decodes the on-chain `tokenURI` (base64 JSON → base64 SVG) and asserts the rendered color, tier name, and label. Total suite: **142 passing.**

<details><summary>▶ 한국어로 보기</summary>

각 테스트는 온체인 `tokenURI`(base64 JSON → base64 SVG)를 디코딩해 렌더된 색·등급명·라벨을 검증. 전체 **142 통과.**

</details>
