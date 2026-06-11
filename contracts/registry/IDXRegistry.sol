// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — IDXRegistry
//
// Portions of this interface are derived from the ENS (Ethereum Name Service)
// `ENS.sol` interface, originally authored by Nick Johnson and the ENS Labs
// team, licensed under MIT.
//   Source : https://github.com/ensdomains/ens-contracts
//   File   : contracts/registry/ENS.sol
//   © 2018 Nick Johnson / ENS Labs
//
// Modifications Copyright (c) 2026 DEXignation, licensed under MIT.
//
// 이 인터페이스의 일부는 ENS의 `ENS.sol` (Nick Johnson 및 ENS Labs, MIT)에서
// 파생되었습니다. 변경 부분은 © 2026 DEXignation, MIT License 하에 배포됩니다.
//
// Notable additions / 주요 추가사항:
//   - `Record.expires` field and the `setSubnodeExpires` / `isExpired`
//     functions to support first-class expiry tracking.
//     만료 추적을 위한 `Record.expires` 필드 및 `setSubnodeExpires` /
//     `isExpired` 함수가 추가되었다.
//   - `NameExpired` / `Unauthorized` custom errors.
//     커스텀 에러 `NameExpired` / `Unauthorized` 가 추가되었다.
//   - Sale-lock subname commerce (v2): `issueSubnodeRecordLocked`,
//     `setSaleModule`, `subnodeSaleLocked`, `saleModule`. A subname issued
//     through an authorised sale module is sale-locked: the parent cannot
//     reassign or revoke it while it is live, so a sold subname stays the
//     buyer's until it expires.
//     판매-잠금 서브네임 커머스(v2). 인가된 판매 모듈로 발급된 서브네임은
//     판매-잠금되어, 라이브 동안 부모가 재지정·회수할 수 없다 — 판 서브네임은
//     만료 전까지 구매자 소유.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

/// @title  IDXRegistry
/// @notice Interface of the DEXignation name registry. EIP-137 compatible
///         with an extension: each record carries an `expires` timestamp so
///         that registrars can record lifecycle directly on-registry.
///         DEXignation 네임 레지스트리 인터페이스. EIP-137 호환이며, 각
///         레코드에 `expires` 타임스탬프를 두어 만료를 일급으로 다룬다.
interface IDXRegistry {

  /// @dev Single registry record.
  ///      단일 레지스트리 레코드.
  /// @param owner    Owner of the node / 노드 소유자
  /// @param resolver Resolver contract / 리졸버 컨트랙트
  /// @param expires  Expiry timestamp (0 == no expiry) / 만료 시각 (0이면 만료 없음)
  struct Record {
    address owner;
    address resolver;
    uint256 expires;
  }

  // ── Events ────────────────────────────────────────────────────────────────

  /// @dev Emitted when a parent assigns a new owner to a subnode.
  ///      부모 노드가 서브노드 소유자를 할당할 때.
  event NewOwner(bytes32 indexed node, bytes32 indexed label, address owner);

  /// @dev Emitted when ownership of a node is transferred.
  ///      노드의 소유권이 이전될 때.
  event Transfer(bytes32 indexed node, address owner);

  /// @dev Emitted when the resolver for a node changes.
  ///      노드의 리졸버가 변경될 때.
  event NewResolver(bytes32 indexed node, address resolver);

  /// @dev Emitted when an operator is approved or revoked.
  ///      operator가 승인 또는 해제될 때.
  event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

  /// @dev Emitted when a parent owner issues a subnode to a recipient.
  ///      부모 노드 소유자가 서브노드를 수령자에게 발급할 때.
  event SubnodeIssued(
    bytes32 indexed node,
    bytes32 indexed subnode,
    string label,
    address indexed recipient
  );

  /// @dev Emitted when a parent owner reassigns an existing subnode.
  ///      부모 노드 소유자가 기존 서브노드 소유자를 재지정할 때.
  event SubnodeReassigned(
    bytes32 indexed node,
    bytes32 indexed subnode,
    string label,
    address previousOwner,
    address indexed recipient
  );

  /// @dev Emitted when a parent owner revokes a subnode back to itself.
  ///      부모 노드 소유자가 서브노드를 자신에게 회수할 때.
  event SubnodeRevoked(
    bytes32 indexed node,
    bytes32 indexed subnode,
    string label,
    address previousOwner,
    address indexed revokedTo
  );

  /// @dev Emitted when a sale module issues a subnode with a sale-lock.
  ///      커머스 모듈이 판매 잠금과 함께 서브노드를 발급할 때.
  event SubnodeIssuedLocked(
    bytes32 indexed node,
    bytes32 indexed subnode,
    string label,
    address indexed recipient
  );

  /// @dev Emitted when an address is authorised/deauthorised as a sale module.
  ///      판매 모듈 인가/해제 시.
  event SaleModuleSet(address indexed module, bool allowed);

  // ── Errors ────────────────────────────────────────────────────────────────

  /// @dev Caller is not authorised to mutate the node.
  ///      호출자가 노드를 수정할 권한이 없음.
  error Unauthorized();

  /// @dev Node has expired (past `expires + grace`).
  ///      노드가 만료되었음.
  error NameExpired();

  /// @dev Subnode label is empty or invalid under the launch label policy.
  ///      서브노드 라벨이 비었거나 현재 라벨 정책상 유효하지 않음.
  error InvalidLabel(string label);

  /// @dev Recipient cannot be zero.
  ///      수령자는 zero address일 수 없음.
  error InvalidRecipient();

  /// @dev Subnode already exists.
  ///      서브노드가 이미 존재함.
  error SubnodeExists(bytes32 subnode);

  /// @dev Subnode does not exist.
  ///      서브노드가 존재하지 않음.
  error SubnodeNotFound(bytes32 subnode);

  /// @dev A live (non-expired) sale-locked subnode cannot be reassigned or
  ///      revoked by the parent. It is the buyer's until it expires.
  ///      라이브(미만료) 판매-잠금 서브노드는 부모가 재지정/회수할 수 없음.
  ///      만료 전까지 구매자 소유.
  error SubnodeSaleLocked(bytes32 subnode);

  /// @dev Caller is not an authorised sale module.
  ///      호출자가 인가된 판매 모듈이 아님.
  error NotSaleModule(address caller);

  // ── Functions ─────────────────────────────────────────────────────────────

  function setOwner(bytes32 node, address owner) external;

  function owner(bytes32 node) external view returns (address);

  function isExpired(bytes32 node) external view returns (bool);

  function parentOf(bytes32 node) external view returns (bytes32);

  function setRecordInvalidator(address invalidator) external;

  function setSubnodeOwner(
    bytes32 node,
    bytes32 label,
    address owner
  ) external returns (bytes32);

  /// @notice Parent-node-owner only. End-users cannot change their own
  ///         expiry directly.
  ///         부모 노드 소유자만 호출 가능. 일반 사용자는 자신의 만료를 직접
  ///         변경할 수 없다.
  function setSubnodeExpires(
    bytes32 node,
    bytes32 label,
    uint256 expires
  ) external;

  function setResolver(bytes32 node, address resolver) external;

  function resolver(bytes32 node) external view returns (address);

  function setApprovalForAll(address operator, bool approved) external;

  function isApprovedForAll(
    address owner,
    address operator
  ) external view returns (bool);

  function setRecord(
    bytes32 node,
    address owner,
    address resolver
  ) external;

  function setSubnodeRecord(
    bytes32 node,
    bytes32 label,
    address owner,
    address resolver
  ) external;

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

  // ── Sale-lock subname commerce (v2) / 판매-잠금 서브네임 커머스 ──────────────

  /// @notice Authorised sale module only. Issues a subnode AND marks it
  ///         sale-locked so the parent cannot reassign/revoke it while live.
  ///         The child inherits parent expiry; once it expires the lock no
  ///         longer protects it and the label becomes re-issuable.
  ///         인가된 판매 모듈 전용. 서브노드를 발급하고 판매-잠금을 표시한다.
  ///         라이브 동안 부모가 재지정/회수 불가. 자식은 부모 만료를 상속하며,
  ///         만료되면 잠금 보호가 사라지고 라벨은 재발급 가능해진다.
  function issueSubnodeRecordLocked(
    bytes32 node,
    string calldata label,
    address owner,
    address resolver
  ) external returns (bytes32);

  /// @notice Root-owner only. Authorise/deauthorise a sale module that may
  ///         call `issueSubnodeRecordLocked`.
  ///         루트 소유자 전용. `issueSubnodeRecordLocked` 호출 가능한 판매
  ///         모듈을 인가/해제.
  function setSaleModule(address module, bool allowed) external;

  /// @notice True if `subnode` was issued by a sale module (sale-locked).
  ///         `subnode`가 판매 모듈로 발급되었는지(판매-잠금).
  function subnodeSaleLocked(bytes32 subnode) external view returns (bool);

  /// @notice True if `module` is an authorised sale module.
  ///         `module`이 인가된 판매 모듈인지.
  function saleModule(address module) external view returns (bool);

  function recordExists(bytes32 node) external view returns (bool);
}
