# Subname Issuance

Subnames are issued directly by `DXRegistry`. `DXSubnameRegistrar` is no longer
used.

## Policy

- The parent name owner can issue a direct child subname to a specific wallet.
- The parent name owner can reassign or revoke that subname.
- There is no sale, payment, price setting, buyer flow, or gating module.
- A subname dynamically inherits the parent name's expiry.
- Reassign/revoke invalidates stale resolver records through `DXResolver`.

## Registry API

```solidity
function issueSubnodeRecord(
  bytes32 node,
  string calldata label,
  address owner,
  address resolver
) external returns (bytes32);

function reassignSubnodeRecord(
  bytes32 node,
  string calldata label,
  address owner,
  address resolver
) external returns (bytes32);

function revokeSubnodeRecord(
  bytes32 node,
  string calldata label,
  address resolver
) external returns (bytes32);
```

Only the current parent node owner, or an approved operator for that owner, can
call these functions. Labels use the same Unicode-safe label validation policy
as the main registrar.

<details><summary>▶ 한국어로 보기</summary>

서브네임은 이제 `DXRegistry`가 직접 발급합니다. `DXSubnameRegistrar`는 사용하지
않습니다.

- 상위 도메인 소유자가 직접 하위 서브도메인을 특정 지갑에 발급합니다.
- 상위 도메인 소유자는 발급한 서브도메인을 재지정하거나 회수할 수 있습니다.
- 판매, 결제, 가격 설정, 구매자 플로우, 게이팅 모듈은 없습니다.
- 서브도메인은 상위 도메인의 만료 상태를 동적으로 상속합니다.
- 재지정/회수 시 `DXResolver`를 통해 기존 resolver 레코드를 무효화합니다.

</details>
