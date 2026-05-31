# 03. Test Reference — All 155 Tests

> This document explains in detail what each of the **155 tests** that pass via
> `npm test` verifies. The goal is to understand the system's behavior from the
> tests and to reproduce/extend them yourself.
>
> Run: `npx hardhat clean && npm test` → expect **155 passing**.

<details><summary>▶ 한국어로 보기</summary>

이 문서는 `npm test`로 통과한 **155개 테스트 각각이 무엇을 검증하는지**를 한글로
상세히 해설합니다. 실행: `npx hardhat clean && npm test` → **155 passing** 기대.

</details>

---

## Test suite overview

| Area | File | Cases |
| --- | --- | --- |
| DXRegistrarController — 등록 흐름 | DXRegistrarController_test.ts | 3 |
| Controller-Pause — 긴급 정지 | Controller-Pause_test.ts | 5 |
| DXNamehash — 이름 해시 | DXNamehash_test.ts | 4 |
| DXReservations — 예약 라벨 | DXReservations_test.ts | 9 |
| Fuzz — 무작위 입력 | Fuzz_test.ts | 3 |
| HolderDiscount — 토큰 보유 할인 | HolderDiscount_test.ts | 11 |
| SBT-Discount — SBT 보유 할인 | SBT-Discount_test.ts | 6 |
| Stake-Discount — 스테이킹 할인 | Stake-Discount_test.ts | 6 |
| HostileERC20 — 적대적 토큰 방어 | HostileERC20_test.ts | 6 |
| Invariants — 시스템 불변식 | Invariants_test.ts | 6 |
| MEV — 선점/파라미터 스왑 방어 | MEV_test.ts | 7 |
| Registrar-Burn — 소각 | Registrar-Burn_test.ts | 7 |
| Registrar-SVG — 온체인 등급 카드 | Registrar-SVG_test.ts | 11 |
| Resolver-Text — 텍스트 레코드 (EIP-634) | Resolver-Text_test.ts | 14 |
| Resolver-Contenthash — 콘텐츠해시 (EIP-1577) | Resolver-Contenthash_test.ts | 9 |
| Resolver-Profile — 로컬라이즈 프로필 | Resolver-Profile_test.ts | 5 |
| Resolver-Agent — 에이전트 식별·결제 | Resolver-Agent_test.ts | 6 |
| Subname-Commerce — 서브네임 판매 | Subname-Commerce_test.ts | 8 |
| Subname-Gating — 서브네임 접근 게이팅 | Subname-Gating_test.ts | 5 |
| Subscription-Renewal — 자동 갱신 | Subscription-Renewal_test.ts | 6 |
| Subscription-USDT — USDT 자동 갱신 | Subscription-USDT_test.ts | 2 |
| SubdomainManager — 서브도메인 | SubdomainManager_test.ts | 3 |
| Transfer-Invalidation — 전송 무효화 (v2) ★ | Transfer-Invalidation.test.ts | 7 |
| Transfer-Edge — 엣지 케이스 하드닝 (v2) ★ | Transfer-Edge.test.ts | 6 |
| **Total** | | **155** |

<details><summary>▶ 한국어로 보기</summary>

총 22개 그룹, 155개 케이스. 전송 안전성(v2) 신규 13개 포함(Transfer-Invalidation 7 + Transfer-Edge 6).

</details>

---

## 1. DXRegistrarController — 등록 흐름

`DXRegistrarController_test.ts` · 3 cases

> Verifies the core registration path (commit-reveal, payment, refund).

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `registers a name end-to-end with native payment` | Full flow commit→wait→register(POL) succeeds. Confirms NFT issuance, registry ownership, and auto-set initial address. This is the exact test that briefly failed during v2 due to the controller-delivery invalidation bug and was fixed with !controllers[from]. |
| 2 | `rejects reveal that is too early` | Reveal before minCommitmentAge reverts. Enforces the lower bound of the front-running defense window. |
| 3 | `refunds overpayment in native currency` | POL sent above the price is refunded. You can send a buffer for price movement and the excess is returned. |

<details><summary>▶ 한국어로 보기</summary>

등록의 핵심 경로(commit-reveal·결제·환불)를 검증한다.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `registers a name end-to-end with native payment` | commit→대기→register(POL)의 전 과정 성공. NFT 발행·레지스트리 소유권·초기 주소 자동설정까지 확인. v2 작업 중 controller 배달 무효화 버그로 잠시 실패했다가 !controllers[from]로 복구된 바로 그 테스트. |
| 2 | `rejects reveal that is too early` | minCommitmentAge 경과 전 reveal은 revert. 선점 방어 윈도우의 하한 강제. |
| 3 | `refunds overpayment in native currency` | 가격보다 많이 보낸 POL이 환불됨. 가격 변동 버퍼를 보내도 초과분 반환. |

</details>

---

## 2. Controller-Pause — 긴급 정지

`Controller-Pause_test.ts` · 5 cases

> Operational safeguard. Registration must be stoppable in an emergency.

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `register reverts while paused (native)` | Registration is blocked while paused. |
| 2 | `commit() still works while paused` | Commits still work while paused — so users don't lose a commit they prepared in advance. |
| 3 | `register succeeds again after unpause()` | Normal operation resumes after unpause. |
| 4 | `non-owner cannot pause` | Only the owner can pause. |
| 5 | `non-owner cannot unpause` | Only the owner can unpause. Pause is a powerful right, so it is owner-restricted. |

<details><summary>▶ 한국어로 보기</summary>

운영 안전장치. 긴급 시 등록을 멈출 수 있어야 한다.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `register reverts while paused (native)` | 정지 중 등록 차단. |
| 2 | `commit() still works while paused` | 정지 중에도 커밋은 가능 — 사용자가 미리 커밋해둔 것을 잃지 않도록. |
| 3 | `register succeeds again after unpause()` | 정지 해제 후 정상화. |
| 4 | `non-owner cannot pause` | 오너만 정지 가능. |
| 5 | `non-owner cannot unpause` | 오너만 해제 가능. pause는 강력한 권한이라 오너 제한. |

</details>

---

## 3. DXNamehash — 이름 해시

`DXNamehash_test.ts` · 4 cases

> That name→node conversion exactly matches the standard (viem reference).

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `matches viem reference for the empty name` | Empty name (root) = 0. |
| 2 | `matches viem for single-label names` | Single-label hash matches. |
| 3 | `matches viem for multi-label names` | Multi-label (a.b.dex) matches. |
| 4 | `rejects empty labels (trailing dot, double dot)` | Rejects empty labels (trailing/double dots). On-chain↔off-chain namehash agreement is the foundation of system integrity. |

<details><summary>▶ 한국어로 보기</summary>

이름→노드 변환이 표준(viem 레퍼런스)과 정확히 일치하는지.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `matches viem reference for the empty name` | 빈 이름(루트) = 0. |
| 2 | `matches viem for single-label names` | 단일 라벨 해시 일치. |
| 3 | `matches viem for multi-label names` | 다중 라벨(a.b.dex) 일치. |
| 4 | `rejects empty labels (trailing dot, double dot)` | 빈 라벨(연속 점·끝 점) 거부. 온체인↔오프체인 namehash 일치가 시스템 정합성의 기초. |

</details>

---

## 4. DXReservations — 예약 라벨

`DXReservations_test.ts` · 9 cases

> Reserve a label so only a specific address can register it (brand protection).

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `starts with no reservations` | Initially no reservations. |
| 2 | `owner can reserve a single label` | Owner can make a single reservation. |
| 3 | `non-owner cannot reserve` | Non-owner cannot reserve. |
| 4 | `bulk reservation works` | Bulk reservation works. |
| 5 | `rejects duplicate reservation` | Rejects duplicate reservation. |
| 6 | `owner can release` | Owner can release. |
| 7 | `authorised releaser can release` | An authorized releaser can release. |
| 8 | `non-authorised cannot release` | An unauthorized account cannot release. |
| 9 | `isClaimableBy returns true only for the recorded claimant` | Only the recorded claimant can claim. |

<details><summary>▶ 한국어로 보기</summary>

특정 라벨을 특정 주소만 등록하도록 예약(브랜드 보호).

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `starts with no reservations` | 초기 상태 무예약. |
| 2 | `owner can reserve a single label` | 오너 단일 예약. |
| 3 | `non-owner cannot reserve` | 비오너 예약 차단. |
| 4 | `bulk reservation works` | 일괄 예약. |
| 5 | `rejects duplicate reservation` | 중복 예약 거부. |
| 6 | `owner can release` | 오너 해제. |
| 7 | `authorised releaser can release` | 인가된 해제자 해제. |
| 8 | `non-authorised cannot release` | 무권한 해제 차단. |
| 9 | `isClaimableBy returns true only for the recorded claimant` | 기록된 청구자만 청구 가능. |

</details>

---

## 5. Fuzz — 무작위 입력

`Fuzz_test.ts` · 3 cases

> Robustness against varied input.

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `100 random valid labels all register successfully` | 100 random valid labels all register successfully. |
| 2 | `invalid labels all reject` | All invalid labels are rejected. |
| 3 | `discounted price calculation is monotonic in bps` | Price is monotonically decreasing in discount bps (no inversion). |

<details><summary>▶ 한국어로 보기</summary>

다양한 입력에 대한 견고성.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `100 random valid labels all register successfully` | 무작위 유효 라벨 100개 모두 등록 성공. |
| 2 | `invalid labels all reject` | 무효 라벨 모두 거부. |
| 3 | `discounted price calculation is monotonic in bps` | 할인율↑ → 가격 단조 감소(역전 없음). |

</details>

---

## 6. HolderDiscount — 토큰 보유 할인

`HolderDiscount_test.ts` · 11 cases

> Discount for users holding a certain amount of an ERC-20 token.

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `by default returns the same price for everyone` | By default there is no discount. |
| 2 | `owner can configure the discount` | Owner can configure the discount. |
| 3 | `non-owner cannot configure` | Non-owner cannot configure. |
| 4 | `rejects discount > MAX_DISCOUNT_BPS (50%)` | Rejects a discount above 50%. |
| 5 | `rejects requiredHoldAmount = 0 when enabling` | Rejects requiredHoldAmount = 0 when enabling. |
| 6 | `allows requiredHoldAmount = 0 when disabling` | Allows 0 when disabling (zero address). |
| 7 | `user above threshold gets the discount` | Holders above the threshold get the discount. |
| 8 | `user just below threshold pays full price` | Below the threshold pays full price. |
| 9 | `owner can switch discount to a different token` | Owner can switch the discount token. |
| 10 | `discount applies end-to-end in native register()` | Discount is reflected in actual registration. |
| 11 | `non-holder must pay full price in register()` | Non-holders pay full price. |

<details><summary>▶ 한국어로 보기</summary>

ERC-20 토큰을 일정량 보유한 사용자에게 할인.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `by default returns the same price for everyone` | 기본은 할인 없음. |
| 2 | `owner can configure the discount` | 오너가 할인 설정. |
| 3 | `non-owner cannot configure` | 비오너 설정 차단. |
| 4 | `rejects discount > MAX_DISCOUNT_BPS (50%)` | 50% 초과 할인 거부. |
| 5 | `rejects requiredHoldAmount = 0 when enabling` | 활성화 시 보유 기준 0 거부. |
| 6 | `allows requiredHoldAmount = 0 when disabling` | 비활성화(zero address) 시 0 허용. |
| 7 | `user above threshold gets the discount` | 기준 이상 보유자 할인 적용. |
| 8 | `user just below threshold pays full price` | 기준 미달은 정가. |
| 9 | `owner can switch discount to a different token` | 할인 토큰 교체. |
| 10 | `discount applies end-to-end in native register()` | 실제 등록에서 할인 반영. |
| 11 | `non-holder must pay full price in register()` | 비보유자 정가. |

</details>

---

## 7. SBT-Discount — SBT 보유 할인

`SBT-Discount_test.ts` · 6 cases

> Discount for holders of a contributor badge (Soulbound Token).

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `non-owner cannot configure the SBT discount` | Permission. |
| 2 | `rejects SBT discount above MAX_DISCOUNT_BPS` | Cap at 50%. |
| 3 | `SBT holder is discount-eligible; non-holder is not` | Eligibility judgment. |
| 4 | `SBT holder pays a discounted quote` | Discounted quote. |
| 5 | `token and SBT discounts do not stack (larger wins)` | Does not stack (max value). |
| 6 | `disabling the SBT discount (zero address) zeroes the rate` | Disabling. |

<details><summary>▶ 한국어로 보기</summary>

기여자 배지(Soulbound Token) 보유자 할인.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `non-owner cannot configure the SBT discount` | 권한. |
| 2 | `rejects SBT discount above MAX_DISCOUNT_BPS` | 상한 50%. |
| 3 | `SBT holder is discount-eligible; non-holder is not` | 자격 판정. |
| 4 | `SBT holder pays a discounted quote` | 할인 견적. |
| 5 | `token and SBT discounts do not stack (larger wins)` | 중첩 안 함(최대값). |
| 6 | `disabling the SBT discount (zero address) zeroes the rate` | 비활성화. |

</details>

---

## 8. Stake-Discount — 스테이킹 할인

`Stake-Discount_test.ts` · 6 cases

> Discount for users who have staked a certain amount.

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `non-owner cannot configure the staking discount` | Permission. |
| 2 | `rejects staking discount above MAX_DISCOUNT_BPS` | Cap. |
| 3 | `staker above threshold is eligible; below is not` | Eligibility. |
| 4 | `staker pays a discounted quote` | Discounted quote. |
| 5 | `token / SBT / stake discounts do not stack (largest wins)` | Three discounts do not stack, max value. |
| 6 | `disabling the staking discount (zero address) zeroes the rate` | Disabling. |

<details><summary>▶ 한국어로 보기</summary>

일정량 스테이킹한 사용자 할인.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `non-owner cannot configure the staking discount` | 권한. |
| 2 | `rejects staking discount above MAX_DISCOUNT_BPS` | 상한. |
| 3 | `staker above threshold is eligible; below is not` | 자격. |
| 4 | `staker pays a discounted quote` | 할인 견적. |
| 5 | `token / SBT / stake discounts do not stack (largest wins)` | 3종 비중첩, 최대값. |
| 6 | `disabling the staking discount (zero address) zeroes the rate` | 비활성화. |

</details>

---

## 9. HostileERC20 — 적대적 토큰 방어

`HostileERC20_test.ts` · 6 cases

> Defense of the payment path against malicious/non-standard ERC-20 tokens.

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `false-return token: register reverts before any value transfers` | Token whose transfer returns false → reverts before any value moves. |
| 2 | `no-return token: transfer succeeds and balances update correctly` | No-return non-standard token: handled correctly via SafeERC20. |
| 3 | `fee-on-transfer token: recipient receives less than declared` | Fee-on-transfer token: recognizes the recipient gets less than declared. |
| 4 | `lying-balance token in discount slot: every wallet eligible` | A balance-lying token in the discount slot makes every wallet eligible → documented as an operational risk (not a code bug). |
| 5 | `honest discount token: only threshold-meeting wallets eligible` | An honest token only qualifies threshold-meeting wallets. |
| 6 | `reentrant token mock: armReentry stores callback configuration` | A reentrancy-attempting token's callback config is stored (reentrancy-defense context). |

<details><summary>▶ 한국어로 보기</summary>

악의적/비표준 ERC-20 토큰에 대한 결제 경로 방어.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `false-return token: register reverts before any value transfers` | transfer가 false 반환 → 가치 이동 전 revert. |
| 2 | `no-return token: transfer succeeds and balances update correctly` | 반환값 없는 비표준 토큰: SafeERC20로 정상 처리. |
| 3 | `fee-on-transfer token: recipient receives less than declared` | 전송 수수료 토큰: 수령액이 선언보다 적음을 인지. |
| 4 | `lying-balance token in discount slot: every wallet eligible` | 잔액 속이는 토큰을 할인 슬롯에 넣으면 모두 자격 → 운영 리스크로 문서화(코드 버그 아님). |
| 5 | `honest discount token: only threshold-meeting wallets eligible` | 정직한 토큰은 기준 충족자만. |
| 6 | `reentrant token mock: armReentry stores callback configuration` | 재진입 시도 토큰의 콜백 설정 저장(재진입 방어 맥락). |

</details>

---

## 10. Invariants — 시스템 불변식

`Invariants_test.ts` · 6 cases

> System-wide properties that must always hold.

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `NFT owner equals registry owner for every registered name` | ★ Core invariant: NFT owner = registry owner. The v2 _update hook maintains it automatically on transfer. |
| 2 | `native balance == sum collected - sum withdrawn` | Contract balance = collected − withdrawn (accounting integrity). |
| 3 | `expiry is in the future for newly registered names` | Expiry of newly registered names is in the future. |
| 4 | `discounted price never exceeds base price` | Discounted price ≤ base price. |
| 5 | `setter rejects all discountBps above MAX_DISCOUNT_BPS` | Every discount setter enforces the cap. |
| 6 | `re-registering an active name reverts` | Re-registering an active name reverts. |

<details><summary>▶ 한국어로 보기</summary>

항상 성립해야 하는 시스템 전역 속성.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `NFT owner equals registry owner for every registered name` | ★핵심 불변식: NFT 소유자 = 레지스트리 소유자. v2 _update 훅이 전송 시 자동 유지. |
| 2 | `native balance == sum collected - sum withdrawn` | 컨트랙트 잔액 = 수금 − 인출(회계 정합성). |
| 3 | `expiry is in the future for newly registered names` | 신규 등록의 만료는 미래. |
| 4 | `discounted price never exceeds base price` | 할인가 ≤ 정가. |
| 5 | `setter rejects all discountBps above MAX_DISCOUNT_BPS` | 모든 할인 setter가 상한 강제. |
| 6 | `re-registering an active name reverts` | 활성 이름 재등록 거부. |

</details>

---

## 11. MEV — 선점/파라미터 스왑 방어

`MEV_test.ts` · 7 cases

> The core of commit-reveal: block parameter swapping at reveal.

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `attacker cannot swap resolver in reveal` | Resolver cannot be swapped. |
| 2 | `attacker cannot swap duration in reveal` | Duration cannot be swapped. |
| 3 | `attacker cannot swap owner in reveal` | Owner cannot be swapped. |
| 4 | `attacker cannot swap paymentToken in reveal` | Payment token cannot be swapped. |
| 5 | `legacy 3-arg commitment is rejected at reveal` | Legacy 3-arg commitment is rejected (now 6-arg). |
| 6 | `reveal before minCommitmentAge rejects` | Reveal too early is rejected. |
| 7 | `first reveal wins; second reveal of same label reverts` | First reveal wins; second reverts. The commitment binds all parameters, blocking front-running and tampering. |

<details><summary>▶ 한국어로 보기</summary>

commit-reveal의 핵심: reveal 시 파라미터 바꿔치기 차단.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `attacker cannot swap resolver in reveal` | 리졸버 바꿔치기 불가. |
| 2 | `attacker cannot swap duration in reveal` | 기간 바꿔치기 불가. |
| 3 | `attacker cannot swap owner in reveal` | 소유자 바꿔치기 불가. |
| 4 | `attacker cannot swap paymentToken in reveal` | 결제토큰 바꿔치기 불가. |
| 5 | `legacy 3-arg commitment is rejected at reveal` | 구형 3-인자 commitment 거부(현재 6-인자). |
| 6 | `reveal before minCommitmentAge rejects` | 너무 이른 reveal 거부. |
| 7 | `first reveal wins; second reveal of same label reverts` | 먼저 reveal한 쪽 승리, 두 번째 revert. commitment가 모든 파라미터를 묶어 선점·조작 차단. |

</details>

---

## 12. Registrar-Burn — 소각

`Registrar-Burn_test.ts` · 7 cases

> Permanent burn of names past expiry+grace (permissionless cleanup).

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `reverts burn() while name is still active` | Cannot burn an active name. |
| 2 | `reverts burn() during grace period (expired but renewable)` | Cannot burn during the grace period. |
| 3 | `allows burn() after expiry + GRACE_PERIOD` | Can burn after expiry+grace. |
| 4 | `allows any third party to burn after grace` | Anyone can burn (permissionless cleanup). |
| 5 | `clears both expiries and names mappings on burn` | Burn clears the expiries·names mappings. |
| 6 | `emits NameBurned during re-registration of an expired name` | NameBurned event on re-registration of an expired name. |
| 7 | `reverts when burning a token that was never minted` | Burning a never-minted token reverts. |

<details><summary>▶ 한국어로 보기</summary>

만료+유예 경과 이름의 영구 소각(permissionless 정리).

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `reverts burn() while name is still active` | 활성 이름 소각 불가. |
| 2 | `reverts burn() during grace period (expired but renewable)` | 유예 기간 중 소각 불가. |
| 3 | `allows burn() after expiry + GRACE_PERIOD` | 만료+유예 경과 후 소각 가능. |
| 4 | `allows any third party to burn after grace` | 누구나 소각 가능(permissionless 정리). |
| 5 | `clears both expiries and names mappings on burn` | 소각 시 expiries·names 매핑 정리. |
| 6 | `emits NameBurned during re-registration of an expired name` | 만료 이름 재등록 시 NameBurned 이벤트. |
| 7 | `reverts when burning a token that was never minted` | 미발행 토큰 소각 시 revert. |

</details>

---

## 13. Registrar-SVG — 온체인 등급 카드

`Registrar-SVG_test.ts` · 11 cases

> The NFT's dynamic SVG and tier rules.

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `1-year purchase → charcoal` | 1 year = charcoal. |
| 2 | `3-year purchase → mud` | 3 years = mud. |
| 3 | `5-year purchase → burnt orange` | 5 years = orange. |
| 4 | `10-year purchase → yellow` | 10 years = yellow. |
| 5 | `15-year purchase → gold` | 15 years = gold. |
| 6 | `tier ratchets UP on renewal: 3y then +3y → mud climbs to yellow` | Tier ratchets up with accumulated renewal. |
| 7 | `tier does NOT ratchet down as time passes (gold stays gold)` | Tier does not ratchet down over time (all-time highest kept). |
| 8 | `expired name shows red regardless of tier` | Red when expired, regardless of tier. |
| 9 | `includes the tier name and full domain in the JSON (gold)` | tokenURI JSON includes tier name and full domain. |
| 10 | `shows the full label in the SVG, even a 50-char name` | Even a long (50-char) label is shown in the SVG. |
| 11 | `renders a hexagon (polygon), not a rectangle card` | Renders a hexagon. |

<details><summary>▶ 한국어로 보기</summary>

NFT의 동적 SVG와 등급(tier) 규칙.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `1-year purchase → charcoal` | 1년 = charcoal. |
| 2 | `3-year purchase → mud` | 3년 = mud. |
| 3 | `5-year purchase → burnt orange` | 5년 = orange. |
| 4 | `10-year purchase → yellow` | 10년 = yellow. |
| 5 | `15-year purchase → gold` | 15년 = gold. |
| 6 | `tier ratchets UP on renewal: 3y then +3y → mud climbs to yellow` | 갱신 누적으로 등급 상향. |
| 7 | `tier does NOT ratchet down as time passes (gold stays gold)` | 시간 경과로 하향 안 됨(역대 최고 유지). |
| 8 | `expired name shows red regardless of tier` | 만료 시 등급 무관 빨강. |
| 9 | `includes the tier name and full domain in the JSON (gold)` | tokenURI JSON에 등급명·전체 도메인 포함. |
| 10 | `shows the full label in the SVG, even a 50-char name` | 긴 라벨(50자)도 SVG 표시. |
| 11 | `renders a hexagon (polygon), not a rectangle card` | 육각형 렌더링. |

</details>

---

## 14. Resolver-Text — 텍스트 레코드 (EIP-634)

`Resolver-Text_test.ts` · 14 cases

> The group with the most cases. In v2 it operates over [node][version][key].

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `returns empty string for an unset key` | Unset key returns empty string. |
| 2 | `stores and reads a text record` | Store and read. |
| 3 | `stores multiple distinct keys for the same node` | Multiple keys per node. |
| 4 | `isolates records across different nodes` | Isolation across nodes. |
| 5 | `overwrites an existing value` | Overwrite. |
| 6 | `empty value deletes the record` | Empty value deletes. |
| 7 | `non-owner cannot setText` | Non-owner cannot setText. |
| 8 | `approved operator can setText` | Approved operator can setText. |
| 9 | `rejects key over MAX_TEXT_KEY_LENGTH (64 bytes)` | Key length cap. |
| 10 | `accepts key at exactly MAX_TEXT_KEY_LENGTH` | Key boundary value allowed. |
| 11 | `rejects value over MAX_TEXT_VALUE_LENGTH (1024 bytes)` | Value length cap. |
| 12 | `accepts value at exactly MAX_TEXT_VALUE_LENGTH` | Value boundary value allowed. |
| 13 | `returns empty string after the node expires` | Empty after expiry (a version bump on transfer has the same effect). |
| 14 | `reports support for EIP-634 (text) via ERC-165` | Declares interface support. |

<details><summary>▶ 한국어로 보기</summary>

케이스가 가장 많은 그룹. v2에서 [node][version][key] 위에서 동작.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `returns empty string for an unset key` | 미설정 키는 빈 문자열. |
| 2 | `stores and reads a text record` | 저장·조회. |
| 3 | `stores multiple distinct keys for the same node` | 한 노드에 여러 키. |
| 4 | `isolates records across different nodes` | 노드 간 격리. |
| 5 | `overwrites an existing value` | 덮어쓰기. |
| 6 | `empty value deletes the record` | 빈 값으로 삭제. |
| 7 | `non-owner cannot setText` | 비소유자 쓰기 불가. |
| 8 | `approved operator can setText` | 승인된 operator 쓰기 가능. |
| 9 | `rejects key over MAX_TEXT_KEY_LENGTH (64 bytes)` | 키 길이 상한. |
| 10 | `accepts key at exactly MAX_TEXT_KEY_LENGTH` | 키 경계값 허용. |
| 11 | `rejects value over MAX_TEXT_VALUE_LENGTH (1024 bytes)` | 값 길이 상한. |
| 12 | `accepts value at exactly MAX_TEXT_VALUE_LENGTH` | 값 경계값 허용. |
| 13 | `returns empty string after the node expires` | 만료 후 빈 값(전송 시 버전 증가도 동일 효과). |
| 14 | `reports support for EIP-634 (text) via ERC-165` | 인터페이스 지원 선언. |

</details>

---

## 15. Resolver-Contenthash — 콘텐츠해시 (EIP-1577)

`Resolver-Contenthash_test.ts` · 9 cases

> Distributed content pointers such as IPFS/IPNS.

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `returns empty bytes for an unset contenthash` | Unset is empty bytes. |
| 2 | `stores and reads an IPFS contenthash` | Store and read IPFS. |
| 3 | `overwrites an existing contenthash (IPFS → IPNS)` | Overwrite. |
| 4 | `empty bytes deletes the contenthash` | Empty value deletes. |
| 5 | `non-owner cannot setContenthash` | Permission. |
| 6 | `rejects contenthash over MAX_CONTENTHASH_LENGTH (128 bytes)` | Length cap. |
| 7 | `accepts contenthash at exactly MAX_CONTENTHASH_LENGTH` | Boundary value allowed. |
| 8 | `returns empty bytes after the node expires` | Empty after expiry. |
| 9 | `reports support for EIP-1577 (contenthash) via ERC-165` | Standard compliance. |

<details><summary>▶ 한국어로 보기</summary>

IPFS/IPNS 등 분산 콘텐츠 포인터.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `returns empty bytes for an unset contenthash` | 미설정은 빈 bytes. |
| 2 | `stores and reads an IPFS contenthash` | IPFS 저장·조회. |
| 3 | `overwrites an existing contenthash (IPFS → IPNS)` | 덮어쓰기. |
| 4 | `empty bytes deletes the contenthash` | 빈 값 삭제. |
| 5 | `non-owner cannot setContenthash` | 권한. |
| 6 | `rejects contenthash over MAX_CONTENTHASH_LENGTH (128 bytes)` | 길이 상한. |
| 7 | `accepts contenthash at exactly MAX_CONTENTHASH_LENGTH` | 경계값 허용. |
| 8 | `returns empty bytes after the node expires` | 만료 후 빈 값. |
| 9 | `reports support for EIP-1577 (contenthash) via ERC-165` | 표준 준수. |

</details>

---

## 16. Resolver-Profile — 로컬라이즈 프로필

`Resolver-Profile_test.ts` · 5 cases

> Name/bio/avatar/URL per language.

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `stores and reads a full profile in one call (Korean)` | Store the full profile in one call (Korean). |
| 2 | `falls back to English per field when a language is missing` | Per-field English fallback when a language is missing. |
| 3 | `reverts setProfile for an unsupported language` | Rejects unsupported language. |
| 4 | `non-owner cannot setProfile` | Permission. |
| 5 | `returns empty profile after the node expires` | Empty profile after expiry. |

<details><summary>▶ 한국어로 보기</summary>

이름/소개/아바타/URL을 언어별로.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `stores and reads a full profile in one call (Korean)` | 한 번에 전체 프로필 저장(한국어). |
| 2 | `falls back to English per field when a language is missing` | 언어 누락 시 필드별 영어 폴백. |
| 3 | `reverts setProfile for an unsupported language` | 미지원 언어 거부. |
| 4 | `non-owner cannot setProfile` | 권한. |
| 5 | `returns empty profile after the node expires` | 만료 후 빈 프로필. |

</details>

---

## 17. Resolver-Agent — 에이전트 식별·결제

`Resolver-Agent_test.ts` · 6 cases

> Record AI agent information and payment path on a name.

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `sets and reads the full agent record` | Store and read the full agent record. |
| 2 | `agentPayment returns just the routing pair` | Read only the payment-routing pair. |
| 3 | `hasAgent reflects whether a record is set` | Reflects whether a record is set. |
| 4 | `non-owner cannot setAgent` | Permission. |
| 5 | `clearAgent removes the record` | Delete. |
| 6 | `returns empty/zero after the node expires` | Empty after expiry. |

<details><summary>▶ 한국어로 보기</summary>

AI 에이전트 정보와 결제 경로를 이름에 기록.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `sets and reads the full agent record` | 전체 에이전트 레코드 저장·조회. |
| 2 | `agentPayment returns just the routing pair` | 결제 라우팅 쌍만 조회. |
| 3 | `hasAgent reflects whether a record is set` | 설정 여부 반영. |
| 4 | `non-owner cannot setAgent` | 권한. |
| 5 | `clearAgent removes the record` | 삭제. |
| 6 | `returns empty/zero after the node expires` | 만료 후 빈 값. |

</details>

---

## 18. Subname-Commerce — 서브네임 판매

`Subname-Commerce_test.ts` · 8 cases

> A parent owner sells child names.

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `constructor rejects a protocol fee above MAX_FEE_BPS` | Fee cap. |
| 2 | `only the parent owner can configure subname commerce` | Only the parent can configure. |
| 3 | `reverts a purchase when sales are disabled` | Cannot buy when sales disabled. |
| 4 | `reverts a purchase when the module is not delegated` | Cannot buy when not delegated. |
| 5 | `reverts on incorrect payment` | Rejects incorrect payment. |
| 6 | `isPurchasable reflects the full precondition set` | Aggregate purchasable preconditions. |
| 7 | `buys a subname end-to-end and registers it to the buyer` | Buy then register to the buyer. |
| 8 | `splits revenue between fee recipient and parent owner` | Revenue split (fee + parent). |

<details><summary>▶ 한국어로 보기</summary>

부모 소유자가 하위 이름을 판매.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `constructor rejects a protocol fee above MAX_FEE_BPS` | 수수료 상한. |
| 2 | `only the parent owner can configure subname commerce` | 부모만 설정. |
| 3 | `reverts a purchase when sales are disabled` | 판매 비활성 시 불가. |
| 4 | `reverts a purchase when the module is not delegated` | 위임 안 됐으면 불가. |
| 5 | `reverts on incorrect payment` | 잘못된 결제액 거부. |
| 6 | `isPurchasable reflects the full precondition set` | 구매 가능 조건 종합. |
| 7 | `buys a subname end-to-end and registers it to the buyer` | 구매 후 구매자에 등록. |
| 8 | `splits revenue between fee recipient and parent owner` | 수익 분배(수수료+부모). |

</details>

---

## 19. Subname-Gating — 서브네임 접근 게이팅

`Subname-Gating_test.ts` · 5 cases

> Restrict subname purchase to token/SBT holders.

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `only the parent owner can set the gate` | Only the parent can set the gate. |
| 2 | `ERC-20 gate: holder can buy, non-holder reverts` | ERC-20 gate. |
| 3 | `SBT gate: badge holder can buy, non-holder reverts` | SBT gate. |
| 4 | `clearing the gate (zero address) re-opens to everyone` | Clearing the gate re-opens to everyone. |
| 5 | `meetsGate view reflects eligibility` | Eligibility query. |

<details><summary>▶ 한국어로 보기</summary>

서브네임 구매를 토큰/SBT 보유자로 제한.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `only the parent owner can set the gate` | 부모만 게이트 설정. |
| 2 | `ERC-20 gate: holder can buy, non-holder reverts` | ERC-20 게이트. |
| 3 | `SBT gate: badge holder can buy, non-holder reverts` | SBT 게이트. |
| 4 | `clearing the gate (zero address) re-opens to everyone` | 게이트 해제 시 전체 개방. |
| 5 | `meetsGate view reflects eligibility` | 자격 조회. |

</details>

---

## 20. Subscription-Renewal — 자동 갱신

`Subscription-Renewal_test.ts` · 6 cases

> Subscription-based auto-renewal.

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `only the subscriber can unsubscribe` | Only the subscriber can unsubscribe. |
| 2 | `executeRenewal reverts when called too early` | Renewal too early is rejected. |
| 3 | `isRenewable is false early, true inside the window` | Renewal-window judgment. |
| 4 | `anyone can execute renewal inside the window; expiry extends` | Anyone can execute renewal within the window (keeper/bot); expiry extends. |
| 5 | `reverts when the live price exceeds the owner's cap` | Reverts when live price exceeds the user's cap (spike protection). |
| 6 | `unsubscribe stops future renewals` | No more renewals after unsubscribe. |

<details><summary>▶ 한국어로 보기</summary>

구독 기반 자동 갱신.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `only the subscriber can unsubscribe` | 구독자만 해지. |
| 2 | `executeRenewal reverts when called too early` | 너무 이른 갱신 거부. |
| 3 | `isRenewable is false early, true inside the window` | 갱신 윈도우 판정. |
| 4 | `anyone can execute renewal inside the window; expiry extends` | 윈도우 내 누구나 갱신 실행(키퍼/봇), 만료 연장. |
| 5 | `reverts when the live price exceeds the owner's cap` | 실시간 가격이 사용자 상한 초과 시 거부(급등 보호). |
| 6 | `unsubscribe stops future renewals` | 해지 후 갱신 중단. |

</details>

---

## 21. Subscription-USDT — USDT 자동 갱신

`Subscription-USDT_test.ts` · 2 cases

> Handling USDT's non-standard approve.

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `single USDT auto-renewal succeeds (expiry extends, USDT pulled)` | Single USDT renewal succeeds. |
| 2 | `TWO consecutive USDT renewals succeed (forceApprove handles the quirk)` | Two consecutive USDT renewals succeed. USDT's approve fails when allowance is non-zero → handled via forceApprove (set to 0 first, then set). |

<details><summary>▶ 한국어로 보기</summary>

USDT의 비표준 approve 처리.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `single USDT auto-renewal succeeds (expiry extends, USDT pulled)` | 단일 USDT 갱신 성공. |
| 2 | `TWO consecutive USDT renewals succeed (forceApprove handles the quirk)` | 연속 2회 USDT 갱신 성공. USDT는 allowance가 0이 아니면 approve 실패 → forceApprove(0으로 만든 뒤 설정)로 처리. |

</details>

---

## 22. SubdomainManager — 서브도메인

`SubdomainManager_test.ts` · 3 cases

> Subdomain creation & dynamic pricing.

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `deploys successfully` | Deploys. |
| 2 | `creates a subdomain with valid inputs` | Creates with valid input. |
| 3 | `returns correct dynamic pricing` | Returns dynamic pricing. |

<details><summary>▶ 한국어로 보기</summary>

서브도메인 생성·동적 가격.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `deploys successfully` | 배포. |
| 2 | `creates a subdomain with valid inputs` | 유효 입력으로 생성. |
| 3 | `returns correct dynamic pricing` | 동적 가격 반환. |

</details>

---

## 23. Transfer-Invalidation — 전송 무효화 (v2) ★ ★

`Transfer-Invalidation.test.ts` · 7 cases

> New tests that directly verify the core v2 feature.

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `transfer moves registry control to the new owner` | After alice→bob transfer, registry owner=bob, NFT owner=bob. The _update hook's setSubnodeOwner transfers control automatically. |
| 2 | `transfer invalidates ALL record kinds (addr/text/contenthash/profile/agent)` | Set all 6 kinds before transfer → all empty after. A version bump invalidates every record at once. The most important proof of v2. |
| 3 | `after transfer, old owner cannot set records; new owner can` | After transfer, alice's setAddr is Not authorized, bob's succeeds. Write permission moves to the new owner. |
| 4 | `resolution resumes once the new owner sets a fresh address` | Empty right after transfer → bob setAddr → resolves again. Invalidation is a protection window, not permanent deletion. |
| 5 | `record version increments on transfer (history preserved)` | version++ on each transfer. Old-version records remain on-chain (history). |
| 6 | `registration (controller delivery) does NOT invalidate the auto-set addr` | version 0 after registration delivery, auto-set address kept. The !controllers[from] exception works (regression guard for the STEP 3 bug). |
| 7 | `mint does not bump version (fresh name starts at version 0)` | Newly registered name has version 0. mint (from==0) is not an invalidation target. |

<details><summary>▶ 한국어로 보기</summary>

v2의 핵심 기능을 직접 검증하는 신규 테스트.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `transfer moves registry control to the new owner` | alice→bob 전송 후 registry owner=bob, NFT owner=bob. _update 훅의 setSubnodeOwner가 제어권 자동 이전. |
| 2 | `transfer invalidates ALL record kinds (addr/text/contenthash/profile/agent)` | 전송 전 6종 설정 → 전송 후 전부 빈 값. 버전 증가가 모든 레코드를 한 번에 무효화. v2의 가장 중요한 증명. |
| 3 | `after transfer, old owner cannot set records; new owner can` | 전송 후 alice setAddr는 Not authorized, bob 성공. 쓰기 권한이 새 소유자로 이전. |
| 4 | `resolution resumes once the new owner sets a fresh address` | 전송 직후 빈 값 → bob setAddr → 다시 정상 해석. 무효화는 영구 삭제가 아닌 보호 윈도우. |
| 5 | `record version increments on transfer (history preserved)` | 전송마다 version++. 옛 버전 레코드는 체인에 남음(이력). |
| 6 | `registration (controller delivery) does NOT invalidate the auto-set addr` | 등록 배달 후 version 0, 자동설정 주소 유지. !controllers[from] 예외 작동(STEP 3 버그 회귀 방지). |
| 7 | `mint does not bump version (fresh name starts at version 0)` | 신규 등록 이름의 version은 0. mint(from==0)는 무효화 대상 아님. |

</details>

---

## 24. Transfer-Edge — 엣지 케이스 하드닝 (v2) ★ ★

`Transfer-Edge.test.ts` · 6 cases

> Corner cases of transfer safety.

| # | Test | Meaning |
| --- | --- | --- |
| 1 | `safeTransferFrom also moves control and invalidates records` | Not only transferFrom but safeTransferFrom (a different path) also invalidates. All transfer paths pass through _update. |
| 2 | `a random account cannot call resolver.bumpVersion directly` | An unauthorized direct bumpVersion is rejected with Only registrar. Blocks the griefing attack. |
| 3 | `not even the contract owner can bumpVersion (registrar-gated)` | Not even the contract owner can call bumpVersion. Least privilege. |
| 4 | `operator-initiated transfer (approved) also invalidates` | An approved operator's proxy transfer also invalidates. Marketplace trades are safe too. |
| 5 | `three sequential transfers bump the version each time` | Three sequential transfers → version +3. Exact invalidation even on repeated transfers. |
| 6 | `records set AFTER transfer by the new owner persist` | Records the new owner sets after transfer are preserved. The new-version namespace is clean. |

<details><summary>▶ 한국어로 보기</summary>

전송 안전성의 모서리 케이스.

| # | 테스트 | 의미 |
| --- | --- | --- |
| 1 | `safeTransferFrom also moves control and invalidates records` | transferFrom뿐 아니라 safeTransferFrom(다른 경로)도 무효화. 모든 전송 경로가 _update를 거침. |
| 2 | `a random account cannot call resolver.bumpVersion directly` | 무권한 직접 bumpVersion은 Only registrar로 거부. grief 공격 차단. |
| 3 | `not even the contract owner can bumpVersion (registrar-gated)` | 컨트랙트 owner조차 bumpVersion 불가. 권한 최소화. |
| 4 | `operator-initiated transfer (approved) also invalidates` | 승인된 operator 대리 전송도 무효화. 마켓플레이스 거래도 안전. |
| 5 | `three sequential transfers bump the version each time` | 연속 3회 전송 → version +3. 반복 전송에도 정확히 무효화. |
| 6 | `records set AFTER transfer by the new owner persist` | 전송 후 새 소유자가 설정한 레코드는 보존. 새 버전 네임스페이스는 깨끗. |

</details>

---

## What the tests guarantee

Taken together, the 155 tests guarantee:

- **Correctness**: registration, renewal, burn, resolution, discounts, subnames,
  and subscriptions behave as specified.
- **Permissions**: every write is restricted to the correct owner/owner/operator.
- **Boundaries**: length caps, discount caps, and timing constraints are exact at
  the boundary.
- **Standards**: EIP-137/634/1577/205, ERC-165/721 compliance.
- **Security**: front-running defense (MEV), reentrancy guards, hostile-token
  defense, emergency pause.
- **Invariants**: NFT owner = registry owner, accounting integrity, discounted
  price ≤ base price.
- **Transfer safety (v2)**: automatic control transfer + 6-kind invalidation +
  history preservation, delivery exception, all transfer paths covered, least
  privilege.

<details><summary>▶ 한국어로 보기</summary>

155개 테스트는 종합적으로 보증합니다: **정확성**(명세대로 동작), **권한**(올바른
소유자/operator 제한), **경계**(길이·할인·시점 경계값), **표준**(EIP-137/634/1577/205,
ERC-165/721), **보안**(MEV·재진입·적대적 토큰·긴급 정지), **불변식**(NFT 소유자=레지스트리
소유자, 회계 정합성, 할인가≤정가), **전송 안전성(v2)**(제어권 자동 이전+6종 무효화+이력
보존, 배달 예외, 모든 경로 커버, 권한 최소화).

</details>
