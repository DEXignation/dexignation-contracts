// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — DXResolver
//
// The resolver layer takes inspiration from the ENS `AddrResolver` /
// `NameResolver` / `TextResolver` / `ContentHashResolver` profile contracts
// (MIT License, https://github.com/ensdomains/ens-contracts), but the
// implementation in this file is materially different — it is a single,
// slim resolver that stores raw bytes per (node, coinType) pair following
// ENSIP-9 / ENSIP-11 conventions rather than ENS's multi-profile
// inheritance model.
//
// Supports:
//   - Address records (ENSIP-9 / ENSIP-11, multi-coin)
//   - Reverse records (anti-spoofed name lookup)
//   - Text records (EIP-634, free-form key/value)
//   - Contenthash (EIP-1577, IPFS/IPNS/Swarm/Arweave pointers)
//
// Copyright (c) 2026 DEXignation, MIT License.
//
// ENS의 AddrResolver / NameResolver / TextResolver / ContentHashResolver
// 프로파일 (MIT)에서 영감을 받았으나, 구현 방식은 상당히 다릅니다. ENS의
// 다중 프로파일 상속 대신 ENSIP-9/11 컨벤션에 따라 (node, coinType)
// 페어에 raw bytes를 저장하는 단일 슬림 리졸버입니다.
//
// 지원:
//   - 주소 레코드 (ENSIP-9/11, 다중 코인)
//   - 역방향 레코드 (위조 방지 이름 조회)
//   - 텍스트 레코드 (EIP-634, 자유 키/값)
//   - Contenthash (EIP-1577, IPFS/IPNS/Swarm/Arweave 포인터)
//
// 본 파일은 © 2026 DEXignation, MIT License.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {IDXResolver} from "./IDXResolver.sol";
import {IDXRegistry} from "../registry/IDXRegistry.sol";
import {DXNamehash} from "../utils/DXNamehash.sol";
import {EVMCoinUtils} from "../utils/EVMCoinUtils.sol";

/// @title  DXResolver
/// @notice Stores resolver records for .dex names: addresses, reverse name,
///         text records, and contenthash.
///         .dex 이름의 리졸버 레코드 저장: 주소, 역방향 이름, 텍스트 레코드,
///         contenthash.
contract DXResolver is IDXResolver {

  // ── Bounds ────────────────────────────────────────────────────────────────
  //
  // Hard limits on writable record sizes, to bound the worst-case gas cost
  // of storage writes and reads. These are generous and accommodate every
  // realistic use case (longest commonly-used text key is ~30 chars; longest
  // contenthash for IPFS/Swarm is ~38 bytes).
  //
  //   쓰기 레코드 크기 상한. 스토리지 read/write 가스 최악 경우 제한용.
  //   현실적 모든 사용 사례 수용 (가장 긴 일반 텍스트 키 ~30자, IPFS/Swarm
  //   contenthash 가장 긴 것 ~38바이트).

  /// @notice Max length of a text record key. Reflects ENS convention
  ///         (e.g. "com.twitter", "verifications.com.foundationapp").
  ///         텍스트 레코드 키 최대 길이.
  uint256 public constant MAX_TEXT_KEY_LENGTH = 64;

  /// @notice Max length of a text record value. Long enough for URLs,
  ///         descriptions, and verification proofs.
  ///         텍스트 레코드 값 최대 길이. URL, 설명, 검증 증명에 충분.
  uint256 public constant MAX_TEXT_VALUE_LENGTH = 1024;

  /// @notice Max length of contenthash bytes. EIP-1577 typical encodings
  ///         (IPFS CIDv0, CIDv1, Swarm, IPNS, Arweave) fit in <= 64 bytes.
  ///         128 gives generous headroom.
  ///         contenthash 바이트 최대 길이. EIP-1577 일반 인코딩(IPFS CIDv0/v1,
  ///         Swarm, IPNS, Arweave)이 64바이트 이하. 128로 여유 확보.
  uint256 public constant MAX_CONTENTHASH_LENGTH = 128;

  // ── ERC-165 interface IDs ─────────────────────────────────────────────────
  //
  // The four standard ENS resolver profile IDs we implement. These let
  // ENS-compatible tooling (wallet libraries, indexers) confirm support
  // without reading docs.
  //
  //   ENS 호환 툴(지갑 라이브러리, 인덱서)이 doc 없이 지원 여부를 확인할
  //   수 있도록 표준 인터페이스 ID를 노출.

  /// @dev EIP-165 self-identifier.
  bytes4 private constant INTERFACE_ID_ERC165 = 0x01ffc9a7;

  /// @dev ENSIP-9 multi-coin addr(node, coinType) profile.
  bytes4 private constant INTERFACE_ID_ADDR_MULTI = 0xf1cb7e06;

  /// @dev EIP-634 text(node, key) profile.
  bytes4 private constant INTERFACE_ID_TEXT = 0x59d1d43c;

  /// @dev EIP-1577 contenthash(node) profile.
  bytes4 private constant INTERFACE_ID_CONTENTHASH = 0xbc1c58d1;

  /// @dev ENS NameResolver name(node) profile.
  bytes4 private constant INTERFACE_ID_NAME = 0x691f3431;

  // ── State ─────────────────────────────────────────────────────────────────

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

  /// @dev texts[node][key] => value string. Free-form key/value records
  ///      per EIP-634. Common keys include: "url", "avatar", "email",
  ///      "description", "com.twitter", "com.github", "org.telegram",
  ///      "verifications.com.foundationapp", etc.
  ///      texts[node][key] => value. EIP-634에 따른 자유 키/값. 일반 키:
  ///      "url", "avatar", "email" 등.
  mapping(bytes32 => mapping(string => string)) texts;

  /// @dev contenthashes[node] => raw bytes per EIP-1577.
  ///      multicodec-prefixed pointers for IPFS/IPNS/Swarm/Arweave content.
  ///      EIP-1577 raw bytes (IPFS/IPNS/Swarm/Arweave 포인터).
  mapping(bytes32 => bytes) contenthashes;

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
  // Address records / 주소 레코드 (ENSIP-9, ENSIP-11)
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
  // Text records / 텍스트 레코드 (EIP-634)
  // ──────────────────────────────────────────────────────────────────────────

  /// @inheritdoc IDXResolver
  /// @dev Returns empty string for expired nodes. Empty string is also
  ///      indistinguishable from "key not set" — this matches ENS behaviour.
  ///      만료 노드는 빈 문자열 반환. 미설정 키와 빈 문자열은 구분 불가.
  function text(
    bytes32 node,
    string calldata key
  ) external view override returns (string memory) {
    if (_isExpired(node)) {
      return "";
    }
    return texts[node][key];
  }

  /// @inheritdoc IDXResolver
  /// @dev Empty value clears the record. Key length is bounded by
  ///      MAX_TEXT_KEY_LENGTH; value length by MAX_TEXT_VALUE_LENGTH.
  ///      The `TextChanged` event emits the key both as an indexed string
  ///      (for log filtering, hash-truncated by EVM) and as a non-indexed
  ///      string (for full retrieval).
  ///      빈 값이면 레코드 삭제. 키 길이 MAX_TEXT_KEY_LENGTH, 값 길이
  ///      MAX_TEXT_VALUE_LENGTH 제한. 이벤트는 키를 indexed/non-indexed
  ///      둘 다 emit (필터링용 + 원본 retrieval용).
  function setText(
    bytes32 node,
    string calldata key,
    string calldata value
  ) external override authorised(node) {
    uint256 keyLen = bytes(key).length;
    if (keyLen > MAX_TEXT_KEY_LENGTH) {
      revert TextKeyTooLong(keyLen, MAX_TEXT_KEY_LENGTH);
    }
    uint256 valueLen = bytes(value).length;
    if (valueLen > MAX_TEXT_VALUE_LENGTH) {
      revert TextValueTooLong(valueLen, MAX_TEXT_VALUE_LENGTH);
    }

    if (valueLen == 0) {
      delete texts[node][key];
    } else {
      texts[node][key] = value;
    }

    emit TextChanged(node, key, key, value);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Contenthash records / Contenthash 레코드 (EIP-1577)
  // ──────────────────────────────────────────────────────────────────────────

  /// @inheritdoc IDXResolver
  function contenthash(
    bytes32 node
  ) external view override returns (bytes memory) {
    if (_isExpired(node)) {
      return "";
    }
    return contenthashes[node];
  }

  /// @inheritdoc IDXResolver
  /// @dev Bytes are stored as provided. Per EIP-1577 the first bytes form
  ///      a multicodec identifier (e.g. 0xe301... for IPFS) but this is
  ///      not enforced on-chain — frontends parse and validate per their
  ///      target protocol.
  ///      바이트는 그대로 저장. EIP-1577에 따라 앞부분이 multicodec ID
  ///      (예: 0xe301... IPFS)이지만 on-chain 검증은 안 함; frontend가
  ///      대상 프로토콜에 따라 파싱/검증.
  function setContenthash(
    bytes32 node,
    bytes calldata hash
  ) external override authorised(node) {
    uint256 len = hash.length;
    if (len > MAX_CONTENTHASH_LENGTH) {
      revert ContenthashTooLong(len, MAX_CONTENTHASH_LENGTH);
    }

    if (len == 0) {
      delete contenthashes[node];
    } else {
      contenthashes[node] = hash;
    }

    emit ContenthashChanged(node, hash);
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

  // ──────────────────────────────────────────────────────────────────────────
  // ERC-165
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice Report supported ENS resolver profiles. Allows ENS-compatible
  ///         tooling (wallet libraries, the official ENS app, indexers) to
  ///         confirm which records this resolver handles.
  ///         지원하는 ENS 리졸버 프로파일 보고. ENS 호환 툴이 어떤 레코드를
  ///         이 리졸버가 처리하는지 확인 가능.
  function supportsInterface(
    bytes4 interfaceId
  ) external pure override returns (bool) {
    return
      interfaceId == INTERFACE_ID_ERC165 ||
      interfaceId == INTERFACE_ID_ADDR_MULTI ||
      interfaceId == INTERFACE_ID_TEXT ||
      interfaceId == INTERFACE_ID_CONTENTHASH ||
      interfaceId == INTERFACE_ID_NAME;
  }
}
