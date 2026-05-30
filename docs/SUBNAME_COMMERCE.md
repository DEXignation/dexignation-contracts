# Subname Commerce (`DXSubnameRegistrar`)

> A standalone module that lets any parent-name owner run their own subname business — set a price, enable sales, and earn revenue when buyers register subnames under their name (e.g. `team.alice.dex`). Built without touching the core registry, controller, or resolver.

---

## Why this is a separate module

DEXignation evolves by **delegation, not replacement.** The registry is the immutable source of truth for ownership; new capabilities are added as separate contracts that the registry authorizes — never by upgrading the registry itself. This module is the first example of that pattern in practice.

Concretely, `DXSubnameRegistrar` only *calls* the registry through its public interface. To issue a subname under `alice.dex`, the registry requires the caller to be authorized for that node, so the parent owner delegates to this module exactly once:

```solidity
registry.setApprovalForAll(address(dxSubnameRegistrar), true);
```

That delegation is revocable at any time and scoped to nodes the owner actually controls. A buggy or malicious module can never affect names whose owners did not opt in, and the module can be swapped by deploying a new one and re-delegating — the registry, controller, and resolver stay immutable. This is the safety advantage of modular ("horizontal") extension over proxy ("vertical") upgrades.

<details><summary>▶ 한국어로 보기</summary>

DEXignation은 **교체가 아니라 위임**으로 진화합니다. registry는 소유권의 불변 진실 원천이고, 새 기능은 registry가 권한을 부여하는 별도 컨트랙트로 추가됩니다 — registry 자체를 업그레이드하지 않습니다. 이 모듈이 그 패턴의 첫 실제 사례입니다.

`DXSubnameRegistrar`는 registry를 공개 인터페이스로 *호출만* 합니다. `alice.dex` 아래 서브네임을 발급하려면 registry가 해당 노드 권한을 요구하므로, 부모 소유자가 한 번 위임합니다:

```solidity
registry.setApprovalForAll(address(dxSubnameRegistrar), true);
```

이 위임은 언제든 회수 가능하고 소유자가 실제 통제하는 노드에만 적용됩니다. 버그·악성 모듈도 옵트인하지 않은 이름에는 영향을 줄 수 없으며, 새 모듈 배포 후 재위임으로 교체 가능 — registry·controller·resolver는 불변. 이것이 프록시("수직") 업그레이드 대비 모듈("수평") 확장의 안전상 이점입니다.

</details>

---

## Roles & flow

There are three actors:

- **Protocol owner** — deploys the module, sets the protocol fee and fee recipient.
- **Parent owner** — owns a name like `alice.dex`; sets their subname price and toggles sales.
- **Buyer** — pays to register a subname like `team.alice.dex`.

The end-to-end flow:

1. **Parent owner configures** their business: price, duration, and an enabled flag.
2. **Parent owner delegates** the module via `registry.setApprovalForAll`.
3. **Buyer purchases** a subname, paying the set price. The protocol fee goes to the fee recipient (e.g. the `RevenueDistributor`); the remainder goes to the parent owner. The subname is registered to the buyer.

<details><summary>▶ 한국어로 보기</summary>

세 행위자:
- **프로토콜 오너** — 모듈 배포, 프로토콜 수수료·수수료 수신처 설정.
- **부모 소유자** — `alice.dex` 같은 이름 소유; 서브네임 가격 설정·판매 토글.
- **구매자** — `team.alice.dex` 같은 서브네임을 결제하고 등록.

전체 흐름:
1. **부모 소유자가 설정**: 가격·기간·활성화 플래그.
2. **부모 소유자가 위임**: `registry.setApprovalForAll`.
3. **구매자가 구매**: 설정된 가격 지불. 프로토콜 수수료는 수수료 수신처(예: `RevenueDistributor`)로, 나머지는 부모 소유자에게. 서브네임은 구매자에게 등록.

</details>

---

## API

### Parent-owner functions

```solidity
function configureSubname(
  bytes32 parentNode,
  uint256 price,      // native wei charged per subname
  uint256 duration,   // seconds granted to each subname (0 = no expiry set)
  bool    enabled     // whether sales are active
) external;           // only the current parent owner; node must not be expired
```

### Buyer function

```solidity
function registerSubname(bytes32 parentNode, string calldata label)
  external payable returns (bytes32 subnode);
// msg.value must equal the configured price; subname is registered to msg.sender
```

### Views

```solidity
function quote(bytes32 parentNode) external view returns (uint256);
function isPurchasable(bytes32 parentNode) external view returns (bool);
// isPurchasable = sales enabled AND parent not expired AND module delegated
```

### Protocol-owner functions

```solidity
function setProtocolFee(uint256 bps) external;       // capped at MAX_FEE_BPS (2000 = 20%)
function setFeeRecipient(address recipient) external; // zero address disables the fee
function setDefaultResolver(address resolver) external;
```

<details><summary>▶ 한국어로 보기</summary>

**부모 소유자 함수**: `configureSubname(parentNode, price, duration, enabled)` — 현재 부모 소유자만, 만료 노드 불가.

**구매자 함수**: `registerSubname(parentNode, label)` payable — `msg.value`가 설정 가격과 일치해야 하며, 서브네임은 `msg.sender`에게 등록.

**조회**: `quote`(가격), `isPurchasable`(판매활성 + 부모미만료 + 모듈위임 모두 충족 시 true).

**프로토콜 오너 함수**: `setProtocolFee`(MAX_FEE_BPS 20% 상한), `setFeeRecipient`(zero address면 수수료 비활성), `setDefaultResolver`.

</details>

---

## Revenue split

The buyer pays once, in native currency. The split is:

```
protocolFee   = price * protocolFeeBps / 10000   (0 if fee disabled)
ownerProceeds = price - protocolFee
```

`protocolFeeBps` is capped at `MAX_FEE_BPS` (20%) in every setter, so `ownerProceeds` is always non-negative. The fee is forwarded to `feeRecipient` (intended to be the `RevenueDistributor`, which later splits accumulated funds among treasury and stakers); the remainder is sent to the parent owner in the same transaction.

<details><summary>▶ 한국어로 보기</summary>

구매자가 native로 한 번 결제. 분배:

```
protocolFee   = price * protocolFeeBps / 10000   (수수료 비활성 시 0)
ownerProceeds = price - protocolFee
```

`protocolFeeBps`는 모든 setter에서 `MAX_FEE_BPS`(20%) 상한이라 `ownerProceeds`는 항상 ≥ 0. 수수료는 `feeRecipient`(`RevenueDistributor` 의도 — 누적 자금을 treasury·스테이커에 분배)로, 나머지는 같은 트랜잭션에서 부모 소유자에게.

</details>

---

## Safety properties

- **Operator-delegation guard** — if the parent owner has not called `setApprovalForAll`, a purchase reverts with `ModuleNotApproved(parentNode, parentOwner)` rather than an opaque inner failure.
- **Fee cap** — `MAX_FEE_BPS = 2000` (20%), enforced in the constructor and `setProtocolFee`.
- **Reentrancy** — `registerSubname` is `nonReentrant`; the registry write happens before any value transfer.
- **Expiry-aware** — both configuration and purchase revert if the parent node is expired.
- **Exact payment** — `msg.value` must equal the configured price (no implicit refunds).

<details><summary>▶ 한국어로 보기</summary>

- **위임 가드** — 부모 소유자가 `setApprovalForAll`을 안 했으면 구매가 불투명한 내부 실패가 아니라 `ModuleNotApproved`로 명확히 revert.
- **수수료 상한** — `MAX_FEE_BPS = 2000`(20%), 생성자·`setProtocolFee`에서 강제.
- **재진입** — `registerSubname`은 `nonReentrant`; registry 기록이 자금 전송보다 먼저.
- **만료 인지** — 부모 노드 만료 시 설정·구매 모두 revert.
- **정확한 결제** — `msg.value`가 설정 가격과 일치해야 함(암묵적 환불 없음).

</details>

---

## Deployment & setup

```solidity
// 1. Deploy the module
new DXSubnameRegistrar(
  registryAddress,
  defaultResolverAddress,
  feeRecipientAddress,   // e.g. RevenueDistributor; address(0) disables fee
  500                    // 5% protocol fee
);

// 2. A parent owner enables their business (their own transactions)
registry.setApprovalForAll(moduleAddress, true);
subnameRegistrar.configureSubname(parentNode, 0.1 ether, 365 days, true);

// 3. Buyers can now purchase
subnameRegistrar.registerSubname{value: 0.1 ether}(parentNode, "team");
```

To wind down a parent's business, the owner calls `configureSubname(parentNode, _, _, false)` or revokes with `registry.setApprovalForAll(moduleAddress, false)`.

<details><summary>▶ 한국어로 보기</summary>

배포 후: (1) 모듈 배포(registry·기본 리졸버·수수료 수신처·수수료율), (2) 부모 소유자가 자기 트랜잭션으로 위임 + 설정, (3) 구매자가 구매. 사업 종료는 `configureSubname(..., false)` 또는 `setApprovalForAll(module, false)` 회수.

</details>

---

## Tests

```
DXSubnameRegistrar — subname commerce (A3)        8 passing
  ✔ constructor rejects a protocol fee above MAX_FEE_BPS
  ✔ only the parent owner can configure subname commerce
  ✔ reverts a purchase when sales are disabled
  ✔ reverts a purchase when the module is not delegated
  ✔ reverts on incorrect payment
  ✔ isPurchasable reflects the full precondition set
  ✔ buys a subname end-to-end and registers it to the buyer
  ✔ splits revenue between fee recipient and parent owner
```

Exercised against the real registry (not mocks), so the operator-delegation flow and revenue split are verified in full. Total suite: **112 passing.**

<details><summary>▶ 한국어로 보기</summary>

8개 테스트가 (목이 아닌) 실제 registry 대상으로 operator 위임 흐름과 수익 분배를 전부 검증. 전체 **112 통과.**

</details>
