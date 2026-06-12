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
import {COIN_TYPE_DEFAULT, COIN_TYPE_ETH} from "../utils/EVMCoinUtils.sol";
import {DXNamehash} from "../utils/DXNamehash.sol";

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

    // ── Record versioning (v2: transfer invalidation) ──────────────────────
    // Each node has a record version. All record mappings are namespaced by it.
    // On NFT transfer, the registrar calls `bumpVersion(node)` to increment it,
    // atomically invalidating EVERY record kind for that node (addr, text,
    // contenthash, multilang, abi, agent) in O(1) gas. Old records stay on chain
    // under the previous version for auditability, but are no longer returned by
    // reads. The new owner sets fresh records under the new version — preventing
    // funds being sent to a previous owner after a name changes hands.
    //   노드별 레코드 버전. 모든 레코드 매핑이 이 버전으로 네임스페이스된다.
    //   NFT 전송 시 registrar가 bumpVersion(node)로 버전을 올리면 해당 노드의
    //   모든 레코드가 O(1)로 일괄 무효화된다. 옛 레코드는 이전 버전 아래 체인에
    //   남아 이력 추적이 가능하나 조회되지 않는다. 이름 양도 후 이전 소유자에게
    //   자금이 송금되는 것을 방지한다.
    mapping(bytes32 => uint64) public recordVersions;

    /// @dev Current record version for a node (indexes every record mapping).
    function _ver(bytes32 node) internal view returns (uint64) {
        return recordVersions[node];
    }

    // v1.0: Basic text records  →  node => version => key => value
    mapping(bytes32 => mapping(uint64 => mapping(string => string))) internal textRecords;

    // v1.1: Multi-language text records  →  node => version => key => lang => value
    mapping(bytes32 => mapping(uint64 => mapping(string => mapping(string => string))))
        internal multiLangText;

    // v1.0: Contenthash  →  node => version => hash
    mapping(bytes32 => mapping(uint64 => bytes)) internal contenthashes;

    // v1.0: Multi-coin addresses  →  node => version => coinType => addr
    mapping(bytes32 => mapping(uint64 => mapping(uint256 => bytes))) internal addresses;

    // v1.1: Full ABI Support (EIP-205)  →  node => version => chainId => contentType => data
    mapping(bytes32 => mapping(uint64 => mapping(uint256 => mapping(uint256 => bytes))))
        internal abiRecords;

    // v1.1: Language support flag
    mapping(string => bool) public supportedLanguages;

    // v1.1: Supported coin types (SLIP-44 + ENSIP-11)
    // coinType => name. EVM 체인은 ENSIP-11(0x80000000 | chainId), non-EVM은 SLIP-44.
    mapping(uint256 => string) public supportedCoins;

    // ── Record length limits (EIP-1577 / EIP-634) ──────────────────────────
    uint256 public constant MAX_CONTENTHASH_LENGTH = 128;
    uint256 public constant MAX_TEXT_KEY_LENGTH = 64;
    uint256 public constant MAX_TEXT_VALUE_LENGTH = 1024;

    // ── Operator approval (ENS-style) ──────────────────────────────────────
    // owner => (operator => approved)
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    // ── Agent identity & payment routing (v1.3, B1) ────────────────────────
    // A `.dex` name can POINT TO an external agent identity (e.g. ERC-8004) and
    // a payment endpoint (e.g. x402). This resolver does NOT implement those
    // standards — it stores pointers to them, exactly as ENS stores addr/
    // contenthash pointers. The agent "card" (capabilities, MCP/A2A/HTTP
    // endpoints, spend policy) lives off-chain at `cardURI`; only the trust-
    // anchoring pointers are kept on-chain.
    //   `.dex` 이름이 외부 에이전트 신원(예: ERC-8004)과 결제 엔드포인트(예:
    //   x402)를 가리킬 수 있다. 이 리졸버는 그 표준들을 구현하지 않고 포인터만
    //   저장한다 — ENS가 addr/contenthash 포인터를 저장하는 것과 동일. 에이전트
    //   "카드"(기능·엔드포인트·지출정책)는 오프체인 `cardURI`에 있고, 온체인에는
    //   신뢰 기준점 포인터만 둔다.
    struct AgentRecord {
        address registry; // external agent registry (e.g. ERC-8004 Identity Registry)
        uint256 agentId; // agent id within that registry (e.g. ERC-721 tokenId)
        string cardURI; // off-chain agent card (MCP/A2A/HTTP endpoints, policy)
        address payTo; // payment recipient (x402 settlement address)
        address payToken; // preferred token (e.g. USDC); address(0) = native
    }

    /// @notice Per-node agent identity + payment-routing record.
    ///         노드별 에이전트 신원 + 결제 라우팅 레코드.
    // node => version => agent record (versioned for transfer invalidation)
    mapping(bytes32 => mapping(uint64 => AgentRecord)) private agentRecords;

    // Reverse resolution (EIP-181): `{addr}.addr.reverse` → forward name
    mapping(bytes32 => string) internal names;

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
    event NameChanged(bytes32 indexed node, string name);

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

    // ── Registrar wiring (v2) ──────────────────────────────────────────────
    // The registrar (NFT contract) is allowed to bump a node's record version
    // on transfer. Additional invalidators can be granted for modules that
    // reassign registry-owned names, such as subname issuance.
    //   registrar(NFT 컨트랙트)는 전송 시 노드의 레코드 버전을 올릴 수 있다.
    //   서브네임 발급처럼 registry 소유권을 재지정하는 모듈은 별도 invalidator
    //   권한을 부여받아 기존 레코드를 무효화할 수 있다.
    address public registrar;
    mapping(address => bool) public recordInvalidators;

    event RegistrarSet(address indexed registrar);
    event RecordInvalidatorSet(address indexed invalidator, bool approved);
    event RecordsInvalidated(bytes32 indexed node, uint64 newVersion);

    modifier onlyRecordInvalidator() {
        require(
            msg.sender == registrar || recordInvalidators[msg.sender],
            "Only record invalidator"
        );
        _;
    }

    /// @notice Wire the registrar that may invalidate records on transfer.
    ///         전송 시 레코드를 무효화할 수 있는 registrar를 연결한다.
    function setRegistrar(address _registrar) external onlyOwner {
        registrar = _registrar;
        emit RegistrarSet(_registrar);
    }

    /// @notice Grant/revoke permission to invalidate resolver records.
    ///         Used by modules that change registry ownership outside the NFT
    ///         transfer hook, e.g. subname issuance/reassignment.
    ///         resolver 레코드 무효화 권한 부여/회수. NFT 전송 훅 밖에서
    ///         registry 소유권을 변경하는 모듈(서브네임 발급 등)에 사용.
    function setRecordInvalidator(address invalidator, bool approved) external onlyOwner {
        recordInvalidators[invalidator] = approved;
        emit RecordInvalidatorSet(invalidator, approved);
    }

    /// @notice Invalidate ALL records for a node by bumping its version.
    ///         Called by the registrar on NFT transfer. Old records remain on
    ///         chain under the previous version (history) but are no longer read.
    ///         노드의 모든 레코드를 버전 증가로 무효화한다. NFT 전송 시 registrar가
    ///         호출. 옛 레코드는 이전 버전 아래 남으나(이력) 더는 조회되지 않는다.
    function bumpVersion(bytes32 node) external onlyRecordInvalidator {
        recordVersions[node]++;
        emit RecordsInvalidated(node, recordVersions[node]);
    }

    /// @notice Approve or revoke `operator` to manage all of caller's records.
    ///         호출자의 모든 레코드를 관리할 operator를 승인/취소한다.
    function setApprovalForAll(address operator, bool approved) external {
        require(operator != msg.sender, "Cannot approve self");
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    /// @notice Query if `operator` is approved to manage `owner`'s records.
    function isApprovedForAll(address ownerAddr, address operator) external view returns (bool) {
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
        supportedLanguages["en"] = true; // English (기본)
        supportedLanguages["ko"] = true; // 한글
        supportedLanguages["zh"] = true; // 中文 (간체)
        supportedLanguages["zh-Hant"] = true; // 繁體中文 (정체)
        supportedLanguages["ja"] = true; // 日本語
        supportedLanguages["vi"] = true; // Tiếng Việt
        supportedLanguages["th"] = true; // ไทย
        supportedLanguages["ar"] = true; // العربية
        supportedLanguages["ru"] = true; // Русский
        supportedLanguages["el"] = true; // Ελληνικά
        supportedLanguages["he"] = true; // עברית
        supportedLanguages["tr"] = true; // Türkçe
    }

    function _initializeSupportedCoins() internal {
        // ── EVM Chains: ENSIP-11 coinType = 0x80000000 | chainId ──────────────
        //    (주의) chainId는 SLIP-44 코인타입과 다르다. 예: Ethereum chainId=1.
        supportedCoins[COIN_TYPE_DEFAULT] = "EVM (default)"; // chainId 0
        supportedCoins[COIN_TYPE_ETH] = "Ethereum"; // SLIP-44 60 (legacy 호환)
        supportedCoins[COIN_TYPE_DEFAULT | 1] = "Ethereum"; // chainId 1
        supportedCoins[COIN_TYPE_DEFAULT | 137] = "Polygon"; // chainId 137
        supportedCoins[COIN_TYPE_DEFAULT | 42161] = "Arbitrum"; // chainId 42161
        supportedCoins[COIN_TYPE_DEFAULT | 10] = "Optimism"; // chainId 10
        supportedCoins[COIN_TYPE_DEFAULT | 8453] = "Base"; // chainId 8453
        supportedCoins[COIN_TYPE_DEFAULT | 43114] = "Avalanche"; // chainId 43114
        supportedCoins[COIN_TYPE_DEFAULT | 250] = "Fantom"; // chainId 250
        supportedCoins[COIN_TYPE_DEFAULT | 56] = "BSC"; // chainId 56

        // ── Non-EVM Chains: SLIP-44 평문 coinType ─────────────────────────────
        supportedCoins[0] = "Bitcoin"; // SLIP-44: 0
        supportedCoins[3] = "Dogecoin"; // SLIP-44: 3
        supportedCoins[2] = "Litecoin"; // SLIP-44: 2
        supportedCoins[501] = "Solana"; // SLIP-44: 501
        supportedCoins[118] = "Cosmos"; // SLIP-44: 118
        supportedCoins[195] = "Tron"; // SLIP-44: 195
        supportedCoins[607] = "TON"; // SLIP-44: 607
        supportedCoins[144] = "Ripple"; // SLIP-44: 144
    }

    // ════════════════════════════════════════════════════════════════════════
    // V1.0 FUNCTIONS (호환성 유지)
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Set text record (v1.0 호환성)
    function setText(
        bytes32 node,
        string calldata key,
        string calldata value
    ) external onlyTokenOwner(node) {
        if (bytes(key).length > MAX_TEXT_KEY_LENGTH) {
            revert TextKeyTooLong(bytes(key).length, MAX_TEXT_KEY_LENGTH);
        }
        if (bytes(value).length > MAX_TEXT_VALUE_LENGTH) {
            revert TextValueTooLong(bytes(value).length, MAX_TEXT_VALUE_LENGTH);
        }
        textRecords[node][_ver(node)][key] = value;
        emit TextChanged(node, key, value);
    }

    /// @notice Get text record (v1.0 호환성). 만료된 노드는 빈 문자열 반환.
    function text(bytes32 node, string calldata key) external view returns (string memory) {
        if (registry.isExpired(node)) {
            return "";
        }
        return textRecords[node][_ver(node)][key];
    }

    /// @notice Set contenthash (v1.0 호환성)
    function setContenthash(bytes32 node, bytes calldata hash) external onlyTokenOwner(node) {
        if (hash.length > MAX_CONTENTHASH_LENGTH) {
            revert ContenthashTooLong(hash.length, MAX_CONTENTHASH_LENGTH);
        }
        contenthashes[node][_ver(node)] = hash;
        emit ContenthashChanged(node, hash);
    }

    /// @notice Get contenthash (v1.0 호환성). 만료된 노드는 빈 bytes 반환.
    function contenthash(bytes32 node) external view returns (bytes memory) {
        if (registry.isExpired(node)) {
            return "";
        }
        return contenthashes[node][_ver(node)];
    }

    /// @notice Set coin address (v1.0 호환성)
    function setAddr(
        bytes32 node,
        uint256 coinType,
        bytes calldata addrBytes
    ) external onlyTokenOwner(node) {
        addresses[node][_ver(node)][coinType] = addrBytes;
        emit AddressChanged(node, coinType, addrBytes);
    }

    /// @notice Get coin address (v1.0 호환성)
    function addr(bytes32 node, uint256 coinType) external view returns (bytes memory) {
        if (registry.isExpired(node)) {
            return "";
        }
        return addresses[node][_ver(node)][coinType];
    }

    /// @notice Set the forward name for a reverse node (`{addr}.addr.reverse`).
    ///         빈 문자열을 전달하면 역방향 이름을 제거한다.
    function setName(bytes32 node, string calldata newName) external onlyTokenOwner(node) {
        bytes32 forwardNode = DXNamehash.namehash(newName);
        if (registry.isExpired(forwardNode)) {
            revert("Forward node is expired");
        }

        if (registry.owner(forwardNode) != registry.owner(node)) {
            revert("Not authorized");
        }

        if (bytes(newName).length == 0) {
            delete names[node];
            emit NameChanged(node, "");
            return;
        }

        names[node] = newName;
        emit NameChanged(node, newName);
    }

    /// @notice Read reverse name with forward-owner verification at read time.
    ///         미설정·만료·정방향/역방향 소유자 불일치 시 빈 문자열 반환.
    function name(bytes32 node) external view returns (string memory) {
        string memory stored = names[node];
        if (bytes(stored).length == 0) {
            return stored;
        }

        bytes32 forwardNode = DXNamehash.namehash(stored);
        address reverseOwner = registry.owner(node);

        if (registry.isExpired(forwardNode) || registry.owner(forwardNode) != reverseOwner) {
            return "";
        }
        return stored;
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
        multiLangText[node][_ver(node)][key][langCode] = value;
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
        string memory result = multiLangText[node][_ver(node)][key][langCode];
        if (bytes(result).length > 0) {
            return result;
        }

        // 2. 없으면 영문(en) 폴백
        if (!_stringEqual(langCode, "en")) {
            result = multiLangText[node][_ver(node)][key]["en"];
            if (bytes(result).length > 0) {
                return result;
            }
        }

        // 3. 다국어 레코드도 없으면 기존 v1.0 텍스트 레코드 조회
        return textRecords[node][_ver(node)][key];
    }

    /// @notice Add new supported language (Owner only)
    function addSupportedLanguage(string calldata langCode) external onlyOwner {
        supportedLanguages[langCode] = true;
        emit LanguageSupportAdded(langCode);
    }

    // ════════════════════════════════════════════════════════════════════════
    // AGENT IDENTITY & PAYMENT ROUTING (v1.3, B1)
    //   Point a `.dex` name at an external agent identity (ERC-8004) and a
    //   payment endpoint (x402). Pointers only — standards are not implemented
    //   here. 외부 에이전트 신원(ERC-8004)·결제 엔드포인트(x402)를 가리키는
    //   포인터만 저장. 표준 자체는 구현하지 않음.
    // ════════════════════════════════════════════════════════════════════════

    event AgentRecordChanged(
        bytes32 indexed node,
        address indexed registry,
        uint256 agentId,
        address payTo
    );
    event AgentRecordCleared(bytes32 indexed node);

    /// @notice Set the agent identity + payment-routing record for `node`.
    ///         Owner/operator only.
    ///         `node`의 에이전트 신원 + 결제 라우팅 레코드 설정. 소유자/operator만.
    /// @param node     Domain node hash / 도메인 노드 해시
    /// @param registry_ External agent registry, e.g. ERC-8004 Identity Registry
    /// @param agentId  Agent id within that registry (e.g. ERC-721 tokenId)
    /// @param cardURI  Off-chain agent card URI (endpoints, capabilities, policy)
    /// @param payTo    Payment recipient (x402 settlement); may differ from owner
    /// @param payToken Preferred payment token; address(0) = native currency
    function setAgent(
        bytes32 node,
        address registry_,
        uint256 agentId,
        string calldata cardURI,
        address payTo,
        address payToken
    ) external onlyTokenOwner(node) {
        agentRecords[node][_ver(node)] = AgentRecord({
            registry: registry_,
            agentId: agentId,
            cardURI: cardURI,
            payTo: payTo,
            payToken: payToken
        });
        emit AgentRecordChanged(node, registry_, agentId, payTo);
    }

    /// @notice Remove the agent record for `node`. Owner/operator only.
    ///         `node`의 에이전트 레코드 삭제. 소유자/operator만.
    function clearAgent(bytes32 node) external onlyTokenOwner(node) {
        delete agentRecords[node][_ver(node)];
        emit AgentRecordCleared(node);
    }

    /// @notice Read the full agent record. Returns zero/empty values for an
    ///         expired node or when unset.
    ///         전체 에이전트 레코드 조회. 만료 노드나 미설정 시 공백/0 반환.
    function getAgent(
        bytes32 node
    )
        external
        view
        returns (
            address registry_,
            uint256 agentId,
            string memory cardURI,
            address payTo,
            address payToken
        )
    {
        if (registry.isExpired(node)) {
            return (address(0), 0, "", address(0), address(0));
        }
        AgentRecord storage a = agentRecords[node][_ver(node)];
        return (a.registry, a.agentId, a.cardURI, a.payTo, a.payToken);
    }

    /// @notice Convenience: just the payment routing (payTo, payToken). Returns
    ///         zeros for an expired node. Useful for x402 settlement lookups.
    ///         편의: 결제 라우팅만(payTo, payToken). 만료 시 0. x402 정산 조회용.
    function agentPayment(bytes32 node) external view returns (address payTo, address payToken) {
        if (registry.isExpired(node)) {
            return (address(0), address(0));
        }
        AgentRecord storage a = agentRecords[node][_ver(node)];
        return (a.payTo, a.payToken);
    }

    /// @notice True if `node` has an agent identity configured (non-zero
    ///         registry) and is not expired.
    ///         `node`에 에이전트 신원(비-0 registry)이 설정되고 미만료면 true.
    function hasAgent(bytes32 node) external view returns (bool) {
        if (registry.isExpired(node)) return false;
        return agentRecords[node][_ver(node)].registry != address(0);
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
        abiRecords[node][_ver(node)][chainId][contentType] = data;
        emit ABIChanged(node, chainId, contentType, data);
    }

    /// @notice Get smart contract ABI with chain-specific fallback
    /// @param node Domain node hash
    /// @param chainId Chain ID (0 = generic, 1 = Ethereum, 137 = Polygon, etc.)
    /// @param contentTypes Requested content types (bit-mapped, but only 4 supported)
    /// @return contentType Content type returned (4 for JSON)
    /// @return abiData The ABI data
    function ABI(
        bytes32 node,
        uint256 chainId,
        uint256 contentTypes
    ) external view returns (uint256, bytes memory) {
        if (registry.isExpired(node)) {
            return (0, "");
        }

        // EIP-205: contentTypes is a bitmask; only JSON (4) is stored
        if ((contentTypes & 4) == 0) {
            return (0, "");
        }

        // 1. 해당 체인의 ABI 조회
        bytes memory data = abiRecords[node][_ver(node)][chainId][4];
        if (data.length > 0) {
            return (4, data);
        }

        // 2. 없으면 generic ABI (chainId=0) 폴백
        if (chainId != 0) {
            data = abiRecords[node][_ver(node)][0][4];
            if (data.length > 0) {
                return (4, data);
            }
        }

        // 3. ABI 없음
        return (0, "");
    }

    // ════════════════════════════════════════════════════════════════════════
    // V1.1 UTILITY FUNCTIONS: Support Metadata
    // ════════════════════════════════════════════════════════════════════════

    /// @notice Check if coin type is supported
    function isCoinSupported(uint256 coinType) external view returns (bool) {
        return bytes(supportedCoins[coinType]).length > 0;
    }

    /// @notice Get supported coin name
    function getCoinName(uint256 coinType) external view returns (string memory) {
        return supportedCoins[coinType];
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
