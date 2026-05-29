# Architecture Decision Records

This document captures the key architectural decisions made during the
design of DEXignation v1, and the reasoning behind each one. It exists
so that the original author, future contributors, security auditors, and
investors can quickly understand **why** the codebase looks the way it
does — not just **what** it does.

Each record describes the context that prompted the decision, the
decision itself, and the consequences (both intended and accepted).

이 문서는 DEXignation v1 설계 과정에서 내린 주요 아키텍처 결정과 그 근거를
기록한다. 원저자, 향후 기여자, 보안 audit firm, 투자자가 코드베이스가
**왜** 이런 모습인지(무엇인지가 아니라) 빠르게 이해할 수 있도록 작성됨.

각 레코드는 결정의 배경, 결정 내용, 그리고 그 결정의 결과(의도된 것과
감수하는 것)를 설명한다.

---

## ADR-001: Pure SaaS architecture — no governance token in v1

**Status:** Accepted (May 2026)
**상태:** 확정 (2026년 5월)

### Context / 배경

The initial design included a full token-economy stack:
- `DXNToken` — ERC20Votes governance token with hard cap (197 lines)
- `DXNStaking` — multi-asset reward staking (386 lines, hardened after audit)
- `RevenueDistributor` — protocol revenue splitter with atomic notify (203 lines)

This is the canonical web3 "full-stack" pattern: domain service + governance
token + staking + revenue share. ENS, Uniswap, and most major protocols
end up here eventually.

초기 설계에는 전체 토큰 경제 스택이 포함됨: `DXNToken` (거버넌스 ERC20Votes,
hard cap), `DXNStaking` (다중 자산 보상 스테이킹), `RevenueDistributor` (수익
분배기). 이는 web3의 표준 "풀스택" 패턴 — 도메인 서비스 + 거버넌스 토큰 +
스테이킹 + 수익 분배. ENS, Uniswap 등 대부분의 주요 프로토콜이 결국 이리로
수렴한다.

However, on review, none of this was actually needed at launch:

1. **Tokenomics undecided.** Issuing a token requires deciding total supply,
   distribution schedule, vesting cliffs, mint authority transitions,
   inflation policy, and more. None of these had been finalised.

2. **Legal uncertainty in Korea.** Issuing a transferable token would
   trigger review under 가상자산이용자보호법 and potentially 자본시장법
   (if revenue-share could be argued to make it a security). Both are
   ongoing regulatory areas; getting them wrong is expensive.

3. **ENS precedent.** ENS ran as a pure registrar from 2017 to 2021 (four
   years) before issuing the ENS governance token. The domain service
   stood on its own merits.

4. **Premature optimisation risk.** Code written today for "if we ever
   launch a token" is likely to be wrong by the time that decision is
   actually made, because tokenomics designs, regulatory environment, and
   audit best practices all evolve.

검토 결과 출시 시점에는 어느 것도 실제로 필요하지 않았다:

1. **토크노믹스 미확정.** 토큰 발행은 총 발행량, 분배 일정, vesting cliff,
   mint 권한 이전, 인플레이션 정책 등을 정해야 함. 모두 미확정 상태.

2. **한국 법적 불확실성.** 양도 가능 토큰은 가상자산이용자보호법, 수익 분배
   주장 가능 시 자본시장법 적용 가능. 양쪽 모두 진행 중인 규제 영역으로
   잘못 가면 비용이 큼.

3. **ENS 선례.** ENS는 2017년부터 2021년까지 4년간 거버넌스 토큰 없이 순수
   registrar로 운영. 도메인 서비스 자체로 가치 입증.

4. **조기 최적화 위험.** 미래 토큰 출시를 가정하고 지금 작성한 코드는, 실제
   결정 시점에는 이미 틀렸을 가능성이 큼. 토크노믹스 디자인, 규제 환경,
   audit best practice 모두 빠르게 진화하기 때문.

### Decision / 결정

Remove all token-economy contracts from v1. Ship pure SaaS:
- User pays for domain registration in USDC/USDT/POL
- Owner withdraws revenue via `withdrawToken()` / `withdraw()`
- 100% of revenue accrues to owner (or owner's multisig)

v1에서 모든 토큰 경제 컨트랙트 제거. 순수 SaaS로 출시:
- 사용자는 USDC/USDT/POL로 도메인 등록 결제
- Owner는 `withdrawToken()` / `withdraw()`로 수익 회수
- 수익 100% owner(또는 owner의 multisig)에게 귀속

### Consequences / 결과

**Accepted / 감수:**

- Minimal audit surface (17 contracts, 3,071 lines)
- Minimal legal surface (no token issuance = essentially no Korean
  crypto-specific regulation applies)
- Simple operations (no token holders to communicate with, no token
  price to watch, no governance proposals to facilitate)
- Future token launch requires writing new contracts from scratch
  (1–2 days of work, plus audit)

**Preserved hooks / 보존된 확장 지점:**

The controller is designed so that a future token can be plugged in
without modifying or redeploying it:
- `setDiscountToken(token, threshold, bps)` — any ERC-20 can become a
  holder-discount target (a future DXN, MOL on Polygon, or anything else)
- `setAllowedPaymentToken(token, true)` — any ERC-20 can be added as a
  payment option

These are not "future token economy hooks" — they are general-purpose
ERC-20 integration points that happen to also serve a future token if
one is ever launched.

컨트롤러는 향후 토큰을 수정·재배포 없이 연결할 수 있도록 설계:
- `setDiscountToken` — 임의 ERC-20을 보유자 할인 대상으로 지정
- `setAllowedPaymentToken` — 임의 ERC-20을 결제 옵션으로 추가

이는 "미래 토큰 경제 hook"이 아니라 범용 ERC-20 통합 지점으로, 미래 토큰
출시 시에도 활용 가능할 뿐.

### References / 참고

- ENS DAO launch (Nov 2021): https://docs.ens.domains/dao
- ENS Labs employee count (LinkedIn, 2026): 19 employees
- 가상자산이용자보호법 (시행 2024.7.19)

---

## ADR-002: Contributor incentives via .dex domain NFTs, not a separate token

**Status:** Accepted (May 2026)
**상태:** 확정 (2026년 5월)

### Context / 배경

The project needs a way to reward contributors (developers, designers,
translators, community moderators). Several models were considered:

1. **ERC-20 contributor token.** Issue a new token, give X amount to each
   contributor. They can sell on a DEX.

2. **Soulbound NFT (SBT).** Non-transferable badge attesting to
   contribution. Recognition only, no monetisation.

3. **Funded .dex registration.** Owner sends USDT to contributor;
   contributor registers .dex domains in their own name and can hold,
   use, or sell them.

기여자(개발자·디자이너·번역자·커뮤니티 운영자) 보상 방식 검토. 세 가지 모델
고려: (1) ERC-20 기여자 토큰 발행 후 DEX 매도, (2) Soulbound NFT 배지 —
인정만, 환금성 없음, (3) USDT 지급 → 기여자 본인 명의 .dex 등록 → 자유 보유/
사용/매도.

The author initially built option 2 (`DXContributionSBT.sol`, 181 lines).
On reflection, the actual intent was closer to option 3: contributors
should be able to monetise the reward, because the reward is meant to
supplement salary, not just to recognise effort.

초기에는 옵션 2를 구현 (`DXContributionSBT.sol`). 재검토 결과 실제 의도는
옵션 3에 가까웠음 — 보상은 단순 인정이 아니라 월급 외 인센티브로
**환금화 가능해야 함**.

### Decision / 결정

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

옵션 3 채택. `DXContributionSBT` 완전 제거. 기여자 보상 흐름:
1. Owner가 기여자에게 USDT(보통 $250 정도) + 소액 POL(가스용, 10 정도) 송금
2. 기여자가 본인 명의로 dexignation.com에서 .dex 도메인 등록
3. USDT 흐름: 기여자 → 컨트롤러 → owner의 `withdrawToken()`. owner 순
   비용은 가스비뿐 (~$5)
4. 기여자는 자유 보유, 지갑 별칭 사용, OpenSea/Magic Eden 판매 가능

### Consequences / 결과

**Benefits / 장점:**

- No additional contract to maintain or audit
- No new token = no new regulatory surface
- `.dex` NFT is already a real, useful digital good (resolves to wallets,
  serves as identity, has marketplace value)
- Contributor receives real value at minimal cost to owner
- Active use of .dex domains by contributors creates organic marketing

**Trade-offs / 감수:**

- Reward value depends on which labels contributor chooses (good labels
  fetch higher prices; mediocre labels less so)
- Contributor must execute 30 registration transactions (mitigated by
  spreading over 6 days, 5 per day)
- No "permanent on-chain recognition" record (this was the SBT's role,
  but it turned out not to be what the author wanted)

### References / 참고

- DXContributionSBT.sol (removed in this commit) — preserved in git history
  if recognition-style attestation is ever needed again

---

## ADR-003: Generic `setDiscountToken` instead of partner-specific `setMolDiscount`

**Status:** Accepted (May 2026)
**상태:** 확정 (2026년 5월)

### Context / 배경

The initial discount API was named after a specific partner project:

```solidity
function setMolDiscount(address _molToken, uint256 _threshold, uint256 _bps);
```

This bound the API to MOL ([MolePin](https://molepin.com)), a specific
ERC-20 the author already operates on BSC. The discount logic itself,
however, is just "holder of token X with balance ≥ Y gets Z% off" —
nothing about it requires the token to be MOL.

초기 할인 API는 특정 파트너 프로젝트 이름을 사용:
`setMolDiscount(address _molToken, ...)`. 이 명명은 API를 MOL
(저자가 BSC에서 이미 운영 중인 ERC-20)에 묶음. 하지만 할인 로직 자체는
"토큰 X를 Y 이상 보유하면 Z% 할인"일 뿐, MOL이어야 할 이유 없음.

Naming a generic mechanism after a specific instance is a maintenance
trap: in a year, if the partner changes (or a second one is added),
either the name lies or the API has to be split.

범용 메커니즘을 특정 인스턴스로 명명하는 것은 유지보수 함정 — 1년 후 파트너
변경 또는 추가 시 이름이 거짓말이 되거나 API를 분리해야 함.

### Decision / 결정

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

새 setter 제약 추가: 활성화 시 `requiredHoldAmount > 0` 강제. 0이면 모든
지갑이 자격 충족 (`balanceOf >= 0`이 항상 참)이 되어 사실상 오설정.

### Consequences / 결과

- Owner can point the discount at MOL, a future DXN, a partner DAO token,
  a community treasury token — anything ERC-20-compatible — without
  needing a code change
- The setter is the only function ever called when changing policy;
  no separate "deactivate MOL, activate DXN" dance needed
- Bilingual documentation reflects the generic intent

---

## ADR-004: Strict ASCII-lowercase label policy at launch

**Status:** Accepted (May 2026)
**상태:** 확정 (2026년 5월)

### Context / 배경

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

초기 `isValidLabel` 검사는 최소 — 3자 이상 UTF-8이면 모두 허용. 이는
`roy.dex`, `Roy.dex`, `R oy.dex`, homoglyph 공격 `гoy.dex` (키릴 'г')를
모두 별개 도메인으로 처리, 다음을 가능하게 함:
- homoglyph 피싱
- 대소문자 혼동
- 공백·invisible 문자
- JSON/SVG injection (tokenURI 메타데이터 깨짐)

### Decision / 결정

Add a strict ASCII-lowercase validator (`StringUtils.isValidAsciiLabel`)
and use it in `isValidLabel`:

```
Allowed: a-z, 0-9, hyphen
Disallowed: uppercase, non-ASCII, whitespace, leading/trailing hyphen,
            consecutive hyphens
Minimum length: 3 codepoints (already enforced)
```

엄격한 ASCII lowercase 검증기 추가 (`StringUtils.isValidAsciiLabel`).
허용: a-z, 0-9, 하이픈. 금지: 대문자, 비-ASCII, 공백, 선두/말미 하이픈,
연속 하이픈.

This is the **launch policy**, not the permanent policy. The plan is:

1. **Launch (now):** ASCII lowercase only. Phishing-safe by construction.
2. **Phase 2 (later):** Add `isValidUnicodeLabel` using UTS-46 / ENSIP-15
   normalisation when the framework and audit budget are in place.
3. **Phase 3 (eventual):** Separate policy module(s) for Korean Hangul,
   Japanese, Arabic, etc. with explicit script-mixing rules.

출시 정책일 뿐, 영구 정책 아님:
1. 출시(현재): ASCII lowercase만 — 설계상 피싱 안전
2. 2단계(향후): UTS-46/ENSIP-15 정규화로 `isValidUnicodeLabel` 추가
3. 3단계(궁극): 한글/일본어/아랍어 등 스크립트별 정책 모듈 분리

### Consequences / 결과

**Benefits / 장점:**

- Zero phishing risk via Unicode tricks at launch
- tokenURI JSON/SVG injection becomes impossible by construction
  (no `"`, `\`, `<`, `>`, `&` can ever appear in a label)
- Simpler initial UX (clear rules, easy to communicate)
- Smaller initial audit surface for normalisation logic

**Trade-offs / 감수:**

- Korean users cannot register Hangul labels (e.g. `홍길동.dex`) at
  launch. This is the right trade-off for v1: phishing resistance >
  internationalisation. Hangul support is planned for Phase 2/3 with
  proper Korean-script normalisation.
- Some users may expect Unicode support and need education about why
  it's restricted initially.

### References / 참고

- ENSIP-15 (Name Normalization): https://docs.ens.domains/ensip/15
- UTS-46 (Unicode IDNA Compatibility Processing):
  https://www.unicode.org/reports/tr46/
- Punycode (RFC 3492): https://datatracker.ietf.org/doc/html/rfc3492

---

## ADR-005: Commitment binds resolver, duration, and payment token (MEV-resistant)

**Status:** Accepted (May 2026)
**상태:** 확정 (2026년 5월)

### Context / 배경

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

기존 commit-reveal은 `(name, owner, secret)`만 해싱. ENS 표준 패턴이지만
resolver, duration, payment token이 commitment에 묶이지 않음. MEV 봇이
reveal 트랜잭션 관찰 후 같은 `(name, owner, secret)`로 다른 resolver를
넣어 front-run 가능 — NFT는 원래 owner에게 가지만 초기 address 레코드는
공격자 resolver를 가리킴.

The user might never notice because the NFT itself is correct; only the
address that `name.dex` resolves to is wrong. The attacker could then
intercept any payment sent to the new domain.

사용자는 NFT 자체가 정확하므로 알아채지 못할 수 있음 — `name.dex`가
resolve되는 주소만 잘못. 공격자는 새 도메인으로 보내진 모든 결제를 가로챌
수 있음.

### Decision / 결정

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

`(label, owner, duration, resolver, paymentToken, secret)`를 모두 포함하는
"full-binding" commitment 해시 추가. register 시점에 strict commitment를
소비. 레거시 3-인자 `makeCommitment`는 ABI 호환용으로 남기되 register 시
사용 불가.

### Consequences / 결과

- MEV resolver-swap attack is impossible (commitment binding forces
  reveal-time parameters to match commit-time parameters exactly)
- Clients must use `makeCommitmentFull` from now on; legacy clients
  using the 3-arg form will fail at reveal with `CommitmentNotFound`
- Slightly larger commitment hash inputs (6 fields vs 3), negligible
  gas cost

### References / 참고

- ENS commit-reveal scheme (the basis for this design):
  https://docs.ens.domains/contract-api-reference/.eth-permanent-registrar/controller
- MEV resolver-swap discussion: this is a known weakness of the basic
  ENS pattern that several alternative name services have addressed
  similarly

---

## ADR-006: DXNStaking (REMOVED) had multi-asset reward accounting

**Status:** Superseded by ADR-001 (May 2026)
**상태:** ADR-001로 대체됨 (2026년 5월)

### Context / 배경

Prior to ADR-001, the project included `DXNStaking.sol` (386 lines after
hardening). This record exists to preserve the rationale of that
contract in case a future token launch revives the staking model, so
that the design can be evaluated rather than re-derived from scratch.

ADR-001 이전에는 `DXNStaking.sol` (보안 강화 후 386줄)을 포함했음. 이
레코드는 향후 토큰 출시 시 스테이킹 모델이 부활할 경우 설계를 재평가
가능하도록 그 근거를 보존하기 위함.

### Key design properties (for future reference) / 주요 설계 속성

The deleted DXNStaking had these properties; if a future version is
written, these are the constraints that proved necessary:

삭제된 DXNStaking은 다음 속성을 가졌음. 향후 버전 작성 시 다음 제약이
필요함이 입증됨:

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

### Why removed / 제거 사유

See ADR-001. The staking model is only useful if there's a token to
stake; until a token exists, staking is dead code. Once a token launch
is approved, this contract (or its successor) can be re-derived from
this record plus git history.

ADR-001 참조. 스테이킹 모델은 stake할 토큰이 있어야 의미가 있음 — 토큰이
없는 동안 스테이킹은 죽은 코드. 향후 토큰 출시 승인 시 이 레코드와 git
history에서 컨트랙트 재유도 가능.

---

## ADR-007: RevenueDistributor (REMOVED) atomic notify pattern

**Status:** Superseded by ADR-001 (May 2026)
**상태:** ADR-001로 대체됨 (2026년 5월)

### Context / 배경

The deleted `RevenueDistributor.sol` (203 lines) split protocol revenue
into four destinations (treasury / staking / burn / buffer) and
atomically called `staking.notifyReward()` after transferring the
staking share.

삭제된 `RevenueDistributor.sol`은 프로토콜 수익을 네 곳(treasury/staking/
burn/buffer)으로 분배하고, staking 몫 전송 후 같은 트랜잭션에서
`staking.notifyReward()`를 원자적으로 호출.

### Key design properties (for future reference) / 주요 설계 속성

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

### Why removed / 제거 사유

See ADR-001. Revenue distribution is only meaningful if there's a token
holder community to distribute to. Until then, the owner takes 100% via
`withdrawToken()`, which is simpler and matches the legal model of a
pure SaaS.

ADR-001 참조. 수익 분배는 분배 대상 토큰 보유자 커뮤니티가 있어야 의미.
그 전까지는 owner가 `withdrawToken()`으로 100% 가져가는 게 더 단순하고 순수
SaaS의 법적 모델에 부합.

---

## ADR-008: Owner-direct withdraw, no programmatic routing

**Status:** Accepted (May 2026)
**상태:** 확정 (2026년 5월)

### Context / 배경

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

이전 컨트롤러는 `RevenueDistributor`가 설정되어 있으면 그곳으로, 아니면
owner로 송금. ADR-001로 distributor 제거됨에 따라 이 라우팅은 죽은 무게.

### Decision / 결정

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

향후 distributor가 필요해지면 (1) owner가 직접 받아 수동 전달, (2) owner를
distributor로 이전, (3) v2 컨트롤러 배포로 라우팅 함수 추가 — 세 가지
모두 가능.

### Consequences / 결과

- Simpler `withdraw()` — fewer storage reads, less branching
- Clearer intent: revenue belongs to the owner in v1
- `recoverFunds()` is preserved for tokens accidentally sent to the
  contract that should go to a specific recipient (not the owner)

---

## ADR-009: Soulbound vs transferable for contributor recognition

**Status:** Considered, both rejected (May 2026)
**상태:** 검토 후 모두 기각 (2026년 5월)

### Context / 배경

Two intermediate designs were considered for contributor rewards before
landing on ADR-002 (fund USDT, contributor registers .dex):

기여자 보상을 위해 ADR-002 (USDT 지급 후 기여자가 .dex 등록)에 도달하기 전
두 가지 중간 설계 검토:

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

### Why both rejected / 양쪽 모두 기각 사유

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

**ADR-002로 결정** — `.dex` NFT가 양도 가능 기여자 NFT가 할 일을 모두 함.
추가 이점: (a) 실사용 가치, (b) 추가 컨트랙트 유지 불필요.

### References / 참고

- DXContributionSBT.sol (Design A) — removed, preserved in git history
- Design B was discussed but never implemented

---

## ADR-010: Defensive balance-delta check on ERC-20 receive

**Status:** Accepted (May 2026)
**상태:** 확정 (2026년 5월)

### Context / 배경

`registerWithToken` and `renewWithToken` accept payment in any ERC-20
the owner has allow-listed via `setAllowedPaymentToken`. The original
implementation called `safeTransferFrom(payer → controller, amount)`
and trusted that the controller's balance increased by exactly `amount`.

`registerWithToken`과 `renewWithToken`은 owner가 `setAllowedPaymentToken`
으로 허용한 임의의 ERC-20으로 결제 가능. 원래 구현은
`safeTransferFrom(payer → controller, amount)`을 호출하고 컨트롤러 잔액이
정확히 `amount`만큼 증가한다고 가정했음.

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

정상 토큰(USDC, USDT, DAI)에는 가정이 성립. 두 부류에는 성립 안 함:
1. fee-on-transfer 토큰 — 전송 시 수수료 차감, 수신자는 `amount - fee` 수령
2. rebasing 토큰 — 블록 간 잔액 변동, pre/post delta가 명시값과 다를 수 있음

The risk is bounded:
- Fee-on-transfer can only happen if the owner explicitly allow-lists
  such a token. USDC/USDT (the planned launch payment tokens) have no
  fee mechanism.
- The harm from silent under-collection is revenue leakage, not user
  fund loss — the user pays exactly the declared amount; only the
  controller's accounting is wrong.

위험은 제한적:
- fee-on-transfer는 owner가 명시적으로 허용해야만 발생. 출시 예정 결제
  토큰(USDC/USDT)에는 수수료 메커니즘 없음.
- 조용한 과소 수금의 해는 매출 누수일 뿐 사용자 자금 손실 아님 — 사용자는
  정확히 명시값 결제, 컨트롤러 회계만 어긋남.

Even so, defending against operator misconfiguration aligns with the
project's "defensive design" principle (see also ADR-005 strict
commitment binding and ADR-006 reward-asset whitelist).

그래도 운영자 오설정에 대한 방어는 프로젝트의 "방어적 설계" 원칙과 일관
(ADR-005 strict commitment binding, ADR-006 reward-asset whitelist 참조).

### Decision / 결정

Add an internal helper `_safeReceiveExactly(token, payer, amount)` that:

1. Reads the controller's balance of `token` before the transfer.
2. Calls `safeTransferFrom(payer, controller, amount)`.
3. Reads the post-transfer balance.
4. Reverts with `PaymentShortfall(token, amount, received)` if the
   delta is less than `amount`.

`registerWithToken` and `renewWithToken` use this helper instead of
calling `safeTransferFrom` directly.

내부 헬퍼 `_safeReceiveExactly(token, payer, amount)` 추가:
1. 전송 전 컨트롤러의 `token` 잔액 읽기
2. `safeTransferFrom(payer, controller, amount)` 호출
3. 전송 후 잔액 읽기
4. delta가 `amount`보다 작으면 `PaymentShortfall`로 revert

`registerWithToken`과 `renewWithToken`은 `safeTransferFrom`을 직접 호출하지
않고 이 헬퍼 사용.

### Consequences / 결과

**Benefits / 장점:**

- Fee-on-transfer tokens cannot silently leak revenue
- Operator misconfiguration surfaces immediately as a transaction
  revert, not as quiet accounting drift
- Explicit error type (`PaymentShortfall`) makes debugging
  trivial — message contains token address, expected, and received

**Trade-offs / 감수:**

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

### Coverage / 검증 범위

The `test/HostileERC20.test.ts` suite verifies:
- Fee-on-transfer token causes `PaymentShortfall` revert (happy
  defence path)
- Normal token (USDC mock, zero fee) registers cleanly (no false
  positive)
- False-return token caught by SafeERC20 (unchanged behaviour)

`test/HostileERC20.test.ts` 검증:
- fee-on-transfer 토큰이 `PaymentShortfall`로 revert (방어 동작)
- 정상 토큰(USDC mock, 수수료 0)은 정상 등록 (false positive 없음)
- false-return 토큰은 SafeERC20으로 차단 (기존 동작)

---

## ADR-011: Resolver profile expansion — text records and contenthash

**Status:** Accepted (May 2026)
**상태:** 확정 (2026년 5월)

### Context / 배경

The v0.9 resolver supported only three things: multi-coin addresses
(ENSIP-9 / ENSIP-11), reverse-name resolution (anti-spoofed), and
operator approval. Pre-mainnet feature-parity review against ENS,
Unstoppable Domains, and Base Names exposed two missing standard
resolver profiles that every major wallet and dApp already integrates
with on the ENS side.

v0.9 리졸버는 세 가지만 지원했음: 다중 코인 주소(ENSIP-9/11), 역방향
이름 해결(위조 방지), operator 승인. 메인넷 직전 ENS, Unstoppable
Domains, Base Names 대비 기능 검토 결과, 모든 주요 지갑·dApp이 ENS
쪽에서 이미 통합한 두 가지 표준 리졸버 프로파일이 빠져 있었음.

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

누락된 프로파일:

1. **EIP-634 — 텍스트 레코드.** `(node, key)` 쌍당 자유 키/값 문자열.
   대표 사용 사례: `avatar`, `url`, `email`, `description`,
   `com.twitter`, `com.github` 같은 namespaced 검증. 이게 없으면
   지갑이 `.dex` 도메인의 프로파일 카드를 렌더링할 수 없음.

2. **EIP-1577 — Contenthash.** 노드당 raw 바이트, multicodec prefix로
   대상 프로토콜(IPFS, IPNS, Swarm, Arweave) 식별. 이게 없으면
   `.dex` 도메인이 IPFS 인식 브라우저(Brave, Opera 등)가 직접 해석
   가능한 분산형 웹사이트를 호스팅할 수 없음.

A third item — ERC-165 `supportsInterface` — was missing entirely.
Without it, ENS-compatible tooling has no way to detect which
resolver profiles are implemented and must hardcode the assumption
or fall back to "try every call and see what works."

세 번째 누락 — ERC-165 `supportsInterface`. 이게 없으면 ENS 호환
툴이 어떤 리졸버 프로파일이 구현됐는지 탐지할 방법이 없고, 하드코딩
가정을 하거나 "모든 호출을 시도해보고 작동하는 거 쓰기" 방식으로
fallback해야 함.

### Decision / 결정

Extend `DXResolver` to implement EIP-634 and EIP-1577 *exactly* as
ENS implements them — same function signatures, same event signatures,
same indexed/non-indexed key pattern in `TextChanged`, same raw-bytes
storage in `contenthash`. Add ERC-165 `supportsInterface` reporting
all five relevant interface IDs.

`DXResolver`를 ENS와 *정확히 동일하게* EIP-634와 EIP-1577 구현 —
같은 함수 시그니처, 같은 이벤트 시그니처, `TextChanged`의 indexed/
non-indexed 키 패턴 동일, contenthash의 raw 바이트 저장 방식 동일.
다섯 개의 관련 interface ID를 보고하는 ERC-165 `supportsInterface`
추가.

The four reported interface IDs (beyond `0x01ffc9a7` for ERC-165
itself) are:

- `0xf1cb7e06` — ENSIP-9 multi-coin `addr(node, coinType)` (already implemented)
- `0x59d1d43c` — EIP-634 `text(node, key)` (new)
- `0xbc1c58d1` — EIP-1577 `contenthash(node)` (new)
- `0x691f3431` — ENS `name(node)` reverse (already implemented)

ERC-165 자체(`0x01ffc9a7`) 외에 보고되는 네 가지 interface ID:
ENSIP-9 다중 코인, EIP-634 텍스트, EIP-1577 contenthash, ENS
역방향 이름.

To prevent gas-DoS on storage writes, three length bounds are added:

```solidity
uint256 public constant MAX_TEXT_KEY_LENGTH = 64;
uint256 public constant MAX_TEXT_VALUE_LENGTH = 1024;
uint256 public constant MAX_CONTENTHASH_LENGTH = 128;
```

These are generous; the longest common ENS text key is around 30
characters, and the longest EIP-1577 contenthash encoding for any
existing protocol fits in 64 bytes.

쓰기 가스 DoS 방지를 위해 세 가지 길이 상한 추가. 여유 있는 값
— 가장 긴 일반 ENS 텍스트 키는 약 30자, 기존 프로토콜의 가장 긴
EIP-1577 contenthash 인코딩도 64바이트 이하.

### Why not other profiles? / 왜 다른 프로파일은 제외했나?

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

ENS의 다른 리졸버 프로파일은 의도적으로 미구현. ABI 레코드(실사용
~0.1%), DNS 레코드(DNSSEC 브리지 필요, v1 범위 외), 공개키 레코드
(ENS 자체에서 deprecated), Interface 레코드(투기적 사용 사례).

### Consequences / 결과

**Benefits / 장점:**

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

**Trade-offs / 감수:**

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

### Coverage / 검증 범위

The `test/Resolver-Text.test.ts` and `test/Resolver-Contenthash.test.ts`
suites together verify (21 tests):

- Set, read, overwrite, and delete operations for both record types
- Authorization (owner-only writes; operator approval via
  `setApprovalForAll`)
- Length bounds (rejection above max; acceptance at exact max)
- Expiry behaviour (reads return empty after `expiry + GRACE_PERIOD`)
- ERC-165 reports `true` for both `0x59d1d43c` and `0xbc1c58d1`
- Sample IPFS and IPNS contenthashes round-trip byte-for-byte

`test/Resolver-Text.test.ts`와 `test/Resolver-Contenthash.test.ts`가
총 21개 테스트로 검증: 양쪽 레코드 타입의 set/read/overwrite/delete,
권한(owner-only 쓰기, operator 승인), 길이 상한, 만료 후 동작,
ERC-165 보고, IPFS/IPNS 샘플 해시 round-trip.

---

## ADR-012: Permissionless voluntary burn after grace period

**Status:** Accepted (May 2026)
**상태:** 확정 (2026년 5월)

### Context / 배경

When a `.dex` domain expires and the holder does not renew within
the 30-day grace period, the domain becomes "available" again — any
new registrant can claim it. However, the underlying ERC-721 token
does not automatically disappear from the chain. Its `ownerOf()`
reverts (because `DXRegistrar.ownerOf` is overridden to revert on
expired tokens), but indexers such as OpenSea, Rarible, and
aggregators continue to display the token as an asset of the previous
holder. This creates "ghost" marketplace listings of names that are,
in protocol terms, no longer owned by anyone.

`.dex` 도메인이 만료되고 보유자가 30일 유예 기간 내 갱신하지 않으면
도메인은 다시 "사용 가능"이 됨 — 누구나 새로 등록 가능. 그러나 기반
ERC-721 토큰은 자동으로 체인에서 사라지지 않음. `ownerOf()`는 revert
하지만(만료 토큰에 대해 revert하도록 override됨), OpenSea, Rarible,
aggregator 같은 인덱서는 그 토큰을 이전 보유자의 자산으로 계속 표시.
프로토콜상 더 이상 누구의 소유도 아닌 이름의 "유령" 마켓플레이스
리스팅이 발생.

The previous holder has no economic incentive to clean up these
ghost listings: they let the name lapse precisely because they no
longer cared about it, and asking them to spend gas now would be
strange. Meanwhile, the existence of stale listings creates
real user confusion ("why is this name listed by someone else
when it's marked as 'available'?") and pollutes marketplace
search results.

이전 보유자는 유령 리스팅 정리에 경제적 인센티브 없음 — 더 이상
관심 없어서 이름을 만료시킨 건데, 이제 와서 가스를 쓰라고 요청하는
건 이상함. 한편 stale 리스팅의 존재는 실제 사용자 혼란을 야기
("'available'로 표시된 이름인데 왜 다른 사람이 listing 중?")하고
마켓플레이스 검색 결과를 오염시킴.

A partial mitigation already existed: when someone re-registers an
expired name, the `register()` function internally calls `_burn()`
on the old token before minting the new one. But this only fires
when re-registration happens. If a name expires and is never
re-registered, the token lingers indefinitely.

부분적 완화책은 이미 존재 — 누군가 만료된 이름을 재등록하면
`register()` 함수가 내부적으로 새 토큰 mint 전에 옛 토큰에 `_burn()`
호출. 그러나 이건 재등록이 일어날 때만 동작. 이름이 만료되고
재등록되지 않으면 토큰은 무기한 남음.

### Decision / 결정

Add a permissionless `burn(uint256 id)` function to `DXRegistrar`
that anyone can call once `expiry + GRACE_PERIOD < block.timestamp`.
The function deletes the ERC-721 token, the label string, and the
expiry record. Also update the existing implicit-burn inside
`register()` to emit `NameBurned` for consistency.

`DXRegistrar`에 권한 불필요 `burn(uint256 id)` 함수 추가 — `expiry
+ GRACE_PERIOD < block.timestamp`이면 누구나 호출 가능. ERC-721
토큰, 라벨 문자열, 만료 기록 모두 삭제. `register()` 내부의 기존
묵시적 burn도 일관성을 위해 `NameBurned` 이벤트 emit하도록 갱신.

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

### Why permissionless? / 왜 권한 불필요인가?

The alternative — restricting burn to the previous holder — was
considered and rejected.

대안 — burn을 이전 보유자로 제한 — 검토 후 거부.

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

**제한된 burn이 안 되는 이유:**

- 이전 보유자는 정의상 그 이름에 관심을 잃은 사람. 이제 가스를 쓰라
  요청하면 원래 전제 위반.
- 제3자(마켓 인덱서, 커뮤니티 정리 스크립트, 경쟁 이름 서비스)는
  stale 리스팅 정리에 인센티브 *있음*. 제한 모델로는 불가능.
- 안전 한계 — `expiry + GRACE_PERIOD` 이후만 burn 가능 — 가 정당
  보유자에게 권한 불필요 burn을 무위험으로 만듦. 유예 기간이
  지나지 않았으면 `available()`은 false, `burn()`은 `NotYetBurnable`로
  revert.

There is no way for permissionless burn to harm a legitimate holder
because `available()` is a strict, monotonic function of time and
the stored expiry. It can only return `true` if the holder has both
let the name expire *and* chosen not to renew during the entire
30-day grace window.

권한 불필요 burn이 정당 보유자에게 해를 끼칠 방법 없음 — `available()`
은 시간과 저장된 만료의 엄격한 단조 함수. 보유자가 이름을 만료시키고
*그리고* 30일 전체 유예 기간 동안 갱신하지 않기로 선택한 경우에만
true 반환 가능.

### Consequences / 결과

**Benefits / 장점:**

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

**Trade-offs / 감수:**

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

### Coverage / 검증 범위

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

`test/Registrar-Burn.test.ts`가 7개 테스트로 검증: 활성 이름에 대한
burn 거부, 유예 기간 중 burn 거부, 유예 이후 burn 성공, 권한 불필요
(제3자) burn 성공, 상태 정리(expiries/names 클리어), 재등록 시
묵시적 burn의 NameBurned 이벤트 emit, 발행되지 않은 토큰에 대한
burn 거부.

---



## How to add a new ADR / 새 ADR 추가 방법

When making a significant architectural decision:

1. Append a new section: `## ADR-NNN: short description`
2. Fill in **Status**, **Context**, **Decision**, **Consequences**
3. Reference earlier ADRs if the new decision supersedes or builds on them
4. Commit alongside the code change so the rationale is paired with the diff

중요한 아키텍처 결정 시:
1. `## ADR-NNN: 짧은 설명` 섹션 추가
2. **상태**, **배경**, **결정**, **결과** 작성
3. 이전 ADR이 대체되거나 기반이 되면 참조
4. 코드 변경과 함께 커밋하여 근거와 diff가 짝지어지도록
