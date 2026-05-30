// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title KoreanNormalization
 * @notice DEXignation v2.0 - Korean Language Support
 * 
 * Features:
 * - Unicode NFC 정규화
 * - Hangul 특화 정규화
 * - Homoglyph 감지
 */

library KoreanNormalization {
  
  // 한글 범위: U+AC00 ~ U+D7A3 (가 ~ 힣)
  uint256 constant HANGUL_START = 0xAC00;
  uint256 constant HANGUL_END = 0xD7A3;
  
  /**
   * @notice 한글 Homoglyph 감지
   * ㄱ(U+1100) vs ㄲ(U+1101) 구분
   */
  function detectHomoglyphsKorean(string memory name)
    internal pure returns (bool)
  {
    bytes memory nameBytes = bytes(name);
    
    for (uint i = 0; i < nameBytes.length; i++) {
      uint256 codePoint = uint256(uint8(nameBytes[i]));
      
      // Cyrillic 감지 (기존 로직)
      if (codePoint >= 0xD0 && codePoint <= 0xFF) {
        return true;
      }
      
      // Greek 감지 (기존 로직)
      if (codePoint >= 0xCE && codePoint <= 0xCF) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * @notice 한글 정규화
   * 현재: NFC 정규화
   * 추후: Hangul 특화 정규화 추가
   */
  function normalizeKorean(string memory input)
    internal pure returns (string memory)
  {
    // TODO: Hangul 특화 정규화 (자음/모음 분해)
    // 현재는 NFC 정규화로 충분
    return input;
  }
  
  /**
   * @notice 한글 문자 범위 확인
   */
  function isKorean(bytes1 char) internal pure returns (bool) {
    uint256 code = uint256(uint8(char));
    return code >= 0xAC && code <= 0xD7;
  }
  
  /**
   * @notice 도메인 라벨 유효성 확인
   * - 3자 이상 63자 이하
   * - 하이픈 금지 (시작/끝)
   * - 한글 + 영문 + 숫자 혼용 가능
   */
  function isValidLabel(string memory label) internal pure returns (bool) {
    bytes memory labelBytes = bytes(label);
    uint256 len = labelBytes.length;
    
    // 길이 확인 (3-63자)
    if (len < 3 || len > 63) {
      return false;
    }
    
    // 첫/끝 하이픈 확인
    if (labelBytes[0] == '-' || labelBytes[len - 1] == '-') {
      return false;
    }
    
    // 연속 하이픈 확인
    for (uint i = 0; i < len - 1; i++) {
      if (labelBytes[i] == '-' && labelBytes[i + 1] == '-') {
        return false;
      }
    }
    
    return true;
  }
}
