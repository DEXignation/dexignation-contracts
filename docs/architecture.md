# DEXignation Architecture
This document is a deep-dive into the DEXignation smart-contract layer.
It complements the high-level README with implementation detail, design
rationale, and the trade-offs we made relative to the ENS reference.

---
## Table of contents
1. [Design principles](#design-principles)
2. [Layered architecture](#layered-architecture)
3. [Namehash & node tree](#namehash-node-tree)
4. [Registration flow](#registration-flow)
5. [Pricing & oracle](#pricing-oracle)
6. [Resolution](#resolution)
7. [Reverse resolution](#reverse-resolution)
8. [NFT & metadata](#nft-metadata)
9. [Security model](#security-model)
10. [ENS comparison matrix](#ens-comparison-matrix)
---
## 1. Design principles
DEXignation is guided by four principles, in priority order.

1. **Standards-first.** Wherever a recognised standard exists (EIP-137,
   EIP-181, ENSIP-9, ENSIP-11, ERC-721, ERC-20), we follow it. This
   maximises wallet interoperability.

2. **User self-custody.** A `.dex` name is an ERC-721 NFT held by the user.
   No "leasing" model, no platform-managed escrow.

3. **Polygon-native economics.** Stablecoin payment is first-class; native
   POL is an alternative, not the only path.

4. **Operational portability.** The protocol must work on Polygon Mainnet
   *and* on networks where direct USD price feeds are unavailable. Hence
   the dual-path oracle.

---
## 2. Layered architecture
```
┌─────────────────────────────────────────────────────────────────┐
│  Application layer                                               │
│  • Wallets (MetaMask, Rabby, Phantom-EVM, Korean wallets)        │
│  • dApps that resolve `name.dex` → address                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │ ABI calls
┌──────────────────────────────▼──────────────────────────────────┐
│  Controller layer                                                │
│  • DXRegistrarController — commit-reveal, payment, atomic setup  │
│  • DXReverseRegistrar — claim addr.reverse                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │ subnode ops, price quotes
┌──────────────────────────────▼──────────────────────────────────┐
│  Protocol layer                                                  │
│  • DXRegistrar — ERC-721, expiry, label storage                  │
│  • DXResolver  — (node, coinType) records, reverse names         │
│  • DXPriceOracle — attoUSD → wei conversion                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │ registry mutations
┌──────────────────────────────▼──────────────────────────────────┐
│  State layer                                                     │
│  • DXRegistry — namehash → (owner, resolver, expires)            │
└─────────────────────────────────────────────────────────────────┘
```
Three properties fall out of this layering:

- **Replaceable controllers.** Owner can whitelist additional controllers
  for promotions, partner integrations, or migration paths without
  touching the registry.

- **Replaceable resolvers.** A user can switch their name's resolver to
  a custom one (e.g. a future "text records" resolver) at any time.

- **Stable state at the bottom.** `DXRegistry` is the smallest, least
  changeable component. Most upgrades happen above it.

---
## 3. Namehash & node tree
We use the EIP-137 `namehash` algorithm without modification.

EIP-137 `namehash`

```
namehash("")               = bytes32(0)
namehash("dex")            = keccak256(bytes32(0) || keccak256("dex"))
namehash("alice.dex")      = keccak256(namehash("dex") || keccak256("alice"))
namehash("foo.alice.dex")  = keccak256(namehash("alice.dex") || keccak256("foo"))
```
The registry stores one record per node in this tree. Subnodes only exist
when explicitly created.

### Implementation note
`DXNamehash.namehash()` performs a right-to-left scan over the input
string. This is more gas-efficient than left-to-right + array reversal
when the labels are short, which is the common case for naming systems.

### EIP-181 reverse parent
The "reverse parent" is fixed at `namehash("addr.reverse")`. Every address
has a deterministic reverse-node under it:

```
reverseNode(addr) =
  keccak256(
    namehash("addr.reverse")
    || keccak256(lowercaseHexNoPrefix(addr))
  )
```
`DXNamehash._addressToLowerHexNoPrefix()` is the reference implementation.

---
## 4. Registration flow
A first-time registration is the most state-rich operation in the
protocol. Here is the full sequence.

### 4.1 Commit (off-chain pre-step)
1. The user (or their wallet) generates a random `secret`.
2. Computes `commitment = keccak256(abi.encode(label, owner, secret))`.
3. Calls `DXRegistrarController.commit(commitment)`.

The controller stores `commitments[commitment] = block.timestamp`. The
user must now wait at least `minCommitmentAge` (default 30s) and reveal
within `maxCommitmentAge` (default 1h).

**Why commit-reveal?** Otherwise, an MEV bot watching the mempool could
front-run a `register("alice", ...)` transaction with a higher gas price
and steal the name. By splitting registration into two phases and binding
the second phase to a secret the bot doesn't know, this attack becomes
infeasible.

### 4.2 Reveal
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
### 4.3 Atomic resolver wiring
This is a non-obvious step that improves UX significantly. ENS leaves
the resolver setup to a separate transaction — meaning a freshly
registered name doesn't resolve until the owner sends a second transaction
to set the address record.

DEXignation registers the controller as the temporary subnode owner,
writes the resolver and the initial Polygon-coin-type address record,
then transfers subnode ownership and the ERC-721 token to the real owner —
all in one transaction.

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

---
## 5. Pricing & oracle
### 5.1 attoUSD pricing
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

attoUSD

### 5.2 Token amount calculation
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

### 5.3 Dual-path oracle
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

- `answer > 0`
- `block.timestamp - updatedAt < maxOracleDelay` (default 26h)

Why 26h? Chainlink heartbeats vary by feed but the standard mainnet
heartbeat for major pairs is ~24h. We add a 2-hour safety margin.

### 5.4 Trade-offs
| | Direct path | ViaLink path |
|---|---|---|
| Gas cost | Lower (1 oracle read) | Higher (2 oracle reads) |
| Trust assumptions | One feed | Two feeds, two heartbeats |
| Network coverage | Requires POL/USD feed | Works on any chain with LINK pairs |
| Precision | Highest | Slightly lower due to chained division |
---
## 6. Resolution
DEXignation resolution is two-layered.

### 6.1 Registry → Resolver
```solidity
// 1. Find the resolver for a node.
address resolverAddr = registry.resolver(namehash("alice.dex"));

// 2. Ask the resolver for the address.
bytes memory addrBytes = IDXResolver(resolverAddr).addr(node, COIN_TYPE_POLYGON);
address polygonAddr = abi.decode(...);
```
This indirection means a user can swap resolvers without affecting other
parts of the system.

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

`EVMCoinUtils.isEVMCoinType()`

### 6.3 Text records (EIP-634)
`DXResolver` implements EIP-634 text records — free-form
key/value strings per `(node, key)` pair. Wallets and dApps
use these for profile metadata: `avatar`, `url`, `email`,
`description`, namespaced verifications like `com.twitter`
and `com.github`.

`DXResolver`
`com.github`

```solidity
function text(bytes32 node, string calldata key) external view returns (string memory);
function setText(bytes32 node, string calldata key, string calldata value) external;
```
Length bounds are enforced to prevent storage DoS:

| Field | Maximum |
|---|---|
| Key length | 64 bytes |
| Value length | 1024 bytes |
The `TextChanged` event emits the key twice — once as
indexed (allowing topic-based filtering at the hashed key
level) and once as a non-indexed string (preserving the
original text for indexers reading event data). This is
the standard ENS pattern.

Empty value writes clear the record (`delete texts[node][key]`).
Reads against expired nodes return the empty string rather
than reverting — matches ENS behaviour.

### 6.4 Contenthash (EIP-1577)
`DXResolver` implements EIP-1577 contenthash — raw bytes per
node, with a multicodec prefix identifying the target
protocol. This lets `.dex` domains host decentralized
websites that IPFS-aware browsers (Brave, Opera, Chromium
with extensions) can resolve directly.

`DXResolver`
raw

```solidity
function contenthash(bytes32 node) external view returns (bytes memory);
function setContenthash(bytes32 node, bytes calldata hash) external;
```
The bytes are stored as provided. The contract does *not*
validate the multicodec format on-chain — frontends parse
the prefix and dispatch to the appropriate handler. This
matches ENS and avoids hard-coding a protocol allowlist.

Common encodings:

| Codec prefix | Protocol |
|---|---|
| `0xe301...` | IPFS (CIDv1) |
| `0xe5...` | IPNS |
| `0xe4...` | Swarm |
| `0x90...` | Arweave |
Length bound: 128 bytes (the longest existing protocol
encoding fits in 64; 128 gives generous headroom).

### 6.5 ERC-165 supportsInterface
`DXResolver.supportsInterface(bytes4)` reports support for
five standard interface IDs, letting ENS-compatible tooling
(wallet libraries, indexers, the official ENS app) detect
which resolver profiles are implemented without trial and
error.

| Interface ID | Standard | Profile |
|---|---|---|
| `0x01ffc9a7` | ERC-165 | self-identification |
| `0xf1cb7e06` | ENSIP-9 | multi-coin `addr(node, coinType)` |
| `0x59d1d43c` | EIP-634 | `text(node, key)` |
| `0xbc1c58d1` | EIP-1577 | `contenthash(node)` |
| `0x691f3431` | ENS spec | `name(node)` reverse |
The practical consequence: every wallet and dApp that
already integrates with ENS resolvers can read `.dex`
records through their existing code path, because the
function signatures and event signatures are byte-identical.

---
## 7. Reverse resolution
The forward record says "alice.dex → 0xABC...". The reverse record
says "0xABC... → alice.dex".

### Claim flow
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
### Read-time anti-spoof
The crucial subtlety: a malicious user can claim a reverse node and set
its name to `"alice.dex"` even if they don't own `alice.dex`. To prevent
wallets from trusting fake reverse records, `DXResolver.name()` performs
a **forward verification** at read time:

```solidity
function name(bytes32 node) public view returns (string memory) {
  if (_isExpired(node)) return "";
  string memory stored = names[node];
  if (bytes(stored).length == 0) return stored;

  bytes32 forwardNode = DXNamehash.namehash(stored);
  address reverseOwner = registry.owner(node);

  // Forward and reverse must agree on the owner.
  if (_isExpired(forwardNode) || registry.owner(forwardNode) != reverseOwner) {
    return "";
  }
  return stored;
}
```
If the forward owner differs, we return the empty string — wallets can
treat that as "no verified name".

---
## 8. NFT & metadata
Each name is an ERC-721 token with `tokenId = uint256(keccak256(label))`.

### Fully on-chain `tokenURI`
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

### Why store the original label?
ENS does not store the original label — only its labelhash. This is
ENS-side gas-saving but means the canonical character form of a name is
not recoverable from the contract.

DEXignation stores the label so:
- `tokenURI` can render the actual text.
- Future on-chain features (subdomain listing, etc.) can use the label.

Gas overhead: ~1 SSTORE per registration. For a one-time operation this
is acceptable.

---
## 9. Security model
### 9.1 Threat model
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
### 9.2 Privileged roles
- **Registrar owner** — adds/removes controllers, sets the TLD resolver.
- **Controller owner** — sets allowed payment tokens, commitment-age
  parameters, performs withdrawals, registers inventory names.
- **Price-oracle owner** — sets aggregator addresses, switches paths,
  sets staleness threshold.

These are likely the same multi-sig in practice, but the separation lets
DEXignation rotate the controller without disturbing the registrar.

### 9.3 Out of scope
- **Wallet UX choices.** A wallet showing an unverified reverse name as
  if verified is a wallet bug, not a protocol bug.
- **Off-chain DNS-style hijacking.** DEXignation does not interact with
  DNS at all.
- **Endpoints outside this repo.** Front-end, indexer, and SDKs have
  their own threat models.

---
## 10. ENS comparison matrix
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
| Text records (EIP-634) | Yes | Yes (compatible signatures) |
| Contenthash (EIP-1577) | Yes | Yes (compatible signatures) |
| ERC-165 supportsInterface | Yes | Yes (5 interface IDs reported) |
| Voluntary burn after grace | No (lingers) | Yes (permissionless) |
| Subdomains | Yes (by name owner) | Future work (v1.1) |
| Off-chain resolution | CCIP-Read | Future work |
| Audit | Multiple | Pending |
---
## Further reading
- [`README.md`](../README.md) — Project overview
- [`THIRD-PARTY-LICENSES.md`](../THIRD-PARTY-LICENSES.md) — Attribution
- [`SECURITY.md`](../SECURITY.md) — Security policy
- Medium series — `docs/medium/`
- [ENS docs](https://docs.ens.domains) — Upstream reference
- [EIP-137](https://eips.ethereum.org/EIPS/eip-137) — Domain name standard
- [EIP-181](https://eips.ethereum.org/EIPS/eip-181) — Reverse resolution
- [EIP-634](https://eips.ethereum.org/EIPS/eip-634) — Text records
- [EIP-1577](https://eips.ethereum.org/EIPS/eip-1577) — Contenthash
- [ERC-165](https://eips.ethereum.org/EIPS/eip-165) — Standard interface detection
- [ENSIP-9](https://docs.ens.domains/ensip/9) — `multicoinAddress`
- [ENSIP-11](https://docs.ens.domains/ensip/11) — EVM chain coin types
