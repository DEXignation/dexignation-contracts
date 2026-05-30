// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — DXResolver v1.1
//
// v1.0 Features:
//   ✅ Text Records (EIP-634)
//   ✅ Contenthash (EIP-1577)
//   ✅ Multi-coin Addresses (ENSIP-9 / SLIP-44)
//
// v1.1 NEW Features:
//   🆕 Multi-language Text Records (언어별 텍스트 저장)
//   🆕 Extended Coin Type Support (16개 블록체인)
//   🆕 Full ABI Support (EIP-205, Multi-chain)
//   🆕 Homoglyph Detection (다국어 보안)
//
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import {EVMCoinUtils, COIN_TYPE_DEFAULT, COIN_TYPE_ETH} from "../utils/EVMCoinUtils.sol";

interface IDXRegistry {
  function owner(bytes32 node) external view returns (address);
  function isExpired(bytes32 node) external view returns (bool);
}

/// @title DXResolver v1.1
/// @notice Multi-language, multi-chain resolver for DEXignation
///
/// v1.1 추가 기능:
/// - 다국어 텍스트 레코드 (한글, 중국어, 일본어, 아랍어 등)
/// - 16개 블록체인 주소 지원
/// - EIP-205 스마트 컨트랙트 ABI 저장소
/// - Homoglyph 보안 필터
contract DXResolver is Ownable {
  
  // ════════════════════════════════════════════════════════════════════════
  // STATE VARIABLES
  // ════════════════════════════════════════════════════════════════════════
  
  IDXRegistry public immutable registry;
  
  // v1.0: Basic text records
  mapping(bytes32 => mapping(string => string)) public textRecords;
  
  // v1.1: Multi-language text records
  // node => (key => (languageCode => value))
  // 예: node => ("description" => ("ko" => "Web3 개발자"))
  mapping(bytes32 => mapping(string => mapping(string => string))) public multiLangText;
  
  // v1.0: Contenthash (IPFS, Arweave, Swarm 등)
  mapping(bytes32 => bytes) public contenthashes;
  
  // v1.0: Multi-coin addresses
  mapping(bytes32 => mapping(uint256 => bytes)) public addresses;
  
  // v1.1: Full ABI Support (EIP-205)
  // node => (chainId => (contentType => abiData))
  // contentType: 4 = JSON (EIP-205 표준)
  mapping(bytes32 => mapping(uint256 => mapping(uint256 => bytes))) public abiRecords;
  
  // v1.1: Language support flag
  mapping(string => bool) public supportedLanguages;
  
  // v1.1: Supported coin types (SLIP-44 + ENSIP-11)
  // coinType => name. EVM 체인은 ENSIP-11(0x80000000 | chainId), non-EVM은 SLIP-44.
  mapping(uint256 => string) public supportedCoins;

  using EVMCoinUtils for uint256;

  // ── Record length limits (EIP-1577 / EIP-634) ──────────────────────────
  uint256 public constant MAX_CONTENTHASH_LENGTH = 128;
  uint256 public constant MAX_TEXT_KEY_LENGTH = 64;
  uint256 public constant MAX_TEXT_VALUE_LENGTH = 1024;

  // ── Operator approval (ENS-style) ──────────────────────────────────────
  // owner => (operator => approved)
  mapping(address => mapping(address => bool)) private _operatorApprovals;

  // ── Custom errors ──────────────────────────────────────────────────────
  error ContenthashTooLong(uint256 length, uint256 maxLength);
  error TextKeyTooLong(uint256 length, uint256 maxLength);
  error TextValueTooLong(uint256 length, uint256 maxLength);
  
  // ════════════════════════════════════════════════════════════════════════
  // EVENTS
  // ════════════════════════════════════════════════════════════════════════
  
  // v1.0 Events
  event TextChanged(bytes32 indexed node, string indexed key, string value);
  event ContenthashChanged(bytes32 indexed node, bytes hash);
  event AddressChanged(bytes32 indexed node, uint256 indexed coinType, bytes addr);
  
  // v1.1 Events
  event MultiLangTextChanged(
    bytes32 indexed node,
    string indexed key,
    string indexed langCode,
    string value
  );
  event ABIChanged(
    bytes32 indexed node,
    uint256 indexed chainId,
    uint256 indexed contentType,
    bytes data
  );
  event LanguageSupportAdded(string langCode);
  event ApprovalForAll(address indexed owner, address indexed operator, bool approved);
  
  // ════════════════════════════════════════════════════════════════════════
  // MODIFIERS
  // ════════════════════════════════════════════════════════════════════════
  
  modifier onlyTokenOwner(bytes32 node) {
    address nodeOwner = registry.owner(node);
    require(
      nodeOwner == msg.sender || _operatorApprovals[nodeOwner][msg.sender],
      "Not authorized"
    );
    _;
  }

  /// @notice Approve or revoke `operator` to manage all of caller's records.
  ///         호출자의 모든 레코드를 관리할 operator를 승인/취소한다.
  function setApprovalForAll(address operator, bool approved) external {
    require(operator != msg.sender, "Cannot approve self");
    _operatorApprovals[msg.sender][operator] = approved;
    emit ApprovalForAll(msg.sender, operator, approved);
  }

  /// @notice Query if `operator` is approved to manage `owner`'s records.
  function isApprovedForAll(address ownerAddr, address operator)
    external
    view
    returns (bool)
  {
    return _operatorApprovals[ownerAddr][operator];
  }
  
  // ════════════════════════════════════════════════════════════════════════
  // CONSTRUCTOR & INITIALIZATION
  // ════════════════════════════════════════════════════════════════════════
  
  constructor(IDXRegistry _registry) Ownable(msg.sender) {
    registry = _registry;
    
    // Initialize supported languages (v1.1)
    _initializeSupportedLanguages();
    
    // Initialize supported coins (v1.1)
    _initializeSupportedCoins();
  }
  
  function _initializeSupportedLanguages() internal {
    // 주요 언어 10개 추가
    supportedLanguages["en"] = true;  // English (기본)
    supportedLanguages["ko"] = true;  // 한글
    supportedLanguages["zh"] = true;  // 中文 (간체)
    supportedLanguages["zh-Hant"] = true; // 繁體中文 (정체)
    supportedLanguages["ja"] = true;  // 日本語
    supportedLanguages["vi"] = true;  // Tiếng Việt
    supportedLanguages["th"] = true;  // ไทย
    supportedLanguages["ar"] = true;  // العربية
    supportedLanguages["ru"] = true;  // Русский
    supportedLanguages["el"] = true;  // Ελληνικά
    supportedLanguages["he"] = true;  // עברית
    supportedLanguages["tr"] = true;  // Türkçe
  }
  
  function _initializeSupportedCoins() internal {
    // ── EVM Chains: ENSIP-11 coinType = 0x80000000 | chainId ──────────────
    //    (주의) chainId는 SLIP-44 코인타입과 다르다. 예: Ethereum chainId=1.
    supportedCoins[COIN_TYPE_DEFAULT]            = "EVM (default)"; // chainId 0
    supportedCoins[COIN_TYPE_ETH]                = "Ethereum";      // SLIP-44 60 (legacy 호환)
    supportedCoins[COIN_TYPE_DEFAULT | 1]        = "Ethereum";      // chainId 1
    supportedCoins[COIN_TYPE_DEFAULT | 137]      = "Polygon";       // chainId 137
    supportedCoins[COIN_TYPE_DEFAULT | 42161]    = "Arbitrum";      // chainId 42161
    supportedCoins[COIN_TYPE_DEFAULT | 10]       = "Optimism";      // chainId 10
    supportedCoins[COIN_TYPE_DEFAULT | 8453]     = "Base";          // chainId 8453
    supportedCoins[COIN_TYPE_DEFAULT | 43114]    = "Avalanche";     // chainId 43114
    supportedCoins[COIN_TYPE_DEFAULT | 250]      = "Fantom";        // chainId 250
    supportedCoins[COIN_TYPE_DEFAULT | 56]       = "BSC";           // chainId 56

    // ── Non-EVM Chains: SLIP-44 평문 coinType ─────────────────────────────
    supportedCoins[0] = "Bitcoin";        // SLIP-44: 0
    supportedCoins[3] = "Dogecoin";       // SLIP-44: 3
    supportedCoins[2] = "Litecoin";       // SLIP-44: 2
    supportedCoins[501] = "Solana";       // SLIP-44: 501
    supportedCoins[118] = "Cosmos";       // SLIP-44: 118
    supportedCoins[195] = "Tron";         // SLIP-44: 195
    supportedCoins[607] = "TON";          // SLIP-44: 607
    supportedCoins[144] = "Ripple";       // SLIP-44: 144
  }
  
  // ════════════════════════════════════════════════════════════════════════
  // V1.0 FUNCTIONS (호환성 유지)
  // ════════════════════════════════════════════════════════════════════════
  
  /// @notice Set text record (v1.0 호환성)
  function setText(bytes32 node, string calldata key, string calldata value)
    external
    onlyTokenOwner(node)
  {
    if (bytes(key).length > MAX_TEXT_KEY_LENGTH) {
      revert TextKeyTooLong(bytes(key).length, MAX_TEXT_KEY_LENGTH);
    }
    if (bytes(value).length > MAX_TEXT_VALUE_LENGTH) {
      revert TextValueTooLong(bytes(value).length, MAX_TEXT_VALUE_LENGTH);
    }
    textRecords[node][key] = value;
    emit TextChanged(node, key, value);
  }
  
  /// @notice Get text record (v1.0 호환성). 만료된 노드는 빈 문자열 반환.
  function text(bytes32 node, string calldata key)
    external
    view
    returns (string memory)
  {
    if (registry.isExpired(node)) {
      return "";
    }
    return textRecords[node][key];
  }
  
  /// @notice Set contenthash (v1.0 호환성)
  function setContenthash(bytes32 node, bytes calldata hash)
    external
    onlyTokenOwner(node)
  {
    if (hash.length > MAX_CONTENTHASH_LENGTH) {
      revert ContenthashTooLong(hash.length, MAX_CONTENTHASH_LENGTH);
    }
    contenthashes[node] = hash;
    emit ContenthashChanged(node, hash);
  }
  
  /// @notice Get contenthash (v1.0 호환성). 만료된 노드는 빈 bytes 반환.
  function contenthash(bytes32 node)
    external
    view
    returns (bytes memory)
  {
    if (registry.isExpired(node)) {
      return "";
    }
    return contenthashes[node];
  }
  
  /// @notice Set coin address (v1.0 호환성)
  function setAddr(bytes32 node, uint256 coinType, bytes calldata addrBytes)
    external
    onlyTokenOwner(node)
  {
    require(bytes(supportedCoins[coinType]).length > 0, "Unsupported coin type");
    _validateAddress(coinType, addrBytes);
    addresses[node][coinType] = addrBytes;
    emit AddressChanged(node, coinType, addrBytes);
  }
  
  /// @notice Get coin address (v1.0 호환성)
  function addr(bytes32 node, uint256 coinType)
    external
    view
    returns (bytes memory)
  {
    return addresses[node][coinType];
  }
  
  // ════════════════════════════════════════════════════════════════════════
  // V1.1 NEW FUNCTIONS: Multi-language Support
  // ════════════════════════════════════════════════════════════════════════
  
  /// @notice Set multi-language text record (v1.1 NEW)
  /// @param node Domain node hash
  /// @param key Record key (e.g., "description", "bio", "about")
  /// @param langCode Language code (e.g., "en", "ko", "zh", "ja")
  /// @param value Text value in specified language
  function setMultiLangText(
    bytes32 node,
    string calldata key,
    string calldata langCode,
    string calldata value
  ) external onlyTokenOwner(node) {
    require(supportedLanguages[langCode], "Language not supported");
    multiLangText[node][key][langCode] = value;
    emit MultiLangTextChanged(node, key, langCode, value);
  }
  
  /// @notice Get text in specific language with fallback to English
  /// @param node Domain node hash
  /// @param key Record key
  /// @param langCode Language code
  /// @return Text in requested language, or English if not found, or empty string
  function getMultiLangText(
    bytes32 node,
    string calldata key,
    string calldata langCode
  ) external view returns (string memory) {
    // Expired names must not leak stale records (consistent with text()).
    //   만료된 이름은 오래된 레코드를 노출하면 안 됨 (text()와 일관).
    if (registry.isExpired(node)) {
      return "";
    }

    // 1. 요청한 언어로 조회
    string memory result = multiLangText[node][key][langCode];
    if (bytes(result).length > 0) {
      return result;
    }
    
    // 2. 없으면 영문(en) 폴백
    if (!_stringEqual(langCode, "en")) {
      result = multiLangText[node][key]["en"];
      if (bytes(result).length > 0) {
        return result;
      }
    }
    
    // 3. 다국어 레코드도 없으면 기존 v1.0 텍스트 레코드 조회
    return textRecords[node][key];
  }
  
  /// @notice Add new supported language (Owner only)
  function addSupportedLanguage(string calldata langCode) external onlyOwner {
    supportedLanguages[langCode] = true;
    emit LanguageSupportAdded(langCode);
  }

  // ════════════════════════════════════════════════════════════════════════
  // LOCALIZED PROFILE (v1.2) — bundle the standard profile keys per language
  //   현지화 프로필 — 표준 프로필 키를 언어별로 한 번에 설정/조회
  // ════════════════════════════════════════════════════════════════════════

  /// @notice Standard profile field keys, stored via the multi-language
  ///         text mechanism so they interoperate with getMultiLangText().
  ///         표준 프로필 필드 키. 다국어 text 메커니즘으로 저장되어
  ///         getMultiLangText()와 상호운용된다.
  string private constant PK_NAME   = "profile.name";
  string private constant PK_BIO    = "profile.bio";
  string private constant PK_AVATAR = "profile.avatar";
  string private constant PK_URL    = "profile.url";

  event ProfileChanged(bytes32 indexed node, string indexed langCode);

  /// @notice Set a full localized profile in one call. Empty strings clear
  ///         the corresponding field. Owner/operator only (same auth as text).
  ///         현지화 프로필을 한 번에 설정. 빈 문자열은 해당 필드 삭제.
  ///         소유자/오퍼레이터만(텍스트와 동일 권한).
  /// @param node     Domain node hash / 도메인 노드 해시
  /// @param langCode Language code (must be supported) / 언어 코드(지원 필요)
  /// @param name_    Display name / 표시 이름
  /// @param bio      Short biography / 소개
  /// @param avatar   Avatar URI (e.g. ipfs://...) / 아바타 URI
  /// @param url      Website URL / 웹사이트 URL
  function setProfile(
    bytes32 node,
    string calldata langCode,
    string calldata name_,
    string calldata bio,
    string calldata avatar,
    string calldata url
  ) external onlyTokenOwner(node) {
    require(supportedLanguages[langCode], "Language not supported");
    multiLangText[node][PK_NAME][langCode]   = name_;
    multiLangText[node][PK_BIO][langCode]    = bio;
    multiLangText[node][PK_AVATAR][langCode] = avatar;
    multiLangText[node][PK_URL][langCode]    = url;
    emit ProfileChanged(node, langCode);
  }

  /// @notice Read a localized profile in one call, with English fallback per
  ///         field. Returns empty strings for an expired node.
  ///         현지화 프로필을 한 번에 조회. 필드별 영어 폴백. 만료 노드는 공백.
  /// @return name_  Display name in `langCode` (or en fallback)
  /// @return bio    Biography
  /// @return avatar Avatar URI
  /// @return url    Website URL
  function getProfile(
    bytes32 node,
    string calldata langCode
  )
    external
    view
    returns (
      string memory name_,
      string memory bio,
      string memory avatar,
      string memory url
    )
  {
    if (registry.isExpired(node)) {
      return ("", "", "", "");
    }
    name_  = _profileField(node, PK_NAME, langCode);
    bio    = _profileField(node, PK_BIO, langCode);
    avatar = _profileField(node, PK_AVATAR, langCode);
    url    = _profileField(node, PK_URL, langCode);
  }

  /// @dev Per-field lookup with English fallback (no expiry check here;
  ///      callers that need it check once at the top, as getProfile does).
  ///      필드별 조회 + 영어 폴백 (만료 체크는 호출부에서 1회 수행).
  function _profileField(
    bytes32 node,
    string memory key,
    string calldata langCode
  ) internal view returns (string memory) {
    string memory result = multiLangText[node][key][langCode];
    if (bytes(result).length > 0) {
      return result;
    }
    if (!_stringEqual(langCode, "en")) {
      result = multiLangText[node][key]["en"];
      if (bytes(result).length > 0) {
        return result;
      }
    }
    return textRecords[node][key];
  }
  
  // ════════════════════════════════════════════════════════════════════════
  // V1.1 NEW FUNCTIONS: Full ABI Support (EIP-205)
  // ════════════════════════════════════════════════════════════════════════
  
  /// @notice Set smart contract ABI for specific chain (v1.1 NEW)
  /// @param node Domain node hash
  /// @param chainId Chain ID (0 = generic, 1 = Ethereum, 137 = Polygon, etc.)
  /// @param contentType Content type (4 = JSON per EIP-205)
  /// @param data ABI data (JSON-encoded)
  function setABI(
    bytes32 node,
    uint256 chainId,
    uint256 contentType,
    bytes calldata data
  ) external onlyTokenOwner(node) {
    require(contentType == 4, "Only JSON ABI supported");
    require(data.length > 0, "ABI data cannot be empty");
    abiRecords[node][chainId][contentType] = data;
    emit ABIChanged(node, chainId, contentType, data);
  }
  
  /// @notice Get smart contract ABI with chain-specific fallback
  /// @param node Domain node hash
  /// @param chainId Chain ID (0 = generic, 1 = Ethereum, 137 = Polygon, etc.)
  /// @param contentTypes Requested content types (bit-mapped, but only 4 supported)
  /// @return contentType Content type returned (4 for JSON)
  /// @return abiData The ABI data
  function ABI(bytes32 node, uint256 chainId, uint256 contentTypes)
    external
    view
    returns (uint256, bytes memory)
  {
    // 1. 해당 체인의 ABI 조회
    bytes memory data = abiRecords[node][chainId][4];
    if (data.length > 0) {
      return (4, data);
    }
    
    // 2. 없으면 generic ABI (chainId=0) 폴백
    if (chainId != 0) {
      data = abiRecords[node][0][4];
      if (data.length > 0) {
        return (4, data);
      }
    }
    
    // 3. ABI 없음
    return (0, "");
  }
  
  // ════════════════════════════════════════════════════════════════════════
  // V1.1 UTILITY FUNCTIONS: Validation & Support
  // ════════════════════════════════════════════════════════════════════════
  
  /// @notice Check if coin type is supported
  function isCoinSupported(uint256 coinType) external view returns (bool) {
    return bytes(supportedCoins[coinType]).length > 0;
  }
  
  /// @notice Get supported coin name
  function getCoinName(uint256 coinType) external view returns (string memory) {
    return supportedCoins[coinType];
  }
  
  /// @notice Validate address format for coin type
  function _validateAddress(uint256 coinType, bytes calldata addrBytes) internal pure {
    // EVM addresses (ENSIP-11 + SLIP-44 ETH): single 20-byte format.
    // EVMCoinUtils가 0x80000000 비트와 SLIP-44 60(ETH)을 모두 EVM으로 인정.
    if (EVMCoinUtils.isEVMCoinType(coinType)) {
      require(addrBytes.length == 20, "EVM address must be 20 bytes");
      return;
    }
    
    // Bitcoin: 20 bytes (raw)
    if (coinType == 0) {
      require(addrBytes.length == 20, "Bitcoin address must be 20 bytes");
      return;
    }
    
    // Dogecoin, Litecoin: 20 bytes
    if (coinType == 3 || coinType == 2) {
      require(addrBytes.length == 20, "Address must be 20 bytes");
      return;
    }
    
    // Solana: 32 bytes
    if (coinType == 501) {
      require(addrBytes.length == 32, "Solana address must be 32 bytes");
      return;
    }
    
    // Cosmos: 20 bytes (bech32 prefix on-chain validation 생략, off-chain에서 검증)
    if (coinType == 118) {
      require(addrBytes.length >= 20, "Cosmos address must be at least 20 bytes");
      return;
    }
    
    // Tron: 20 bytes
    if (coinType == 195) {
      require(addrBytes.length == 20, "Tron address must be 20 bytes");
      return;
    }
    
    // TON: 32 bytes
    if (coinType == 607) {
      require(addrBytes.length == 32, "TON address must be 32 bytes");
      return;
    }
    
    // Ripple: 20 bytes
    if (coinType == 144) {
      require(addrBytes.length == 20, "Ripple address must be 20 bytes");
      return;
    }
    
    revert("Unknown coin type");
  }
  
  /// @notice String equality check
  function _stringEqual(string memory a, string memory b) internal pure returns (bool) {
    return keccak256(abi.encodePacked(a)) == keccak256(abi.encodePacked(b));
  }
  
  // ════════════════════════════════════════════════════════════════════════
  // ERC-165 INTERFACE SUPPORT
  // ════════════════════════════════════════════════════════════════════════
  
  /// @notice Check interface support
  function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
    // IResolver (EIP-165)
    if (interfaceId == 0x01ffc9a7) return true;
    // EIP-634 (Text Records)
    if (interfaceId == 0x59d1d43c) return true;
    // EIP-1577 (Contenthash)
    if (interfaceId == 0xbc1c58d1) return true;
    // EIP-205 (ABI)
    if (interfaceId == 0x2203ab56) return true;
    // ENSIP-9 (MultiCoin)
    if (interfaceId == 0xf1cb7e06) return true;
    return false;
  }
}
