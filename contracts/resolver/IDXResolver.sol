// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — IDXResolver
//
// Loosely inspired by ENS resolver profile interfaces (MIT,
// https://github.com/ensdomains/ens-contracts). The DEXignation resolver is
// a single, slim contract rather than a multi-profile composition, so the
// interface is original work.
//
// Copyright (c) 2026 DEXignation, MIT License.
//
// ENS 리졸버 프로파일 인터페이스 (MIT)에서 컨셉을 차용했으나, DEXignation
// 리졸버는 다중 프로파일 합성 대신 단일 슬림 컨트랙트라 인터페이스는
// 신규 작성.
// 본 파일은 © 2026 DEXignation, MIT License.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

interface IDXResolver {

  // ── Events ────────────────────────────────────────────────────────────────

  /// @dev Emitted when a `(node, coinType)` address record changes.
  ///      `(node, coinType)` 주소 레코드가 변경될 때.
  event AddrChanged(
    bytes32 indexed node,
    uint256 indexed coinType,
    bytes addrBytes
  );

  /// @dev Emitted when an operator approval is set.
  ///      operator 승인이 설정될 때.
  event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

  /// @dev Emitted when a reverse name is set or cleared.
  ///      역방향 이름이 설정/제거될 때.
  event NameChanged(bytes32 indexed node, string name);

  // ── Errors ────────────────────────────────────────────────────────────────

  /// @dev Caller is not authorised for this node.
  ///      호출자가 해당 노드에 대한 권한이 없음.
  error Unauthorized();

  /// @dev Address bytes are not 0 or 20 length for an EVM coin type.
  ///      EVM 코인 타입인데 주소 바이트 길이가 0 또는 20이 아님.
  error InvalidEVMAddress(uint256 coinType, bytes addr);

  // ── Functions ─────────────────────────────────────────────────────────────

  function setAddr(
    bytes32 node,
    uint256 coinType,
    bytes calldata addrBytes
  ) external;

  function addr(
    bytes32 node,
    uint256 coinType
  ) external view returns (bytes memory);

  function hasAddr(
    bytes32 node,
    uint256 coinType
  ) external view returns (bool);

  function name(bytes32 node) external view returns (string memory);

  function setName(bytes32 node, string calldata newName) external;

  function setApprovalForAll(address operator, bool approved) external;

  function isApprovedForAll(address owner, address operator) external view returns (bool);
}
