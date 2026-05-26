// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — EVMCoinUtils
//
// Implements coin-type encoding per ENSIP-11
// (https://docs.ens.domains/ensip/11), where the coin type for an EVM chain
// is `0x80000000 | chainId`. The encoding scheme is an open ENS-driven
// standard; this file is original DEXignation implementation.
//
// Copyright (c) 2026 DEXignation, MIT License.
//
// ENSIP-11에 따라 EVM 체인의 coin type을 `0x80000000 | chainId`로 인코딩.
// 인코딩 방식은 ENS 주도의 공개 표준이며, 본 파일은 DEXignation 자체 구현.
// 본 파일은 © 2026 DEXignation, MIT License.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

/// @dev Pre-EIP-155 chain ID for Ethereum mainnet.
uint32 constant CHAIN_ID_ETH = 1;

/// @dev SLIP-44 coin type for Ether.
uint256 constant COIN_TYPE_ETH = 60;

/// @dev ENSIP-11 high bit indicating "EVM chain". Combined with chainId:
///      coinType = COIN_TYPE_DEFAULT | chainId.
///      ENSIP-11에서 EVM 체인을 나타내는 high bit. chainId와 OR하여 사용.
uint256 constant COIN_TYPE_DEFAULT = 1 << 31; // 0x8000_0000

/// @title  EVMCoinUtils
/// @notice Helpers for the ENSIP-11 coin-type encoding.
///         ENSIP-11 coin-type 인코딩 헬퍼.
library EVMCoinUtils {

  /// @notice Decode the chain ID from a coin type. Returns 0 for non-EVM
  ///         coin types.
  ///         coin type에서 chain ID를 디코드. 비EVM은 0 반환.
  function chainFromCoinType(
    uint256 coinType
  ) internal pure returns (uint32) {
    if (coinType == COIN_TYPE_ETH) return CHAIN_ID_ETH;
    coinType ^= COIN_TYPE_DEFAULT;
    return uint32(coinType < COIN_TYPE_DEFAULT ? coinType : 0);
  }

  /// @notice True if `coinType` identifies an EVM address.
  ///         `coinType`이 EVM 주소를 나타내면 true.
  function isEVMCoinType(uint256 coinType) internal pure returns (bool) {
    return coinType == COIN_TYPE_DEFAULT || chainFromCoinType(coinType) > 0;
  }
}
