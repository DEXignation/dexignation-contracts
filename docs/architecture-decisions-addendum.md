# Architecture Decision Records — Addendum (ADR-011, ADR-012)

> v1.0 출시 직전 추가된 두 가지 결정. 기존 architecture-decisions.md에
> 이 두 ADR을 append한다.
>
> Two decisions added immediately before v1.0 launch. Append these to
> the existing architecture-decisions.md.

---

## ADR-011 — Resolver profile expansion: Text records + Contenthash

**Status:** Accepted
**Date:** 2026-05-29
**Context:** Pre-v1.0 feature parity review with ENS, Unstoppable Domains,
Base Names, and other comparable name services.

### Decision

Extend `DXResolver` to implement two additional ENS-standard resolver
profiles:

1. **EIP-634 Text Records** — free-form key/value strings per node
2. **EIP-1577 Contenthash** — multicodec-prefixed bytes for decentralized
   web content (IPFS, IPNS, Swarm, Arweave)

The existing ENSIP-9 / ENSIP-11 multi-coin address support is retained
unchanged. ERC-165 `supportsInterface` is added so ENS-compatible tooling
can detect support without reading docs.

`DXResolver`를 확장하여 EIP-634 텍스트 레코드와 EIP-1577 contenthash를
구현한다. 기존 ENSIP-9/11 다중 코인 주소 지원은 그대로 유지하며,
ERC-165 `supportsInterface`를 추가하여 ENS 호환 툴이 지원 여부를
탐지 가능하도록 한다.

### Rationale

**Why these, and not other profiles?**

The four profiles that matter for v1 user experience are: addr (multi-coin),
name (reverse), text, and contenthash. Every wallet, dApp, and indexer that
integrates with ENS-style naming reads these four. Without text records and
contenthash:

- Wallets cannot display a user's twitter, avatar, or website
- dApps cannot personalize based on user profile records
- Domains cannot host decentralized websites (the highest-impact feature
  of any web3 name service)

v1 사용자 경험에 중요한 네 가지 프로파일: addr, name, text, contenthash.
ENS 스타일 네임을 통합하는 모든 지갑/dApp/인덱서가 이 네 가지를 읽는다.
text와 contenthash 없이는 지갑이 트위터/아바타/웹사이트를 표시할 수 없고
도메인이 분산형 웹사이트를 호스팅할 수 없다.

**Why not ABI records, interface records, pubkey, DNS, etc.?**

These additional ENS profiles have minimal real-world adoption:
- ABI records: ~0.1% of ENS names use them
- DNS records: requires DNSSEC bridge complexity
- Public key records: deprecated by ENS itself

이들은 실제 사용률이 극히 낮거나 ENS 자체에서 deprecated.

### Trade-offs

- **Pros:** Standard compliance, no vendor lock-in, every existing ENS
  integration "just works" with `.dex` names if frontend points to our
  resolver
- **Cons:** ~150 lines of additional contract code, ~30 new tests, ~2,300
  gas added to per-record reads (compared to a pure address-only resolver)

장단점: 표준 준수로 vendor lock-in 없음, 기존 ENS 통합이 frontend만
가리키면 그대로 동작. 비용은 컨트랙트 ~150줄과 가스 ~2,300 추가.

### Bounds chosen

To prevent gas-DoS on storage writes:

DoS 방지를 위한 길이 상한:

| Field             | Maximum | Rationale                             |
|-------------------|---------|---------------------------------------|
| text key length   | 64 B    | Longest common ENS keys ~30 chars     |
| text value length | 1024 B  | Long enough for URLs + descriptions   |
| contenthash       | 128 B   | All EIP-1577 codecs fit in <= 64 B    |

These are generous; no realistic record will hit any limit.

### Interface IDs reported

```solidity
0x01ffc9a7  // ERC-165 self
0xf1cb7e06  // ENSIP-9 multi-coin addr(node, coinType)
0x59d1d43c  // EIP-634 text(node, key)
0xbc1c58d1  // EIP-1577 contenthash(node)
0x691f3431  // ENS NameResolver name(node)
```

### Consequences

- Resolver storage layout adds two mappings: `texts[node][key] → value`
  and `contenthashes[node] → bytes`. Future migrations to a new resolver
  must re-populate these or accept data loss.
- Frontend can now display rich profile cards for `.dex` domains
- IPFS-aware browsers (Brave, Opera, Chromium with extensions) can
  resolve `.dex` domains to IPFS sites with no further protocol work

Resolver 저장 구조에 두 매핑 추가. 향후 리졸버 마이그레이션 시 재이전 또는
데이터 손실 수용 필요. Frontend가 풍부한 프로파일 카드 표시 가능. IPFS
지원 브라우저가 `.dex`를 IPFS 사이트로 추가 작업 없이 해석 가능.

---

## ADR-012 — Voluntary domain burn after grace period

**Status:** Accepted
**Date:** 2026-05-29
**Context:** NFT marketplace hygiene + ENS-equivalent UX for expired domains.

### Decision

Add a permissionless `burn(uint256 id)` function to `DXRegistrar` that
deletes an expired token plus its label and expiry state, callable by
**anyone** once `expiry + GRACE_PERIOD < block.timestamp`.

The existing implicit burn inside `register()` (when re-registering a
previously-expired name) is also updated to emit `NameBurned` for log
consistency.

`DXRegistrar`에 권한 불필요 `burn(uint256 id)` 추가. `expiry +
GRACE_PERIOD < block.timestamp` 시 누구나 호출 가능. 기존 `register()`
내 묵시적 burn도 `NameBurned` 이벤트 emit하도록 보강.

### Rationale

**The problem:**

NFT marketplaces (OpenSea, Rarible, Magic Eden) index every minted ERC-721
token. When a `.dex` domain expires and is not renewed:

- The token still exists in NFT contracts (just `ownerOf` reverts)
- Marketplace listings continue showing it as an asset of the previous
  holder
- Users encounter "ghost" listings of domains they could actually
  re-register fresh
- The previous holder has no incentive (and may not know how) to clean it up

NFT 마켓플레이스가 모든 발행 ERC-721을 인덱싱한다. 도메인이 만료되어
갱신되지 않으면 마켓에는 "유령" 리스팅으로 남아 사용자 혼란 유발.

**The fix:**

A permissionless burn that:
- Anyone can call (cost: one transaction's gas)
- Only works after grace period — never threatens active or renewable names
- Fully deletes the token, label, and expiry state
- Emits `NameBurned` so indexers can update

권한 불필요 burn. 누구나 호출 가능 (가스 비용만 부담), 유예 기간 후에만
동작 (활성/갱신 가능 도메인엔 위협 없음), 토큰/라벨/만료 상태 전부 삭제,
인덱서를 위한 이벤트 emit.

### Why permissionless?

Alternative considered: restrict burn to the previous holder.

대안 검토: burn을 이전 보유자만 가능하도록 제한.

**Rejected because:**

- Previous holder has no reason to spend gas cleaning up a domain they
  abandoned
- This is exactly the case where third-party (indexer, community member,
  even competitive registrar) cleanup is most useful
- The safety bound — only burnable after expiry + grace — makes the
  permissionless version risk-free for legitimate holders

거부 이유: 보유자가 가스 부담 의지 없음. 제3자 정리가 가장 유용한 케이스.
유예 기간 이후만 가능하다는 안전 한계로 정당 보유자에겐 위험 없음.

### Trade-offs

- **Pros:**
  - NFT marketplace data stays clean
  - No state bloat (mappings get deleted, not just abandoned)
  - Community/automated cleanup possible without protocol intervention
- **Cons:**
  - One additional public function (small audit surface)
  - One additional event type to index

### Consequences

- `nameExpires(id)` returns 0 for burned tokens (vs. previous-expiry value
  for never-cleaned tokens) — backward-compatible since both indicate
  "not active"
- `available(id)` returns true for burned tokens (already the case before
  burn — burn just makes the state authoritative)
- A third party who burns and immediately re-registers gains no advantage:
  they go through the same commit-reveal flow as any other registrant

소비된 토큰의 `nameExpires`는 0 반환. 정리 안 된 토큰과 동작 동일 (둘 다
"비활성"). 제3자 burn 후 즉시 재등록도 일반 등록과 동일 commit-reveal
거쳐야 함 — 이점 없음.

---

## Summary table

| ADR | Topic                              | Impact                | Lines added |
|-----|-------------------------------------|-----------------------|-------------|
| 011 | Text records + Contenthash         | Resolver only         | ~150        |
| 012 | Voluntary burn after grace          | Registrar only        | ~50         |

Combined: ~200 lines of contract code, ~3 new test files (~30 tests),
no changes to registry, controller, oracle, reservations, or reverse
registrar.

| ADR | 주제                                | 영향 범위            | 추가 줄 수 |
|-----|-------------------------------------|---------------------|-----------|
| 011 | Text records + Contenthash         | Resolver만           | ~150      |
| 012 | 유예 후 자발적 burn                  | Registrar만          | ~50       |

합산 ~200줄, 신규 테스트 ~30개. Registry/Controller/Oracle/Reservations/
ReverseRegistrar 변경 없음.
