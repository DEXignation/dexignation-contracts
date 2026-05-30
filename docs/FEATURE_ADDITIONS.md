# DEXignation — Feature Additions (Post-Audit Hardening & Tokenomics)

> Documentation for four features added after the core test suite reached green: an emergency pause, localized profiles, and two discount sources (SBT and staking) that fold into a single safe discount engine. All changes are covered by tests; the suite stands at 104 passing.

---

## Overview

| Feature | Contract | Type | Tests |
|---|---|---|---|
| Emergency pause | `DXRegistrarController` | Safety | 5 |
| Localized profile | `DXResolver` | Product | 5 |
| SBT-gated discount | `DXRegistrarController` | Tokenomics | 6 |
| Staking discount | `DXRegistrarController` | Tokenomics | 6 |

A design note that ties three of these together: the controller now has **three independent discount sources** — ERC-20 holdings, contribution SBTs, and staking. They are deliberately **non-stacking**: a user who qualifies for several receives only the single largest discount. This preserves the `MAX_DISCOUNT_BPS` (50%) ceiling no matter how the sources are configured, so a price can never go negative or below the floor.

<details><summary>▶ 한국어로 보기</summary>

핵심 테스트가 그린에 도달한 뒤 추가한 네 기능 문서: 긴급 정지, 현지화 프로필, 그리고 단일 안전 할인 엔진으로 합쳐지는 두 할인원(SBT·스테이킹). 모두 테스트로 커버되며 현재 104개 통과.

설계 메모: 컨트롤러는 이제 **세 개의 독립 할인원** — ERC-20 보유, 기여 SBT, 스테이킹 — 을 가집니다. 의도적으로 **비중첩**입니다: 여러 조건을 충족해도 가장 큰 할인 하나만 적용됩니다. 이로써 할인원을 어떻게 설정하든 `MAX_DISCOUNT_BPS`(50%) 상한이 보장되어, 가격이 음수가 되거나 하한 아래로 내려갈 수 없습니다.

</details>

---

## 1. Emergency Pause

Adds OpenZeppelin `Pausable` to the controller. The four value-moving entry points — `register`, `renew`, `registerWithToken`, `renewWithToken` — are gated with `whenNotPaused`. `commit()` is intentionally left open: it moves no funds, and gating it would force users to re-wait `minCommitmentAge` after an unpause.

```solidity
function pause()   external onlyOwner;   // halt register/renew
function unpause() external onlyOwner;    // resume
```

**Operational use:** if a price-oracle or payment-token issue surfaces post-launch, the owner (ideally a multisig) halts registrations immediately, investigates, and resumes — no redeploy required.

<details><summary>▶ 한국어로 보기</summary>

컨트롤러에 OpenZeppelin `Pausable` 추가. 자금이 움직이는 4개 진입점(`register`, `renew`, `registerWithToken`, `renewWithToken`)에 `whenNotPaused` 적용. `commit()`은 의도적으로 열어둠: 자금 이동이 없고, 막으면 정지 해제 후 `minCommitmentAge`를 다시 기다려야 하기 때문.

**운영 활용:** 출시 후 오라클·결제 토큰 문제 발생 시 owner(멀티시그 권장)가 즉시 등록 중단 → 조사 → 재개. 재배포 불필요.

</details>

---

## 2. Localized Profile

Builds on the resolver's existing multi-language text store (`node → key → langCode → value`, 12 languages). Two conveniences are added so a client can set or fetch a whole profile in one call instead of per-key round-trips.

```solidity
function setProfile(
  bytes32 node, string langCode,
  string name_, string bio, string avatar, string url
) external;  // owner/operator only

function getProfile(bytes32 node, string langCode)
  external view
  returns (string name_, string bio, string avatar, string url);
```

Behavior:
- Profile fields are stored under standard keys (`profile.name`, etc.) via the same multi-language mechanism, so they interoperate with `getMultiLangText`.
- `getProfile` applies **per-field English fallback**: a missing Korean `bio` falls back to the English `bio` independently of the other fields.
- An **expired node returns empty strings** — consistent with `text()` and `contenthash()`. (This release also fixes a missing expiry check in `getMultiLangText`.)

This is a concrete localization edge: a wallet in Korea/Japan/Vietnam can render a native-language profile automatically, where ENS profiles are English-default.

<details><summary>▶ 한국어로 보기</summary>

리졸버의 기존 다국어 text 저장소(`node→key→langCode→value`, 12개 언어) 위에 구축. 키별 왕복 대신 프로필 전체를 한 번에 설정/조회하는 편의 함수 두 개 추가.

동작:
- 프로필 필드는 표준 키(`profile.name` 등)로 동일 다국어 메커니즘에 저장 → `getMultiLangText`와 상호운용.
- `getProfile`은 **필드별 영어 폴백** 적용: 한국어 `bio`가 없으면 다른 필드와 독립적으로 영어 `bio`로 폴백.
- **만료 노드는 공백 반환** — `text()`·`contenthash()`와 일관. (이번 릴리스에서 `getMultiLangText`의 누락된 만료 체크도 수정.)

구체적 현지화 우위: 한국/일본/베트남 지갑이 모국어 프로필을 자동 표시. ENS 프로필은 영어 기본.

</details>

---

## 3. SBT-Gated Discount

Holders of a contribution SBT (`DXContributionSBT`) receive a configurable registration/renewal discount. This turns the reputation badge from a cosmetic token into a spend-affecting asset.

```solidity
function setSBTDiscount(address sbtToken, uint256 bps) external onlyOwner;
// bps capped at MAX_DISCOUNT_BPS; zero address disables and zeroes the rate
```

Eligibility is simply holding ≥ 1 badge (`balanceOf(user) > 0`).

<details><summary>▶ 한국어로 보기</summary>

기여 SBT(`DXContributionSBT`) 보유자는 설정 가능한 등록/갱신 할인을 받음. 평판 배지를 장식용 토큰에서 지출에 영향을 주는 자산으로 전환.

자격은 배지 1개 이상 보유(`balanceOf(user) > 0`). `bps`는 `MAX_DISCOUNT_BPS` 상한, zero address면 비활성 및 율 0으로 초기화.

</details>

---

## 4. Staking Discount

Stakers with at least a threshold balance in `DXNStaking` receive a discount. This is the token value-capture loop: staking DXN reduces your domain costs, giving the governance token concrete utility beyond voting.

```solidity
function setStakeDiscount(
  address staking, uint256 threshold, uint256 bps
) external onlyOwner;
// bps capped at MAX_DISCOUNT_BPS; zero address disables and zeroes threshold+rate
```

Eligibility is `stakedOf(user) >= threshold`.

<details><summary>▶ 한국어로 보기</summary>

`DXNStaking`에 임계치 이상 스테이크한 사용자는 할인을 받음. 이것이 토큰 가치 포착 루프: DXN 스테이킹이 도메인 비용을 줄여, 거버넌스 토큰에 투표 외 구체적 유틸리티 부여.

자격은 `stakedOf(user) >= threshold`. `bps`는 `MAX_DISCOUNT_BPS` 상한, zero address면 비활성 및 임계치·율 0으로 초기화.

</details>

---

## The unified discount engine

All three sources resolve through one internal function. The pattern is "largest wins," never a sum:

```solidity
function _effectiveDiscountBps(address user) internal view returns (uint256) {
  uint256 best = 0;
  // ERC-20 holder discount
  if (token configured && balanceOf(user) >= requiredHoldAmount)
      best = max(best, discountBps);
  // SBT discount
  if (sbt configured && sbt.balanceOf(user) > 0)
      best = max(best, sbtDiscountBps);
  // staking discount
  if (staking configured && staking.stakedOf(user) >= threshold)
      best = max(best, stakeDiscountBps);
  return best;
}
```

Two read helpers expose this to UIs:

```solidity
function isDiscountEligible(address user) external view returns (bool);
function effectiveDiscountBps(address user) external view returns (uint256);
```

**Why non-stacking matters:** each source is independently capped at 50% in its setter. Taking the max (not the sum) means the combined discount is also ≤ 50% by construction — there is no configuration of the three sources that can drive a price below half, let alone negative. The test suite asserts this explicitly (token 10% + SBT 20% + stake 30% → effective 30%, not 60%).

<details><summary>▶ 한국어로 보기</summary>

세 할인원은 하나의 내부 함수로 해석됩니다. 패턴은 합이 아니라 "최대값 적용".

UI용 조회 헬퍼 둘: `isDiscountEligible`, `effectiveDiscountBps`.

**비중첩이 중요한 이유:** 각 할인원은 setter에서 독립적으로 50% 상한. 합이 아닌 max를 취하므로 결합 할인도 구조적으로 ≤ 50% — 세 할인원의 어떤 조합으로도 가격을 절반 아래로, 하물며 음수로 만들 수 없음. 테스트가 이를 명시적으로 검증(토큰 10% + SBT 20% + 스테이크 30% → 유효 30%, 60% 아님).

</details>

---

## Test coverage

```
DXRegistrarController — emergency pause      5 passing
DXResolver — localized profile (B2)          5 passing
SBT-gated discount (A1)                      6 passing
Staking discount (A2)                        6 passing
```

Total suite: **104 passing, 0 failing.**

<details><summary>▶ 한국어로 보기</summary>

긴급 정지 5 / 현지화 프로필 5 / SBT 할인 6 / 스테이킹 할인 6. 전체 **104 통과, 0 실패.**

</details>

---

## Configuration checklist (post-deploy)

These features ship disabled or owner-controlled; configure them after deployment:

1. **Transfer ownership to a multisig** — pause, withdrawals, and all discount setters are `onlyOwner`. A single EOA owner is a single point of failure.
2. **Discounts default off** — call `setSBTDiscount` / `setStakeDiscount` (and the existing `setDiscountToken`) to enable each source. Each is independently capped at 50%.
3. **Pause is a break-glass tool** — leave it unpaused in normal operation; use only for incident response.

<details><summary>▶ 한국어로 보기</summary>

이 기능들은 비활성 또는 owner 제어 상태로 출시됨. 배포 후 설정:

1. **owner를 멀티시그로 이전** — pause·출금·모든 할인 setter가 `onlyOwner`. 단일 EOA owner는 단일 실패점.
2. **할인은 기본 비활성** — `setSBTDiscount`/`setStakeDiscount`(및 기존 `setDiscountToken`)로 각 할인원 활성화. 각각 50% 상한.
3. **pause는 비상용** — 평상시 비정지 유지, 사고 대응 시에만 사용.

</details>
