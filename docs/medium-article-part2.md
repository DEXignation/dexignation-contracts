# I Added 200 Lines of Smart Contract Code After Deleting 1,000

## A week later, my .dex domain registry can be read by MetaMask, OpenSea, and IPFS browsers — and I didn't write a single line of integration code

---

Last week I wrote about [deleting 1,000 lines of smart contract code](#) before mainnet. Tokens, staking, revenue distribution, contributor SBTs — all gone. The system got simpler. The audit surface shrank. I felt great.

For about a day.

Then I opened MetaMask, typed in a hypothetical `.dex` address, and watched it... do nothing. No avatar. No display name. Just the raw 0x address, like every other unidentified wallet.

The problem wasn't what I had deleted. The problem was what I had never built.

---

## The setup: a registry that nobody could read

DEXignation, at that moment, could do three things:

1. Register a `.dex` name (commit-reveal, MEV-resistant)
2. Store the owner's address against it
3. Reverse-resolve from address back to name

That's it. That's what shipped as v0.9.

It worked. It was tested. It was deployed to Amoy and verified on PolygonScan. But it was, in the parlance of every web3 product manager I've ever talked to, "table stakes minus one."

Here's what every other name service in the space could do that mine couldn't:

| Feature | ENS | Unstoppable | Base Names | `.dex` (v0.9) |
|---------|-----|-------------|------------|---------------|
| Multi-coin addresses | ✅ | ✅ | ✅ | ✅ |
| Reverse lookup | ✅ | ✅ | ✅ | ✅ |
| Text records (avatar, twitter, url) | ✅ | ✅ | ✅ | ❌ |
| Contenthash (IPFS sites) | ✅ | ✅ | ✅ | ❌ |
| Subdomain delegation | ✅ | ✅ | ❌ | ❌ |

Two missing features. Both standard. Both well-specified in EIPs that have been final for years. And without them, a `.dex` domain was just a vanity label that nobody's wallet would render nicely.

I had a week. I gave myself a deadline. Let's see what happens.

---

## The inventory: six things I could ship, two I shouldn't

I made a list of everything missing compared to the leaders. Six items:

1. **Text records** — EIP-634. Key/value strings. `avatar`, `url`, `com.twitter`, etc.
2. **Contenthash** — EIP-1577. IPFS/IPNS pointers so domains can host decentralized websites.
3. **Subdomain delegation** — Let `vitalik.dex` create `wallet.vitalik.dex`.
4. **Multi-coin addresses** — ENSIP-9/11. One name resolves to ETH, BTC, SOL, Polygon addresses.
5. **ERC-165 supportsInterface** — So tools can detect which features the resolver supports.
6. **Soft burn / domain reclamation** — Clean up expired NFTs from marketplaces.

For each, I asked the same question: *is this a single contract function with clear semantics, or is it a sub-product with its own business model?*

**Text records, contenthash, ERC-165, soft burn** — all sub-product-free. Each is a few dozen lines of contract code with a single, well-specified behavior. No pricing decisions. No UX decisions. No questions like "who pays for this?"

**Subdomain delegation** — sub-product. It needs decisions I hadn't made: are subdomains NFTs themselves or just records? What does the parent owner pay (or charge)? Can the parent revoke? Does ENS NameWrapper's "fuses" model apply? Each answer is a product decision worth its own design cycle.

**Multi-coin addresses** — I went to check whether I needed to add this. I opened my own resolver code.

It was already there.

I had implemented ENSIP-9/11 multi-coin support months ago, written tests for it, deployed it to Amoy, and then *forgot I had it*. Six features became five. (More on the embarrassment of forgetting your own code later.)

So: **four to ship, one to defer, one to celebrate.**

---

## The decision: do the boring thing, faithfully

There's a temptation, when you're building something that overlaps with an established standard, to "improve" it. Add a twist. Make it yours.

I did not do that.

For text records, I implemented EIP-634 exactly as ENS does. Same function signature. Same event signature. Same indexed-and-non-indexed key pattern (so logs are filterable by hash but readable for the original string).

For contenthash, I implemented EIP-1577 exactly. Raw multicodec-prefixed bytes. No on-chain validation of the codec format — let frontends parse, like every other resolver does.

For ERC-165 `supportsInterface`, I returned `true` for all four standard interface IDs:
- `0x01ffc9a7` — ERC-165 itself
- `0xf1cb7e06` — ENSIP-9 multi-coin `addr(node, coinType)`
- `0x59d1d43c` — EIP-634 `text(node, key)`
- `0xbc1c58d1` — EIP-1577 `contenthash(node)`
- `0x691f3431` — ENS `name(node)` reverse

The reason for this conservatism is not laziness. It's strategy.

**If I implement these standards exactly, then every wallet that already integrated with ENS works with `.dex` automatically.** MetaMask doesn't need a `.dex` plugin. OpenSea doesn't need a partnership. The official ENS app — running on Ethereum mainnet, completely unaware that `.dex` exists — could in principle resolve a `.dex` name if pointed at my resolver, because the interface is identical.

That's the real prize. Not the feature itself, but the inheritance of nine years of ENS tooling work.

---

## Soft burn: the one decision that was actually a decision

The other four features I added had no real design space. The standards specified everything.

Burn was different. The standards say nothing about it. I had to think.

The problem: when a `.dex` domain expires and nobody renews, the ERC-721 token continues to exist on-chain. Its `ownerOf()` reverts (because I made expired tokens return `address(0)` instead of the previous owner), but OpenSea and other marketplaces still index it. The expired name shows up as a "ghost" listing of the previous holder, who has no incentive to clean it up.

Three options:

**A. Restricted burn** — only the previous holder can call `burn(id)` after the grace period.

**B. Permissionless burn** — anyone can call `burn(id)` once the grace period has fully passed.

**C. Automatic burn during re-registration** — when someone re-registers the expired name, the old token gets `_burn`ed implicitly.

I had already implemented (C). It works but only fires when re-registration happens. If nobody ever re-registers, the ghost listing persists forever.

(A) is the "safer" option in terms of audit surface. But the previous holder has *no reason* to spend gas cleaning up a domain they let lapse. The whole point of cleanup is that someone else cares (a marketplace indexer, a community member running cleanup scripts, a competitive name service trying to make my domain pollution look bad).

I went with (B). Permissionless. Anyone can burn an expired `.dex` domain once `expiry + GRACE_PERIOD < block.timestamp`. The only risk would be if `available()` returned true for a non-expired token — and I had to convince myself, in writing, that it never does. (It doesn't. The function literally checks `block.timestamp > expires + GRACE_PERIOD`.)

Total cost: 30 lines of contract code, one new event, one new error type.

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

This is the part of my code I'm proudest of this week. Not because it's clever — it's not. But because the alternative ("you must call burn yourself, sorry") would have made me feel responsible for an ecosystem-wide cleanup problem that I have neither the authority nor the incentive to solve.

Permissionless cleanup means the community can solve it without my permission. That feels right.

---

## The "already there" moment

Back to multi-coin addresses.

When I started this week, I assumed I needed to implement ENSIP-9. I had a vague memory of "addresses" being a thing but couldn't recall specifics. I opened `DXResolver.sol` to figure out where to add the new function.

The function was already there. So was `setAddr(node, coinType, bytes)`. So was the helper library that distinguishes EVM coin types from non-EVM ones. So were three tests for it.

I had implemented this months ago, written `EVMCoinUtils.sol`, handled the EVM-vs-non-EVM byte-length distinction (20 bytes for EVM, arbitrary for chains like Solana), and then completely forgotten.

There's a developer truism that you should "read your own code before writing new code." I have always nodded at this truism and then ignored it.

I will keep ignoring it. But this time I want to note: the cost of forgetting was an hour of confusion. The cost of remembering would have been opening one file. The asymmetry is brutal.

---

## The bug hunt: two stupid mistakes in a row

With contracts written and 28 new tests drafted, I ran the suite. Eleven failed. Then 28. Then back to 11. Then 7. Each iteration revealed a different category of mistake.

### Mistake 1: a file in the wrong folder

```
HHE1001: There are multiple artifacts for contract "DXRegistrar"

contracts/registrar/DXRegistrar.sol:DXRegistrar
contracts/registry/DXRegistrar.sol:DXRegistrar
```

I had two folders, `registry/` and `registrar/`, named in the ENS tradition where one holds the ownership ledger and the other holds the NFT-issuing logic. While copying files around, I had pasted `DXRegistrar.sol` into `registry/` by accident. Solidity's compiler doesn't care which folder a file lives in — both got compiled, both produced artifacts, both got named `DXRegistrar`. Hardhat then refused to deploy because it couldn't pick one.

The fix took ten seconds. The diagnosis took twenty minutes, because I assumed the error was about something deep and architectural rather than "you put a file in the wrong directory."

### Mistake 2: `encodePacked` vs `abi.encode`

In Solidity, these are two different functions that produce two different byte arrays:

```solidity
abi.encode(label, owner, duration, ...)        // 32-byte-aligned, padded
abi.encodePacked(label, owner, duration, ...)  // tightly packed, no padding
```

In viem, the JavaScript counterparts are:

```ts
encodeAbiParameters(parseAbiParameters("..."), [...])  // = abi.encode
encodePacked([...], [...])                              // = abi.encodePacked
```

I wrote new tests using `encodePacked` because the helper function name `subnodeFor` (which computes ENS-style namehash) legitimately uses packed encoding. By muscle memory, I used the same encoding for the commitment hash too.

The contract computes commitments with `keccak256(abi.encode(...))`. My tests computed them with `keccak256(abi.encodePacked(...))`. Different bytes. Different hashes. Every test failed with `CommitmentNotFound`.

The fix was three lines per file. The diagnosis took an hour, because the error message ("commitment not found") implies a logic bug somewhere in the contract, not a hash-encoding mismatch in the test helper.

Both bugs were a flavor of the same underlying issue: **I copy-pasted from an old working pattern without thinking about which encoding was right for *this* call.** ENS-style namehash uses `encodePacked`. Commitment hashes use `abi.encode`. Both look like "concatenate things and hash them." They are not the same.

I now have a rule: any time I see `encodePacked` and `keccak256` in the same line, I stop and check which one the function being called actually wants.

---

## The result

After the bugs were fixed and the contracts were in their proper directories, the test suite settled at:

```
79 passing (36s)
```

That's the 49 baseline tests, the 21 new Resolver tests (text + contenthash + ERC-165), the 7 new burn tests, plus a couple of additional checks I'd forgotten about.

More importantly, the four ENS interface IDs now report `true` from `supportsInterface`. That means:

- **MetaMask** can show profile cards for `.dex` domains using its existing ENS code path.
- **IPFS-aware browsers** (Brave, Opera) can navigate to `.dex` domains pointing at IPFS sites with no further integration work.
- **OpenSea** can display avatar text records for `.dex` domain NFTs by reading the resolver the same way it reads ENS resolvers.
- **The official ENS app** could, in principle, resolve a `.dex` name. (It won't, because its UI hardcodes `.eth`, but the resolver interface is interchangeable.)

None of these integrations required me to talk to anyone. No business development calls. No partnership announcements. No SDK to publish. The wallets and browsers don't even know `.dex` exists. They just call `text()` and `contenthash()` and `addr(node, coinType)` on whatever resolver they're pointed at, and the bytes that come back are formatted exactly as their existing parsers expect.

This is what standards do. This is what nine years of ENS engineering bought, and what I got to inherit for free by typing the right four function signatures.

---

## What I'm not doing (and why)

Subdomain delegation is the obvious next feature. It's also a sub-product with real design decisions:

- **Pricing model**: do subdomains cost USDC? Are they free to the parent owner? Can the parent set their own price?
- **Token vs record**: are subdomains themselves NFTs (like ENS NameWrapper) or just resolver records (like classic ENS)?
- **Revocation rights**: can the parent owner reclaim a subdomain at will? Or are there ENS-style "fuses" that lock down the parent's power?
- **NFT marketplace implications**: if subdomains are NFTs and the parent can revoke them, marketplaces have an obvious trust problem. If they can't be revoked, then a parent who delegates `wallet.alice.dex` to a third party can never get it back.

Each of these is a fork in the road for the entire product. I am not going to make four such decisions in a week, run a one-day audit on them, and ship to mainnet. That's how you end up with a v2 that breaks every v1 holder.

So `subdomain.dex` waits for v1.1. There will be a dedicated design cycle, a dedicated audit, a dedicated launch. It might take a month. It might take three. What it will not do is ride along on this release because I felt like shipping it.

---

## The week's actual lesson

Last week's post was about subtraction: I deleted 1,000 lines of well-intentioned but over-engineered token mechanics because the simpler system was correct and the elaborate one was a distraction.

This week's post is about a different kind of restraint. I added 200 lines, but they were exactly the 200 lines that nine years of ENS engineering had already validated. I didn't add a "DEXignation flavor" to text records. I didn't introduce a slightly-different `setText` signature with a "useful tweak." I implemented the four standards verbatim and let nine years of tooling work for me.

There's a phrase from the Unix world: *worse is better*. The Unix kernel doesn't try to be elegant; it tries to be a thin, predictable layer that other things can build on. The text-records standard is the same: nothing about EIP-634 is elegant. The function signature includes a `string` parameter that the EVM doesn't index well. The event emits the key both as `indexed` and non-indexed because indexed strings get hashed and become unreadable. It's awkward. It's what everyone uses.

And because it's what everyone uses, I am — for the cost of 50 lines of resolver code — now compatible with everyone.

I don't have a partnership team. I don't have a business development department. I don't have a tooling ecosystem of my own. I have a small `.dex` registry that conforms exactly to interfaces other people have already integrated. And that, for now, is enough.

Next week: Amoy redeployment with the full v1.0 contracts, then beta testing. After that — if the beta holds — Polygon mainnet.

The week after that, maybe I'll start thinking about subdomain delegation.

But not before.

---

*The DEXignation contracts are MIT-licensed and open source at [github.com/DEXignation](https://github.com/DEXignation). Built on Polygon. Designed to be boring on purpose.*
