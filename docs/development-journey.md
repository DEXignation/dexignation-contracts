# DEXignation Development Journey

This document captures the human story of building DEXignation —
not the formal architecture decisions (those live in
[`architecture-decisions.md`](./architecture-decisions.md)) and not
the technical deep-dive (that's [`architecture.md`](./architecture.md)).
This is the chronological account of what got built, what got deleted,
what got added, and what we learned along the way.

The story is told chapter by chapter. Each chapter corresponds to a
discrete development milestone with its own decisions, mistakes, and
recovery.

<details>
<summary>▶ 한국어로 보기</summary>

이 문서는 DEXignation 구축의 인간적인 이야기를 담습니다 — 공식 아키텍처
결정(그건 [`architecture-decisions.md`](./architecture-decisions.md)에
있음)이나 기술 심층 분석([`architecture.md`](./architecture.md))이 아닌,
무엇이 만들어졌고 무엇이 삭제됐으며 무엇이 추가됐는지, 그리고 그 과정에서
무엇을 배웠는지에 대한 시간순 기록입니다.

이야기는 챕터 단위로 진행됩니다. 각 챕터는 고유한 결정, 실수, 회복을
가진 별개의 개발 마일스톤에 대응합니다.

</details>

---

## Chapter 1: The 1,000-line deletion (v0.9)

The first version of DEXignation was, in retrospect, two projects
glued together: a name service, and a token economy on top of it.

The name service half was clean — namehash tree, ERC-721 registrar,
commit-reveal registration, multi-coin resolver. ENS-derived (MIT)
and well-trodden ground.

The token economy half was speculative. `DXNToken` (ERC20Votes with
hard cap, 197 lines). `DXNStaking` (multi-asset reward staking, 386
lines, hardened after one audit pass). `RevenueDistributor` (atomic
notify pattern, 203 lines). `DXContributionSBT` (soulbound badges
for contributors).

Total: about 1,000 lines of code that did not need to ship for v1
to be useful. Tokenomics were undecided. Korean securities law
(가상자산이용자보호법, 자본시장법) imposed real review obligations
on transferable token issuance. The audit firm flagged "scope sprawl"
as the single highest risk in their first pass.

So we deleted it. All of it. Token, staking, distributor, SBT —
gone. The decision is recorded in [ADR-001](./architecture-decisions.md#adr-001).

The name service half remained. It was simpler. It was correct.
It was the actual product.

<details>
<summary>▶ 한국어로 보기</summary>

DEXignation의 첫 버전은 돌이켜보면 두 프로젝트가 붙은 것이었습니다:
이름 서비스, 그리고 그 위의 토큰 경제.

이름 서비스 쪽은 깔끔했습니다 — namehash 트리, ERC-721 registrar,
commit-reveal 등록, 다중 코인 리졸버. ENS에서 파생(MIT)된 검증된
영역입니다.

토큰 경제 쪽은 투기적이었습니다. `DXNToken`(hard cap이 있는 ERC20Votes,
197줄). `DXNStaking`(다중 자산 보상 스테이킹, 386줄, 한 차례 audit
후 강화). `RevenueDistributor`(원자적 notify 패턴, 203줄).
`DXContributionSBT`(기여자용 소울바운드 배지).

총합: v1이 유용하기 위해 ship할 필요가 없는 약 1,000줄 코드. 토크노믹스
미정. 한국 증권법(가상자산이용자보호법, 자본시장법)이 양도 가능 토큰
발행에 실질적 검토 의무 부과. Audit firm이 첫 패스에서 "범위 비대"를
단일 최고 위험으로 표시.

그래서 삭제했습니다. 전부. 토큰, 스테이킹, distributor, SBT — 없어졌습니다.
결정은 [ADR-001](./architecture-decisions.md#adr-001)에 기록됨.

이름 서비스 쪽은 남았습니다. 더 간단했습니다. 정확했습니다. 그것이 실제
제품이었습니다.

</details>

### What survived deletion / 삭제에서 살아남은 것

The codebase after deletion:

- 9 contracts (was 13)
- ~3,100 lines of Solidity (was ~4,100)
- 49 passing tests (none regressed)
- Single product surface: register, renew, resolve, reverse-resolve

The audit firm marked the deleted-token scope as resolved on their
second pass.

<details>
<summary>▶ 한국어로 보기</summary>

삭제 후 코드베이스:

- 9개 컨트랙트 (이전 13개)
- 약 3,100줄 Solidity (이전 약 4,100줄)
- 통과 테스트 49개 (회귀 없음)
- 단일 제품 표면: 등록, 갱신, 해결, 역방향 해결

Audit firm이 두 번째 패스에서 삭제된 토큰 범위를 해결됨으로 표시.

</details>

---

## Chapter 2: The Amoy deployment that almost shipped

With the v0.9 codebase clean and tested, we deployed to Polygon Amoy
testnet (chainId 80002). All 9 contracts verified on PolygonScan and
Sourcify. Contract addresses were committed to `deployments/amoy.md`.

The frontend team integrated. MetaMask connected. The first test
registration of `roy.dex` went through cleanly. We were ready to
freeze v1 and start beta testing.

Then we tried to set a reverse name. `setName("roy.dex")` on
`DXReverseRegistrar` reverted with `NotAuthorized`.

The bug was subtle. The deployment script had wired up the forward
namespace correctly (the controller could create subnodes under
`.dex`), but had not wired up the *reverse* namespace. ENS uses a
special `addr.reverse` subtree where each address gets a node
keyed by its hex representation, and that subtree needs to be
delegated to the reverse registrar contract at deploy time.

Two missing `setSubnodeOwner` calls. Three lines of code. But
they had to be added *to the deployment module*, which meant the
old Amoy deployment was, in a real sense, broken.

<details>
<summary>▶ 한국어로 보기</summary>

v0.9 코드베이스가 정리되고 테스트된 상태에서 Polygon Amoy 테스트넷
(chainId 80002)에 배포했습니다. 9개 컨트랙트 모두 PolygonScan과
Sourcify에서 verified. 컨트랙트 주소는 `deployments/amoy.md`에
커밋됨.

프론트엔드 팀이 통합했습니다. MetaMask가 연결됐습니다. `roy.dex`의 첫
테스트 등록이 깔끔하게 진행됐습니다. v1을 freeze하고 베타 테스트를
시작할 준비가 됐습니다.

그리고 역방향 이름을 설정하려 했습니다. `DXReverseRegistrar`의
`setName("roy.dex")`이 `NotAuthorized`로 revert했습니다.

버그는 미묘했습니다. 배포 스크립트는 정방향 네임스페이스를 정확히 wiring
(controller가 `.dex` 아래 subnode 생성 가능)했지만 *역방향* 네임스페이스는
wiring하지 않았습니다. ENS는 특별한 `addr.reverse` 서브트리를 사용 — 각
주소는 그 hex 표현으로 키된 노드를 받고, 이 서브트리는 배포 시점에 reverse
registrar 컨트랙트에 위임되어야 합니다.

누락된 `setSubnodeOwner` 호출 두 개. 코드 세 줄. 그러나 그것이 *배포
모듈에* 추가되어야 했고, 그 말은 옛 Amoy 배포가 실질적으로 망가졌다는
뜻이었습니다.

</details>

### The choice: patch or redeploy / 선택: 패치 vs 재배포

Option A was a one-off patch script: a TypeScript file that, run
once against the existing deployment, would call the missing
`setSubnodeOwner` invocations using the deployer key. The old
Amoy contracts would survive; only the registry state would change.

Option B was a clean redeploy: trash the existing Amoy state,
deploy fresh contracts with the fixed deployment module, get new
addresses, update every downstream document.

We went with B. The reasoning was straightforward: the Amoy
deployment is supposed to be the *exact* shape we'll deploy to
Polygon mainnet, minus the network. If the production deployment
module has bugs that get patched out-of-band on testnet, then the
production deployment is unrehearsed. That's exactly the kind
of risk a testnet exists to surface.

So we backed up the old Amoy state (`chain-80002` →
`chain-80002-old-2026-05-27`) and prepared to redeploy.

<details>
<summary>▶ 한국어로 보기</summary>

옵션 A: 일회성 패치 스크립트. 기존 배포에 대해 한 번 실행하면 deployer
키로 누락된 `setSubnodeOwner` 호출을 수행하는 TypeScript 파일. 옛 Amoy
컨트랙트는 살아남고, registry 상태만 변경됨.

옵션 B: 깨끗한 재배포. 기존 Amoy 상태 폐기, 수정된 배포 모듈로 새 컨트랙트
배포, 새 주소 획득, 모든 하위 문서 갱신.

B를 선택했습니다. 이유는 단순합니다 — Amoy 배포는 Polygon 메인넷에 배포할
*정확한* 형태(네트워크만 다름)여야 합니다. 프로덕션 배포 모듈에 버그가
있고 그것이 테스트넷에서 out-of-band로 패치된다면, 프로덕션 배포는 리허설
되지 않은 것입니다. 그것이 정확히 테스트넷이 surface하기 위해 존재하는
종류의 위험입니다.

그래서 옛 Amoy 상태를 백업하고 (`chain-80002` →
`chain-80002-old-2026-05-27`) 재배포를 준비했습니다.

</details>

---

## Chapter 3: Feature parity review

While preparing the redeploy, we ran a side-by-side comparison
against ENS, Unstoppable Domains, and Base Names. The goal was
not feature *parity* per se — DEXignation deliberately omits some
ENS features (governance token, off-chain CCIP-Read) and emphasizes
others (stablecoin payments, on-chain SVG metadata). The goal was
to make sure that whatever differences existed were *intentional*.

The review surfaced six items where DEXignation lagged behind:

1. **Text records** (EIP-634) — every comparable service has them
2. **Contenthash** (EIP-1577) — every comparable service has them
3. **Subdomain delegation** — ENS and Unstoppable have it, Base doesn't
4. **Multi-coin addresses** (ENSIP-9/11) — every comparable service has it
5. **ERC-165 `supportsInterface`** — implicit standard; absence breaks tooling
6. **Voluntary burn after grace** — nobody does it well; opportunity

<details>
<summary>▶ 한국어로 보기</summary>

재배포 준비 중 ENS, Unstoppable Domains, Base Names와 나란히 비교했습니다.
목표는 기능 *동등성* 자체가 아니었습니다 — DEXignation은 의도적으로 일부
ENS 기능을 생략(거버넌스 토큰, off-chain CCIP-Read)하고 다른 것을 강조
(스테이블코인 결제, on-chain SVG 메타데이터)합니다. 목표는 어떤 차이가
존재하든 그것이 *의도적*인지 확인하는 것이었습니다.

검토는 DEXignation이 뒤처진 여섯 항목을 surface했습니다:

1. **텍스트 레코드** (EIP-634) — 모든 비교 가능 서비스에 있음
2. **Contenthash** (EIP-1577) — 모든 비교 가능 서비스에 있음
3. **서브도메인 위임** — ENS, Unstoppable에는 있고 Base에는 없음
4. **다중 코인 주소** (ENSIP-9/11) — 모든 비교 가능 서비스에 있음
5. **ERC-165 `supportsInterface`** — 암묵적 표준; 부재 시 툴링 손상
6. **유예 후 자발적 burn** — 잘 하는 곳 없음; 기회

</details>

### The "already there" moment / "이미 있었다" 순간

We opened the resolver to figure out where to add multi-coin
support. The function was already implemented. So was `setAddr`.
So was `EVMCoinUtils.isEVMCoinType()`. So were three passing tests
covering it.

Months ago, during an earlier sprint, we had implemented ENSIP-9
and ENSIP-11. And then forgotten. There was a vague memory of
"addresses being a thing" but nothing concrete. The cost of
forgetting was an hour of confusion. The cost of remembering
would have been opening one file.

Six items became five.

<details>
<summary>▶ 한국어로 보기</summary>

리졸버를 열어 다중 코인 지원을 추가할 위치를 찾으려 했습니다. 그 함수는
이미 구현되어 있었습니다. `setAddr`도. `EVMCoinUtils.isEVMCoinType()`도.
그것을 다루는 통과 테스트 세 개도.

몇 달 전 이전 스프린트에서 ENSIP-9과 ENSIP-11을 구현했었습니다. 그리고
잊었습니다. "주소가 있다"는 막연한 기억은 있었지만 구체적인 것은 없었습니다.
잊은 비용은 한 시간의 혼란이었습니다. 기억한 비용은 파일 하나를 여는
것이었을 겁니다.

여섯 항목이 다섯으로.

</details>

### The sub-product test / 서브 프로덕트 테스트

For each remaining item, we asked: *is this a single contract
function with clear semantics, or is it a sub-product with its
own business model?*

| Item | Single function? | Sub-product? | Decision |
|---|---|---|---|
| Text records | Yes — EIP-634 fully specifies it | No | **Ship in v1.0** |
| Contenthash | Yes — EIP-1577 fully specifies it | No | **Ship in v1.0** |
| ERC-165 | Yes — return a fixed set of IDs | No | **Ship in v1.0** |
| Voluntary burn | Yes — well-defined safety bound | No | **Ship in v1.0** |
| Subdomains | No — pricing, fuses, revocation, NFT vs record | **Yes** | **Defer to v1.1** |

The four "single function" items together amounted to about 200
lines of contract code, 30 lines of interface, and 28 new tests.
Subdomain delegation, by contrast, was a multi-week design exercise
involving questions the team hadn't even discussed yet (do subdomains
cost USDC? can parents revoke? are subdomains themselves NFTs?
what's the fuses model?).

So: ship four, defer one. The decisions are recorded as
[ADR-011](./architecture-decisions.md#adr-011) (resolver expansion)
and [ADR-012](./architecture-decisions.md#adr-012) (voluntary burn).

<details>
<summary>▶ 한국어로 보기</summary>

남은 각 항목에 대해 물었습니다: *명확한 의미론을 가진 단일 컨트랙트
함수인가, 아니면 자체 비즈니스 모델을 가진 서브 프로덕트인가?*

| 항목 | 단일 함수? | 서브 프로덕트? | 결정 |
|---|---|---|---|
| 텍스트 레코드 | 예 — EIP-634이 완전히 명세 | 아니오 | **v1.0에 ship** |
| Contenthash | 예 — EIP-1577이 완전히 명세 | 아니오 | **v1.0에 ship** |
| ERC-165 | 예 — 고정된 ID 집합 반환 | 아니오 | **v1.0에 ship** |
| 자발적 burn | 예 — 잘 정의된 안전 한계 | 아니오 | **v1.0에 ship** |
| 서브도메인 | 아니오 — 가격, fuses, 회수, NFT vs 레코드 | **예** | **v1.1로 연기** |

네 개의 "단일 함수" 항목은 합쳐서 약 200줄 컨트랙트 코드, 30줄 인터페이스,
28개 새 테스트였습니다. 반면 서브도메인 위임은 팀이 아직 논의조차 하지
않은 질문들을 포함한 수 주짜리 설계 작업이었습니다(서브도메인은 USDC를
드는가? 부모가 회수 가능한가? 서브도메인 자체가 NFT인가? fuses 모델은?).

그래서 — 네 개 ship, 하나 연기. 결정은
[ADR-011](./architecture-decisions.md#adr-011)(리졸버 확장)과
[ADR-012](./architecture-decisions.md#adr-012)(자발적 burn)로 기록됨.

</details>

---

## Chapter 4: The 200-line addition

Implementation took about a week. The code itself was straightforward;
the goal was deliberately to implement the standards *exactly* as
ENS does them, not to "improve" anything.

`DXResolver` grew by two storage mappings and four external functions:

```solidity
mapping(bytes32 => mapping(string => string)) texts;
mapping(bytes32 => bytes) contenthashes;

function text(bytes32 node, string calldata key) external view returns (string memory);
function setText(bytes32 node, string calldata key, string calldata value) external;
function contenthash(bytes32 node) external view returns (bytes memory);
function setContenthash(bytes32 node, bytes calldata hash) external;
function supportsInterface(bytes4 interfaceId) external pure returns (bool);
```

`DXRegistrar` grew by one external function:

```solidity
function burn(uint256 id) external {
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

That's it. That's the entire feature surface. No new contracts,
no new external dependencies, no new admin functions.

<details>
<summary>▶ 한국어로 보기</summary>

구현은 약 일주일 걸렸습니다. 코드 자체는 직관적이었습니다 — 목표는
의도적으로 표준을 ENS가 하는 *정확히 그대로* 구현하는 것이었지, 무엇을
"개선"하는 것이 아니었습니다.

`DXResolver`는 두 개의 storage mapping과 네 개의 external 함수가 추가됨.

`DXRegistrar`는 하나의 external 함수가 추가됨.

그게 전부입니다. 그것이 전체 기능 표면입니다. 새 컨트랙트 없음, 새 외부
의존성 없음, 새 admin 함수 없음.

</details>

---

## Chapter 5: Two stupid bugs

We wrote 28 new tests. We ran them. Twenty-eight failed.

### Bug 1: a file in the wrong folder / 버그 1: 잘못된 폴더의 파일

```
HHE1001: There are multiple artifacts for contract "DXRegistrar"

contracts/registrar/DXRegistrar.sol:DXRegistrar
contracts/registry/DXRegistrar.sol:DXRegistrar
```

The codebase has two folders, `registry/` and `registrar/`, named
in the ENS tradition. `registry/` holds the ownership ledger
(`DXRegistry.sol`, `IDXRegistry.sol`). `registrar/` holds the NFT
issuance and lifecycle logic (`DXRegistrar.sol`, plus
`DXRegistrarController.sol`, `DXReservations.sol`,
`DXReverseRegistrar.sol`).

While copying updated files into the working directory, `DXRegistrar.sol`
landed in `registry/` by accident. Solidity's compiler doesn't care
which folder a file lives in — both copies compiled, both produced
artifacts, both got named `DXRegistrar`. Hardhat then refused to
deploy because it could not pick one.

The fix took ten seconds. The diagnosis took twenty minutes. The
lesson: when a tool says "multiple artifacts," it means *files*,
not abstract namespacing. Look for two files with the same name
before looking anywhere else.

<details>
<summary>▶ 한국어로 보기</summary>

코드베이스에는 ENS 관행에 따라 명명된 두 폴더가 있습니다 — `registry/`와
`registrar/`. `registry/`는 소유권 원장을 담음(`DXRegistry.sol`,
`IDXRegistry.sol`). `registrar/`는 NFT 발행과 생애주기 로직을 담음
(`DXRegistrar.sol`, 그리고 `DXRegistrarController.sol`,
`DXReservations.sol`, `DXReverseRegistrar.sol`).

업데이트된 파일을 작업 디렉토리에 복사하던 중 `DXRegistrar.sol`이 실수로
`registry/`에 들어갔습니다. Solidity 컴파일러는 파일이 어느 폴더에 있는지
신경 쓰지 않음 — 두 사본 모두 컴파일되고, 두 artifact를 생성하고, 둘 다
`DXRegistrar`로 이름이 됐습니다. 그 후 Hardhat은 하나를 선택할 수 없어
배포를 거부했습니다.

수정에 10초. 진단에 20분. 교훈: 도구가 "multiple artifacts"라고 하면
추상적 namespacing이 아니라 *파일*을 의미합니다. 다른 곳을 보기 전에
같은 이름의 파일 두 개부터 찾으세요.

</details>

### Bug 2: encodePacked vs abi.encode / 버그 2: encodePacked vs abi.encode

In Solidity, these are two distinct functions producing two distinct
byte arrays for the same inputs:

```solidity
abi.encode(label, owner, duration, ...)        // 32-byte-aligned padded
abi.encodePacked(label, owner, duration, ...)  // tightly packed, no padding
```

In viem, the JavaScript counterparts are `encodeAbiParameters` and
`encodePacked` respectively.

The new test files used `encodePacked` for commitment hashes because
the existing `subnodeFor` helper (which computes ENS-style namehash)
legitimately uses packed encoding. Muscle memory reused the same
encoding for `keccak256(abi.encode(label, owner, duration, resolver, paymentToken, secret))`
— except it should have been `encodeAbiParameters`, because that's
what the contract uses.

The result: every test failed with `CommitmentNotFound`. Each test
was computing a commitment hash with packed encoding, committing it,
then trying to register — and the register call recomputed the
commitment with abi.encode, got a different hash, and reverted.

The fix was three lines per file (import + commitment call). The
diagnosis took an hour, because the error message ("commitment not
found") implies a contract logic bug, not a test-helper encoding
mismatch.

The two encodings have legitimate, distinct uses:

- **ENS-style namehash**: `keccak256(abi.encodePacked(parentNode, labelhash))`
  — fixed-size inputs, no ambiguity, packed is correct.
- **Commitment hash**: `keccak256(abi.encode(label, owner, duration, ...))`
  — variable-length string `label` plus other fields. Packed encoding
  here would be ambiguous (the boundary between `label` and `owner`
  would shift with label length).

Lesson: any time `encodePacked` and `keccak256` appear in the same
line, stop and verify which one the call needs.

<details>
<summary>▶ 한국어로 보기</summary>

Solidity에서 이 둘은 같은 입력에 대해 서로 다른 바이트 배열을 생성하는
별개의 함수입니다:

- `abi.encode(...)` — 32바이트 정렬 패딩
- `abi.encodePacked(...)` — 빈틈없이 패킹, 패딩 없음

viem에서는 각각 `encodeAbiParameters`와 `encodePacked`.

새 테스트 파일들은 commitment 해시에 `encodePacked`를 사용했습니다 — 기존
`subnodeFor` 헬퍼(ENS 스타일 namehash 계산)가 합당하게 패킹 인코딩을
사용하기 때문. 근육 기억이 같은 인코딩을 `keccak256(abi.encode(label,
owner, duration, resolver, paymentToken, secret))`에 재사용했습니다 —
그런데 그건 `encodeAbiParameters`여야 했습니다, 컨트랙트가 그걸 사용하기
때문에.

결과: 모든 테스트가 `CommitmentNotFound`로 실패. 각 테스트는 패킹 인코딩
으로 commitment 해시를 계산하고 commit한 후 등록을 시도 — 그리고 register
호출은 abi.encode로 commitment를 재계산, 다른 해시를 얻고 revert.

수정은 파일당 세 줄(import + commitment 호출). 진단에 한 시간 — 에러
메시지("commitment not found")가 테스트 헬퍼 인코딩 mismatch가 아니라
컨트랙트 로직 버그를 암시하기 때문.

두 인코딩은 합당한 별개의 용도를 가집니다:

- **ENS 스타일 namehash**: `keccak256(abi.encodePacked(parentNode, labelhash))`
  — 고정 크기 입력, 모호성 없음, 패킹 정확.
- **Commitment 해시**: `keccak256(abi.encode(label, owner, duration, ...))`
  — 가변 길이 문자열 `label` + 다른 필드. 여기서 패킹 인코딩은 모호함
  (label과 owner 사이 경계가 label 길이에 따라 이동).

교훈: `encodePacked`와 `keccak256`이 같은 줄에 나타날 때마다 멈추고 어떤
것이 필요한지 확인할 것.

</details>

---

## Chapter 6: 79 passing

After both bugs were fixed and the files were in their correct
directories, the test suite settled:

```
  79 passing (36s)
  0 failing
```

Breakdown:

| Suite | Tests |
|---|---|
| DXNamehash | 4 |
| DXRegistrarController | 3 |
| DXReservations | 9 |
| Fuzz | 3 |
| Holder discount | 11 |
| Hostile ERC-20 | 6 |
| Invariants | 6 |
| MEV | 7 |
| DXRegistrar — burn (NEW) | 7 |
| DXResolver — contenthash (NEW) | 9 |
| DXResolver — text (NEW) | 14 |
| **Total** | **79** |

49 baseline + 30 new. No regressions. ERC-165 `supportsInterface`
returns `true` for all four standard interface IDs. The resolver
is now byte-compatible with the ENS resolver interface; any wallet
that already integrates with ENS can read `.dex` records through
its existing code path.

<details>
<summary>▶ 한국어로 보기</summary>

두 버그가 모두 수정되고 파일이 올바른 디렉토리에 위치한 후, 테스트
suite가 안정됐습니다:

기존 49 + 새 30. 회귀 없음. ERC-165 `supportsInterface`가 네 개의 표준
interface ID에 대해 모두 `true` 반환. 리졸버는 이제 ENS 리졸버 인터페이스와
바이트 호환 — ENS와 이미 통합한 모든 지갑이 기존 코드 경로로 `.dex`
레코드를 읽을 수 있음.

</details>

---

## What's deferred and why / 연기된 것과 그 이유

Subdomain delegation is the obvious next feature. It is also the
feature with the most undecided product questions:

- **Pricing**: do subdomains cost USDC? Are they free to the parent?
  Can the parent set their own price?
- **Token vs record**: are subdomains themselves NFTs (like ENS
  NameWrapper) or just resolver records (like classic ENS)?
- **Revocation**: can the parent owner reclaim a subdomain at will?
  Or are there ENS-style "fuses" that lock down the parent's power?
- **Marketplace implications**: if subdomains are NFTs and the parent
  can revoke them, marketplaces have a trust problem. If they cannot
  be revoked, then a parent who delegates `wallet.alice.dex` to a
  third party can never get it back.

Each of these is a fork in the road for the entire product. They
will get their own design cycle, their own audit milestone, and
their own launch. That's v1.1.

What v1.0 ships with: text records, contenthash, multi-coin
addresses, ERC-165, voluntary burn, all the existing v0.9 surface,
all the existing tests, plus 28 new tests. Standards-compliant.
Boring on purpose.

<details>
<summary>▶ 한국어로 보기</summary>

서브도메인 위임은 명백한 다음 기능입니다. 또한 가장 많은 미결 제품
질문을 가진 기능입니다:

- **가격**: 서브도메인이 USDC를 드는가? 부모에게 무료인가? 부모가 자기
  가격을 정할 수 있는가?
- **토큰 vs 레코드**: 서브도메인 자체가 NFT인가(ENS NameWrapper처럼)
  아니면 단순히 리졸버 레코드인가(고전 ENS처럼)?
- **회수**: 부모 owner가 임의로 서브도메인을 회수할 수 있는가? 아니면
  부모의 권한을 잠그는 ENS 스타일 "fuses"가 있는가?
- **마켓플레이스 영향**: 서브도메인이 NFT이고 부모가 회수 가능하면,
  마켓플레이스는 신뢰 문제를 가짐. 회수 불가능하면, `wallet.alice.dex`를
  제3자에게 위임한 부모는 결코 되찾을 수 없음.

이들 각각은 전체 제품의 분기점입니다. 그들은 자체 설계 사이클, 자체 audit
마일스톤, 자체 launch를 가질 것입니다. 그것이 v1.1입니다.

v1.0이 ship하는 것: 텍스트 레코드, contenthash, 다중 코인 주소, ERC-165,
자발적 burn, 모든 기존 v0.9 표면, 모든 기존 테스트, 28개 새 테스트 추가.
표준 준수. 의도적으로 지루함.

</details>

---

## Roadmap from here / 여기서부터의 로드맵

```
v1.0 — current                  Tests passing, contracts ready
   ├── Amoy redeploy            in progress
   ├── PolygonScan verify       blocked on redeploy
   ├── Beta testing             1-2 weeks
   └── Polygon mainnet          contingent on beta

v1.1 — subdomain delegation     design cycle ahead
   ├── Pricing model decision
   ├── Token-vs-record decision
   ├── Revocation/fuses model
   ├── Audit milestone
   └── Mainnet add-on deploy

v1.2 — TBD                       likely candidates:
   ├── CCIP-Read off-chain resolution
   ├── ENS L2 bridge integration
   └── Multi-TLD support
```

<details>
<summary>▶ 한국어로 보기</summary>

```
v1.0 — 현재                     테스트 통과, 컨트랙트 준비
   ├── Amoy 재배포              진행 중
   ├── PolygonScan verify        재배포 차단
   ├── 베타 테스트               1-2주
   └── Polygon 메인넷            베타 결과에 따름

v1.1 — 서브도메인 위임          설계 사이클 예정
   ├── 가격 모델 결정
   ├── 토큰-vs-레코드 결정
   ├── 회수/fuses 모델
   ├── Audit 마일스톤
   └── 메인넷 add-on 배포

v1.2 — 미정                      유력 후보:
   ├── CCIP-Read off-chain 해결
   ├── ENS L2 브리지 통합
   └── 다중 TLD 지원
```

</details>

---

## Cross-references / 교차 참조

- [`architecture.md`](./architecture.md) — Technical deep-dive into
  the smart-contract layer
- [`architecture-decisions.md`](./architecture-decisions.md) — Formal
  ADRs for every major design decision (ADR-001 through ADR-012)
- [`../README.md`](../README.md) — Project overview, quick start
- [`../THIRD-PARTY-LICENSES.md`](../THIRD-PARTY-LICENSES.md) —
  Attribution for ENS-derived code (MIT)
- [`../SECURITY.md`](../SECURITY.md) — Disclosure policy
