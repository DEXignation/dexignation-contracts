# Architecture Decision Records
This document captures the key architectural decisions made during the
design of DEXignation v1, and the reasoning behind each one. It exists
so that the original author, future contributors, security auditors, and
investors can quickly understand **why** the codebase looks the way it
does — not just **what** it does.

Each record describes the context that prompted the decision, the
decision itself, and the consequences (both intended and accepted).

---
## ADR-001: Pure SaaS architecture — no governance token in v1
**Status:** Accepted (May 2026)

### Context
The initial design included a full token-economy stack:
- `DXNToken` — ERC20Votes governance token with hard cap (197 lines)
- `DXNStaking` — multi-asset reward staking (386 lines, hardened after audit)
- `RevenueDistributor` — protocol revenue splitter with atomic notify (203 lines)

This is the canonical web3 "full-stack" pattern: domain service + governance
token + staking + revenue share. ENS, Uniswap, and most major protocols
end up here eventually.

However, on review, none of this was actually needed at launch:

1. **Tokenomics undecided.** Issuing a token requires deciding total supply,
   distribution schedule, vesting cliffs, mint authority transitions,
   inflation policy, and more. None of these had been finalised.

2. **Legal uncertainty in Korea.** Issuing a transferable token would
   trigger review under the Virtual Asset User Protection Act and
   potentially the Capital Markets Act (if revenue-share could be argued
   to make it a security). Both are ongoing regulatory areas; getting
   them wrong is expensive.

3. **ENS precedent.** ENS ran as a pure registrar from 2017 to 2021 (four
   years) before issuing the ENS governance token. The domain service
   stood on its own merits.

4. **Premature optimisation risk.** Code written today for "if we ever
   launch a token" is likely to be wrong by the time that decision is
   actually made, because tokenomics designs, regulatory environment, and
   audit best practices all evolve.

### Decision
Remove all token-economy contracts from v1. Ship pure SaaS:
- User pays for domain registration in USDC/USDT/POL
- Owner withdraws revenue via `withdrawToken()` / `withdraw()`
- 100% of revenue accrues to owner (or owner's multisig)

### Consequences
**Accepted:**

- Minimal audit surface (17 contracts, 3,071 lines)
- Minimal legal surface (no token issuance = essentially no Korean
  crypto-specific regulation applies)
- Simple operations (no token holders to communicate with, no token
  price to watch, no governance proposals to facilitate)
- Future token launch requires writing new contracts from scratch
  (1–2 days of work, plus audit)

**Preserved hooks:**

The controller is designed so that a future token can be plugged in
without modifying or redeploying it:
- `setDiscountToken(token, threshold, bps)` — any ERC-20 can become a
  holder-discount target (a future DXN, MOL on Polygon, or anything else)
- `setAllowedPaymentToken(token, true)` — any ERC-20 can be added as a
  payment option

These are not "future token economy hooks" — they are general-purpose
ERC-20 integration points that happen to also serve a future token if
one is ever launched.

### References
- ENS DAO launch (Nov 2021): https://docs.ens.domains/dao
- ENS Labs employee count (LinkedIn, 2026): 19 employees

---
## ADR-002: Contributor incentives via .dex domain NFTs, not a separate token
**Status:** Accepted (May 2026)

### Context
The project needs a way to reward contributors (developers, designers,
translators, community moderators). Several models were considered:

1. **ERC-20 contributor token.** Issue a new token, give X amount to each
   contributor. They can sell on a DEX.

2. **Soulbound NFT (SBT).** Non-transferable badge attesting to
   contribution. Recognition only, no monetisation.

3. **Funded .dex registration.** Owner sends USDT to contributor;
   contributor registers .dex domains in their own name and can hold,
   use, or sell them.

The author initially built option 2 (`DXContributionSBT.sol`, 181 lines).
On reflection, the actual intent was closer to option 3: contributors
should be able to monetise the reward, because the reward is meant to
supplement salary, not just to recognise effort.

### Decision
Use option 3. Remove `DXContributionSBT` entirely. Contributors are
rewarded by:

1. Owner sends contributor USDT (typically ~$250) + a small POL allowance
   for gas (~10 POL)
2. Contributor uses dexignation.com to register .dex domains in their
   own name (commit-reveal flow, standard `register()` call)
3. USDT flows: contributor → controller → back to owner via
   `withdrawToken()`. Net cost to owner is gas only (~$5)
4. Contributor freely holds, uses as wallet alias, or sells on
   OpenSea/Magic Eden

1. Owner
2.
3. USDT

### Consequences
**Benefits:**

- No additional contract to maintain or audit
- No new token = no new regulatory surface
- `.dex` NFT is already a real, useful digital good (resolves to wallets,
  serves as identity, has marketplace value)
- Contributor receives real value at minimal cost to owner
- Active use of .dex domains by contributors creates organic marketing

**Trade-offs:**

- Reward value depends on which labels contributor chooses (good labels
  fetch higher prices; mediocre labels less so)
- Contributor must execute 30 registration transactions (mitigated by
  spreading over 6 days, 5 per day)
- No "permanent on-chain recognition" record (this was the SBT's role,
  but it turned out not to be what the author wanted)

### References
- DXContributionSBT.sol (removed in this commit) — preserved in git history
  if recognition-style attestation is ever needed again

---
## ADR-003: Generic `setDiscountToken` instead of partner-specific `setMolDiscount`
**Status:** Accepted (May 2026)

### Context
The initial discount API was named after a specific partner project:

```solidity
function setMolDiscount(address _molToken, uint256 _threshold, uint256 _bps);
```
This bound the API to MOL ([MolePin](https://molepin.com)), a specific
ERC-20 the author already operates on BSC. The discount logic itself,
however, is just "holder of token X with balance ≥ Y gets Z% off" —
nothing about it requires the token to be MOL.

Naming a generic mechanism after a specific instance is a maintenance
trap: in a year, if the partner changes (or a second one is added),
either the name lies or the API has to be split.

### Decision
Rename to generic terms:

| Before (MOL-specific) | After (generic) |
|---|---|
| `setMolDiscount(_molToken, _threshold, _discountBps)` | `setDiscountToken(_discountToken, _requiredHoldAmount, _discountBps)` |
| `molToken` | `discountToken` |
| `molThreshold` | `requiredHoldAmount` |
| `molDiscountBps` | `discountBps` |
| `MAX_MOL_DISCOUNT_BPS` | `MAX_DISCOUNT_BPS` |
| `isMolEligible()` | `isDiscountEligible()` |
| `_applyMolDiscount()` | `_applyDiscount()` |
| `MolDiscountSet` event | `DiscountConfigured` event |
| `MolDiscountTooHigh` error | `DiscountRateTooHigh` error |
Also added a new setter constraint: `requiredHoldAmount > 0` is enforced
when enabling the discount (i.e. when `_discountToken != address(0)`).
A zero threshold would grant the discount to every wallet (`balanceOf >= 0`
is always true), which is almost certainly a misconfiguration.

### Consequences
- Owner can point the discount at MOL, a future DXN, a partner DAO token,
  a community treasury token — anything ERC-20-compatible — without
  needing a code change
- The setter is the only function ever called when changing policy;
  no separate "deactivate MOL, activate DXN" dance needed
- Bilingual documentation reflects the generic intent

---
## ADR-004: Strict ASCII-lowercase label policy at launch
**Status:** Accepted (May 2026)

### Context
The initial `isValidLabel(label)` check was minimal: any UTF-8 string
of 3+ characters was accepted. This meant `roy.dex`, `Roy.dex`, `R oy.dex`,
and the homoglyph attack `гoy.dex` (with Cyrillic 'г') would all be
treated as distinct domains, opening up:

- **Phishing via homoglyphs.** A user expecting `metamask.dex` could be
  fooled into trusting `metаmask.dex` (Cyrillic 'а').
- **Case-confusion.** `Apple.dex` vs `apple.dex` look identical in many
  fonts but namehash differently.
- **Whitespace and invisible chars.** Zero-width joiners, RTL marks, etc.
- **JSON/SVG injection.** Labels go into `tokenURI` JSON and SVG output;
  unrestricted characters could break metadata or marketplace rendering.

### Decision
Add a strict ASCII-lowercase validator (`StringUtils.isValidAsciiLabel`)
and use it in `isValidLabel`:

```
Allowed: a-z, 0-9, hyphen
Disallowed: uppercase, non-ASCII, whitespace, leading/trailing hyphen,
            consecutive hyphens
Minimum length: 3 codepoints (already enforced)
```
This is the **launch policy**, not the permanent policy. The plan is:

1. **Launch (now):** ASCII lowercase only. Phishing-safe by construction.
2. **Phase 2 (later):** Add `isValidUnicodeLabel` using UTS-46 / ENSIP-15
   normalisation when the framework and audit budget are in place.
3. **Phase 3 (eventual):** Separate policy module(s) for Korean Hangul,
   Japanese, Arabic, etc. with explicit script-mixing rules.

1.
2. 2

### Consequences
**Benefits:**

- Zero phishing risk via Unicode tricks at launch
- tokenURI JSON/SVG injection becomes impossible by construction
  (no `"`, `\`, `<`, `>`, `&` can ever appear in a label)
- Simpler initial UX (clear rules, easy to communicate)
- Smaller initial audit surface for normalisation logic

**Trade-offs:**

- Korean users cannot register Hangul labels (e.g. `홍길동.dex`) at
  launch. This is the right trade-off for v1: phishing resistance >
  internationalisation. Hangul support is planned for Phase 2/3 with
  proper Korean-script normalisation.
- Some users may expect Unicode support and need education about why
  it's restricted initially.

### References
- ENSIP-15 (Name Normalization): https://docs.ens.domains/ensip/15
- UTS-46 (Unicode IDNA Compatibility Processing):
  https://www.unicode.org/reports/tr46/
- Punycode (RFC 3492): https://datatracker.ietf.org/doc/html/rfc3492

---
## ADR-005: Commitment binds resolver, duration, and payment token (MEV-resistant)
**Status:** Accepted (May 2026)

### Context
The original commit-reveal scheme hashed only `(name, owner, secret)`:

```solidity
keccak256(abi.encode(name, owner, secret))
```
This is the canonical ENS pattern, but it leaves the resolver, duration,
and payment token unbound. An MEV bot observing the reveal transaction
could front-run with the same `(name, owner, secret)` triple but a
different resolver — directing the new domain's initial address record
to an attacker-controlled resolver while still delivering the NFT to the
intended owner.

resolver, duration, payment token
reveal

The user might never notice because the NFT itself is correct; only the
address that `name.dex` resolves to is wrong. The attacker could then
intercept any payment sent to the new domain.

### Decision
Add a "full-binding" commitment hash that includes ALL register-time
parameters:

```solidity
function makeCommitmentFull(
  string calldata label,
  address owner,
  uint256 duration,
  address resolver,
  address paymentToken,  // address(0) for native
  bytes32 secret
) public pure returns (bytes32);
```
`register()` and `registerWithToken()` now consume this strict
commitment. The legacy 3-arg `makeCommitment` is preserved for ABI
compatibility but no longer accepted at register time.

`(label, owner, duration, resolver, paymentToken, secret)`
"full-binding" commitment

### Consequences
- MEV resolver-swap attack is impossible (commitment binding forces
  reveal-time parameters to match commit-time parameters exactly)
- Clients must use `makeCommitmentFull` from now on; legacy clients
  using the 3-arg form will fail at reveal with `CommitmentNotFound`
- Slightly larger commitment hash inputs (6 fields vs 3), negligible
  gas cost

### References
- ENS commit-reveal scheme (the basis for this design):
  https://docs.ens.domains/contract-api-reference/.eth-permanent-registrar/controller
- MEV resolver-swap discussion: this is a known weakness of the basic
  ENS pattern that several alternative name services have addressed
  similarly

---
## ADR-006: DXNStaking (REMOVED) had multi-asset reward accounting
**Status:** Superseded by ADR-001 (May 2026)

### Context
Prior to ADR-001, the project included `DXNStaking.sol` (386 lines after
hardening). This record exists to preserve the rationale of that
contract in case a future token launch revives the staking model, so
that the design can be evaluated rather than re-derived from scratch.

### Key design properties (for future reference)
The deleted DXNStaking had these properties; if a future version is
written, these are the constraints that proved necessary:

1. **Multi-asset rewards.** Stakers earn rewards in multiple ERC-20s
   (USDC, USDT, possibly POL via WPOL). A single-asset staking model
   couldn't accommodate the natural revenue mix from domain registrations.

2. **Synthetix-style accumulator per asset.** `accRewardPerShare[token]`
   tracks accumulated reward per staked unit, allowing O(1) per-staker
   reward computation.

3. **Settle-on-mutation rule.** Any change to a staker's balance
   (`stake`, `unstake`, `claim`) must first settle pending rewards for
   ALL registered reward assets. Skipping this causes the "history-theft"
   bug: a new staker can claim rewards that accrued before they joined.

4. **Balance-delta verification in `notifyReward`.** The notifier's
   claimed `amount` is treated as a hint; the actual reward credited is
   `min(amount, deltaBalance)`. This caps over-reporting (inflation
   attack) at zero and silently caps under-reporting too.

5. **Reward-asset whitelist.** Notifying for an unregistered asset
   reverts. Adding a new reward asset is append-only (removal would
   break debt accounting).

6. **Carry-over for empty stake.** Rewards arriving while
   `totalStaked == 0` are held in `_carriedOver[token]` and credited
   to the first non-zero notify. Without this, early rewards are stuck
   forever.

7. **Cap on reward assets.** `MAX_REWARD_ASSETS = 16`. Each
   stake/unstake iterates this list, so unbounded growth would brick
   the contract via out-of-gas.

### Why removed
See ADR-001. The staking model is only useful if there's a token to
stake; until a token exists, staking is dead code. Once a token launch
is approved, this contract (or its successor) can be re-derived from
this record plus git history.

---
## ADR-007: RevenueDistributor (REMOVED) atomic notify pattern
**Status:** Superseded by ADR-001 (May 2026)

### Context
The deleted `RevenueDistributor.sol` (203 lines) split protocol revenue
into four destinations (treasury / staking / burn / buffer) and
atomically called `staking.notifyReward()` after transferring the
staking share.

`staking.notifyReward()`

### Key design properties (for future reference)
1. **Atomic notify after transfer.** Splitting transfer and notify into
   separate transactions opens a window where the staking contract holds
   tokens that aren't credited to anyone. An atomic call closes that
   window.

2. **Refuse to notify unregistered assets.** If a token is sent to
   distribution but the staking contract hasn't whitelisted it,
   `distributeToken` reverts rather than silently leaking tokens.

3. **Separate native-staking proxy.** Native (POL) revenue cannot be
   sent to a pure ERC-20 staking contract (which lacks `receive()`).
   The distributor routes the native staking share to a configurable
   `nativeStakingProxy` (typically treasury or a WPOL wrap-and-notify
   helper) instead.

4. **Hard 10000-bps total check.** The setter enforces
   `treasuryBps + stakingBps + burnBps + bufferBps == 10000`, preventing
   accidental misconfiguration that would silently leak or duplicate funds.

5. **Per-destination zero-check.** Each non-zero bps destination must
   have a non-zero address, preventing accidental sends to address(0).

### Why removed
See ADR-001. Revenue distribution is only meaningful if there's a token
holder community to distribute to. Until then, the owner takes 100% via
`withdrawToken()`, which is simpler and matches the legal model of a
pure SaaS.

---
## ADR-008: Owner-direct withdraw, no programmatic routing
**Status:** Accepted (May 2026)

### Context
The earlier controller had:

```solidity
function withdraw() public override onlyOwner nonReentrant {
    address dest = address(revenueDistributor) == address(0)
        ? owner()
        : address(revenueDistributor);
    _sendNative(dest, address(this).balance);
}
```
This routed funds to a `RevenueDistributor` if one was configured,
falling back to the owner otherwise. With ADR-001 removing the
distributor, this routing is dead weight.

### Decision
Simplify to owner-direct withdraw:

```solidity
function withdraw() public override onlyOwner nonReentrant {
    _sendNative(owner(), address(this).balance);
}
function withdrawToken(address token) public override onlyOwner nonReentrant {
    IERC20(token).safeTransfer(owner(), IERC20(token).balanceOf(address(this)));
}
```
If a distributor is ever introduced later, the owner can either:
1. Withdraw to themselves, then forward to the distributor (manual), or
2. Add `transferOwnership(distributor)` so the distributor IS the owner, or
3. Add a new routing function to the controller in a v2 deployment

### Consequences
- Simpler `withdraw()` — fewer storage reads, less branching
- Clearer intent: revenue belongs to the owner in v1
- `recoverFunds()` is preserved for tokens accidentally sent to the
  contract that should go to a specific recipient (not the owner)

---
## ADR-009: Soulbound vs transferable for contributor recognition
**Status:** Considered, both rejected (May 2026)

### Context
Two intermediate designs were considered for contributor rewards before
landing on ADR-002 (fund USDT, contributor registers .dex):

**Design A: Soulbound NFT (DXContributionSBT, 181 lines)**

- ERC-721 with `_update` override that reverts on non-mint/burn transfers
- Owner-only `award(contributor, category, description)`
- Owner-only `revoke(tokenId)` for revocation
- On-chain SVG metadata, no IPFS dependency
- Rationale: recognition without monetisation = no securities risk

**Design B: Transferable ERC-721 contributor edition**

- Standard ERC-721 with EIP-2981 royalty
- Owner mints to contributor; contributor can sell on marketplaces
- Rationale: real monetisable reward

### Why both rejected
**Design A (Soulbound) rejected because:**
- The author's actual intent was for rewards to be monetisable
  (supplement to salary, not just attaboy)
- A non-monetisable reward isn't really an incentive

**Design B (Transferable contributor NFT) rejected because:**
- Adds a second NFT contract with no functional purpose distinct from
  `.dex` NFTs themselves
- `.dex` NFTs are already transferable, have marketplace presence, and
  carry actual utility (wallet resolution)
- Issuing 900 new NFTs (30 contributors × 30 each) with no use case
  beyond resale is closer to a token-distribution event than a
  recognition program — exactly the legal complexity we were avoiding

**Settled on ADR-002** because `.dex` NFTs already do everything a
transferable contributor NFT would do, with the added benefits of
(a) real utility and (b) no second contract to maintain.

### References
- DXContributionSBT.sol (Design A) — removed, preserved in git history
- Design B was discussed but never implemented

---
## ADR-010: Defensive balance-delta check on ERC-20 receive
**Status:** Accepted (May 2026)

### Context
`registerWithToken` and `renewWithToken` accept payment in any ERC-20
the owner has allow-listed via `setAllowedPaymentToken`. The original
implementation called `safeTransferFrom(payer → controller, amount)`
and trusted that the controller's balance increased by exactly `amount`.

`registerWithToken`
`safeTransferFrom(payer → controller, amount)`

This trust holds for normal tokens (USDC, USDT, DAI). It does **not**
hold for two well-known categories:

1. **Fee-on-transfer tokens.** Tokens that charge a fee on every
   transfer (deflationary tokens, some reflective tokens). The recipient
   receives `amount - fee`, but `transferFrom` succeeds and returns true.
   The controller would credit a full payment but actually have less,
   silently under-collecting revenue.

2. **Rebasing tokens.** Tokens whose balances change between blocks
   (e.g. via rebasing or yield accrual). The pre/post delta could
   differ from the declared amount in either direction.

1. fee-on-transfer
2. rebasing

The risk is bounded:
- Fee-on-transfer can only happen if the owner explicitly allow-lists
  such a token. USDC/USDT (the planned launch payment tokens) have no
  fee mechanism.
- The harm from silent under-collection is revenue leakage, not user
  fund loss — the user pays exactly the declared amount; only the
  controller's accounting is wrong.

Even so, defending against operator misconfiguration aligns with the
project's "defensive design" principle (see also ADR-005 strict
commitment binding and ADR-006 reward-asset whitelist).

(ADR-005 strict commitment binding, ADR-006 reward-asset whitelist

### Decision
Add an internal helper `_safeReceiveExactly(token, payer, amount)` that:

1. Reads the controller's balance of `token` before the transfer.
2. Calls `safeTransferFrom(payer, controller, amount)`.
3. Reads the post-transfer balance.
4. Reverts with `PaymentShortfall(token, amount, received)` if the
   delta is less than `amount`.

`registerWithToken` and `renewWithToken` use this helper instead of
calling `safeTransferFrom` directly.

2. `safeTransferFrom(payer, controller, amount)`
4. delta

`registerWithToken`

### Consequences
**Benefits:**

- Fee-on-transfer tokens cannot silently leak revenue
- Operator misconfiguration surfaces immediately as a transaction
  revert, not as quiet accounting drift
- Explicit error type (`PaymentShortfall`) makes debugging
  trivial — message contains token address, expected, and received

**Trade-offs:**

- ~2,300 gas overhead per ERC-20 payment (one extra `balanceOf` call).
  Negligible vs ~200k gas for a full register.
- Rebasing tokens with positive rebase between the pre-balance read
  and the transfer would still credit the declared amount (received
  ≥ amount); negative rebase would revert. Acceptable: rebasing
  tokens are not on the launch allow-list and shouldn't be added.
- Does not defend against `LyingBalance` tokens (where `balanceOf`
  itself is fake). Such tokens require operator-side vetting; the
  delta check assumes `balanceOf` is honest about the contract's own
  balance, which is a much weaker assumption than trusting it for
  arbitrary addresses.

### Coverage
The `test/HostileERC20.test.ts` suite verifies:
- Fee-on-transfer token causes `PaymentShortfall` revert (happy
  defence path)
- Normal token (USDC mock, zero fee) registers cleanly (no false
  positive)
- False-return token caught by SafeERC20 (unchanged behaviour)

`test/HostileERC20.test.ts`
- fee-on-transfer
- false-return

---
## ADR-011: Resolver profile expansion — text records and contenthash
**Status:** Accepted (May 2026)

### Context
The v0.9 resolver supported only three things: multi-coin addresses
(ENSIP-9 / ENSIP-11), reverse-name resolution (anti-spoofed), and
operator approval. Pre-mainnet feature-parity review against ENS,
Unstoppable Domains, and Base Names exposed two missing standard
resolver profiles that every major wallet and dApp already integrates
with on the ENS side.

The missing profiles are:

1. **EIP-634 — Text records.** Free-form key/value strings per
   `(node, key)` pair. The canonical use cases are `avatar`,
   `url`, `email`, `description`, and namespaced verifications
   like `com.twitter`, `com.github`, `org.telegram`. Without this,
   wallets cannot render profile cards for `.dex` domains.

2. **EIP-1577 — Contenthash.** Raw bytes per node, encoded with a
   multicodec prefix that identifies the target protocol (IPFS,
   IPNS, Swarm, Arweave). Without this, `.dex` domains cannot host
   decentralized websites that IPFS-aware browsers (Brave, Opera,
   Chromium with extensions) can resolve directly.

1.
   `com.twitter`, `com.github`

2. **EIP-1577 — Contenthash.**
   `.dex`

A third item — ERC-165 `supportsInterface` — was missing entirely.
Without it, ENS-compatible tooling has no way to detect which
resolver profiles are implemented and must hardcode the assumption
or fall back to "try every call and see what works."

### Decision
Extend `DXResolver` to implement EIP-634 and EIP-1577 *exactly* as
ENS implements them — same function signatures, same event signatures,
same indexed/non-indexed key pattern in `TextChanged`, same raw-bytes
storage in `contenthash`. Add ERC-165 `supportsInterface` reporting
all five relevant interface IDs.

`DXResolver`
non-indexed

The four reported interface IDs (beyond `0x01ffc9a7` for ERC-165
itself) are:

- `0xf1cb7e06` — ENSIP-9 multi-coin `addr(node, coinType)` (already implemented)
- `0x59d1d43c` — EIP-634 `text(node, key)` (new)
- `0xbc1c58d1` — EIP-1577 `contenthash(node)` (new)
- `0x691f3431` — ENS `name(node)` reverse (already implemented)

ERC-165
ENSIP-9

To prevent gas-DoS on storage writes, three length bounds are added:

```solidity
uint256 public constant MAX_TEXT_KEY_LENGTH = 64;
uint256 public constant MAX_TEXT_VALUE_LENGTH = 1024;
uint256 public constant MAX_CONTENTHASH_LENGTH = 128;
```
These are generous; the longest common ENS text key is around 30
characters, and the longest EIP-1577 contenthash encoding for any
existing protocol fits in 64 bytes.

### Why not other profiles?
ENS exposes additional resolver profiles that we deliberately did
*not* implement:

- **ABI records** (`0x2203ab56`) — barely used in production
  (~0.1% of ENS names). Adds complexity for no realistic benefit.
- **DNS records** (`0xa8fa5682`) — requires a DNSSEC bridge to
  Ethereum; out of scope for v1.
- **Public key records** (`0xc8690233`) — deprecated by ENS itself
  in favour of text records like `pubkey.0x...`.
- **Interface records** (`0x01ffc9a7`-style discovery for arbitrary
  contracts) — speculative use case; not used by any major wallet.

### Consequences
**Benefits:**

- Wallets that integrate with ENS (MetaMask, Rainbow, Frame, Coinbase
  Wallet, etc.) can read `.dex` profile cards using their existing
  ENS code path. No `.dex`-specific plugin needed.
- IPFS-aware browsers can resolve `.dex` domains to IPFS sites
  directly, again with no new integration work on their side.
- ENS-compatible indexers (The Graph subgraphs, ENS-data services)
  can index `.dex` records by pointing at our resolver address —
  schema is byte-identical.
- The official ENS app could, in principle, resolve a `.dex` name.
  It won't, because its UI hardcodes `.eth`, but the resolver
  interface is interchangeable.

**Trade-offs:**

- ~150 lines of additional contract code (two new storage mappings,
  four new external functions, one ERC-165 view function, four
  events/errors).
- ~2,300 gas overhead per resolver read (the `_isExpired` modifier
  now runs on text and contenthash reads too).
- Resolver storage layout adds two mappings. Future migrations to
  a new resolver contract must either re-populate these or accept
  partial data loss.
- Three new error types and two new events expand the ABI surface
  that frontends and indexers need to know about.

### Coverage
The `test/Resolver-Text.test.ts` and `test/Resolver-Contenthash.test.ts`
suites together verify (21 tests):

- Set, read, overwrite, and delete operations for both record types
- Authorization (owner-only writes; operator approval via
  `setApprovalForAll`)
- Length bounds (rejection above max; acceptance at exact max)
- Expiry behaviour (reads return empty after `expiry + GRACE_PERIOD`)
- ERC-165 reports `true` for both `0x59d1d43c` and `0xbc1c58d1`
- Sample IPFS and IPNS contenthashes round-trip byte-for-byte

`test/Resolver-Text.test.ts`
ERC-165

---
## ADR-012: Permissionless voluntary burn after grace period
**Status:** Accepted (May 2026)

### Context
When a `.dex` domain expires and the holder does not renew within
the 30-day grace period, the domain becomes "available" again — any
new registrant can claim it. However, the underlying ERC-721 token
does not automatically disappear from the chain. Its `ownerOf()`
reverts (because `DXRegistrar.ownerOf` is overridden to revert on
expired tokens), but indexers such as OpenSea, Rarible, and
aggregators continue to display the token as an asset of the previous
holder. This creates "ghost" marketplace listings of names that are,
in protocol terms, no longer owned by anyone.

The previous holder has no economic incentive to clean up these
ghost listings: they let the name lapse precisely because they no
longer cared about it, and asking them to spend gas now would be
strange. Meanwhile, the existence of stale listings creates
real user confusion ("why is this name listed by someone else
when it's marked as 'available'?") and pollutes marketplace
search results.

A partial mitigation already existed: when someone re-registers an
expired name, the `register()` function internally calls `_burn()`
on the old token before minting the new one. But this only fires
when re-registration happens. If a name expires and is never
re-registered, the token lingers indefinitely.

### Decision
Add a permissionless `burn(uint256 id)` function to `DXRegistrar`
that anyone can call once `expiry + GRACE_PERIOD < block.timestamp`.
The function deletes the ERC-721 token, the label string, and the
expiry record. Also update the existing implicit-burn inside
`register()` to emit `NameBurned` for consistency.

`DXRegistrar`
+ GRACE_PERIOD < block.timestamp`

```solidity
function burn(uint256 id) external override {
  address prevOwner = _ownerOf(id);
  if (prevOwner == address(0)) {
    revert TokenOwnerNotFound();
  }
  if (!available(id)) {
    revert NotYetBurnable(id, expiries[id] + GRACE_PERIOD + 1);
  }

  _burn(id);
  delete expiries[id];
  delete names[id];

  emit NameBurned(id, prevOwner);
}
```
### Why permissionless?
The alternative — restricting burn to the previous holder — was
considered and rejected.

**Restricted burn fails because:**

- The previous holder, by definition, has stopped caring about the
  name. Asking them to spend gas now violates the original premise.
- Third parties (marketplace indexers, community cleanup scripts,
  competitive name services) *do* have an incentive to clean up
  stale listings, but cannot under a restricted model.
- The safety bound — only burnable after `expiry + GRACE_PERIOD` —
  makes permissionless burn risk-free for legitimate holders. The
  grace period is non-negotiable; if it hasn't passed, `available()`
  returns false and `burn()` reverts with `NotYetBurnable`.

There is no way for permissionless burn to harm a legitimate holder
because `available()` is a strict, monotonic function of time and
the stored expiry. It can only return `true` if the holder has both
let the name expire *and* chosen not to renew during the entire
30-day grace window.

### Consequences
**Benefits:**

- NFT marketplaces and aggregators can be cleaned up by community
  members or automated indexers, at the cost of one transaction's
  gas per stale name. No protocol intervention or holder action
  needed.
- Storage is reclaimed (`expiries[id]` and `names[id]` mappings
  are deleted), giving back gas refunds to the caller and shrinking
  the contract's effective state size over time.
- `NameBurned` events provide an explicit signal for off-chain
  indexers (vs. having to infer burn from "the token disappeared").
- The implicit-burn-during-register path now emits the same event,
  giving indexers a single, consistent signal regardless of how
  the burn was triggered.

**Trade-offs:**

- One additional external function and one additional event type
  expand the audit surface, though by very little (~50 lines total).
- A previously-burned token's `nameExpires(id)` returns 0 (vs.
  the original expiry value for non-cleaned expired tokens).
  Both indicate "not active" to downstream code, but the distinction
  could trip up consumers that special-case "0 means never registered"
  vs "non-zero past timestamp means expired." Verified that all
  in-protocol consumers treat both as "not active."
- A third party who burns and immediately re-registers the same
  name gains no advantage: they still go through the standard
  commit-reveal flow with `MIN_COMMITMENT_AGE` enforced. No
  front-running of legitimate registrants is possible because
  the commit-reveal binding from ADR-005 prevents parameter
  swapping.

### Coverage
The `test/Registrar-Burn.test.ts` suite verifies (7 tests):

- `burn()` reverts with `NotYetBurnable` while the name is still
  active
- `burn()` reverts with `NotYetBurnable` during the grace period
  (expired but still renewable)
- `burn()` succeeds after `expiry + GRACE_PERIOD` has passed
- Permissionless: a third party (not the previous holder) can
  successfully burn a fully-expired token
- After burn, `expiries[id]` and `names[id]` are both cleared
  (read as 0 / empty string)
- The implicit `_burn()` inside `register()` emits exactly one
  `NameBurned` event during re-registration of an expired name
- `burn()` on a never-minted tokenId reverts with `TokenOwnerNotFound`

`test/Registrar-Burn.test.ts`
(
burn

---
## How to add a new ADR
When making a significant architectural decision:

1. Append a new section: `## ADR-NNN: short description`
2. Fill in **Status**, **Context**, **Decision**, **Consequences**
3. Reference earlier ADRs if the new decision supersedes or builds on them
4. Commit alongside the code change so the rationale is paired with the diff
