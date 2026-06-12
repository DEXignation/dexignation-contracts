# 서브네임 판매-잠금(Sale-Lock) 정책

> 커밋 `5f80435` — *feat(subname): sale-lock policy so sold subnames can't be reclaimed*
> 대상: `DXRegistry`, `IDXRegistry`, `DXSubnameRegistrar`, 배포 모듈 4종, 회귀 테스트
> 작성일: 2026-06-12

---

## 1. 배경 — 무엇이 문제였나

DEXignation에서 도메인 소유자(예: `alice.dex`의 주인)는 자기 이름 아래 서브네임(`team.alice.dex`)을 **유상으로 판매**할 수 있다. 이 판매는 커머스 모듈 `DXSubnameRegistrar`가 담당한다.

문제는 **판매 이후 그 서브네임의 통제권**에 있었다. 변경 전 구조에서는, 부모 노드 소유자가 살아있는(미만료) 서브네임을 언제든 회수(`revokeSubnodeRecord`)하거나 다른 사람에게 재지정(`reassignSubnodeRecord`)할 수 있었다. 즉:

- 구매자 Bob이 `team.alice.dex`를 정당하게 샀는데,
- 부모 `alice.dex`의 소유자가 그 서브네임을 도로 회수하거나 제3자에게 넘길 수 있었다.
- 더 나아가, `alice.dex` 자체가 2차 시장에서 Carol에게 팔리면, **새 부모 소유자 Carol**이 Bob의 서브네임을 회수할 수 있었다.

이는 구매자가 돈을 주고 산 자산이 **판매자(또는 판매자의 후속 소유자) 의사로 언제든 박탈될 수 있다**는 뜻으로, 서브네임 커머스의 신뢰 기반을 무너뜨린다.

### 감사 지적과의 관계

1차 보안 점검에서 이 문제는 **Critical-A**로 분류되었다: *"서브네임 발급 경로에 만료/소유 체크가 없어, 활성 서브네임도 재판매 시 기존 소유자 레코드를 조용히 덮어쓸 수 있다(소유권 탈취 가능)."* 이번 변경이 그 항목을 닫는다.

동시에, 과거 버전의 잔존물이던 `SubdomainManager.sol`(감사 **Medium-#4**, registry에 기록도 안 하고 라벨 검증도 없던 dead code)도 함께 제거했다.

---

## 2. 정책 — 무엇을 보장하는가

이번 변경의 핵심 규칙은 하나다: **"판매된 서브네임은 부모 도메인이 유효한 동안 구매자의 것이다."**

세부 동작은 네 가지로 정리된다.

| # | 상황 | 동작 |
|---|------|------|
| 1 | 커머스 모듈로 **판매된** 서브네임 (라이브) | 부모도, 새 2LD 구매자도 회수·재지정 **불가** |
| 2 | 부모 도메인이 **만료됨** | 서브네임도 만료 상태로 간주되어 해석/사용이 중단됨 |
| 3 | 부모가 **직접 무상 발급**한 서브네임 | 잠금 **없음** → 부모가 자유롭게 회수·재지정 (기존 동작 유지) |
| 4 | 같은 라벨을 **라이브 상태에서 중복 판매** 시도 | `SubnodeExists`로 거부 (덮어쓰기 차단) |

여기서 1번과 3번의 구분이 설계의 핵심이다. **"판 것"은 잠그고, "그냥 나눠준 것"은 안 잠근다.** 부모가 내부 팀에게 무상으로 발급한 서브네임까지 잠가버리면 부모가 자기 자원을 관리하지 못하게 되므로, 유상 판매분만 선별적으로 보호한다.

---

## 3. 구현 — 어떻게 동작하는가

### 3.1 "판매 잠금" 표식

레지스트리에 서브노드 단위로 잠금 여부를 저장하는 상태를 추가했다.

```solidity
// DXRegistry.sol
mapping(bytes32 => bool) public subnodeSaleLocked;  // 서브노드 => 판매-잠금 여부
mapping(address => bool) public saleModule;         // 모듈 => 판매 모듈 인가 여부
```

`subnodeSaleLocked[subnode]`가 `true`이고 그 서브노드가 아직 살아있으면(`!isExpired`), 부모의 회수·재지정이 차단된다.

### 3.2 발급 경로 분리

발급 함수를 **두 갈래**로 나눈 것이 핵심이다.

- `issueSubnodeRecord(...)` — **무상 발급**. 잠금을 걸지 않는다. 부모가 직접 호출. *(기존 동작, 변경 없음)*
- `issueSubnodeRecordLocked(...)` — **판매 발급**. 잠금을 건다. 인가된 커머스 모듈만 호출 가능.

```solidity
// DXRegistry.sol — 판매 발급 (요지)
function issueSubnodeRecordLocked(
    bytes32 node,
    string calldata label,
    address _owner,
    address _resolver
) external onlySaleModule authorised(node) returns (bytes32 subnode) {
    if (_owner == address(0)) revert InvalidRecipient();
    bytes32 labelHash = _validateSubnodeLabel(label);   // 라벨 검증은 레지스트리가 일원 처리
    subnode = keccak256(abi.encodePacked(node, labelHash));
    if (records[subnode].owner != address(0)) revert SubnodeExists(subnode);  // 라이브 중복 차단

    _setSubnodeRecord(node, subnode, labelHash, _owner, _resolver);
    subnodeSaleLocked[subnode] = true;   // ← 판매 잠금 표시
    _invalidate(subnode);
    emit SubnodeIssuedLocked(node, subnode, label, _owner);
}
```

### 3.3 회수·재지정 가드

`reassignSubnodeRecord`와 `revokeSubnodeRecord` 양쪽에 동일한 가드를 한 줄씩 넣었다.

```solidity
// 라이브 판매-잠금 서브노드는 부모가 건드릴 수 없다.
if (subnodeSaleLocked[subnode] && !isExpired(subnode)) {
    revert SubnodeSaleLocked(subnode);
}
```

- **`isExpired`는 부모 만료를 상속**한다(부모 체인을 거슬러 올라가며 검사). 따라서 부모가 만료되면 자식도 만료로 간주된다.
- 판매 모듈은 별도 서브네임 기간을 저장하지 않는다. 서브네임의 유효성은 registry의 부모 만료 체인을 동적으로 따른다.
- 부모가 직접 무상 재발급(`issueSubnodeRecord`)하는 경로는 판매-잠금을 걸지 않으며, 같은 라벨을 새로 발급할 수 있는 상태라면 이전 판매의 잔여 잠금을 정리한다.

### 3.4 권한 모델 — 이중 게이트 (Pattern A)

`issueSubnodeRecordLocked`를 호출하려면 **두 가지 인가**가 동시에 필요하다. 방어 심층화(defence in depth)다.

1. **레지스트리의 판매 모듈 인가** — 루트 노드(`0x0`) 소유자(= 배포자/관리자)가 `setSaleModule(module, true)`로 해당 모듈을 등록해야 한다.
2. **부모의 위임** — 부모 노드 소유자가 `registry.setApprovalForAll(module, true)`로 그 모듈에게 자기 노드 조작을 위임해야 한다(`authorised(node)` 통과 조건).

둘 중 하나라도 없으면 발급이 불가능하다. 즉 *인가된 모듈* 이면서 *부모가 위임한 노드* 에 대해서만 판매 잠금을 걸 수 있다.

```solidity
function setSaleModule(address module, bool allowed) external authorised(0x0) {
    saleModule[module] = allowed;
    emit SaleModuleSet(module, allowed);
}
```

### 3.5 커머스 모듈의 변경

`DXSubnameRegistrar`는 발급 호출을 `setSubnodeRecord` → `issueSubnodeRecordLocked`로 교체했다. 동시에, 모듈 안에 중복으로 있던 라벨 검증과 중복 차단 로직을 제거했다 — 이제 레지스트리가 단일 진실 원천(single source of truth)으로 `_validateSubnodeLabel`(NFC·길이·문자 정책)과 `SubnodeExists`(중복)를 처리한다. 검증 로직이 두 곳에 흩어져 어긋나는 것을 막는다.

모듈은 커머스 고유 책임(가격, 판매 토글, 접근 게이트, 수수료 분배, 위임 확인)만 담당한다.

---

## 4. 시나리오 예시

### 예시 A — 정상 판매와 보호

```
1. alice.dex 소유자 Alice가 판매를 연다:
   - subnameRegistrar.configureSubname(aliceNode, price=1 POL, enabled=true)
   - registry.setApprovalForAll(subnameRegistrar, true)   // 모듈에 위임

2. Bob이 team.alice.dex를 구매:
   - subnameRegistrar.registerSubname(aliceNode, "team") + 1 POL 지불
   - 결과: team.alice.dex 소유자 = Bob, subnodeSaleLocked = true
   - 수수료(5%)는 RevenueDistributor로, 나머지는 Alice에게

3. Alice가 회수를 시도:
   - registry.revokeSubnodeRecord(aliceNode, "team", ...) → revert SubnodeSaleLocked
   - Bob의 소유권은 그대로 유지된다. ✓
```

### 예시 B — 2LD가 팔려도 보호 유지

```
1. Alice가 alice.dex 자체를 Carol에게 판매 (마켓플레이스).
   - 이제 부모 노드 소유자는 Carol.

2. Carol이 Bob의 team.alice.dex를 회수 시도:
   - registry.reassignSubnodeRecord(aliceNode, "team", carol, ...) → revert SubnodeSaleLocked
   - 부모가 바뀌어도 판매-잠금은 서브노드에 붙어있으므로 Bob은 보호된다. ✓
```

### 예시 C — 부모 만료 상속

```
1. alice.dex가 만료됨.
   - registry.isExpired(aliceNode) == true
   - registry.isExpired(teamNode) == true

2. team.alice.dex도 부모 만료를 상속해 비활성으로 취급된다.
   - 별도 서브네임 duration을 갱신하거나 매일 재설정할 필요가 없다. ✓
```

### 예시 D — 무상 발급은 자유롭게 관리 (기존 동작)

```
1. Alice가 내부 팀원에게 무상 발급:
   - registry.issueSubnodeRecord(aliceNode, "dev", teamMember, ...)
   - subnodeSaleLocked = false (잠금 없음)

2. Alice가 나중에 재지정:
   - registry.reassignSubnodeRecord(aliceNode, "dev", anotherMember, ...) → 성공
   - 무상 발급분은 부모가 자유롭게 관리한다. ✓
```

---

## 5. 검증 — 테스트

회귀 테스트 `test/Subname-Commerce.test.ts`에 8개 시나리오를 추가했다.

| 테스트 | 검증 내용 |
|--------|-----------|
| sells a subname (sale-locked) | 판매 시 잠금 표시 + 소유권 이전 + 수익 분배 |
| blocks parent from REVOKING | 라이브 판매분 회수 시도 → `SubnodeSaleLocked` |
| blocks parent from REASSIGNING | 라이브 판매분 재지정 시도 → `SubnodeSaleLocked` |
| marks sold subname expired with parent | 부모 만료 시 판매 서브네임도 만료 상태 |
| does NOT lock parent-DIRECT issuance | 무상 발급은 잠금 없음 + 재지정 가능 |
| rejects non-authorised caller | 비인가 호출 → `NotSaleModule` |
| rejects when parent NOT delegated | 미위임 → `ModuleNotApproved` |
| rejects duplicate live sale | 라이브 중복 판매 → `SubnodeExists` |

**현재 타겟 검증:** `npm test -- test/Subname-Commerce.test.ts` 기준 **8 passing**. 전체 회귀 검증은 배포 전 별도로 실행한다.

---

## 6. 배포 시 주의사항

### 자동으로 처리되는 것

배포 모듈(`DXDeployLocal` / `DXDeployPolygon` / `DXDeployAmoy` / `DXDeployAmoyMock`)이 다음을 자동 수행한다:

- `DXSubnameRegistrar` 배포
- `registry.setSaleModule(subnameRegistrar, true)` — 모듈을 판매 모듈로 인가

> 트레이딩 모듈(`DXDeployTrading` / `DXDeployTradingPolygon`)은 수정하지 않았다. 이들은 코어 모듈을 `useModule`로 재사용하므로 서브네임 설정이 자동 상속된다. 또한 `setSaleModule`은 루트(`0x0`) 소유자 권한이 필요한데 트레이딩 모듈은 그 권한을 갖지 않으므로, 코어 모듈에 두는 것이 올바르다.

### 런타임에 부모가 직접 해야 하는 것

각 부모(도메인 소유자)는 **서브네임을 팔기 전에 한 번** 모듈에 위임해야 한다:

```solidity
registry.setApprovalForAll(subnameRegistrar_주소, true)
```

이는 자기 노드에 대한 위임이므로 배포 모듈이 대신 할 수 없다. 프론트엔드의 "서브네임 판매 시작" 플로우에 포함시켜야 한다.

### 수수료 설정

프로토콜 수수료는 현재 5%(500 bps)이며, 상한은 20%(`MAX_FEE_BPS = 2000`)다. 필요 시 `setProtocolFee`로 조정한다.

---

## 7. 함께 정리한 것 / 남은 항목

### 이번 커밋에서 함께 처리

- `SubdomainManager.sol`, `ISubdomainRegistry.sol`, 그 테스트 삭제 (감사 Medium-#4 dead code).
- `ignition/deployments/` 빌드 캐시를 git 추적에서 제외(`.gitignore` 추가).

### 메인넷 전 남은 감사 항목 (이번 작업 범위 밖)

아래는 1차 보안 점검에서 "메인넷 전 필수"로 분류되었으나 **아직 열려 있는** 항목이다. 서브네임 정책과 독립적인 별도 트랙으로, 자금/자산 직접 손실 경로이므로 우선 처리가 권고된다.

1. **DXContributionSBT `tokenURI` JSON 오류** (감사 Critical-#1) — 따옴표 혼용으로 JSON이 깨짐. `.prettierignore` 추가 + JSON 재작성 필요.
2. **DXEnglishAuction `settle`의 `ownerOf` 데드락** (감사 Critical-C) — 만료 토큰에서 `ownerOf`가 revert하여 graceful 경로 도달 불가, 낙찰자 에스크로 자금 묶임. `try/catch` 처리 필요.

> 참고: DXResolver `addr()`/`ABI()`의 만료 가드 부재(감사 Critical-#2)도 권고 항목으로 남아 있으나, 노출 창이 "만료 후 ~ 재등록 전"으로 한정되고 재등록 시 덮어써진다. x402 결제 라우팅이 `addr`/`agentPayment`를 참조하는 경우 영향이 있으므로 검토가 필요하다.
