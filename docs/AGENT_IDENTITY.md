# Agent Identity & Payment Routing

> Let a `.dex` name point to an AI agent's on-chain identity and payment endpoint. DEXignation does **not** reimplement agent standards — it bridges a human-readable name to the ones the ecosystem already settled on (ERC-8004 for identity, x402 for payment).

---

## The principle: reference, don't reinvent

By 2026 the agent economy has its standards. **ERC-8004** — backed by the Ethereum Foundation, MetaMask, Google, and Coinbase — went live on mainnet in January 2026 as the identity-and-reputation registry for AI agents, where each agent is an on-chain id (minted as an ERC-721) pointing to an off-chain *agent card* describing its capabilities and endpoints. **x402** revives the HTTP 402 "Payment Required" status code for per-request stablecoin payments, and has processed over 100 million payments across chains.

Competing with those would repeat the mistake of competing with ENS on naming. So DEXignation does the opposite: a `.dex` name *points to* an agent's ERC-8004 identity and x402 payment endpoint, exactly as ENS names point to addresses and content hashes. The standards stay theirs; we provide the human-readable bridge to them.

This mirrors the module-vs-proxy lesson elsewhere in the codebase: extend by pointing at and composing with what exists, not by re-building it.

<details><summary>▶ 한국어로 보기</summary>

2026년 에이전트 경제엔 이미 표준이 있습니다. **ERC-8004**(이더리움 재단·MetaMask·Google·Coinbase 후원)은 2026년 1월 메인넷에 출시된 AI 에이전트 신원·평판 레지스트리로, 각 에이전트는 온체인 id(ERC-721로 발행)이며 기능·엔드포인트를 기술한 오프체인 *agent card*를 가리킵니다. **x402**는 HTTP 402 "Payment Required" 코드를 되살려 요청당 스테이블코인 결제를 가능케 하며, 전 체인 1억 건 이상을 처리했습니다.

이것들과 경쟁하는 건 ENS와 네이밍으로 경쟁하는 실수의 반복입니다. 그래서 DEXignation은 반대로 합니다: `.dex` 이름이 에이전트의 ERC-8004 신원과 x402 결제 엔드포인트를 *가리킵니다* — ENS 이름이 주소·콘텐츠해시를 가리키듯. 표준은 그들 것이고, 우리는 사람이 읽을 수 있는 다리를 제공합니다.

이는 코드베이스의 모듈 vs 프록시 교훈과 같은 맥락입니다: 다시 만드는 게 아니라, 존재하는 것을 가리키고 조합해 확장합니다.

</details>

---

## What the resolver stores

A single record per node, holding only pointers. The agent's actual capabilities, service endpoints (MCP / A2A / HTTP), and spend policy live off-chain in the agent card; on-chain we keep just the trust-anchoring pointers.

```solidity
struct AgentRecord {
  address registry;   // external agent registry, e.g. ERC-8004 Identity Registry
  uint256 agentId;    // agent id within that registry (e.g. ERC-721 tokenId)
  string  cardURI;    // off-chain agent card (endpoints, capabilities, policy)
  address payTo;      // payment recipient (x402 settlement); may differ from owner
  address payToken;   // preferred token (e.g. USDC); address(0) = native
}
```

<details><summary>▶ 한국어로 보기</summary>

노드당 레코드 하나, 포인터만 저장. 에이전트의 실제 기능·서비스 엔드포인트(MCP/A2A/HTTP)·지출 정책은 오프체인 agent card에 있고, 온체인엔 신뢰 기준점 포인터만 둡니다.

</details>

---

## API

```solidity
// Owner/operator only
function setAgent(
  bytes32 node,
  address registry_,
  uint256 agentId,
  string  calldata cardURI,
  address payTo,
  address payToken
) external;

function clearAgent(bytes32 node) external;   // owner/operator only

// Views (return zero/empty for an expired node)
function getAgent(bytes32 node) external view
  returns (address registry_, uint256 agentId, string memory cardURI,
           address payTo, address payToken);

function agentPayment(bytes32 node) external view
  returns (address payTo, address payToken);   // x402 settlement lookup

function hasAgent(bytes32 node) external view returns (bool);
```

`agentPayment` is a deliberately small surface for the common case: a settlement layer (e.g. an x402 facilitator) that only needs "where do I send the stablecoin, and which token" can read the routing pair without decoding the whole record.

<details><summary>▶ 한국어로 보기</summary>

`agentPayment`는 흔한 경우를 위한 의도적으로 작은 인터페이스입니다: 정산 계층(예: x402 facilitator)이 "어디로 어떤 토큰을 보낼지"만 필요할 때 전체 레코드를 디코딩하지 않고 결제 라우팅 쌍만 읽을 수 있습니다.

</details>

---

## Example: pointing alice.dex at an agent

```solidity
// alice configures her name to represent her ERC-8004 agent and route
// x402 payments to her settlement address in USDC.
resolver.setAgent(
  aliceNode,
  ERC8004_IDENTITY_REGISTRY,   // the standard's registry
  aliceAgentId,                // her agent's id (ERC-721 tokenId)
  "ipfs://.../alice-agent.json",
  aliceSettlementAddress,
  USDC
);

// A counterparty that knows "alice.dex" can now resolve:
( , , , address payTo, address payToken) = resolver.getAgent(aliceNode);
// → send the x402 stablecoin payment to payTo in payToken
```

<details><summary>▶ 한국어로 보기</summary>

alice가 자기 이름을 ERC-8004 에이전트로 표현하고 x402 결제를 USDC로 자기 정산 주소에 라우팅하도록 설정. "alice.dex"를 아는 상대방은 이제 `getAgent`로 결제처를 해석할 수 있습니다.

</details>

---

## Properties

- **Pointers only** — the resolver implements neither ERC-8004 nor x402; it stores references to them. No standard is duplicated or forked.
- **Owner/operator gated** — `setAgent`/`clearAgent` use the same `onlyTokenOwner` authorization as text/contenthash records (owner or an approved operator).
- **Expiry-aware** — all reads (`getAgent`, `agentPayment`, `hasAgent`) return zero/empty for an expired node, consistent with the rest of the resolver. A lapsed name cannot keep advertising a stale payment address.
- **Separation of concerns** — mutable, rich data (capabilities, policy, endpoints) lives in the off-chain card; on-chain holds only the minimal, trust-anchoring pointers.

<details><summary>▶ 한국어로 보기</summary>

- **포인터만** — 리졸버는 ERC-8004도 x402도 구현하지 않고 참조만 저장. 표준 복제·포크 없음.
- **소유자/operator 게이팅** — `setAgent`/`clearAgent`는 text/contenthash와 동일한 `onlyTokenOwner` 권한(소유자 또는 승인된 operator).
- **만료 인지** — 모든 조회가 만료 노드에 0/공백 반환. 만료된 이름이 낡은 결제 주소를 계속 광고할 수 없음.
- **책임 분리** — 변경 잦고 풍부한 데이터(기능·정책·엔드포인트)는 오프체인 카드에, 온체인엔 최소 신뢰 기준점 포인터만.

</details>

---

## Tests

```
DXResolver — agent identity & payment routing (B1)   6 passing
  ✔ sets and reads the full agent record
  ✔ agentPayment returns just the routing pair
  ✔ hasAgent reflects whether a record is set
  ✔ non-owner cannot setAgent
  ✔ clearAgent removes the record
  ✔ returns empty/zero after the node expires
```

Total suite: **123 passing.**

<details><summary>▶ 한국어로 보기</summary>

6개 테스트가 전체 레코드 set/get, 결제 라우팅 조회, hasAgent, 비소유자 차단, clear, 만료 시 공백을 검증. 전체 **123 통과.**

</details>
