// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — StringUtils
//
// The UTF-8 character-length routine in this file follows the pattern of
// ENS's `StringUtils.sol` (MIT,
// https://github.com/ensdomains/ens-contracts), which itself is a small
// well-known helper widely used across the ecosystem.
//
// Modifications and inline documentation Copyright (c) 2026 DEXignation,
// MIT License.
//
// 이 파일의 UTF-8 길이 계산 루틴은 ENS `StringUtils.sol` (MIT) 패턴을
// 따른다. 인라인 문서화 및 변경은 © 2026 DEXignation, MIT License.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

/// @title  StringUtils
/// @notice UTF-8 aware string-length helper. Multi-byte aware so that
///         Korean / Japanese / Chinese labels are counted by character
///         rather than by byte.
///         UTF-8을 인식하는 문자열 길이 계산. 한글/한자/일본어 라벨이 바이트
///         단위가 아닌 문자 단위로 세어진다.
library StringUtils {

  /// @notice Return the number of UTF-8 codepoints in `s`.
  ///         `s` 의 UTF-8 코드포인트 수를 반환.
  function strlen(string calldata s) internal pure returns (uint256) {
    uint256 len;
    uint256 i = 0;
    uint256 bytelength = bytes(s).length;

    // UTF-8 prefix bits determine codepoint length:
    //   0xxxxxxx → 1 byte  (b < 0x80)
    //   110xxxxx → 2 bytes (b < 0xE0)
    //   1110xxxx → 3 bytes (b < 0xF0)
    //   11110xxx → 4 bytes (b < 0xF8)
    //
    // UTF-8 시작 바이트의 앞쪽 비트 패턴으로 코드포인트 길이를 결정.
    for (len = 0; i < bytelength; len++) {
      bytes1 b = bytes(s)[i];
      if (b < 0x80) {
        i += 1;
      } else if (b < 0xE0) {
        i += 2;
      } else if (b < 0xF0) {
        i += 3;
      } else if (b < 0xF8) {
        i += 4;
      } else if (b < 0xFC) {
        i += 5;
      } else {
        i += 6;
      }
    }
    return len;
  }
}
