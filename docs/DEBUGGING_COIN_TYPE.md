# Fixing 37 Failing Tests: ENSIP-11 Coin Type Mismatch in a `.dex` Name Service

> A post-mortem of a full test-suite recovery in the DEXignation contracts — from **37 failing** down to **0 failing** — and what each failure taught us about ENS-style resolver design.

---

## TL;DR

A single mismatch between how the registrar **encoded** a coin type and how the resolver **validated** it caused 37 of 82 tests to fail with the same opaque error: `Unsupported coin type`. Fixing it surfaced two further layers of unrelated issues (an under-implemented resolver, and a test constant that disagreed with the contract). The final tally:

| Stage | Failing | Root cause | Fix location |
| --- | --- | --- | --- |
| 1 | 37 | Coin type encoded as ENSIP-11 (`0x80000000 \| chainId`) but validated as plain SLIP-44 | `DXResolver.sol` |
| 2 | 10 | Resolver missing length checks, expiry checks, operator approval | `DXResolver.sol` |
| 3 | 4 | `gracePeriod` constant disagreement between test and contract | test file |
| Final | **0** | — | — |

<details><summary>▶ 한국어로 보기</summary>

레지스트라가 coin type을 **인코딩**하는 방식과 리졸버가 그것을 **검증**하는 방식 사이의 단 하나의 불일치 때문에, 82개 테스트 중 37개가 동일한 모호한 에러 `Unsupported coin type`으로 실패했습니다. 이를 수정하자 서로 무관한 두 계층의 문제가 추가로 드러났습니다(미완성 리졸버, 그리고 컨트랙트와 어긋난 테스트 상수). 최종 결과는 **37 → 10 → 0**입니다.

</details>

---

## The first symptom: 37 identical reverts

Every failing test that went through the `register()` flow died at the same place:

```
register → _executeRegister → DXResolver.setAddr → revert "Unsupported coin type"
```

The 45 tests that passed never touched `register()` — they were unit tests for commitments, reservations, discount views, and ERC-165 support. The moment a test actually registered a name, it reverted.

The controller atomically writes an initial resolver record during registration so a name is usable immediately:

```solidity
// DXRegistrarController.sol
uint256 constant COIN_TYPE_POLYGON = COIN_TYPE_DEFAULT | CHAIN_ID_POLYGON;

IDXResolver(resolver).setAddr(subnode, COIN_TYPE_POLYGON, abi.encodePacked(owner));
```

`COIN_TYPE_DEFAULT` is the ENSIP-11 EVM high bit, `0x80000000`. So the value actually sent was **`0x80000089`** (`2147483785`), not the plain chain id `137`.

The resolver, however, only knew about plain SLIP-44 values:

```solidity
// DXResolver.sol — before
supportedCoins[137] = "Polygon"; // plain 137, NOT 0x80000089
```

`setAddr` checked `supportedCoins[coinType]`, found an empty entry for `0x80000089`, and reverted. The encode side and the validate side were speaking two different dialects of the same standard.

<details><summary>▶ 한국어로 보기</summary>

`register()` 흐름을 거치는 모든 실패 테스트가 동일한 지점에서 멈췄습니다: `setAddr`에서 `"Unsupported coin type"`. 통과한 45개는 `register()`를 건드리지 않는 단위 테스트(commitment, reservation, discount view, ERC-165)였습니다.

컨트롤러는 등록 시 이름을 즉시 사용 가능하게 하려고 초기 리졸버 레코드를 원자적으로 기록합니다. 이때 `COIN_TYPE_DEFAULT`는 ENSIP-11 EVM 상위 비트(`0x80000000`)이므로 실제 전달값은 `0x80000089`였습니다. 하지만 리졸버는 SLIP-44 평문값 `137`만 알고 있었습니다. 인코딩 측과 검증 측이 같은 표준의 서로 다른 방언을 쓰고 있던 것입니다.

</details>

---

## Understanding ENSIP-11 vs SLIP-44

This is the conceptual heart of the bug, and it is an easy trap.

- **SLIP-44** assigns a flat coin type per chain (Ethereum = 60, Polygon = 137 in some lists).
- **ENSIP-11** encodes EVM chains as `0x80000000 | chainId`. The high bit flags "this is an EVM chain", and the lower bits carry the **chain id** — not the SLIP-44 number.

The trap: Polygon's chain id is **137**, which coincidentally equals a SLIP-44-style number, so it *looks* interchangeable. But Ethereum's chain id is **1**, while its SLIP-44 coin type is **60**. They are not the same namespace.

<details><summary>▶ 한국어로 보기</summary>

이것이 버그의 개념적 핵심이며, 빠지기 쉬운 함정입니다.

- **SLIP-44**: 체인마다 평면적인 coin type을 부여 (Ethereum=60, Polygon=137).
- **ENSIP-11**: EVM 체인을 `0x80000000 | chainId`로 인코딩. 상위 비트는 "EVM 체인"임을 표시하고, 하위 비트는 SLIP-44 번호가 아니라 **체인 ID**를 담습니다.

함정: Polygon의 체인 ID는 137로, 우연히 SLIP-44 스타일 번호와 같아서 호환되는 것처럼 보입니다. 하지만 Ethereum의 체인 ID는 1이고 SLIP-44 coin type은 60으로, 서로 다른 네임스페이스입니다.

</details>

---

## Fix #1 — align the resolver with ENSIP-11

The project already had an `EVMCoinUtils` library implementing the standard correctly:

```solidity
// EVMCoinUtils.sol
uint256 constant COIN_TYPE_DEFAULT = 1 << 31; // 0x80000000

function isEVMCoinType(uint256 coinType) internal pure returns (bool) {
    return coinType == COIN_TYPE_DEFAULT || chainFromCoinType(coinType) > 0;
}
```

The controller already imported it (that's why `COIN_TYPE_DEFAULT` resolved at compile time). The resolver simply hadn't been wired to the same source of truth. Three coordinated changes:

**1. Register EVM chains under their ENSIP-11 keys** (chain id, not SLIP-44), keep non-EVM chains on plain SLIP-44:

```solidity
supportedCoins[COIN_TYPE_DEFAULT]         = "EVM (default)"; // chainId 0
supportedCoins[COIN_TYPE_ETH]             = "Ethereum";      // SLIP-44 60 (legacy)
supportedCoins[COIN_TYPE_DEFAULT | 1]     = "Ethereum";      // chainId 1
supportedCoins[COIN_TYPE_DEFAULT | 137]   = "Polygon";       // chainId 137
// ... Arbitrum, Optimism, Base, Avalanche, Fantom, BSC ...
supportedCoins[0]   = "Bitcoin";  // non-EVM stays SLIP-44
supportedCoins[501] = "Solana";
```

**2. Validate EVM addresses via the shared library** instead of a hardcoded list:

```solidity
// DXResolver.sol — after
if (EVMCoinUtils.isEVMCoinType(coinType)) {
    require(addrBytes.length == 20, "EVM address must be 20 bytes");
    return;
}
```

**3. Single source of truth** — import the constant rather than redefining it, so the controller and resolver can never drift again:

```solidity
import {EVMCoinUtils, COIN_TYPE_DEFAULT, COIN_TYPE_ETH} from "../utils/EVMCoinUtils.sol";
```

Note we deliberately did **not** add `COIN_TYPE_DEFAULT` to the controller — it already inherits it from `EVMCoinUtils`, and a second definition would be a duplicate-declaration error.

After this: **37 → 10 failing.**

<details><summary>▶ 한국어로 보기</summary>

프로젝트에는 이미 표준을 올바르게 구현한 `EVMCoinUtils` 라이브러리가 있었고, 컨트롤러는 이를 import하고 있었습니다(그래서 `COIN_TYPE_DEFAULT`가 컴파일 시 해석됨). 리졸버만 같은 단일 진실 공급원에 연결돼 있지 않았습니다. 세 가지를 함께 수정했습니다.

1. **EVM 체인을 ENSIP-11 키(체인 ID 기준)로 등록**하고, non-EVM은 SLIP-44 평문 유지.
2. **하드코딩 목록 대신 공유 라이브러리 `isEVMCoinType`으로 EVM 주소 검증**.
3. **단일 진실 공급원** — 상수를 재정의하지 않고 import하여 컨트롤러와 리졸버가 다시 어긋나지 않게 함. 컨트롤러에는 `COIN_TYPE_DEFAULT`를 추가하지 않았습니다(이미 상속받고 있어 중복 선언 에러가 남).

결과: **37 → 10**.

</details>

---

## Fix #2 — finish the resolver to match its own interface

The next 10 failures revealed that `DXResolver` implemented less than its `IDXResolver` interface promised. The interface already declared the errors and functions; the implementation simply hadn't caught up.

**Length validation** — the interface defined `TextKeyTooLong`, `TextValueTooLong`, `ContenthashTooLong`, but the implementation enforced nothing:

```solidity
uint256 public constant MAX_TEXT_KEY_LENGTH    = 64;
uint256 public constant MAX_TEXT_VALUE_LENGTH  = 1024;
uint256 public constant MAX_CONTENTHASH_LENGTH = 128;

if (bytes(key).length > MAX_TEXT_KEY_LENGTH) {
    revert TextKeyTooLong(bytes(key).length, MAX_TEXT_KEY_LENGTH);
}
```

**Expiry-aware reads** — a resolver must return empty data once a name expires, otherwise stale records leak after a domain changes hands:

```solidity
function text(bytes32 node, string calldata key) external view returns (string memory) {
    if (registry.isExpired(node)) return "";
    return textRecords[node][key];
}
```

**Operator approval** — EIP-634/137-style delegation (`setApprovalForAll` / `isApprovedForAll`) so an owner can authorize a manager:

```solidity
modifier onlyTokenOwner(bytes32 node) {
    address nodeOwner = registry.owner(node);
    require(
        nodeOwner == msg.sender || _operatorApprovals[nodeOwner][msg.sender],
        "Not authorized"
    );
    _;
}
```

After this: **10 → 4 failing.**

<details><summary>▶ 한국어로 보기</summary>

다음 10개 실패는 `DXResolver`가 자신의 `IDXResolver` 인터페이스가 약속한 것보다 적게 구현돼 있었음을 드러냈습니다. 인터페이스는 이미 에러와 함수를 선언해 두었고, 구현부가 따라오지 못한 상태였습니다.

- **길이 검증**: 인터페이스에 정의된 `TextKeyTooLong` 등을 실제로 강제(키 64·값 1024·contenthash 128 바이트).
- **만료 인식 조회**: 이름 만료 시 빈 값 반환(도메인 소유권 이전 후 오래된 레코드 유출 방지).
- **operator 위임**: `setApprovalForAll`/`isApprovedForAll`로 소유자가 관리자를 승인 가능하게 함.

결과: **10 → 4**.

</details>

---

## Fix #3 — the test was wrong, not the contract

The last 4 failures were burn-after-grace tests reverting with `NotYetBurnable`. By back-calculating the `burnableAt` value in the revert, the contract's math proved correct: it applied exactly `gracePeriod = 70 days`.

The test, meanwhile, defined:

```ts
const GRACE_PERIOD = 30n * 24n * 60n * 60n; // 30 days
```

and only fast-forwarded `expiry + 30 days + 60s`. Against a 70-day grace contract, that timestamp is still inside the grace window → revert. This was a **test constant drift**, not a contract bug. The 70-day grace period is a deliberate product decision (documented in the contract header). So the fix was to correct the test:

```ts
const GRACE_PERIOD = 70n * 24n * 60n * 60n; // matches DXRegistrar product decision
```

After this: **4 → 0. All 82 passing.**

<details><summary>▶ 한국어로 보기</summary>

마지막 4개 실패는 grace 이후 burn 테스트가 `NotYetBurnable`로 revert한 것이었습니다. revert의 `burnableAt` 값을 역산하니 컨트랙트 계산은 정확했습니다 — 정확히 `gracePeriod = 70 days`를 적용 중이었습니다.

반면 테스트는 `GRACE_PERIOD`를 30일로 정의하고 `expiry + 30일 + 60초`까지만 시간을 점프했습니다. 70일 grace 컨트랙트에서 이 시점은 여전히 grace 기간 내부 → revert. 이것은 컨트랙트 버그가 아니라 **테스트 상수 불일치**였습니다. 70일 grace는 의도된 제품 결정(컨트랙트 헤더에 문서화됨)이므로, 테스트를 70일로 수정했습니다.

결과: **4 → 0. 82개 전부 통과.**

</details>

---

## Lessons

1. **A shared standard is not a shared implementation.** Both sides imported the idea of ENSIP-11; only one imported the code. Centralize the encoding in one library and import it everywhere — never redefine a protocol constant.
2. **Let the interface lead.** `IDXResolver` already encoded the full contract (length errors, expiry semantics, operator approval). When implementation lags interface, the tests are right and the contract is incomplete.
3. **When a test fails, verify which side is wrong.** Back-calculating the on-chain value (`burnableAt`) proved the contract correct and the test constant stale — the opposite of the first two stages.
4. **Opaque reverts hide layered bugs.** One `Unsupported coin type` masked nothing deeper, but fixing it *unmasked* two independent issues. Green is reached in layers, not in one jump.

<details><summary>▶ 한국어로 보기</summary>

1. **공유 표준이 곧 공유 구현은 아니다.** 양쪽 모두 ENSIP-11 개념을 import했지만 코드를 import한 건 한쪽뿐이었습니다. 인코딩을 한 라이브러리에 집중시키고 모든 곳에서 import하세요 — 프로토콜 상수를 재정의하지 마세요.
2. **인터페이스가 앞서게 하라.** `IDXResolver`는 이미 전체 계약(길이 에러, 만료 의미, operator 승인)을 담고 있었습니다. 구현이 인터페이스에 뒤처지면, 테스트가 옳고 컨트랙트가 미완성입니다.
3. **테스트 실패 시 어느 쪽이 틀렸는지 검증하라.** 온체인 값(`burnableAt`)을 역산해 컨트랙트가 옳고 테스트 상수가 낡았음을 증명했습니다 — 앞 두 단계와 정반대.
4. **모호한 revert는 계층화된 버그를 숨긴다.** 하나의 `Unsupported coin type`을 고치자 독립적인 두 문제가 드러났습니다. 그린은 한 번에 도달하는 게 아니라 계층적으로 도달합니다.

</details>

---

## Files changed

| File | Change |
| --- | --- |
| `contracts/resolver/DXResolver.sol` | ENSIP-11 coin registration + shared validation; length checks; expiry-aware reads; operator approval |
| `contracts/registrar/DXRegistrarController.sol` | Comment only (sources `COIN_TYPE_DEFAULT` from `EVMCoinUtils`) |
| `contracts/registrar/DXRegistrar.sol` | None (70-day grace confirmed as intended) |
| `test/Registrar-Burn.test.ts` | `GRACE_PERIOD` constant corrected 30 → 70 days |

**Result: 82 passing, 0 failing.**
