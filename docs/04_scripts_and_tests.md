# 04. How Scripts and Tests Were Built

> This document explains **the method and order** in which the tests and scripts
> were built, so the team can write new tests/scripts the same way.

<details><summary>▶ 한국어로 보기</summary>

이 문서는 테스트와 스크립트를 **어떤 방법과 순서로 만들었는지** 설명합니다.
개발팀이 같은 방식으로 새 테스트·스크립트를 작성할 수 있도록 하는 것이 목표입니다.

</details>

---

## 1. Test-writing philosophy

### 1.1 What we test

DEXignation tests cover all four layers:

1. **Happy path**: the intended normal behavior (register, resolve, renew, etc.).
2. **Permission boundaries**: what unauthorized parties cannot do (non-owner
   cannot ...).
3. **Boundary/edge values**: length caps, timing constraints, 0/empty values,
   expiry.
4. **Invariants/security**: properties that must always hold, attack scenarios.

In particular, a **"silently failing" bug like transfer safety** can never be
revealed by happy-path cases alone. That is why tests that explicitly assert "what
must be empty after transfer" were the key.

### 1.2 Test stack

- **Mocha** + **viem** (Hardhat 3 environment).
- Deployment via **Hardhat Ignition** modules. Every test uses the same setup via
  `ignition.deploy(DXDeployLocal)` → **module wiring is the test setup**.
- Time manipulation via `testClient.increaseTime` + `mine`.

<details><summary>▶ 한국어로 보기</summary>

DEXignation 테스트는 4개 층위를 다룹니다: ① 해피 패스 ② 권한 경계 ③ 경계값/엣지
④ 불변식/보안. 특히 **전송 안전성처럼 "조용히 실패하는" 버그**는 정상 케이스만으로는
드러나지 않아, "전송 후 무엇이 비어야 하는가"를 명시적으로 단언하는 테스트가
핵심이었습니다. 스택: Mocha + viem, 배포는 Ignition(`ignition.deploy(DXDeployLocal)` →
모듈 와이어링이 곧 테스트 셋업), 시간 조작은 `increaseTime` + `mine`.

</details>

---

## 2. Common test structure

Every test file follows a similar skeleton:

```typescript
import { expect } from "chai";
import { network } from "hardhat";
import { keccak256, toBytes, encodePacked, ... } from "viem";
import DXDeployLocal from "../ignition/modules/DXDeployLocal.js";

describe("feature name", function () {
  // (1) deploy helper: deploy the whole system via ignition + prepare wallets
  async function deploy() {
    const { ignition, viem } = await network.getOrCreate();
    const deployed = await ignition.deploy(DXDeployLocal);
    const [owner, alice, bob, ...] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();
    const testClient = await viem.getTestClient();
    return { ...deployed, owner, alice, bob, publicClient, testClient };
  }

  // (2) registration helper: commit → time jump → register
  async function registerName(deployed, registrant, label) { ... }

  // (3) individual it() cases
  it("behavior to verify", async function () {
    const d = await deploy();
    // ... perform the action ...
    expect(result).to.equal(expected);
  });
});
```

### 2.1 Core helper — node/tokenId computation

```typescript
function labelHash(label) { return keccak256(toBytes(label)); }
function tokenIdFromLabel(label) { return BigInt(labelHash(label)); }
function subnodeFor(parent, label) {
  return keccak256(encodePacked(["bytes32","bytes32"], [parent, labelHash(label)]));
}
function tldNode() {
  return subnodeFor("0x00...00", "dex");  // 32 zero bytes + "dex"
}
```

> **Important**: standardize on the `encodePacked` approach. Early scripts used
> string concatenation and caused confusion; we unified based on the verification
> script. Same result, but for consistency.

### 2.2 Registration helper (commit-reveal)

```typescript
async function registerName(deployed, registrant, label) {
  const { controller, resolver, testClient } = deployed;
  const secret = `0x${"ab".repeat(32)}`;
  const commitment = keccak256(encodeAbiParameters(
    parseAbiParameters("string, address, uint256, address, address, bytes32"),
    [label, registrant.account.address, ONE_YEAR, resolver.address, ZERO_ADDR, secret],
  ));
  await controller.write.commit([commitment], { account: registrant.account });
  await testClient.increaseTime({ seconds: MIN_COMMITMENT_AGE + 5 });  // time jump
  await testClient.mine({ blocks: 1 });
  const price = await controller.read.rentPrice([ONE_YEAR]);
  await controller.write.register(
    [label, registrant.account.address, ONE_YEAR, resolver.address, secret],
    { account: registrant.account, value: price },
  );
  return subnodeFor(tldNode(), label);
}
```

This helper shows how the commit-reveal timing constraint is skipped with
`increaseTime`. Locally, time can be manipulated freely.

### 2.3 Revert-check helper

```typescript
async function expectRevert(promise, keyword) {
  try { await promise; }
  catch (err) {
    if (keyword) expect(String(err)).to.include(keyword);
    return;
  }
  throw new Error(`Expected revert${keyword ? " with " + keyword : ""}`);
}
```

Used in "...cannot..." permission tests. It even verifies specific error messages
(`"Not authorized"`, `"Only registrar"`, etc.).

<details><summary>▶ 한국어로 보기</summary>

모든 테스트 파일은 비슷한 골격(배포 헬퍼 → 등록 헬퍼 → it 케이스)을 따릅니다.

- **노드/토큰ID 헬퍼**: `subnodeFor`는 `encodePacked(["bytes32","bytes32"], [parent,
  labelHash])` 방식으로 통일(일관성).
- **등록 헬퍼**: commit → `increaseTime`로 시간 점프 → register. 로컬에서는 시간을
  자유롭게 조작.
- **revert 검증 헬퍼**: "...cannot..." 권한 테스트에서 특정 에러 메시지("Not
  authorized", "Only registrar")까지 검증.

</details>

---

## 3. The order in which v2 transfer tests were built (a real case)

The process of building the transfer-safety tests is a good model for writing new
feature tests.

### STEP A — list what must be guaranteed

What transfer safety must guarantee:
- transfer → control transfer
- transfer → all 6 record kinds invalidated
- permission moves to the new owner
- resolution resumes when the new owner re-sets
- version increment + history preservation
- registration delivery does NOT invalidate (regression guard)
- mint has no effect (regression guard)

### STEP B — confirm signatures

Before writing tests, confirm the actual function signatures in the code:

```bash
grep -n "function setAddr\|function addr\|function setProfile\|function setAgent" DXResolver.sol
```

In particular, confirm that `setAddr`'s third argument is `bytes` (a 20-byte
address) and that `recordVersions` is `public` (so it has an auto-getter).

### STEP C — happy cases first, then edges

First write and pass the core behavior (`Transfer-Invalidation.test.ts`, 7), then
add the corners (`Transfer-Edge.test.ts`, 6).

### STEP D — run the full suite after each step

```bash
npx hardhat clean && npm test
```

Run the whole suite after every addition/change to check for **regressions**. In
fact, in STEP 3, one existing test failed and revealed the controller-delivery bug
— that is the value of regression testing.

<details><summary>▶ 한국어로 보기</summary>

전송 안전성 테스트를 만든 과정은 새 기능 테스트 작성의 좋은 모델입니다.

- **STEP A — 보증 목록화**: 제어권 이전·6종 무효화·권한 이전·해석 재개·버전 증가/이력·배달
  예외·mint 무영향.
- **STEP B — 시그니처 확인**: `grep`으로 `setAddr` 3번째 인자가 `bytes`(20바이트),
  `recordVersions`가 `public`임을 확인.
- **STEP C — 정상부터 엣지로**: `Transfer-Invalidation`(7) 통과 후 `Transfer-Edge`(6) 추가.
- **STEP D — 단계마다 전체 실행**: `npx hardhat clean && npm test`로 회귀 확인. STEP
  3에서 기존 1개 실패로 배달 버그 발견 — 회귀 테스트의 가치.

</details>

---

## 4. Script (scripts/) patterns

Scripts, unlike tests, run on **live networks** (`--network amoy/polygon`).

### 4.1 Live network vs local differences

| Item | Local test | Live-network script |
| --- | --- | --- |
| Time manipulation | `increaseTime` possible | not possible — must actually wait (`sleep`) |
| Price feed | mock set freely | real Chainlink feed (or deploy a mock) |
| Gas/balance | unlimited | real POL needed |
| RPC | in-memory | Alchemy etc., may be unstable |
| Tx finality | immediate | `waitForTransactionReceipt` needed |

### 4.2 Verification-script pattern (verify-transfer-amoy.ts)

```typescript
async function main() {
  const { viem } = await network.connect();
  const pub = await viem.getPublicClient();
  const [wallet] = await viem.getWalletClients();

  // (0) preflight — feed alive, mock refresh
  const mockFeed = await viem.getContractAt("MockPriceOracle", ADDR.mockPolUsd);
  await pub.waitForTransactionReceipt({
    hash: await mockFeed.write.updateAnswer([800000000n])  // prevent staleness
  });
  const price = await controller.read.rentPrice([DURATION]);  // confirm feed alive

  // (1) register: commit → real wait → register
  await pub.waitForTransactionReceipt({ hash: await controller.write.commit([commitment]) });
  await sleep(70000);  // actually wait 70s (increaseTime not possible)
  await pub.waitForTransactionReceipt({ hash: await controller.write.register(...) });

  // (2) set records + transfer + verify
  // ... transferFrom → read addr/text/version and confirm empty ...
}
```

Key: on a live network, **every write needs `waitForTransactionReceipt`**, **time
is real `sleep`**, and **the feed needs a staleness refresh**.

### 4.3 Safety-guard pattern

Verification scripts spend real funds, so we add guards:

```typescript
// stop so it doesn't go to 0xdead when recipient is unset
if (RECIPIENT === "0x00...dead") {
  console.log("RECIPIENT_ADDRESS unset — stopping");
  return;
}
// stop if the feed is dead
try { price = await controller.read.rentPrice([DURATION]); }
catch { console.log("feed dead — mock needed, stopping"); return; }
```

### 4.4 Registration-script pattern (register-roy.ts)

The actual mainnet registration script additionally:
- prints **balance + price** at the start → the user decides before proceeding
  (Ctrl+C if insufficient).
- performs a **wiring check** (recordResolver/registrar) → verifies the v2
  connection at the same time as registration.
- checks the **NFT tier** after registration (decode tokenURI).

<details><summary>▶ 한국어로 보기</summary>

스크립트는 테스트와 달리 **실네트워크**에서 실행됩니다.

- **로컬 vs 실네트워크**: 시간 조작(increaseTime↔sleep), 가격 피드(mock↔실제),
  가스(무한↔실제 POL), 트랜잭션 확정(즉시↔waitForReceipt).
- **검증 스크립트 패턴**: 모든 쓰기에 `waitForTransactionReceipt`, 시간은 실제
  `sleep`, 피드는 `updateAnswer`로 staleness 갱신.
- **안전장치**: 수령자 미설정/피드 사망 시 중단.
- **등록 스크립트**: 시작 시 잔액+가격 출력, 와이어링 확인(recordResolver/registrar),
  등록 후 NFT 등급 확인.

</details>

---

## 5. Deployment module (ignition/modules/) patterns

### 5.1 Module structure

```typescript
export default buildModule("DXDeployXXX", (m) => {
  // (1) deploy contracts
  const registry = m.contract("DXRegistry", []);
  const registrar = m.contract("DXRegistrar", [registry, TLD_NODE, TLD]);
  const resolver = m.contract("DXResolver", [registry]);
  // ...

  // (2) wiring (call order matters!)
  const grantTld = m.call(registry, "setSubnodeOwner",
    [zeroHash, TLD_LABEL_HASH, registrar], { id: "GrantTldToRegistrar" });
  m.call(registrar, "addController", [controller], { id: "AddController" });

  // (3) v2 wiring — guarantee execution after GrantTld (after)
  m.call(registrar, "setResolver", [resolver],
    { id: "SetRegistrarResolver", after: [grantTld] });
  m.call(resolver, "setRegistrar", [registrar],
    { id: "SetResolverRegistrar" });

  return { registry, registrar, resolver, ... };
});
```

### 5.2 Order dependency — the `after` lesson

`SetRegistrarResolver` internally requires the registrar to already own the
baseNode, so it **must run after `GrantTldToRegistrar`**. Ignition does not
guarantee order within the same batch without an explicit dependency (`after:`).

> We hit this on mainnet as an actual `Unauthorized()` error. Amoy passed by luck
> because the order happened to be right, but it surfaced in the mainnet batch
> arrangement. **Don't leave order to luck; declare it with `after`.**

### 5.3 The three deployment modules

| Module | Use | Feed |
| --- | --- | --- |
| `DXDeployLocal.ts` | local tests | MockPriceOracle |
| `DXDeployAmoy.ts` | Amoy testnet | real Amoy Chainlink (dead) |
| `DXDeployAmoyMock.ts` | Amoy verification | MockPriceOracle (bypass feed) |
| `DXDeployPolygon.ts` | mainnet | real Polygon Chainlink (normal) |

All modules must include the v2 wiring (setResolver/setRegistrar + after).

<details><summary>▶ 한국어로 보기</summary>

- **모듈 구조**: ① 컨트랙트 배포 ② 와이어링(호출 순서 중요) ③ v2 와이어링(`after`로
  GrantTld 이후 실행 보장).
- **순서 의존성 — after 교훈**: `SetRegistrarResolver`는 registrar가 baseNode 소유자일
  것을 요구하므로 반드시 `GrantTldToRegistrar` 이후 실행돼야 합니다. ignition은
  명시적 `after`가 없으면 같은 배치에서 순서를 보장하지 않습니다. 메인넷에서
  `Unauthorized()`로 실제 겪었고 Amoy는 운으로 통과 → 순서를 운에 맡기지 말 것.
- **세 배포 모듈**: Local(mock), Amoy(실제, 죽음), AmoyMock(mock 우회), Polygon(실제,
  정상). 모두 v2 와이어링 포함.

</details>

---

## 6. Checklist for adding a new test/script

The order to follow when the team adds a new feature:

1. **List what must be guaranteed** (happy/permission/boundary/invariant).
2. Confirm the **actual function signatures** in the code (`grep`).
3. Write tests in the order **happy → permission → boundary → edge**.
4. If deployment wiring is needed, reflect it in **all three deployment modules**
   (+ `after` order).
5. Check for **full regression** with `npx hardhat clean && npm test`.
6. If live-network behavior is needed, write a verification script
   (waitForReceipt, sleep, feed refresh, safety guards).
7. Verify on Amoy (mock) first → then mainnet.

<details><summary>▶ 한국어로 보기</summary>

1. **보증 목록화**(해피·권한·경계·불변식). 2. 코드에서 **실제 시그니처 확인**(grep).
3. **정상 → 권한 → 경계 → 엣지** 순으로 작성. 4. 배포 와이어링은 **세 모듈 전부**에
반영(+after). 5. `npx hardhat clean && npm test`로 **전체 회귀** 확인. 6. 실네트워크는
검증 스크립트(waitForReceipt·sleep·피드 갱신·안전장치). 7. Amoy(mock) 먼저 → 메인넷.

</details>
