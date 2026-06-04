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
/// @notice UTF-8 aware string helpers. Multi-byte aware so that
///         multilingual labels are counted by character (codepoint)
///         rather than by byte. Also provides label validators.
///
///         UTF-8을 인식하는 문자열 헬퍼. 다국어 라벨을 바이트가 아닌
///         문자(코드포인트) 단위로 계산한다. 라벨 검증 함수도 제공.
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
      i += utf8CharWidth(bytes(s)[i]);
    }
    return len;
  }

  /// @notice Return the number of UTF-8 codepoints in memory string `s`.
  ///         Solidity cannot overload `string calldata` and `string memory`
  ///         here because data location is not part of the function
  ///         signature, so memory callers use an explicit name.
  ///
  ///         memory 문자열 `s`의 UTF-8 코드포인트 수를 반환. Solidity에서는
  ///         data location만 다른 string 오버로드가 불가능하므로 memory 호출자는
  ///         별도 이름을 사용한다.
  function strlenMemory(string memory s) internal pure returns (uint256) {
    bytes memory b = bytes(s);
    uint256 len;
    uint256 offset = 0;
    while (offset < b.length) {
      offset += utf8CharWidth(b[offset]);
      len += 1;
    }
    return len;
  }

  /// @notice Extract `count` UTF-8 codepoints from memory string `s`, starting
  ///         at codepoint offset `start`.
  ///         memory 문자열 `s`의 코드포인트 offset `start`부터 UTF-8 코드포인트
  ///         `count`개를 추출한다.
  function substrCodepoints(
    string memory s,
    uint256 start,
    uint256 count
  ) internal pure returns (string memory) {
    bytes memory b = bytes(s);
    uint256 byteStart = byteOffsetOfCodepoint(b, start);
    uint256 byteEnd = byteOffsetOfCodepoint(b, start + count);
    if (byteEnd > b.length) byteEnd = b.length;

    bytes memory out = new bytes(byteEnd - byteStart);
    for (uint256 i = 0; i < out.length; i++) {
      out[i] = b[byteStart + i];
    }
    return string(out);
  }

  function byteOffsetOfCodepoint(bytes memory s, uint256 target)
    internal
    pure
    returns (uint256)
  {
    uint256 offset = 0;
    uint256 codepoints = 0;
    while (offset < s.length && codepoints < target) {
      offset += utf8CharWidth(s[offset]);
      codepoints += 1;
    }
    return offset;
  }

  function utf8CharWidth(bytes1 b) internal pure returns (uint256) {
    if (b < 0x80) return 1;
    if (b < 0xE0) return 2;
    if (b < 0xF0) return 3;
    if (b < 0xF8) return 4;
    if (b < 0xFC) return 5;
    return 6;
  }

  /// @notice Strict initial-policy label validator: only `a-z`, `0-9`, and
  ///         `-` allowed; hyphens may not lead, trail, or be doubled
  ///         (matches the LDH-without-leading-hyphen subset of DNS).
  ///
  ///         This is intentionally narrow for launch. Phishing via Unicode
  ///         homoglyphs (`r` vs `г`, lookalike spacing, RTL marks) is
  ///         impossible inside this set. A future `isValidUnicodeLabel`
  ///         can run UTS-46 / ENSIP-15 normalisation for full-Unicode
  ///         support after the framework is in place.
  ///
  ///         초기 정책 strict 라벨 검증: `a-z`, `0-9`, `-`만 허용. 하이픈은
  ///         선두/말미/연속 금지 (DNS LDH 부분집합).
  ///
  ///         출시 단계용 의도적으로 좁은 정책. 이 집합 안에서는 유니코드
  ///         homoglyph (`r` vs `г` 등)이나 보이지 않는 공백/RTL 마크로 인한
  ///         피싱이 불가능. 향후 UTS-46/ENSIP-15 normalize를 적용한
  ///         `isValidUnicodeLabel`을 도입해 전체 유니코드 지원 가능.
  function isValidAsciiLabel(string calldata s) internal pure returns (bool) {
    bytes memory b = bytes(s);
    uint256 n = b.length;
    if (n == 0) return false;
    if (b[0] == 0x2D || b[n - 1] == 0x2D) return false; // no leading/trailing '-'
    for (uint256 i = 0; i < n; i++) {
      bytes1 c = b[i];
      bool isLower  = c >= 0x61 && c <= 0x7A; // a-z
      bool isDigit  = c >= 0x30 && c <= 0x39; // 0-9
      bool isHyphen = c == 0x2D;              // '-'
      if (!(isLower || isDigit || isHyphen)) return false;
      // Reject consecutive hyphens (matches IDNA rules conservatively).
      // 연속 하이픈 거부 (IDNA 규칙을 보수적으로 채용).
      if (isHyphen && i > 0 && b[i - 1] == 0x2D) return false;
    }
    return true;
  }

  /// @notice Validate a user-facing label with multilingual UTF-8 support.
  ///         ASCII characters are kept to the conservative launch set
  ///         (`a-z`, `0-9`, `-`) so dots, whitespace, quotes, slashes, and
  ///         markup-sensitive characters cannot enter names. Non-ASCII
  ///         characters are accepted only when encoded as well-formed UTF-8
  ///         Unicode scalar values.
  ///
  ///         다국어 UTF-8 라벨 검증. ASCII 문자는 보수적인 기존 집합
  ///         (`a-z`, `0-9`, `-`)만 허용해 점, 공백, 따옴표, 슬래시,
  ///         마크업 민감 문자를 차단한다. 비-ASCII 문자는 올바른 UTF-8
  ///         유니코드 스칼라 값일 때만 허용한다.
  function isValidUnicodeLabel(string calldata s) internal pure returns (bool) {
    bytes memory b = bytes(s);
    uint256 n = b.length;
    if (n == 0) return false;

    bool lastWasHyphen = false;
    uint256 i = 0;
    while (i < n) {
      uint8 c = uint8(b[i]);

      if (c < 0x80) {
        bool isLower = c >= 0x61 && c <= 0x7A; // a-z
        bool isDigit = c >= 0x30 && c <= 0x39; // 0-9
        bool isHyphen = c == 0x2D;             // '-'
        if (!(isLower || isDigit || isHyphen)) return false;
        if (isHyphen && (i == 0 || i == n - 1 || lastWasHyphen)) return false;
        lastWasHyphen = isHyphen;
        i += 1;
        continue;
      }

      uint256 width;
      uint32 codepoint;
      if (c >= 0xC2 && c <= 0xDF) {
        width = 2;
        if (i + width > n || !_isContinuation(b[i + 1])) return false;
        codepoint = (uint32(c & 0x1F) << 6) | uint32(uint8(b[i + 1]) & 0x3F);
      } else if (c >= 0xE0 && c <= 0xEF) {
        width = 3;
        if (i + width > n || !_isContinuation(b[i + 1]) || !_isContinuation(b[i + 2])) {
          return false;
        }
        uint8 c1 = uint8(b[i + 1]);
        if (c == 0xE0 && c1 < 0xA0) return false; // overlong
        if (c == 0xED && c1 > 0x9F) return false; // surrogate range
        codepoint = (
          (uint32(c & 0x0F) << 12) |
          (uint32(c1 & 0x3F) << 6) |
          uint32(uint8(b[i + 2]) & 0x3F)
        );
      } else if (c >= 0xF0 && c <= 0xF4) {
        width = 4;
        if (
          i + width > n ||
          !_isContinuation(b[i + 1]) ||
          !_isContinuation(b[i + 2]) ||
          !_isContinuation(b[i + 3])
        ) {
          return false;
        }
        uint8 c1 = uint8(b[i + 1]);
        if (c == 0xF0 && c1 < 0x90) return false; // overlong
        if (c == 0xF4 && c1 > 0x8F) return false; // > U+10FFFF
        codepoint = (
          (uint32(c & 0x07) << 18) |
          (uint32(c1 & 0x3F) << 12) |
          (uint32(uint8(b[i + 2]) & 0x3F) << 6) |
          uint32(uint8(b[i + 3]) & 0x3F)
        );
      } else {
        return false;
      }

      if (_isUnsafeUnicodeCodepoint(codepoint)) return false;
      lastWasHyphen = false;
      i += width;
    }
    return true;
  }

  function _isContinuation(bytes1 b) private pure returns (bool) {
    uint8 c = uint8(b);
    return c >= 0x80 && c <= 0xBF;
  }

  function _isUnsafeUnicodeCodepoint(uint32 cp) private pure returns (bool) {
    // Reject common invisible formatting and bidi controls.
    // 흔한 보이지 않는 포맷/양방향 제어 문자 거부.
    if (cp >= 0x200B && cp <= 0x200F) return true;
    if (cp >= 0x202A && cp <= 0x202E) return true;
    if (cp >= 0x2060 && cp <= 0x206F) return true;
    if (cp == 0x00A0 || cp == 0xFEFF) return true;
    return false;
  }
}
