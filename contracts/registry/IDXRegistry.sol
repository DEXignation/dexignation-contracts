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

  // ── Errors ────────────────────────────────────────────────────────────────

  /// @dev Caller is not authorised to mutate the node.
  ///      호출자가 노드를 수정할 권한이 없음.
  error Unauthorized();

  /// @dev Node has expired (past `expires + grace`).
  ///      노드가 만료되었음.
  error NameExpired();

  // ── Functions ─────────────────────────────────────────────────────────────

  function setOwner(bytes32 node, address owner) external;

  function owner(bytes32 node) external view returns (address);

  function isExpired(bytes32 node) external view returns (bool);

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

  function recordExists(bytes32 node) external view returns (bool);
}
