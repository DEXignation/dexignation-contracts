# 01. Contract Reference

> This document summarizes each contract's concept, responsibilities, key
> variables, key functions, and state flow. The code basis is the **final v2
> version** (with transfer safety). For the big picture see `00_overview.md`; for
> the v2 work narrative see `02_transfer_safety_v2.md`.

This document explains things in dependency order, starting from the root of
authority: DXRegistry → DXRegistrar → DXResolver → DXRegistrarController →
Oracle/Reservations/Reverse → extension modules.

<details><summary>▶ 한국어로 보기</summary>

각 컨트랙트의 개념, 책임, 주요 변수, 주요 함수, 상태 흐름을 정리합니다. 코드
기준은 **v2 최종본**(전송 안전성 반영)입니다. 권한의 루트부터 의존성 순서로
설명합니다: DXRegistry → DXRegistrar → DXResolver → DXRegistrarController →
가격/예약/역방향 → 확장 모듈.

</details>

---

## 1. DXRegistry — the root of authority

### 1.1 Concept & responsibility

DXRegistry is the **single source of truth for "who owns which node"** across the
entire system. It plays the same role as ENS's `ENSRegistry`, storing an
`(owner, resolver, expires)` record for each node in the namehash tree in EIP-137
style.

A characteristic unique to DEXignation is that it **tracks expiry directly in the
registry**, so the registrar can record a name's lifecycle (registration/expiry)
directly in the registry.

Why this contract matters: DXResolver judges "do I have permission to write
records for this node" based on **DXRegistry's owner(node)**. That is, registry
ownership is the effective control of a name. The core of v2 transfer safety is
exactly to transfer this ownership automatically on NFT transfer.

### 1.2 Key variables

| Variable | Type | Description |
| --- | --- | --- |
| `records` | `mapping(bytes32 => Record)` | node → `(owner, resolver, expires)` |
| `operators` | `mapping(address => mapping(address => bool))` | ERC-721-style operator approval |

The `Record` struct consists of `owner` (node owner), `resolver` (this node's
resolver address), and `expires` (expiry time).

### 1.3 Core logic — the `authorised` modifier

```solidity
modifier authorised(bytes32 node) {
    if (isExpired(node)) revert NameExpired();
    address nodeOwner = records[node].owner;
    if (nodeOwner != msg.sender && !operators[nodeOwner][msg.sender])
        revert Unauthorized();
    _;
}
```

This modifier is the gate for all write permissions. It checks two things:

1. **Expiry check**: revert if `isExpired(node)` is true. But since
   `isExpired = expires != 0 && now > expires`, **a node with expires=0 never
   expires**. This matters because the TLD node (`.dex`, baseNode) does not set
   expiry (expires=0), so it always passes — allowing the registrar to create
   subnodes at any time.
2. **Ownership check**: the caller must be the node owner or an operator the owner
   approved.

> **v2 connection**: the fact that `authorised` is based on baseNode is why v2's
> `_update` hook passes without an expiry problem when calling
> `setSubnodeOwner(baseNode, ...)`. See the safety-review section of the `02`
> document for details.

### 1.4 Key functions

| Function | Description |
| --- | --- |
| `owner(node)` | Look up node owner |
| `setOwner(node, owner)` | Change node owner (authorised) |
| `setSubnodeOwner(node, label, owner)` | Grant subnode ownership (parent node authorised). **Called by registrar on name issuance and on v2 transfer** |
| `setSubnodeExpires(node, label, expires)` | Set subnode expiry |
| `resolver(node)` / `setResolver(node, resolver)` | Look up/set node's resolver |
| `setApprovalForAll(operator, approved)` | Operator approval |
| `setRecord` / `setSubnodeRecord` | Set owner+resolver+expires at once |
| `recordExists(node)` | Whether a record exists |
| `isExpired(node)` | Whether expired (`expires != 0 && now > expires`) |

### 1.5 Initialization at deployment

The constructor sets the owner of the root node (`0x0`) to the deployer. Right
after deployment, the deployer must transfer ownership of the `.dex` TLD to
DXRegistrar (the `GrantTldToRegistrar` step in the deployment module). The
registrar can only issue names once this step is complete.

<details><summary>▶ 한국어로 보기</summary>

DXRegistry는 **"누가 어떤 노드를 소유하는가"의 단일 진실 공급원**입니다. ENS의
`ENSRegistry`와 같은 역할이며, EIP-137 스타일로 각 노드에 `(owner, resolver,
expires)` 레코드를 저장합니다. DEXignation만의 특징은 **만료를 레지스트리에서 직접
추적**한다는 점입니다.

중요한 이유: DXResolver는 레코드 쓰기 권한을 **DXRegistry의 owner(node)** 기준으로
판단합니다. 즉 레지스트리 소유권이 실질적인 이름 제어권이며, v2 전송 안전성의 핵심도
이 소유권을 NFT 전송 시 자동 이전하는 것입니다.

**`authorised` modifier**가 모든 쓰기 권한의 게이트입니다. ① 만료 검사:
`isExpired = expires≠0 && now>expires`이므로 expires=0인 노드(TLD `.dex`)는 절대
만료되지 않아 항상 통과 → registrar가 언제든 서브노드 생성 가능. ② 소유권 검사:
호출자가 노드 소유자이거나 승인된 operator여야 함.

**배포 시 초기화**: 생성자는 루트 노드(`0x0`) 소유자를 배포자로 설정. 배포 직후
배포자는 `.dex` TLD 소유권을 DXRegistrar로 이전해야 합니다(`GrantTldToRegistrar`).
이 단계가 끝나야 registrar가 이름을 발행할 수 있습니다.

</details>

---

## 2. DXRegistrar — the name NFT (ERC-721)

### 2.1 Concept & responsibility

DXRegistrar is the contract that **mints and manages `.dex` names as ERC-721
NFTs**. As the owner of the `.dex` TLD node (baseNode), it has the authority to
create individual names (subnodes). Its main responsibilities:

- Name NFT issuance (`register`), renewal (`renew`), and burning (`burn`)
- Expiry and grace-period management
- On-chain SVG tier card rendering (`tokenURI`)
- **v2: control transfer + record invalidation on NFT transfer (`_update` hook)**

### 2.2 Key variables

| Variable | Type | Description |
| --- | --- | --- |
| `expiries` | `mapping(uint256 => uint256)` | tokenId → expiry time |
| `names` | `mapping(uint256 => string)` | tokenId → original label (for SVG) |
| `highestTier` | `mapping(uint256 => uint8)` | tokenId → tier (0=charcoal~4=gold). "all-time highest" badge |
| `controllers` | `mapping(address => bool)` | whitelist of controllers with register/renew authority |
| `recordResolver` (v2) | `IResolverVersion` | resolver to call `bumpVersion` on transfer |
| `registry` | `IDXRegistry` | registry reference |
| `baseNode` | `bytes32` | `.dex` TLD node |
| `gracePeriod` | `uint256` | post-expiry renewal grace (default 70 days) |

### 2.3 Tier rules — very important

The tier is the NFT's color badge and follows these rules:

- **Set point**: determined by the purchase term at registration.
- **Ratchet up**: when accumulated term lengthens via renewal, the tier rises.
- **No downgrade**: the tier never goes down over time ("all-time highest" kept).
- **Expiry display**: shown in red only when expired (the tier itself is kept).
- **Boundaries**: `≤1yr` charcoal, `≤3yr` mud, `≤5yr` orange, `≤10yr` yellow,
  beyond that (15yr) gold.

Implemented with `_tierOf(duration)` and the `highestTier` mapping. Reference
test: `Registrar-SVG.test.ts`.

### 2.4 Key functions

| Function | Description |
| --- | --- |
| `register(id, owner, duration)` | Mint name NFT (onlyController, whenOwnsBaseNode) |
| `renew(id, duration)` | Renew (extend expiry, may ratchet tier up) |
| `burn(id)` | Permanent burn after expiry+grace (permissionless) |
| `reclaim(id, owner)` | Manual registry-ownership reset (**usually unnecessary in v2 since transfer handles it automatically**) |
| `nameExpires(id)` | Look up expiry time |
| `available(id)` | Whether registerable (unregistered or expired+grace passed) |
| `tokenURI(id)` | On-chain SVG tier card (base64 JSON) |
| `ownerOf(id)` | ERC-721 owner (overridden to revert when expired) |
| `addController/removeController` | Controller management (onlyOwner) |
| `setResolver(resolver)` (v2) | Set `recordResolver` — connects transfer invalidation |
| `setGracePeriod` | Adjust grace period (onlyOwner, 7~365 days) |

### 2.5 register internal flow

```solidity
// inside register(owner, id, duration) (summary)
highestTier[id] = _tierOf(duration);
_mint(owner, id);                                        // (A) NFT issuance
registry.setSubnodeOwner(baseNode, bytes32(id), owner);  // (B) registry ownership
registry.setSubnodeExpires(baseNode, bytes32(id), expiries[id]);
```

Here `_mint` is an issuance with `from == 0`, so it is not a target of the v2
`_update` hook's invalidation (see 2.6).

### 2.6 v2 core — the `_update` hook

All ERC-721 ownership changes (mint/transfer/burn) pass through OpenZeppelin's
`_update`. v2 overrides it.

```solidity
function _update(address to, uint256 tokenId, address auth)
    internal override returns (address)
{
    address from = super._update(to, tokenId, auth);  // state change first (CEI)

    // exclude mint(from==0)·burn(to==0)·controller delivery(!controllers[from])
    if (from != address(0) && to != address(0) && !controllers[from]) {
        bytes32 node = keccak256(abi.encodePacked(baseNode, bytes32(tokenId)));
        // (1) transfer control
        registry.setSubnodeOwner(baseNode, bytes32(tokenId), to);
        // (2) invalidate all records
        if (address(recordResolver) != address(0))
            recordResolver.bumpVersion(node);
    }
    return from;
}
```

**Meaning of the conditions**:
- `from != 0`: exclude mint (issuance is not invalidated).
- `to != 0`: exclude burn.
- `!controllers[from]`: exclude **registration delivery** (controller → user). This
  preserves the initial address the controller set at registration. Without it, a
  bug occurs where the address disappears right after registration (covered in
  detail in the `02` document).

**Reentrancy safety**: the state change (`super._update`) happens before external
calls, and the callees (registry, resolver) are trusted contracts with no
callbacks, so there is no reentrancy vector.

Reference tests: `Transfer-Invalidation.test.ts`, `Transfer-Edge.test.ts`.

### 2.7 ownerOf override

`ownerOf` of an expired name reverts. However, inside `_update`, `super._update`
internally uses `_ownerOf` (the non-reverting version), so it does not conflict
with the transfer logic.

<details><summary>▶ 한국어로 보기</summary>

DXRegistrar는 `.dex` 이름을 **ERC-721 NFT로 발행·관리**합니다. baseNode 소유자로서
서브노드를 만들 권한을 가지며, 발행·갱신·소각, 만료·유예 관리, 온체인 SVG 렌더링,
**v2 전송 훅**을 담당합니다.

**등급 규칙**: 등록 시 기간으로 결정 → 갱신으로 상향(ratchet up) → 시간으로 하향
없음 → 만료 시에만 빨강 표시. 경계: ≤1년 charcoal, ≤3년 mud, ≤5년 orange,
≤10년 yellow, 15년 gold.

**register 내부**: `_mint`(from==0이라 무효화 대상 아님) → `setSubnodeOwner` →
`setSubnodeExpires`.

**v2 핵심 `_update` 훅**: 모든 소유권 변경이 거치는 `_update`를 오버라이드.
`from≠0`(mint 제외)·`to≠0`(burn 제외)·`!controllers[from]`(등록 배달 제외) 조건의
진짜 전송에만 ① 제어권 이전(setSubnodeOwner) ② 무효화(bumpVersion). `super._update`가
외부 호출보다 먼저라 재진입 안전. `!controllers[from]`가 빠지면 등록 직후 주소가
사라지는 버그 발생.

**ownerOf 오버라이드**: 만료 이름의 `ownerOf`는 revert하지만, `_update` 내부는
`_ownerOf`(non-revert)를 써서 전송 로직과 충돌하지 않습니다.

</details>

---

## 3. DXResolver — resolution records + v2 versioning

### 3.1 Concept & responsibility

DXResolver is the **resolution data store** that holds what a name actually points
to. For one name (node) it keeps several kinds of records:

- **addr**: per-coin-type address (EVM, Polygon, etc.)
- **text**: key-value (email, URL, etc., EIP-634)
- **multiLangText**: per-key, per-language value
- **contenthash**: IPFS/IPNS, etc. (EIP-1577)
- **ABI**: per-chain, per-content-type ABI (EIP-205)
- **profile**: name/bio/avatar/URL (per language)
- **agent**: AI agent identity + payment routing

Write permission is based on **DXRegistry.owner(node)** (the `onlyTokenOwner`
modifier).

### 3.2 v2 core — record versioning

The biggest structural change in v2. **A version dimension was added to every
record mapping.**

```solidity
mapping(bytes32 => uint64) public recordVersions;   // node => current version

function _ver(bytes32 node) internal view returns (uint64) {
    return recordVersions[node];
}
```

Each record mapping becomes a `[node][version][...]` structure:

| Record | v1 structure | v2 structure |
| --- | --- | --- |
| text | `textRecords[node][key]` | `textRecords[node][ver][key]` |
| multi-lang | `multiLangText[node][key][lang]` | `multiLangText[node][ver][key][lang]` |
| contenthash | `contenthashes[node]` | `contenthashes[node][ver]` |
| address | `addresses[node][coinType]` | `addresses[node][ver][coinType]` |
| ABI | `abiRecords[node][chainId][type]` | `abiRecords[node][ver][chainId][type]` |
| agent | `agentRecords[node]` | `agentRecords[node][ver]` |

All reads/writes use `[node][_ver(node)][...]`, so when the version changes, all
records of the previous version become unreachable at once (O(1) invalidation).

### 3.3 Transfer-invalidation wiring

```solidity
address public registrar;                  // who may call bumpVersion on transfer

modifier onlyRegistrar() {
    require(msg.sender == registrar, "Only registrar");
    _;
}

function setRegistrar(address _registrar) external onlyOwner {
    registrar = _registrar;
}

function bumpVersion(bytes32 node) external onlyRegistrar {
    recordVersions[node]++;
    // old records remain on-chain under the previous version (history). No longer read.
}
```

- `setRegistrar`: owner-only. Set once after deployment (links the registrar
  address).
- `bumpVersion`: registrar-only. Not callable directly by outsiders — not even by
  the owner (griefing prevention).

Reference test: `Transfer-Edge.test.ts` (verifies blocking of unauthorized
bumpVersion).

### 3.4 Key functions

| Function | Description |
| --- | --- |
| `setAddr(node, coinType, addrBytes)` / `addr(node, coinType)` | Set/get address. **addrBytes is 20 bytes for EVM** |
| `setText / text` | Text records (EIP-634) |
| `setContenthash / contenthash` | Contenthash (EIP-1577) |
| `setMultiLangText / getMultiLangText` | Multi-language text |
| `setProfile / getProfile` | Profile (name/bio/avatar/URL, per-language fallback) |
| `setAgent / getAgent / clearAgent / hasAgent / agentPayment` | Agent identity & payment routing |
| `setApprovalForAll / isApprovedForAll` | Operator approval |
| `recordVersions(node)` | Look up current version (public getter) |
| `setRegistrar(addr)` (v2) | Link registrar (onlyOwner) |
| `bumpVersion(node)` (v2) | Increment version = invalidate (onlyRegistrar) |

### 3.5 Empty return on expiry

The resolver's read functions return empty/zero when a node expires. This is
handled by `onlyTokenOwner` or a separate expiry check, preventing an expired
name from continuing to resolve old data. Reference test: "returns empty after the
node expires" in each Resolver test.

### 3.6 Note on setAddr's bytes argument

The third argument of `setAddr(node, coinType, bytes addrBytes)` is `bytes`. An EVM
address must be **exactly 20 bytes** (validated in `_validateAddress`). The
controller auto-sets it at registration via `abi.encodePacked(owner)` (20 bytes).
When calling from viem, passing the address (`0x...` 40 hex) is handled as 20-byte
bytes.

<details><summary>▶ 한국어로 보기</summary>

DXResolver는 이름이 가리키는 데이터를 저장하는 **해석 데이터 저장소**입니다. 6종
레코드(주소·텍스트·다국어·콘텐츠해시·ABI·프로필·에이전트)를 보관하며, 쓰기 권한은
**DXRegistry.owner(node)** 기준(`onlyTokenOwner`)입니다.

**v2 핵심 — 레코드 버전 관리**: 모든 레코드 매핑에 버전 차원을 추가해
`[node][version][...]` 구조로 만들었습니다. 모든 읽기/쓰기가 `[node][_ver(node)][...]`를
쓰므로, 버전이 바뀌면 이전 버전 레코드가 한 번에 도달 불가능(O(1) 무효화).

**전송 무효화 연결**: `setRegistrar`(오너만, 배포 후 1회), `bumpVersion`(registrar만,
외부인·오너도 직접 호출 불가 — grief 방지). 옛 레코드는 이전 버전 아래 체인에 남음.

**만료 시 빈 값 반환**: 만료된 이름이 옛 데이터를 계속 해석하지 않도록 빈 값/0 반환.

**setAddr의 bytes 주의**: 3번째 인자는 `bytes`, EVM 주소는 정확히 20바이트.
컨트롤러는 `abi.encodePacked(owner)`(20바이트)로 자동 설정.

</details>

---

## 4. DXRegistrarController — the registration & payment entry point

### 4.1 Concept & responsibility

The **main entry point** users interact with directly. It orchestrates the whole
registration/renewal process:

- two-stage commit-reveal registration (front-running defense)
- price calculation (calls DXPriceOracle + applies discounts)
- payment receipt (native POL or USDT/USDC tokens)
- reserved-label check (DXReservations)
- delegates NFT minting to the registrar + sets initial resolver/address
- emergency pause, fund withdrawal

### 4.2 Key variables

| Variable | Description |
| --- | --- |
| `allowedPaymentTokens` | whitelist of allowed payment tokens (USDT/USDC) |
| `commitments` | commitment hash → submission time |
| `discountToken / discountBps / requiredHoldAmount` | ERC-20 holding discount |
| `sbtDiscountToken / sbtDiscountBps` | SBT holding discount |
| `stakingContract / stakeDiscountBps / stakeDiscountThreshold` | staking discount |
| `minCommitmentAge / maxCommitmentAge` | commit-reveal window |
| `priceOracle / registrar / registry / reservations` | dependency references |

### 4.3 Discount logic — max, not stacked

```
effective discount = max(token discount, SBT discount, staking discount)
```

The three discounts are **not summed; only the maximum is applied**
(`_effectiveDiscountBps`). Each rate is capped at `MAX_DISCOUNT_BPS` (50%) in its
setter, so the discount amount can never exceed the price. Reference tests:
`HolderDiscount`, `SBT-Discount`, `Stake-Discount`, `Invariants`.

### 4.4 Price calculation flow

```
1. rentPrice(duration)         → convert USD-fixed price to POL (DXPriceOracle.price)
2. _applyDiscount(price, user) → apply effective discount
3. (for token payment) _attoUSDToTokenUnits → convert USD to token units
```

- `rentPrice` family: native (POL) price.
- `rentPriceInToken` family: token (USDT/USDC) price.
- `...For(user)` / `...ForPayer(payer)`: price with a specific user's discount.

### 4.5 register internals (commit-reveal reveal stage)

The order in `_executeRegister` (or the register body) is directly tied to v2.

```
1. registrar.register(..., owner=this)   // controller mints NFT to itself
2. registry.setResolver(subnode, resolver)
3. resolver.setAddr(subnode, COIN_TYPE_POLYGON, owner)  // auto-set initial addr
4. registry.setOwner(subnode, owner)      // set registry ownership to actual owner
5. registrar.transferFrom(this, owner, id) // deliver NFT to actual owner
6. refund overpayment
```

**Step 5's "controller → owner" transfer is the key v2 issue.** Since it is a
"delivery," not a real transfer, the registrar's `_update` hook skips invalidation
via the `!controllers[from]` condition. Otherwise the address set in step 3 would
be invalidated by the step-5 transfer and disappear. (Details: `02` document.)

### 4.6 Key functions

| Function | Description |
| --- | --- |
| `commit(commitment)` | Stage 1: submit commitment |
| `register(label, owner, duration, resolver, secret)` | Stage 2: register with POL |
| `registerWithToken(...)` | Register with USDT/USDC |
| `renew(...) / renewWithToken(...)` | Renew |
| `available(label)` | Whether registerable |
| `rentPrice(duration)`, etc. | Price queries (several variants) |
| `makeCommitment / makeCommitmentFull` | Compute commitment (view) |
| `setDiscountToken / setSBTDiscount / setStakeDiscount` | Configure discounts (onlyOwner) |
| `setAllowedPaymentToken` | Allow payment token (onlyOwner) |
| `setCommitmentAgeSettings` | Adjust commit-reveal window |
| `pause / unpause` | Emergency pause (onlyOwner) |
| `withdraw / withdrawToken / recoverFunds` | Fund recovery (onlyOwner, nonReentrant) |
| `registerInventoryNames` | Operational bulk registration |

### 4.7 Security features

- **commit-reveal**: front-running defense. At reveal, parameters are re-hashed
  and checked against the commitment → resolver/duration/owner/paymentToken cannot
  be swapped (ref: `MEV` tests).
- **pause**: stop registration in emergencies (commits still possible).
- **nonReentrant**: reentrancy guard on fund-recovery functions.
- **hostile ERC-20 defense**: handles false-return/no-return/fee-on-transfer
  tokens (ref: `HostileERC20` tests).

<details><summary>▶ 한국어로 보기</summary>

사용자가 직접 상호작용하는 **메인 진입점**. commit-reveal 2단계 등록, 가격 계산+할인,
결제 수령(POL/토큰), 예약 확인, registrar에 발행 위임+초기 리졸버/주소 설정, 긴급
정지·자금 회수를 담당합니다.

**할인 로직**: 유효 할인 = max(토큰, SBT, 스테이킹). 합산 아닌 최댓값. 각 setter에서
50% 상한 강제.

**register 내부 순서**: ① registrar.register(owner=this) ② setResolver ③ setAddr(초기
주소) ④ setOwner ⑤ transferFrom(컨트롤러→owner) ⑥ 환불. **⑤의 "컨트롤러→owner"
전송이 v2 핵심 쟁점** — 배달이므로 `!controllers[from]`로 무효화 건너뜀(안 그러면
③의 주소가 사라짐).

**보안**: commit-reveal(선점 방어), pause(긴급 정지), nonReentrant(재진입 가드),
hostile ERC-20 방어.

</details>

---

## 5. DXPriceOracle — USD→POL conversion

### 5.1 Concept & responsibility

Performs **real-time conversion via a Chainlink POL/USD feed** of USD-fixed
prices. It stores per-tier USD prices ($8/$18/$25/$40/$55) and computes the
required POL amount at the POL price at payment time.

### 5.2 Core — staleness guard

```solidity
uint256 public maxOracleDelay = 26 hours;

// when reading the price:
if (updatedAt == 0 || block.timestamp - updatedAt >= maxOracleDelay) {
    revert StaleOraclePrice();
}
```

If the oracle data is older than 26 hours, it reverts. This is a safeguard against
receiving a wrong price from a dead or stuck feed.

> **Testnet implication**: Amoy's real Chainlink POL/USD feed is often dead
> (revert on read) and hits this guard. So during Amoy verification we use a
> MockPriceOracle, and since the mock also hits staleness over time, its timestamp
> must be refreshed via `updateAnswer`. The mainnet feed works normally. (Details:
> `02`, `05` documents.)

### 5.3 Key functions

| Function | Description |
| --- | --- |
| `price(duration)` | POL price for the duration |
| `priceAttoUSD(duration)` | USD price (atto units) |
| `setPolUsdOracle(addr)` | Set POL/USD feed address (onlyOwner) |
| `setMaxOracleDelay(delay)` | Staleness threshold (1~48 hours) |

<details><summary>▶ 한국어로 보기</summary>

USD 고정가를 **Chainlink POL/USD 피드로 실시간 환산**. 등급별 USD 가격을 저장하고
결제 시점 시세로 POL 수량 계산.

**핵심 — staleness 가드**: 오라클 데이터가 26시간보다 오래되면 revert. 죽은/멈춘
피드로부터 잘못된 가격을 받지 않기 위한 안전장치. Amoy 실제 피드는 종종 죽어 이
가드에 걸리므로 검증 시 MockPriceOracle을 쓰고 `updateAnswer`로 타임스탬프를 갱신.
메인넷 피드는 정상.

</details>

---

## 6. DXReverseRegistrar — reverse resolution

### 6.1 Concept & responsibility

Registers address → name resolution (`0x123....addr.reverse` → "roy.dex"). Separate
from forward (name → address) resolution.

### 6.2 Key functions

| Function | Description |
| --- | --- |
| `claim(owner)` | Claim ownership of the reverse node |
| (name setting) | Record the name in the reverse record |

> **Not covered in v2**: reverse records were not in the scope of this v2
> transfer-safety work. The consistency of reverse records on NFT transfer is
> marked as a separate item to review (not directly tied to fund loss). It is a
> candidate for a future v2.x (see the `06` document).

<details><summary>▶ 한국어로 보기</summary>

주소 → 이름 해석을 등록(`0x….addr.reverse` → "roy.dex"). 정방향과 별개.
`claim(owner)`로 역방향 노드 소유권 주장.

**v2 미반영 영역**: 역방향 레코드는 이번 v2 범위가 아니었습니다. NFT 전송 시
역방향 정합성은 별도 검토 대상(자금 손실과 직결되지 않음). 향후 v2.x 후보.

</details>

---

## 7. DXReservations — reserved labels

### 7.1 Concept & responsibility

Reserves a specific label so that only a specific address (claimant) can register
it. Used for protecting brand names and reserved words.

### 7.2 Key functions

| Function | Description |
| --- | --- |
| `reserve(label, claimant)` | Single reservation (onlyOwner) |
| `reserveBulk(...)` | Bulk reservation |
| `release(label)` | Release a reservation (owner or authorized releaser) |
| `isClaimableBy(label, addr)` | Whether the address can claim |

The controller checks reservations at registration via `_checkReservation`.
Reference test: `DXReservations`.

<details><summary>▶ 한국어로 보기</summary>

특정 라벨을 특정 주소(claimant)만 등록하도록 예약(브랜드명·예약어 보호).
`reserve`/`reserveBulk`/`release`/`isClaimableBy`. 컨트롤러는 등록 시
`_checkReservation`으로 예약 여부를 확인합니다.

</details>

---

## 8. Extension modules

### 8.1 DXRegistry — direct subname issuance

Lets a parent name owner directly issue child names (e.g. `shop.roy.dex`) to
specific wallet addresses.

- no sale/payment flow
- parent owner can issue, reassign, and revoke direct child nodes
- child nodes dynamically inherit parent expiry
- resolver records are invalidated on reassign/revoke

Reference tests: `Subname-Issuance`.

### 8.2 DXSubscriptionRenewer — auto-renewal (subscription)

USDT/USDC-based auto-renewal. Once a user subscribes, anyone (including
keepers/bots) can execute renewal within the renewal window.

- `subscribe / unsubscribe`
- `executeRenewal` — only within the window, reverts if the price cap is exceeded
- handles USDT's non-standard approve (`forceApprove`)

Reference tests: `Subscription-Renewal`, `Subscription-USDT`.

### 8.3 Discount-eligibility contracts

- **DXContributionSBT**: contributor badge (Soulbound). SBT discount eligibility.
- **DXNToken**: native ERC-20. Token-holding discount eligibility.
- **DXNStaking**: staking. Staking discount eligibility.

### 8.4 RevenueDistributor — revenue distribution

Distributes revenue at fixed ratios.

### 8.5 Helper libraries

| Library | Role |
| --- | --- |
| `DXNamehash` | namehash computation (verified to match viem reference) |
| `StringUtils` | string utilities (label length, etc.) |
| `EVMCoinUtils` | EVM coin-type/address validation |
| `KoreanNormalization` | Korean text normalization |

<details><summary>▶ 한국어로 보기</summary>

- **DXRegistry 서브네임 발급**: 부모 소유자가 하위 이름을 특정 지갑에 직접 발급.
  판매/결제 개념은 없으며, 재지정·회수 시 resolver 레코드는 무효화된다.
  하위 이름은 부모 이름의 만료 상태를 동적으로 상속한다.
- **DXSubscriptionRenewer**: USDT/USDC 자동 갱신. 윈도우 내 누구나 `executeRenewal`,
  상한 초과 시 revert. USDT 비표준 approve는 `forceApprove`로 대응.
- **할인 자격 컨트랙트**: DXContributionSBT(SBT 할인), DXNToken(토큰 할인),
  DXNStaking(스테이킹 할인).
- **RevenueDistributor**: 수익 분배.
- **보조 라이브러리**: DXNamehash(viem 일치 검증), StringUtils, EVMCoinUtils,
  KoreanNormalization.

</details>

---

## 9. Inter-contract dependency summary

```
DXRegistry  ← (ownership lookup) ← DXResolver
     ↑                                ↑
     │ (ownership record)             │ (bumpVersion, v2)
DXRegistrar ────────────────────────-┘
     ↑
     │ (NFT issuance delegation)
DXRegistrarController → DXPriceOracle (price)
                      → DXReservations (reservation)
                      → discount contracts (eligibility)
DXReverseRegistrar → DXRegistry (reverse node)
DXRegistry → DXResolver (subnode record invalidation)
DXSubscriptionRenewer → DXRegistrarController (renewal call)
```

Core invariant: **for every registered name, `DXRegistrar.ownerOf(id) ==
DXRegistry.owner(node)`** must always hold. The v2 `_update` hook maintains this
invariant automatically on transfer. Reference test: "NFT owner equals registry
owner" in `Invariants`.

<details><summary>▶ 한국어로 보기</summary>

핵심 불변식: **모든 등록된 이름에 대해 `DXRegistrar.ownerOf(id) ==
DXRegistry.owner(node)`** 가 항상 성립해야 합니다. v2 `_update` 훅이 전송 시 이
불변식을 자동으로 유지합니다. (참조 테스트: `Invariants`의 "NFT owner equals
registry owner")

</details>
