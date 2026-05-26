// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — DXResolver
//
// The resolver layer takes inspiration from the ENS `AddrResolver` /
// `NameResolver` profile contracts (MIT License,
// https://github.com/ensdomains/ens-contracts), but the implementation in
// this file is materially different — it is a single, slim resolver that
// stores raw bytes per (node, coinType) pair following ENSIP-9 / ENSIP-11
// conventions rather than ENS's multi-profile inheritance model.
//
// Copyright (c) 2026 DEXignation, MIT License.
//
// 이 컨트랙트는 ENS의 `AddrResolver` / `NameResolver` 프로파일 (MIT)에서
// 영감을 받았으나, 구현 방식은 상당히 다릅니다. ENS의 다중 프로파일 상속
// 대신 ENSIP-9/11 컨벤션에 따라 (node, coinType) 페어에 raw bytes를 저장하는
// 단일 슬림 리졸버입니다.
// 본 파일은 © 2026 DEXignation, MIT License.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {IDXResolver} from "./IDXResolver.sol";
import {IDXRegistry} from "../registry/IDXRegistry.sol";
import {DXNamehash} from "../utils/DXNamehash.sol";
import {EVMCoinUtils} from "../utils/EVMCoinUtils.sol";

/// @title  DXResolver
/// @notice Stores `(coinType → addrBytes)` per node, and reverse name
///         `(node → string)` for `addr.reverse` lookups.
///         노드별 `(coinType → addrBytes)` 매핑 및 역방향 이름
///         `(node → string)` 매핑을 저장한다.
contract DXResolver is IDXResolver {
  IDXRegistry immutable registry;

  /// @dev addresses[node][coinType] => raw address bytes.
  ///      Per ENSIP-11 (EVM) the value is the 20-byte EVM address; for
  ///      non-EVM coin types the value is the chain-native byte string
  ///      (e.g. Bitcoin scriptPubKey).
  ///      addresses[node][coinType] => 원시 주소 바이트.
  ///      EVM(ENSIP-11)은 20바이트, 비EVM은 체인 고유 바이트 문자열.
  mapping(bytes32 => mapping(uint256 => bytes)) addresses;

  /// @dev operators[owner][operator] => approved.
  ///      ERC-721 style approve-all over resolver writes.
  ///      리졸버 쓰기 권한에 대한 ERC-721 스타일 일괄 승인.
  mapping(address => mapping(address => bool)) operators;

  /// @dev names[node] => reverse name string (e.g. "vitalik.dex").
  ///      `node`는 `{addr}.addr.reverse`의 해시.
  mapping(bytes32 => string) names;

  constructor(IDXRegistry _registry) {
    registry = _registry;
  }

  /// @dev Reverts on expired node or insufficient authority.
  ///      만료/권한 부족 시 revert.
  modifier authorised(bytes32 node) {
    if (_isExpired(node)) {
      revert IDXRegistry.NameExpired();
    }
    address owner = registry.owner(node);
    if (owner != msg.sender && !operators[owner][msg.sender]) {
      revert Unauthorized();
    }
    _;
  }

  function _isExpired(bytes32 node) internal view returns (bool) {
    return registry.isExpired(node);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Address records / 주소 레코드
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice Set the address bytes for a (node, coinType) pair.
  ///         (node, coinType)에 대한 주소 바이트를 설정.
  /// @dev    For EVM coin types, the value must be either empty (deletion)
  ///         or exactly 20 bytes. Non-EVM coin types accept any length.
  ///         EVM 코인 타입은 빈 바이트(삭제) 또는 정확히 20바이트만 허용.
  ///         비EVM 코인 타입은 길이 제한 없음.
  function setAddr(
    bytes32 node,
    uint256 coinType,
    bytes calldata addrBytes
  ) public override authorised(node) {
    if (
      addrBytes.length != 0 &&
      addrBytes.length != 20 &&
      EVMCoinUtils.isEVMCoinType(coinType)
    ) {
      revert InvalidEVMAddress(coinType, addrBytes);
    }

    addresses[node][coinType] = addrBytes;

    emit AddrChanged(node, coinType, addrBytes);
  }

  /// @inheritdoc IDXResolver
  function addr(
    bytes32 node,
    uint256 coinType
  ) public view override returns (bytes memory) {
    if (_isExpired(node)) {
      revert IDXRegistry.NameExpired();
    }
    return addresses[node][coinType];
  }

  /// @inheritdoc IDXResolver
  function hasAddr(
    bytes32 node,
    uint256 coinType
  ) external view override returns (bool) {
    if (_isExpired(node)) {
      revert IDXRegistry.NameExpired();
    }
    return addresses[node][coinType].length > 0;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Reverse records / 역방향 레코드
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice Read the reverse name. Returns empty string if the node is
  ///         expired, if no name was set, or if the claimed forward node
  ///         does not point back to the same owner (anti-spoof check).
  ///         역방향 이름을 읽는다. 만료/미설정/정방향-역방향 소유자 불일치
  ///         시에는 빈 문자열을 반환 (위조 방지).
  function name(
    bytes32 node
  ) public view override returns (string memory) {
    if (_isExpired(node)) {
      return "";
    }

    string memory stored = names[node];
    if (bytes(stored).length == 0) {
      return stored;
    }

    // Verify the forward record actually points to the same owner.
    // This is the standard ENS-style anti-spoof check.
    //   정방향 노드가 역방향 노드와 같은 소유자를 가리키는지 검증.
    bytes32 forwardNode = DXNamehash.namehash(stored);
    address reverseOwner = registry.owner(node);
    if (
      _isExpired(forwardNode) ||
      registry.owner(forwardNode) != reverseOwner
    ) {
      return "";
    }

    return stored;
  }

  /// @notice Set the reverse name. Empty string deletes the record.
  ///         역방향 이름을 설정. 빈 문자열이면 삭제.
  function setName(
    bytes32 node,
    string calldata newName
  ) public override authorised(node) {
    if (bytes(newName).length == 0) {
      delete names[node];
      emit NameChanged(node, "");
      return;
    }

    bytes32 forwardNode = DXNamehash.namehash(newName);
    if (_isExpired(forwardNode)) {
      revert IDXRegistry.NameExpired();
    }

    address reverseOwner = registry.owner(node);
    if (registry.owner(forwardNode) != reverseOwner) {
      revert Unauthorized();
    }

    names[node] = newName;
    emit NameChanged(node, newName);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Approval / 권한 위임
  // ──────────────────────────────────────────────────────────────────────────

  function setApprovalForAll(
    address operator,
    bool approved
  ) external override {
    operators[msg.sender][operator] = approved;
    emit ApprovalForAll(msg.sender, operator, approved);
  }

  function isApprovedForAll(
    address _owner,
    address operator
  ) external view override returns (bool) {
    return operators[_owner][operator];
  }
}
