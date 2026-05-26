# DEXignation Architecture / DEXignation 아키텍처

This document is a deep-dive into the DEXignation smart-contract layer.
It complements the high-level README with implementation detail, design
rationale, and the trade-offs we made relative to the ENS reference.

본 문서는 DEXignation 스마트 컨트랙트 레이어를 심층적으로 다룹니다.
README의 개요와 보완 관계이며, 구현 디테일, 설계 의도, ENS 참조 구현 대비
선택한 트레이드오프를 설명합니다.

---

## Table of contents / 목차

1. [Design principles / 설계 원칙](#1-design-principles--설계-원칙)
2. [Layered architecture / 계층 구조](#2-layered-architecture--계층-구조)
3. [Namehash & node tree / namehash와 노드 트리](#3-namehash--node-tree--namehash와-노드-트리)
4. [Registration flow / 등록 플로우](#4-registration-flow--등록-플로우)
5. [Pricing & oracle / 가격과 오라클](#5-pricing--oracle--가격과-오라클)
6. [Resolution / 해결(resolution)](#6-resolution--해결resolution)
7. [Reverse resolution / 역방향 해결](#7-reverse-resolution--역방향-해결)
8. [NFT & metadata / NFT와 메타데이터](#8-nft--metadata--nft와-메타데이터)
9. [Security model / 보안 모델](#9-security-model--보안-모델)
10. [ENS comparison matrix / ENS 비교 매트릭스](#10-ens-comparison-matrix--ens-비교-매트릭스)

---

## 1. Design principles / 설계 원칙

DEXignation is guided by four principles, in priority order.

DEXignation은 다음 4가지 원칙을 우선순위 순으로 따릅니다.

1. **Standards-first.** Wherever a recognised standard exists (EIP-137,
   EIP-181, ENSIP-9, ENSIP-11, ERC-721, ERC-20), we follow it. This
   maximises wallet interoperability.
   **표준 우선.** 인정된 표준이 있는 곳에서는 표준을 따른다. 지갑 호환성
   극대화.

2. **User self-custody.** A `.dex` name is an ERC-721 NFT held by the user.
   No "leasing" model, no platform-managed escrow.
   **사용자 자기 보관.** `.dex` 이름은 사용자가 직접 보유하는 ERC-721 NFT.
   대여 모델이나 플랫폼 에스크로 없음.

3. **Polygon-native economics.** Stablecoin payment is first-class; native
   POL is an alternative, not the only path.
   **Polygon 네이티브 경제.** 스테이블코인 결제가 1급 기능. POL은 대안.

4. **Operational portability.** The protocol must work on Polygon Mainnet
   *and* on networks where direct USD price feeds are unavailable. Hence
   the dual-path oracle.
   **운영 이식성.** Polygon 메인넷뿐 아니라 직접 USD 피드가 없는 네트워크에서도
   동작해야 함. 그래서 dual-path 오라클.

---

## 2. Layered architecture / 계층 구조

```
┌─────────────────────────────────────────────────────────────────┐
│  Application layer / 애플리케이션 레이어                          │
│  • Wallets (MetaMask, Rabby, Phantom-EVM, Korean wallets)        │
│  • dApps that resolve `name.dex` → address                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │ ABI calls
┌──────────────────────────────▼──────────────────────────────────┐
│  Controller layer / 컨트롤러 레이어                              │
│  • DXRegistrarController — commit-reveal, payment, atomic setup  │
│  • DXReverseRegistrar — claim addr.reverse                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │ subnode ops, price quotes
┌──────────────────────────────▼──────────────────────────────────┐
│  Protocol layer / 프로토콜 레이어                                │
│  • DXRegistrar — ERC-721, expiry, label storage                  │
│  • DXResolver  — (node, coinType) records, reverse names         │
│  • DXPriceOracle — attoUSD → wei conversion                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │ registry mutations
┌──────────────────────────────▼──────────────────────────────────┐
│  State layer / 상태 레이어                                       │
│  • DXRegistry — namehash → (owner, resolver, expires)            │
└─────────────────────────────────────────────────────────────────┘
```

Three properties fall out of this layering:

이 계층화에서 세 가지 성질이 도출됩니다.

- **Replaceable controllers.** Owner can whitelist additional controllers
  for promotions, partner integrations, or migration paths without
  touching the registry.
  **컨트롤러 교체 가능.** 오너는 프로모션/파트너/마이그레이션을 위해
  추가 컨트롤러를 화이트리스트할 수 있으며, 레지스트리는 그대로.

- **Replaceable resolvers.** A user can switch their name's resolver to
  a custom one (e.g. a future "text records" resolver) at any time.
  **리졸버 교체 가능.** 사용자는 언제든 자기 이름의 리졸버를 교체 가능
  (예: 미래의 텍스트 레코드 리졸버).

- **Stable state at the bottom.** `DXRegistry` is the smallest, least
  changeable component. Most upgrades happen above it.
  **하단의 안정적 상태.** `DXRegistry`는 가장 작고 변하지 않는 구성요소.
  대부분의 업그레이드는 그 위에서 발생.

---

## 3. Namehash & node tree / namehash와 노드 트리

We use the EIP-137 `namehash` algorithm without modification.

EIP-137 `namehash`를 그대로 사용합니다.

```
namehash("")               = bytes32(0)
namehash("dex")            = keccak256(bytes32(0) || keccak256("dex"))
namehash("alice.dex")      = keccak256(namehash("dex") || keccak256("alice"))
namehash("foo.alice.dex")  = keccak256(namehash("alice.dex") || keccak256("foo"))
```

The registry stores one record per node in this tree. Subnodes only exist
when explicitly created.

레지스트리는 이 트리의 각 노드마다 레코드를 하나씩 저장합니다. 서브노드는
명시적으로 생성될 때만 존재합니다.

### Implementation note / 구현 메모

`DXNamehash.namehash()` performs a right-to-left scan over the input
string. This is more gas-efficient than left-to-right + array reversal
when the labels are short, which is the common case for naming systems.

`DXNamehash.namehash()`는 입력 문자열을 오른쪽에서 왼쪽으로 스캔합니다.
라벨이 짧은 경우(네임 시스템의 일반적 케이스) 좌→우 + 배열 뒤집기보다
가스 효율적입니다.

### EIP-181 reverse parent / EIP-181 역방향 부모

The "reverse parent" is fixed at `namehash("addr.reverse")`. Every address
has a deterministic reverse-node under it:

"역방향 부모"는 `namehash("addr.reverse")`로 고정됩니다. 모든 주소는
그 아래에 결정적 역방향 노드를 가집니다.

```
reverseNode(addr) =
  keccak256(
    namehash("addr.reverse")
    || keccak256(lowercaseHexNoPrefix(addr))
  )
```

`DXNamehash._addressToLowerHexNoPrefix()` is the reference implementation.

---

## 4. Registration flow / 등록 플로우

A first-time registration is the most state-rich operation in the
protocol. Here is the full sequence.

최초 등록은 프로토콜에서 가장 state가 많이 바뀌는 작업입니다. 전체
순서는 다음과 같습니다.

### 4.1 Commit (off-chain pre-step) / 커밋 (사전 단계)

1. The user (or their wallet) generates a random `secret`.
2. Computes `commitment = keccak256(abi.encode(label, owner, secret))`.
3. Calls `DXRegistrarController.commit(commitment)`.

The controller stores `commitments[commitment] = block.timestamp`. The
user must now wait at least `minCommitmentAge` (default 30s) and reveal
within `maxCommitmentAge` (default 1h).

컨트롤러는 commit 시각을 저장. 사용자는 최소 30초 대기 후 1시간 안에 reveal.

**Why commit-reveal?** Otherwise, an MEV bot watching the mempool could
front-run a `register("alice", ...)` transaction with a higher gas price
and steal the name. By splitting registration into two phases and binding
the second phase to a secret the bot doesn't know, this attack becomes
infeasible.

**commit-reveal 이유?** 그렇지 않으면 멤풀을 감시하는 MEV 봇이 더 높은
gas price로 같은 이름을 가로챌 수 있습니다. 등록을 2단계로 분리하고
2단계를 봇이 모르는 secret에 묶음으로써 공격을 비용/타이밍 양면에서
무력화합니다.

### 4.2 Reveal / 공개

The user calls one of:

- `register(label, owner, duration, resolver, secret)` — paid in POL
- `registerWithToken(label, owner, duration, resolver, paymentToken, secret)` — paid in USDT/USDC

Inside `_consumeCommitment(label, owner, secret)` we:

1. Recompute the commitment and look it up.
2. Reject if not found, too new, or too old.
3. Delete it (one-time use).

```solidity
function _consumeCommitment(string calldata label, address owner, bytes32 secret) internal {
  bytes32 commitment = makeCommitment(label, owner, secret);
  uint256 ts = commitments[commitment];
  if (ts == 0) revert CommitmentNotFound(commitment);
  if (ts + minCommitmentAge > block.timestamp) revert CommitmentTooNew(commitment);
  if (ts + maxCommitmentAge <= block.timestamp) revert CommitmentTooOld(commitment);
  delete commitments[commitment];
}
```

### 4.3 Atomic resolver wiring / 리졸버 원자적 설정

This is a non-obvious step that improves UX significantly. ENS leaves
the resolver setup to a separate transaction — meaning a freshly
registered name doesn't resolve until the owner sends a second transaction
to set the address record.

이 단계는 UX를 크게 개선합니다. ENS는 리졸버 설정을 별도 트랜잭션으로
분리하기 때문에, 갓 등록된 이름은 두 번째 트랜잭션 전까지 해결되지
않습니다.

DEXignation registers the controller as the temporary subnode owner,
writes the resolver and the initial Polygon-coin-type address record,
then transfers subnode ownership and the ERC-721 token to the real owner —
all in one transaction.

DEXignation은 컨트롤러를 임시 서브노드 소유자로 등록 → 리졸버와 초기
Polygon coinType 주소 레코드 기록 → 서브노드 소유권과 ERC-721을 실제
소유자에게 이전. 모두 하나의 트랜잭션 안에서 수행.

```solidity
function _executeRegister(...) internal returns (uint256 expires) {
  // 1. Mint NFT to `this`, register subnode with `this` as temp owner.
  expires = registrar.register(label, uint256(labelhash), address(this), duration);

  bytes32 subnode = keccak256(abi.encodePacked(registrar.baseNode(), labelhash));

  // 2. Wire resolver + initial address record.
  registry.setResolver(subnode, resolver);
  IDXResolver(resolver).setAddr(subnode, COIN_TYPE_POLYGON, abi.encodePacked(owner));

  // 3. Hand over subnode ownership.
  registry.setOwner(subnode, owner);

  // 4. Hand over the ERC-721.
  registrar.transferFrom(address(this), owner, uint256(labelhash));
}
```

Result: `alice.dex` resolves correctly the moment the registration
transaction confirms.

결과: 등록 트랜잭션이 컨펌되는 순간부터 `alice.dex`가 즉시 해결됩니다.

---

## 5. Pricing & oracle / 가격과 오라클

### 5.1 attoUSD pricing / attoUSD 가격

All rent prices are stored in **attoUSD** (1 USD = `10^18`).

```solidity
price1Year  =  8e18;   //  $8
price3Year  = 18e18;   // $18
price5Year  = 25e18;   // $25
price10Year = 40e18;   // $40
```

Working in attoUSD eliminates rounding errors when converting to
different decimals tokens (USDT is 6 decimals, USDC is 6 decimals on
Polygon, POL is 18).

attoUSD로 계산하면 토큰별 decimals(USDT 6, USDC 6, POL 18)로 변환할 때
반올림 오차를 방지할 수 있습니다.

### 5.2 Token amount calculation / 토큰 결제 금액 계산

```solidity
function rentPriceInToken(uint256 duration, address token) public view returns (uint256) {
  if (!allowedPaymentTokens[token]) revert TokenNotAllowed(token);
  uint8 d = IERC20Metadata(token).decimals();
  if (d > 18) revert UnsupportedTokenDecimals(d);

  uint256 attoUSD = priceOracle.priceAttoUSD(duration);
  uint256 scaleDown = 10 ** (18 - uint256(d));
  return (attoUSD + scaleDown - 1) / scaleDown;   // ceiling division
}
```

We use **ceiling division** to ensure the user never underpays by 1 wei
due to rounding. The maximum overpayment is therefore <= 1 minimum unit
of the token (i.e. $0.000001 for USDC).

**올림 나눗셈**으로 반올림에 의한 1 wei 부족을 방지합니다. 최대 초과
지불은 토큰의 최소 단위 1개 이하(USDC의 경우 $0.000001).

### 5.3 Dual-path oracle / dual-path 오라클

The `DXPriceOracle` converts attoUSD to wei of POL using one of two paths:

```
┌─────────────────────────────────────────────────────────────────┐
│  Path A: Direct                                                  │
│    wei = attoUSD * 10^d / answer                                 │
│    where answer is from a POL/USD AggregatorV3                   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  Path B: ViaLink                                                 │
│                                                                  │
│        attoUSD * (LINK/POL) * 10^(LINK/USD decimals)             │
│  wei = ──────────────────────────────────────────────            │
│             (LINK/USD) * 10^(LINK/POL decimals)                  │
│                                                                  │
│  Derivation: POL/USD = (LINK/USD) / (LINK/POL)                   │
└─────────────────────────────────────────────────────────────────┘
```

The owner switches paths via `setPriceSource(PriceSource source)`.
Every aggregator read enforces:

오너는 `setPriceSource()`로 경로 전환. 모든 오라클 read는 다음을 강제합니다:

- `answer > 0`
- `block.timestamp - updatedAt < maxOracleDelay` (default 26h)

Why 26h? Chainlink heartbeats vary by feed but the standard mainnet
heartbeat for major pairs is ~24h. We add a 2-hour safety margin.

26시간인 이유? Chainlink heartbeat가 피드마다 다르지만 메이저 페어의
메인넷 표준은 ~24시간. 2시간 안전 여유.

### 5.4 Trade-offs / 트레이드오프

| | Direct path | ViaLink path |
|---|---|---|
| Gas cost | Lower (1 oracle read) | Higher (2 oracle reads) |
| Trust assumptions | One feed | Two feeds, two heartbeats |
| Network coverage | Requires POL/USD feed | Works on any chain with LINK pairs |
| Precision | Highest | Slightly lower due to chained division |

---

## 6. Resolution / 해결(resolution)

DEXignation resolution is two-layered.

### 6.1 Registry → Resolver / 레지스트리 → 리졸버

```solidity
// 1. Find the resolver for a node.
address resolverAddr = registry.resolver(namehash("alice.dex"));

// 2. Ask the resolver for the address.
bytes memory addrBytes = IDXResolver(resolverAddr).addr(node, COIN_TYPE_POLYGON);
address polygonAddr = abi.decode(...);
```

This indirection means a user can swap resolvers without affecting other
parts of the system.

이 우회 구조 덕분에 사용자가 리졸버를 교체해도 다른 부분에는 영향이
없습니다.

### 6.2 ENSIP-9 / ENSIP-11 coin types

The resolver stores raw bytes per `(node, coinType)` pair:

```
coinType 60                  → Ethereum  (SLIP-44)
coinType 0                   → Bitcoin   (SLIP-44)
coinType 0x80000000 | 137    → Polygon   (ENSIP-11)
coinType 0x80000000 | 56     → BNB Chain (ENSIP-11)
coinType 0x80000000          → "any EVM" (ENSIP-11 default)
```

`EVMCoinUtils.isEVMCoinType(coinType)` returns `true` for any value
that fits the ENSIP-11 EVM pattern. When `true`, `setAddr` enforces a
20-byte length on the address bytes; otherwise any length is accepted
(needed for non-EVM chains like Bitcoin with variable-length
scriptPubKeys).

`EVMCoinUtils.isEVMCoinType()`이 `true`이면 `setAddr`가 20바이트
길이를 강제합니다. 아니면 임의 길이 허용(가변 길이 scriptPubKey를 가진
비트코인 등 비EVM 체인 지원).

---

## 7. Reverse resolution / 역방향 해결

The forward record says "alice.dex → 0xABC...". The reverse record
says "0xABC... → alice.dex".

정방향 레코드: "alice.dex → 0xABC...". 역방향 레코드: "0xABC... → alice.dex".

### Claim flow / 클레임 흐름

```
User (0xABC):
  → DXReverseRegistrar.claim(0xABC)
       ↓
       1. label = keccak256("abc...")   (lowercase hex)
       2. registry.setSubnodeOwner(addr.reverse, label, address(this))
       3. registry.setResolver(reverseNode, defaultResolver)
       4. registry.setOwner(reverseNode, 0xABC)
       ↓
       Now 0xABC owns `{0xabc...}.addr.reverse`.

User (0xABC):
  → resolver.setName(reverseNode, "alice.dex")
       ↓
       resolver writes names[reverseNode] = "alice.dex"
```

### Read-time anti-spoof / 읽기 시점 위조 방지

The crucial subtlety: a malicious user can claim a reverse node and set
its name to `"alice.dex"` even if they don't own `alice.dex`. To prevent
wallets from trusting fake reverse records, `DXResolver.name()` performs
a **forward verification** at read time:

악의적 사용자가 자신의 역방향 노드 이름을 `"alice.dex"`로 설정해도 실제
`alice.dex` 소유자가 아닐 수 있습니다. 이를 막기 위해 `DXResolver.name()`은
읽기 시점에 **정방향 검증**을 수행합니다.

```solidity
function name(bytes32 node) public view returns (string memory) {
  if (_isExpired(node)) return "";
  string memory stored = names[node];
  if (bytes(stored).length == 0) return stored;

  bytes32 forwardNode = DXNamehash.namehash(stored);
  address reverseOwner = registry.owner(node);

  // Forward and reverse must agree on the owner.
  // 정방향과 역방향이 같은 소유자에 동의해야 함.
  if (_isExpired(forwardNode) || registry.owner(forwardNode) != reverseOwner) {
    return "";
  }
  return stored;
}
```

If the forward owner differs, we return the empty string — wallets can
treat that as "no verified name".

정방향 소유자가 다르면 빈 문자열 반환. 지갑은 이를 "검증된 이름 없음"으로
처리합니다.

---

## 8. NFT & metadata / NFT와 메타데이터

Each name is an ERC-721 token with `tokenId = uint256(keccak256(label))`.

각 이름은 `tokenId = uint256(keccak256(label))`인 ERC-721 토큰입니다.

### Fully on-chain `tokenURI` / 완전 온체인 `tokenURI`

```solidity
function tokenURI(uint256 tokenId) public view override returns (string memory) {
  _requireOwned(tokenId);
  string memory label = names[tokenId];
  if (bytes(label).length == 0) label = "?";
  string memory dotTld = string.concat(".", baseNodeName);
  string memory svg = _generateSVG(label, dotTld);
  string memory json = string.concat(
    '{"name":"', label, dotTld, '",',
    '"description":"DEXignation Name: ', label, dotTld, '",',
    '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)), '"}'
  );
  return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
}
```

This produces a `data:` URI containing Base64-encoded JSON, whose
`image` field is a Base64-encoded SVG. **No IPFS, no external server,
no rug-pull-by-CDN.** As long as the contract exists, the artwork
exists.

`data:` URI에 Base64로 인코딩된 JSON. JSON의 `image` 필드는 Base64
인코딩 SVG. **IPFS도 외부 서버도 없습니다.** 컨트랙트가 살아있는 한
아트워크도 살아있습니다.

### Why store the original label? / 원본 라벨을 저장하는 이유?

ENS does not store the original label — only its labelhash. This is
ENS-side gas-saving but means the canonical character form of a name is
not recoverable from the contract.

ENS는 labelhash만 저장하고 원본 라벨은 저장하지 않습니다. ENS 측 가스
절감이지만, 이름의 원본 문자열을 컨트랙트에서 복원할 수 없습니다.

DEXignation stores the label so:
- `tokenURI` can render the actual text.
- Future on-chain features (subdomain listing, etc.) can use the label.

DEXignation은 라벨을 저장합니다:
- `tokenURI`가 실제 텍스트를 렌더할 수 있도록.
- 향후 온체인 기능(서브도메인 목록 등)이 라벨을 사용할 수 있도록.

Gas overhead: ~1 SSTORE per registration. For a one-time operation this
is acceptable.

가스 오버헤드: 등록당 SSTORE 1회. 일회성 작업이므로 수용 가능.

---

## 9. Security model / 보안 모델

### 9.1 Threat model / 위협 모델

| Threat | Mitigation |
|---|---|
| Front-running of registration | Commit-reveal pattern |
| Re-entrancy on payment / refund | `ReentrancyGuard` on all controller entry points |
| Non-standard ERC-20 (USDT mainnet) | `SafeERC20` everywhere |
| Stale oracle prices | `maxOracleDelay` enforced on every read |
| Negative or zero oracle answer | `answer > 0` enforced |
| Token decimals > 18 | Explicit rejection in `rentPriceInToken` |
| Reverse-name spoofing | Forward verification at read time |
| Token / registry ownership drift | `reclaim()` re-syncs |
| Expired name still usable | `authorised` / `ownerOf` revert on expiry |

### 9.2 Privileged roles / 권한 있는 역할

- **Registrar owner** — adds/removes controllers, sets the TLD resolver.
- **Controller owner** — sets allowed payment tokens, commitment-age
  parameters, performs withdrawals, registers inventory names.
- **Price-oracle owner** — sets aggregator addresses, switches paths,
  sets staleness threshold.

These are likely the same multi-sig in practice, but the separation lets
DEXignation rotate the controller without disturbing the registrar.

이 세 역할은 실제로는 같은 multi-sig일 가능성이 높지만, 분리되어 있어
컨트롤러만 교체해도 Registrar는 영향을 받지 않습니다.

### 9.3 Out of scope / 범위 외

- **Wallet UX choices.** A wallet showing an unverified reverse name as
  if verified is a wallet bug, not a protocol bug.
  지갑이 미검증 역방향 이름을 검증된 것처럼 표시하는 것은 지갑 버그.
- **Off-chain DNS-style hijacking.** DEXignation does not interact with
  DNS at all.
- **Endpoints outside this repo.** Front-end, indexer, and SDKs have
  their own threat models.

---

## 10. ENS comparison matrix / ENS 비교 매트릭스

| Aspect | ENS | DEXignation |
|---|---|---|
| TLD | `.eth` | `.dex` |
| Network | Ethereum L1 | Polygon |
| Pricing model | Per-second + premium decay | Fixed tier (1/3/5/10y) |
| Payment | ETH only | POL + USDT + USDC |
| Price denomination | USD via Chainlink | attoUSD via Chainlink (Direct or ViaLink) |
| Registration | Commit-reveal | Commit-reveal |
| Resolver model | Multi-profile inheritance | Slim single resolver |
| Initial address record | Separate transaction | Set atomically at registration |
| NFT metadata | Off-chain service | Fully on-chain SVG |
| Label storage | Hash only | Hash + original string |
| Coin-type encoding | ENSIP-9 / ENSIP-11 | ENSIP-9 / ENSIP-11 (compatible) |
| Reverse resolution | Yes | Yes |
| Subdomains | Yes (by name owner) | Future work |
| Text records | Yes | Future work |
| Off-chain resolution | CCIP-Read | Future work |
| Audit | Multiple | Pending |

---

## Further reading / 더 읽을거리

- [`README.md`](../README.md) — Project overview
- [`THIRD-PARTY-LICENSES.md`](../THIRD-PARTY-LICENSES.md) — Attribution
- [`SECURITY.md`](../SECURITY.md) — Security policy
- Medium series — `docs/medium/`
- [ENS docs](https://docs.ens.domains) — Upstream reference
- [EIP-137](https://eips.ethereum.org/EIPS/eip-137) — Domain name standard
- [EIP-181](https://eips.ethereum.org/EIPS/eip-181) — Reverse resolution
- [ENSIP-9](https://docs.ens.domains/ensip/9) — `multicoinAddress`
- [ENSIP-11](https://docs.ens.domains/ensip/11) — EVM chain coin types
