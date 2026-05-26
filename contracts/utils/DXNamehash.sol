// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — DXNamehash
//
// Implements the EIP-137 `namehash` algorithm and the EIP-181 reverse-record
// helpers (`addr.reverse` parent node / per-address label hash). The algorithm
// itself is an open standard; this implementation is original DEXignation work
// optimised for the in-place right-to-left scan in `namehash()`.
//
// ENS provides a reference implementation of the same algorithm under MIT
// (https://github.com/ensdomains/ens-contracts). We do not copy that
// implementation directly, but we acknowledge the prior art.
//
// Copyright (c) 2026 DEXignation, MIT License.
//
// EIP-137 `namehash` 및 EIP-181 역방향 헬퍼 구현. 알고리즘은 표준이며,
// 이 파일의 구현은 right-to-left 스캔에 최적화된 DEXignation 자체 작성.
// ENS의 참조 구현(MIT)에 prior art가 있음을 명시한다.
// 본 파일은 © 2026 DEXignation, MIT License.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

/// @title  DXNamehash
/// @notice EIP-137 namehash + EIP-181 reverse-record helpers.
///         EIP-137 namehash 및 EIP-181 역방향 헬퍼.
library DXNamehash {
  error EmptyDnsLabel();

  /// @notice namehash("addr.reverse"). Constant in result, but computed
  ///         to allow audit-by-inspection.
  ///         "addr.reverse"의 namehash. 결과는 상수지만 감사 편의를 위해
  ///         재계산.
  function reverseAddrParentNode() internal pure returns (bytes32 node) {
    node = bytes32(0);
    node = keccak256(abi.encodePacked(node, keccak256(bytes("reverse"))));
    node = keccak256(abi.encodePacked(node, keccak256(bytes("addr"))));
  }

  /// @notice Compute the label hash for a reverse node, derived from the
  ///         lowercase-hex (no 0x prefix) form of the address.
  ///         주소를 소문자 16진 40자(0x 없이)로 변환한 후 keccak256.
  function addrReverseLabelHash(address addr) internal pure returns (bytes32) {
    bytes memory hex40 = _addressToLowerHexNoPrefix(addr);
    return keccak256(hex40);
  }

  /// @notice Compute the reverse node for an address:
  ///         keccak256(reverseAddrParentNode() || addrReverseLabelHash(addr)).
  ///         주소에 대한 역방향 노드 해시 계산.
  function reverseNode(address addr) internal pure returns (bytes32) {
    bytes32 parent = reverseAddrParentNode();
    bytes32 label = addrReverseLabelHash(addr);
    return keccak256(abi.encodePacked(parent, label));
  }

  /// @notice EIP-137 namehash for a dotted name like "example.dex".
  ///         Labels are processed right-to-left and the hash is accumulated
  ///         using `keccak256(parent || keccak256(label))`.
  ///         "example.dex" 같은 점 구분 도메인에 대한 EIP-137 namehash.
  ///         라벨은 오른쪽에서 왼쪽으로 처리되며 해시는
  ///         `keccak256(parent || keccak256(label))` 누적.
  /// @param name The dotted name / 점으로 구분된 도메인 이름
  /// @return node The namehash / namehash
  function namehash(string memory name) internal pure returns (bytes32 node) {
    bytes memory encoded = bytes(name);
    if (encoded.length == 0) {
      return bytes32(0);
    }
    node = bytes32(0);
    uint256 i = encoded.length;
    while (i > 0) {
      uint256 labelStart = i;
      // Walk left until a '.' or the start of the string.
      //   '.' 또는 문자열 시작까지 왼쪽으로 스캔.
      while (i > 0 && encoded[i - 1] != bytes1(".")) {
        unchecked {
          i--;
        }
      }
      if (labelStart == i) {
        revert EmptyDnsLabel();
      }
      bytes memory labelBytes = new bytes(labelStart - i);
      for (uint256 j = 0; j < labelBytes.length; ) {
        labelBytes[j] = encoded[i + j];
        unchecked {
          j++;
        }
      }
      node = keccak256(abi.encodePacked(node, keccak256(labelBytes)));
      // Skip the separator '.' if not at start.
      //   시작이 아니면 구분자 '.'을 건너뛴다.
      if (i > 0) {
        unchecked {
          i--;
        }
      }
    }
  }

  /// @dev Convert a 20-byte address into 40 ASCII bytes of lowercase hex,
  ///      without a "0x" prefix.
  ///      20바이트 주소를 0x 없는 소문자 16진 40바이트로 변환.
  function _addressToLowerHexNoPrefix(
    address addr
  ) private pure returns (bytes memory str) {
    str = new bytes(40);
    bytes memory alphabet = "0123456789abcdef";
    uint160 x = uint160(addr);
    for (uint256 i = 0; i < 20; i++) {
      uint8 b = uint8(x >> (8 * (19 - i)));
      str[2 * i] = alphabet[b >> 4];
      str[2 * i + 1] = alphabet[b & 0x0f];
    }
  }
}
