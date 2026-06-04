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
  ///         impossible inside this set.
  ///
  ///         초기 정책 strict 라벨 검증: `a-z`, `0-9`, `-`만 허용. 하이픈은
  ///         선두/말미/연속 금지 (DNS LDH 부분집합).
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

  /// @notice Validate a user-facing label with multilingual UTF-8 support,
  ///         restricted to PRECOMPOSED (NFC) characters only.
  ///
  ///         ASCII is limited to `a-z`, `0-9`, `-` so dots, whitespace,
  ///         quotes, slashes, and markup-sensitive characters cannot enter
  ///         names. Non-ASCII characters are accepted only when they are
  ///         well-formed UTF-8 AND are not combining/decomposed/invisible
  ///         codepoints (see `_isUnsafeUnicodeCodepoint`).
  ///
  ///         WHY NFC-ONLY: a normal user typing on their native keyboard/IME
  ///         always produces precomposed (NFC) characters — French `é`
  ///         (U+00E9), Japanese `が` (U+304C), Korean `한` (U+D55C) are each a
  ///         single codepoint. Combining marks (`e`+◌́) and conjoining Hangul
  ///         jamo are not produced by normal input; injecting them is an
  ///         attack that creates a *visually identical but cryptographically
  ///         different* name (different labelhash → different NFT). By
  ///         rejecting the combining/decomposed ranges we let every language's
  ///         normal NFC input through while blocking the spoofing vector —
  ///         no per-language whitelist needed.
  ///
  ///         다국어 UTF-8 라벨 검증 (완성형/NFC 전용). 사용자가 자국
  ///         키보드/IME로 정상 입력하면 항상 완성형 한 글자가 나온다
  ///         (불어 `é`=U+00E9, 일본어 `が`=U+304C, 한글 `한`=U+D55C).
  ///         결합용 분음부호나 한글 분해 자모는 정상 입력으로 나오지 않으며,
  ///         이를 끼워 넣는 것은 "시각적으로 동일하지만 labelhash가 다른"
  ///         이름을 만드는 공격이다. 결합/분해 영역만 거부하면 언어별
  ///         화이트리스트 없이 모든 언어의 완성형 입력은 통과시키면서
  ///         스푸핑 벡터를 차단한다.
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

  /// @dev Reject codepoints that are unsafe (invisible/bidi) OR that break the
  ///      NFC-only (precomposed) policy by being combining/decomposed marks.
  ///      Precomposed letters of every language pass; the decomposed building
  ///      blocks that would let an attacker forge a look-alike name do not.
  ///
  ///      위험(invisible/bidi) 코드포인트와, 완성형(NFC) 정책을 깨뜨리는
  ///      결합/분해 문자를 거부한다. 모든 언어의 완성형 글자는 통과하고,
  ///      look-alike 이름을 위조하는 데 쓰이는 분해형 구성요소는 막힌다.
  function _isUnsafeUnicodeCodepoint(uint32 cp) private pure returns (bool) {
    // ── (1) Invisible formatting / bidi controls ────────────────────────
    //     보이지 않는 포맷 / 양방향 제어 문자.
    if (cp >= 0x200B && cp <= 0x200F) return true; // zero-width 계열
    if (cp >= 0x202A && cp <= 0x202E) return true; // bidi embedding/override
    if (cp >= 0x2066 && cp <= 0x2069) return true; // bidi isolate
    if (cp >= 0x2060 && cp <= 0x206F) return true; // word-joiner 등
    if (cp == 0x00A0 || cp == 0xFEFF) return true; // NBSP, BOM/ZWNBSP

    // ── (2) Combining marks (Latin/Greek/Cyrillic/Vietnamese 분해형) ─────
    //     완성형이 아닌, 다른 글자 뒤에 결합되는 분음부호 등. 정상 키보드
    //     입력으로는 나오지 않으며 look-alike 위조에만 쓰인다.
    if (cp >= 0x0300 && cp <= 0x036F) return true; // Combining Diacritical Marks
    if (cp >= 0x1AB0 && cp <= 0x1AFF) return true; // Combining Diacritical Ext
    if (cp >= 0x1DC0 && cp <= 0x1DFF) return true; // Combining Diacritical Suppl
    if (cp >= 0x20D0 && cp <= 0x20FF) return true; // Combining Marks for Symbols
    if (cp >= 0xFE20 && cp <= 0xFE2F) return true; // Combining Half Marks

    // ── (3) Hangul decomposed jamo (한글 자모분해형) ─────────────────────
    //     완성형(U+AC00~U+D7A3)만 허용. 분해 자모 영역을 차단한다.
    if (cp >= 0x1100 && cp <= 0x11FF) return true; // Hangul Jamo (conjoining)
    if (cp >= 0xA960 && cp <= 0xA97F) return true; // Hangul Jamo Extended-A
    if (cp >= 0xD7B0 && cp <= 0xD7FF) return true; // Hangul Jamo Extended-B
    if (cp >= 0x3130 && cp <= 0x318F) return true; // Hangul Compatibility Jamo

    // ── (4) Japanese combining (반)탁점 ─────────────────────────────────
    //     が = U+304C (완성형) 통과, か + U+3099 (결합 탁점) 차단.
    if (cp == 0x3099 || cp == 0x309A) return true; // combining (semi-)voiced mark

    return false;
  }
}
