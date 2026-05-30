# Auto-Renewal Subscriptions (`DXSubscriptionRenewer`)

> Let a name owner opt into automatic renewal at purchase time. When the name nears expiry, the subscription pays the renewal fee from the owner's pre-approved stablecoin balance — no manual action needed. A standalone module that touches no core contract; works with both USDC and USDT.

---

## Why a standalone module

Like the subname registrar, this is added by **delegation, not modification.** `DXSubscriptionRenewer` calls the controller and registrar through their public interfaces; the registry, controller, and resolver are untouched. The owner grants the module a token allowance (a standard ERC-20 `approve`), and that allowance is the only authority the module ever has — revocable at any time by setting it back to zero.

<details><summary>▶ 한국어로 보기</summary>

서브네임 레지스트라처럼, 이것도 **수정이 아니라 위임**으로 추가됩니다. `DXSubscriptionRenewer`는 controller·registrar를 공개 인터페이스로 호출하며, registry·controller·resolver는 그대로입니다. 소유자가 모듈에 토큰 allowance(표준 ERC-20 `approve`)를 부여하고, 그 allowance가 모듈이 가진 유일한 권한입니다 — 0으로 되돌리면 언제든 회수.

</details>

---

## How it works

1. **Subscribe** — the owner approves the module to spend their stablecoin (ideally several cycles' worth), then calls `subscribe(label, paymentToken, duration, maxPricePerRenewal)`.
2. **Wait** — nothing happens until the name nears expiry.
3. **Execute** — once inside the renewal window, **anyone** may call `executeRenewal(label)`: a keeper, a backend cron job, or the owner. The module re-checks timing and price, pulls exactly the fee from the owner, and renews through the controller.

The trigger is **permissionless** by design: the contract enforces every condition itself, so a too-early or over-cap call simply reverts. No privileged keeper is required, and no off-chain server is needed for safety — only (optionally) for convenience.

<details><summary>▶ 한국어로 보기</summary>

1. **구독** — 소유자가 모듈에 스테이블코인 사용을 approve(여러 주기분 권장)하고 `subscribe(label, paymentToken, duration, maxPricePerRenewal)` 호출.
2. **대기** — 만료 임박 전까진 아무 일 없음.
3. **실행** — 갱신 윈도우에 들어서면 **누구나** `executeRenewal(label)` 호출 가능: 키퍼·백엔드 크론·소유자. 모듈이 시점·가격을 재검증하고, 소유자에게서 정확히 수수료만 받아 컨트롤러로 갱신.

트리거는 의도적으로 **permissionless**: 컨트랙트가 모든 조건을 스스로 강제하므로 너무 이르거나 상한 초과면 revert. 특권 키퍼 불필요, 안전을 위한 오프체인 서버 불필요(편의용으로만 선택적).

</details>

---

## API

```solidity
// Subscriber (the name owner)
function subscribe(
  string calldata label,
  address paymentToken,        // USDC or USDT (must be allowed on the controller)
  uint256 duration,            // renewal length per cycle (seconds)
  uint256 maxPricePerRenewal   // spend cap per renewal, in token units
) external;

function unsubscribe(string calldata label) external;   // subscriber only

// Permissionless
function executeRenewal(string calldata label) external; // anyone; reverts unless due & within cap

// Views
function isRenewable(string calldata label) external view returns (bool);
function getSubscription(string calldata label) external view
  returns (address subscriber, address paymentToken, uint256 duration,
           uint256 maxPricePerRenewal, bool active);

// Protocol owner
function setRenewalWindow(uint256 window) external;      // 1–90 days
```

<details><summary>▶ 한국어로 보기</summary>

**구독자**: `subscribe`(라벨·결제토큰·주기·상한), `unsubscribe`(구독자만).
**Permissionless**: `executeRenewal`(누구나; 시점·상한 미충족 시 revert).
**조회**: `isRenewable`, `getSubscription`.
**프로토콜 오너**: `setRenewalWindow`(1~90일).

</details>

---

## Stablecoin support — USDC and USDT

The module is token-agnostic: the subscriber passes the payment token address, and the module handles it via the standard ERC-20 interface. Both USDC and USDT work, with one important detail handled for you.

**USDT's non-standard `approve`.** USDT on mainnet reverts if you call `approve(spender, X)` while the current allowance is non-zero and `X` is non-zero — you must reset to zero first. A naive integration would break on the *second* renewal (when a stale allowance lingers). This module uses OpenZeppelin's `SafeERC20.forceApprove`, which resets to zero before setting the new value, so consecutive USDT renewals work correctly. This is covered by a dedicated test that performs two back-to-back USDT renewals.

**Operational requirement.** The chosen token must be allow-listed on the controller (`setAllowedPaymentToken(token, true)`); otherwise the renewal reverts at settlement. Enable both USDC and USDT if you want to offer both.

<details><summary>▶ 한국어로 보기</summary>

모듈은 토큰 비의존적: 구독자가 결제 토큰 주소를 넘기고, 모듈은 표준 ERC-20 인터페이스로 처리. USDC·USDT 모두 동작.

**USDT의 비표준 `approve`**: 메인넷 USDT는 현재 allowance가 0이 아닌데 0이 아닌 값으로 approve하면 revert(먼저 0으로 리셋 필요). 단순 통합은 *두 번째* 갱신에서 깨짐. 이 모듈은 OZ `SafeERC20.forceApprove`(0으로 리셋 후 설정)를 써서 연속 USDT 갱신이 정상 동작. 연속 2회 USDT 갱신 전용 테스트로 검증됨.

**운영 요건**: 선택한 토큰이 컨트롤러에 allow-list 돼야 함(`setAllowedPaymentToken(token, true)`). 아니면 정산 시 revert. 둘 다 제공하려면 USDC·USDT 모두 활성화.

</details>

---

## Safety properties

- **Owner-set spend cap** — `maxPricePerRenewal` bounds each charge. If the live renewal price exceeds it, `executeRenewal` reverts (`PriceExceedsCap`). Protects against price spikes draining the wallet.
- **Renewal window only** — renewal is allowed only within a configured window before expiry (`TooEarlyToRenew` otherwise). No early draining.
- **Exact pull** — the module transfers only the live price from the subscriber, approves the controller for exactly that, and zeroes the allowance afterward.
- **Cancellable** — the subscriber can `unsubscribe` anytime; revoking the ERC-20 allowance disables it at the token level regardless.
- **Standard price** — auto-renewal uses the undiscounted price so the amount pulled equals the amount the controller charges (the module is the payer). SBT/staking discounts remain a benefit of manual renewal — a deliberate, simple separation.
- **Reentrancy-guarded** — `executeRenewal` is `nonReentrant`.

<details><summary>▶ 한국어로 보기</summary>

- **소유자 지정 상한** — `maxPricePerRenewal`이 매 청구를 제한. 현재 가격이 넘으면 revert(`PriceExceedsCap`). 가격 급등 시 지갑 보호.
- **갱신 윈도우 한정** — 만료 전 설정된 윈도우 안에서만 갱신(`TooEarlyToRenew`). 조기 인출 없음.
- **정확한 인출** — 현재 가격만 구독자에게서 받아 컨트롤러에 그만큼만 approve, 이후 allowance 0으로 정리.
- **취소 가능** — 언제든 `unsubscribe`; ERC-20 allowance 회수 시 토큰 레벨에서도 비활성.
- **표준 가격** — 자동 갱신은 할인 없는 가격(모듈이 payer라 인출액=청구액 일치). SBT/스테이킹 할인은 수동 갱신 혜택 — 의도적·단순한 분리.
- **재진입 방지** — `executeRenewal`은 `nonReentrant`.

</details>

---

## Operating the renewals

Because the trigger is permissionless, "who calls `executeRenewal`" is purely an operational choice:

- **Simplest (recommended to start):** a backend cron job that periodically scans active subscriptions, calls `isRenewable(label)`, and submits `executeRenewal(label)` for those that return true. The backend pays only gas; the renewal fee comes from the subscriber's stablecoin. No special privileges — it's the same call anyone could make.
- **Decentralized (later):** a keeper network (e.g. Chainlink Automation) that calls `executeRenewal`. Drop-in, since the function is already permissionless.
- **Self-service:** the owner (or anyone) can manually trigger a due renewal.

A practical note: fund the allowance for several cycles up front (e.g. approve 3× the per-renewal cap), so renewals don't fail for insufficient allowance between top-ups.

<details><summary>▶ 한국어로 보기</summary>

트리거가 permissionless라 "누가 `executeRenewal`을 부르냐"는 순전히 운영 선택:

- **가장 단순(시작 권장)**: 백엔드 크론이 활성 구독을 주기적으로 스캔, `isRenewable` 확인 후 true인 것에 `executeRenewal` 제출. 백엔드는 가스만 부담, 갱신비는 구독자 스테이블코인에서. 특권 없음 — 누구나 할 수 있는 동일 호출.
- **탈중앙화(나중)**: 키퍼 네트워크(예: Chainlink Automation)가 호출. 함수가 이미 permissionless라 그대로 적용.
- **셀프서비스**: 소유자(또는 누구나) 만료 임박 갱신을 수동 트리거.

실무 팁: allowance를 여러 주기분 미리 충전(예: 주기 상한의 3배 approve)해 충전 사이 갱신 실패 방지.

</details>

---

## Tests

```
DXSubscriptionRenewer — auto-renewal                       6 passing
  ✔ only the subscriber can unsubscribe
  ✔ executeRenewal reverts when called too early
  ✔ isRenewable is false early, true inside the window
  ✔ anyone can execute renewal inside the window; expiry extends
  ✔ reverts when the live price exceeds the owner's cap
  ✔ unsubscribe stops future renewals

DXSubscriptionRenewer — USDT (non-standard approve)        2 passing
  ✔ single USDT auto-renewal succeeds (expiry extends, USDT pulled)
  ✔ TWO consecutive USDT renewals succeed (forceApprove handles the quirk)
```

Exercised against the real controller + registrar. Total suite: **131 passing.**

<details><summary>▶ 한국어로 보기</summary>

자동 갱신 6개 + USDT 2개. 실제 controller+registrar 대상 검증. 전체 **131 통과.**

</details>
