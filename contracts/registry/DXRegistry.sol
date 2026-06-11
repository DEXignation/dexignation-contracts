// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — DXRegistry
//
// Portions of this contract are derived from the ENS (Ethereum Name Service)
// reference implementation `ENSRegistry`, originally authored by Nick Johnson
// and the ENS Labs team. The original work is licensed under the MIT License.
//   Source : https://github.com/ensdomains/ens-contracts
//   File   : contracts/registry/ENSRegistry.sol
//   © 2018 Nick Johnson / ENS Labs
//
// Modifications and additions Copyright (c) 2026 DEXignation, licensed under
// the MIT License. See the LICENSE and THIRD-PARTY-LICENSES.md files at the
// repository root for full terms.
//
// 이 컨트랙트의 일부는 ENS(Ethereum Name Service)의 레퍼런스 구현인
// `ENSRegistry` (Nick Johnson 및 ENS Labs, MIT License)에서 파생되었습니다.
// 변경 및 추가 부분은 © 2026 DEXignation, MIT License 하에 배포됩니다.
//
// Notable modifications by DEXignation / DEXignation의 주요 변경사항:
//   1. Record struct: `uint64 ttl` → `uint256 expires`
//      Record 구조체에 `ttl` 대신 `expires`(만료 시각)를 두어 도메인 만료
//      개념을 레지스트리 자체에서 일급으로 다룬다.
//   2. `authorised` modifier now also rejects expired nodes (`NameExpired`).
//      `authorised` modifier가 만료된 노드의 변경을 거부한다.
//   3. New external function `setSubnodeExpires` — only callable by parent
//      node owner (typically the `DXRegistrar`).
//      서브노드의 만료 시각을 부모 노드 소유자(보통 `DXRegistrar`)만 기록할
//      수 있도록 하는 `setSubnodeExpires` 함수가 추가되었다.
//   4. Custom errors (`Unauthorized`, `NameExpired`) replace `require()` for
//      gas efficiency and better revert decoding.
//      가스 효율과 디코딩 편의를 위해 `require` 대신 커스텀 에러를 사용한다.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {IDXRegistry} from "./IDXRegistry.sol";
import "../utils/StringUtils.sol";

interface IRecordInvalidator {
  function bumpVersion(bytes32 node) external;
}

/// @title  DXRegistry
/// @notice The central name registry for the DEXignation namespace.
///         Implements the EIP-137 style `(owner, resolver, expires)` record
///         for every node in the namehash tree.
/// @dev    Equivalent in role to ENS `ENSRegistry`, but adds first-class
///         expiry tracking so that registrars can record lifecycle directly
///         on the registry.
///
///         DEXignation 네임스페이스의 중앙 레지스트리. EIP-137 스타일의
///         namehash 트리상 각 노드에 대해 `(owner, resolver, expires)`
///         레코드를 저장한다. ENS `ENSRegistry`와 역할이 같지만, 만료
///         시각을 레지스트리에서 직접 추적한다.
contract DXRegistry is IDXRegistry {
  using StringUtils for string;

  /// @dev namehash node => record(owner, resolver, expires)
  mapping(bytes32 => Record) records;

  /// @dev child node => parent node. Used for inherited expiry.
  mapping(bytes32 => bytes32) public override parentOf;

  /// @dev owner => (operator => approved). ERC-721 style approval-for-all.
  mapping(address => mapping(address => bool)) operators;

  /// @notice Optional resolver-like contract that can invalidate stale records.
  IRecordInvalidator public recordInvalidator;

  /// @notice Root node owner is set to the deployer. The deployer should
  ///         transfer ownership of each TLD (e.g. `.dex`) to its registrar
  ///         shortly after deployment.
  ///         루트 노드의 소유자는 배포자로 설정된다. 배포자는 배포 직후
  ///         각 TLD(예: `.dex`)의 소유권을 해당 Registrar로 이전해야 한다.
  constructor() {
    records[0x0].owner = msg.sender;
  }

  /// @dev Reverts if the node is past its expiry, or if `msg.sender` is
  ///      neither the node owner nor an approved operator.
  ///      노드가 만료되었거나 호출자가 소유자/승인된 operator가 아니면
  ///      revert.
  /// @param node namehash node / 노드 해시
  modifier authorised(bytes32 node) {
    if (isExpired(node)) {
      revert NameExpired();
    }
    address nodeOwner = records[node].owner;
    if (nodeOwner != msg.sender && !operators[nodeOwner][msg.sender]) {
      revert Unauthorized();
    }
    _;
  }

  /// @inheritdoc IDXRegistry
  function isExpired(bytes32 node) public view override returns (bool) {
    bytes32 current = node;
    for (uint256 i = 0; i < 32; i++) {
      if (records[current].expires != 0 && block.timestamp > records[current].expires) {
        return true;
      }
      bytes32 parent = parentOf[current];
      if (parent == bytes32(0)) return false;
      current = parent;
    }
    return true;
  }

  /// @notice Set the contract called to invalidate resolver records after
  ///         subnode issue/reassign/revoke operations. Set zero to disable.
  ///         서브노드 발급/재지정/회수 후 resolver 레코드를 무효화할 컨트랙트.
  ///         zero address면 비활성.
  function setRecordInvalidator(address invalidator) external override authorised(0x0) {
    recordInvalidator = IRecordInvalidator(invalidator);
  }

  /// @notice Called by the parent node owner (e.g. `DXRegistrar` for `.dex`)
  ///         to record a child node's expiry. End-users cannot modify their
  ///         own node's expiry.
  ///         부모 노드 소유자(예: `.dex`의 경우 `DXRegistrar`)가 자식 노드의
  ///         만료 시각을 기록한다. 일반 사용자는 자신의 노드 expiry를 직접
  ///         바꿀 수 없다.
  function setSubnodeExpires(
    bytes32 node,
    bytes32 label,
    uint256 _expires
  ) external override authorised(node) {
    bytes32 subnode = keccak256(abi.encodePacked(node, label));
    records[subnode].expires = _expires;
  }

  /// @notice Transfer ownership of a node to a new address. Only the current
  ///         owner (or approved operator) may call.
  ///         노드 소유권을 새 주소로 이전. 현재 소유자(또는 승인된 operator)만
  ///         호출 가능.
  /// @param node   Node hash / 노드 해시
  /// @param _owner New owner / 새 소유자 주소
  function setOwner(
    bytes32 node,
    address _owner
  ) public override authorised(node) {
    _setOwner(node, _owner);
    emit Transfer(node, _owner);
  }

  /// @inheritdoc IDXRegistry
  function owner(
    bytes32 node
  ) public view override returns (address) {
    return records[node].owner;
  }

  /// @notice Create or update a subnode owner. The subnode hash is computed
  ///         per EIP-137 as `keccak256(parent || label)`.
  ///         서브노드 소유자를 생성/갱신한다. 서브노드 해시는 EIP-137에 따라
  ///         `keccak256(parent || label)` 로 계산.
  function setSubnodeOwner(
    bytes32 node,
    bytes32 label,
    address _owner
  ) public override authorised(node) returns (bytes32) {
    bytes32 subnode = keccak256(abi.encodePacked(node, label));
    parentOf[subnode] = node;
    _setOwner(subnode, _owner);
    emit NewOwner(node, label, _owner);
    return subnode;
  }

  /// @notice Set the resolver address for a node.
  ///         노드의 리졸버 주소를 설정.
  function setResolver(
    bytes32 node,
    address _resolver
  ) public override authorised(node) {
    if (_resolver != records[node].resolver) {
      records[node].resolver = _resolver;
      emit NewResolver(node, _resolver);
    }
  }

  /// @inheritdoc IDXRegistry
  function resolver(
    bytes32 node
  ) public view override returns (address) {
    return records[node].resolver;
  }

  /// @notice ERC-721 style approve-all. Lets `operator` manage all nodes
  ///         owned by `msg.sender`.
  ///         ERC-721 스타일 일괄 승인. `operator`가 `msg.sender` 소유의
  ///         모든 노드를 관리할 수 있게 한다.
  function setApprovalForAll(
    address operator,
    bool approved
  ) external override {
    operators[msg.sender][operator] = approved;
    emit ApprovalForAll(msg.sender, operator, approved);
  }

  /// @inheritdoc IDXRegistry
  function isApprovedForAll(
    address _owner,
    address operator
  ) external view override returns (bool) {
    return operators[_owner][operator];
  }

  /// @notice Atomically set both owner and resolver for a node.
  ///         노드의 소유자와 리졸버를 원자적으로 설정.
  function setRecord(
    bytes32 node,
    address _owner,
    address _resolver
  ) external override authorised(node) {
    _setOwner(node, _owner);
    emit Transfer(node, _owner);

    if (_resolver != records[node].resolver) {
      records[node].resolver = _resolver;
      emit NewResolver(node, _resolver);
    }
  }

  /// @notice Atomically set both owner and resolver for a subnode.
  ///         서브노드의 소유자와 리졸버를 원자적으로 설정.
  function setSubnodeRecord(
    bytes32 node,
    bytes32 label,
    address _owner,
    address _resolver
  ) external override authorised(node) {
    bytes32 subnode = keccak256(abi.encodePacked(node, label));
    parentOf[subnode] = node;
    _setOwner(subnode, _owner);
    emit NewOwner(node, label, _owner);

    if (_resolver != records[subnode].resolver) {
      records[subnode].resolver = _resolver;
      emit NewResolver(subnode, _resolver);
    }
  }

  /// @notice Issue a new direct subnode to `owner` with `resolver`.
  ///         Parent owner only. The child inherits parent expiry dynamically.
  ///         직접 하위 서브노드를 수령자에게 발급한다. 부모 소유자만 호출.
  ///         자식은 부모 만료 상태를 동적으로 상속한다.
  function issueSubnodeRecord(
    bytes32 node,
    string calldata label,
    address _owner,
    address _resolver
  ) external override authorised(node) returns (bytes32 subnode) {
    if (_owner == address(0)) revert InvalidRecipient();
    bytes32 labelHash = _validateSubnodeLabel(label);
    subnode = keccak256(abi.encodePacked(node, labelHash));
    if (records[subnode].owner != address(0)) revert SubnodeExists(subnode);

    _setSubnodeRecord(node, subnode, labelHash, _owner, _resolver);
    _invalidate(subnode);
    emit SubnodeIssued(node, subnode, label, _owner);
  }

  /// @notice Reassign an existing direct subnode to `owner`.
  ///         Existing resolver records are invalidated.
  ///         기존 직접 하위 서브노드 소유자를 재지정한다. 기존 resolver 레코드는 무효화.
  function reassignSubnodeRecord(
    bytes32 node,
    string calldata label,
    address _owner,
    address _resolver
  ) external override authorised(node) returns (bytes32 subnode) {
    if (_owner == address(0)) revert InvalidRecipient();
    bytes32 labelHash = _validateSubnodeLabel(label);
    subnode = keccak256(abi.encodePacked(node, labelHash));
    address previousOwner = records[subnode].owner;
    if (previousOwner == address(0)) revert SubnodeNotFound(subnode);

    _setSubnodeRecord(node, subnode, labelHash, _owner, _resolver);
    _invalidate(subnode);
    emit SubnodeReassigned(node, subnode, label, previousOwner, _owner);
  }

  /// @notice Revoke an existing direct subnode back to the parent owner.
  ///         Existing resolver records are invalidated.
  ///         기존 직접 하위 서브노드를 부모 소유자에게 회수한다. 기존 resolver 레코드는 무효화.
  function revokeSubnodeRecord(
    bytes32 node,
    string calldata label,
    address _resolver
  ) external override authorised(node) returns (bytes32 subnode) {
    bytes32 labelHash = _validateSubnodeLabel(label);
    subnode = keccak256(abi.encodePacked(node, labelHash));
    address previousOwner = records[subnode].owner;
    if (previousOwner == address(0)) revert SubnodeNotFound(subnode);

    address parentOwner = records[node].owner;
    _setSubnodeRecord(node, subnode, labelHash, parentOwner, _resolver);
    _invalidate(subnode);
    emit SubnodeRevoked(node, subnode, label, previousOwner, parentOwner);
  }

  /// @inheritdoc IDXRegistry
  function recordExists(
    bytes32 node
  ) public view override returns (bool) {
    return records[node].owner != address(0);
  }

  /// @dev Internal owner setter (no events, no auth — callers must enforce).
  ///      내부 소유자 설정 함수 (이벤트/권한 검증 없음 — 호출자가 책임).
  function _setOwner(bytes32 node, address _owner) internal {
    records[node].owner = _owner;
  }

  function _setSubnodeRecord(
    bytes32 node,
    bytes32 subnode,
    bytes32 label,
    address _owner,
    address _resolver
  ) internal {
    parentOf[subnode] = node;
    _setOwner(subnode, _owner);
    emit NewOwner(node, label, _owner);

    if (_resolver != records[subnode].resolver) {
      records[subnode].resolver = _resolver;
      emit NewResolver(subnode, _resolver);
    }
  }

  function _validateSubnodeLabel(string calldata label) internal pure returns (bytes32) {
    if (!(label.strlen() >= 3 && label.isValidUnicodeLabel())) {
      revert InvalidLabel(label);
    }
    return keccak256(bytes(label));
  }

  function _invalidate(bytes32 node) internal {
    address invalidator = address(recordInvalidator);
    if (invalidator != address(0)) {
      recordInvalidator.bumpVersion(node);
    }
  }
}
