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
///         rather than by byte. Also provides a strict ASCII-lowercase
///         validator used for the initial label normalisation policy.
///
///         UTF-8을 인식하는 문자열 길이 계산. 한글/한자/일본어 라벨이 바이트
///         단위가 아닌 문자 단위로 세어진다. 초기 라벨 정규화 정책용 strict
///         ASCII lowercase 검증 함수도 제공.
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
}
