// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// ════════════════════════════════════════════════════════════════════════════
// DXSubnameRegistrar (A3 — subname commerce, v2 sale-lock)
//
//   A STANDALONE module that lets a parent-name owner run their own subname
//   business: set a price, enable sales, and earn revenue when buyers register
//   subnames under their name (e.g. team.alice.dex).
//
//   DESIGN — "Pattern 1" (operator delegation) + registry sale-lock:
//     • This contract touches NO existing contract storage. It calls the
//       registry through its public interface only.
//     • Issuance goes through the registry's `issueSubnodeRecordLocked`, which
//       both creates the subnode AND marks it sale-locked. A sale-locked
//       subname cannot be reassigned or revoked by the parent while it is live.
//       Sold subnames do not have a separate configured duration here; their
//       live/expired state follows the registry's parent-expiry chain. (Buyer
//       protection is enforced in the registry, not here.)
//     • Two authorisations are required for issuance, giving defence in depth:
//         (1) the registry must have authorised THIS module as a sale module
//             (registry.setSaleModule(address(this), true), root-owner only);
//         (2) the parent owner must have delegated to this module
//             (registry.setApprovalForAll(address(this), true)).
//       Either can be revoked at any time. A module that is not BOTH a
//       registered sale module AND delegated by the parent cannot issue.
//     • Replaceable: deploy a new module, re-authorise, re-delegate. The
//       registry, controller, and resolver remain immutable.
//
//   REVENUE — the buyer pays in native currency. A protocol fee (bps, capped)
//   is forwarded to the RevenueDistributor (or treasury); the remainder goes
//   to the parent owner.
//
//   LABEL POLICY & DUPLICATES — both are enforced by the registry inside
//   `issueSubnodeRecordLocked` (`_validateSubnodeLabel` rejects bad labels;
//   `SubnodeExists` rejects a live duplicate). This module no longer
//   re-validates — a single source of truth avoids drift.
//
//   독립 모듈(서브네임 커머스, v2 판매-잠금). 부모 이름 소유자가 가격·판매를
//   설정하고, 구매자가 서브네임을 등록하면 수익을 얻는다. 발급은 registry의
//   `issueSubnodeRecordLocked`를 거치며, 이는 서브노드 생성과 동시에 판매-잠금을
//   표시한다 — 판 서브네임은 라이브 동안 부모가 재지정/회수 불가(구매자 보호는
//   registry가 강제). 별도 기간은 저장하지 않고 registry의 부모 만료 체인을 따른다.
//   발급에는 두 인가가 필요하다: (1) registry가 이 모듈을 판매
//   모듈로 인가(setSaleModule, 루트 소유자), (2) 부모가 이 모듈에 위임
//   (setApprovalForAll). 라벨 정책·중복 검증은 registry가 일원 처리하므로 이
//   모듈은 재검증하지 않는다.
// ════════════════════════════════════════════════════════════════════════════

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Minimal registry interface this module depends on. Mirrors the
///      relevant functions of DXRegistry without importing its implementation,
///      keeping the module loosely coupled.
///      이 모듈이 의존하는 최소 registry 인터페이스. 구현을 import하지 않고
///      필요한 함수만 미러링해 결합도를 낮춘다.
interface IDXRegistryMinimal {
    function owner(bytes32 node) external view returns (address);
    function isExpired(bytes32 node) external view returns (bool);
    function isApprovedForAll(address _owner, address operator) external view returns (bool);

    /// @notice Sale-locked subname issuance. Creates the subnode under `node`,
    ///         assigns it to `_owner` with `_resolver`, and marks it
    ///         sale-locked so the parent cannot reassign/revoke it while live.
    ///         Reverts on invalid label (InvalidLabel) or live duplicate
    ///         (SubnodeExists). Caller must be a registered sale module AND
    ///         authorised for `node`.
    ///         판매-잠금 서브네임 발급. `node` 아래 서브노드를 생성해 `_owner`/
    ///         `_resolver`로 지정하고 판매-잠금을 표시. 잘못된 라벨·라이브 중복
    ///         시 revert. 호출자는 등록된 판매 모듈이며 `node`에 authorised여야.
    function issueSubnodeRecordLocked(
        bytes32 node,
        string calldata label,
        address _owner,
        address _resolver
    ) external returns (bytes32);
}

/// @dev Minimal balance interface shared by ERC-20 and ERC-721/SBT. Both expose
///      `balanceOf(address) returns (uint256)`, so a single interface gates on
///      either: for ERC-20 the threshold is a token amount; for an SBT the
///      threshold is a badge count (typically 1).
///      ERC-20과 ERC-721/SBT가 공유하는 최소 잔액 인터페이스. 둘 다
///      `balanceOf(address)`를 노출하므로 하나의 인터페이스로 게이팅:
///      ERC-20은 임계치가 토큰 수량, SBT는 배지 개수(보통 1).
interface IGateBalance {
    function balanceOf(address account) external view returns (uint256);
}

contract DXSubnameRegistrar is Ownable, ReentrancyGuard {
    // ──────────────────────────────────────────────────────────────────────────
    // Immutable wiring / 불변 연결
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice The DEXignation registry (source of truth for ownership).
    ///         DEXignation 레지스트리(소유권의 진실 원천).
    IDXRegistryMinimal public immutable registry;

    /// @notice Default resolver assigned to newly created subnames.
    ///         새로 생성되는 서브네임에 지정되는 기본 리졸버.
    address public defaultResolver;

    /// @notice Where the protocol fee is sent (RevenueDistributor). May be the
    ///         treasury/multisig directly. Zero address disables the fee.
    ///         프로토콜 수수료 수신처(RevenueDistributor). treasury/멀티시그도 가능.
    ///         zero address면 수수료 비활성.
    address public feeRecipient;

    // ──────────────────────────────────────────────────────────────────────────
    // Fee configuration / 수수료 설정
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice Protocol fee in basis points (e.g. 500 = 5%). Capped at
    ///         `MAX_FEE_BPS` in the setter.
    ///         프로토콜 수수료(만분율, 500 = 5%). setter에서 `MAX_FEE_BPS` 상한.
    uint256 public protocolFeeBps;

    /// @notice Hard cap on the protocol fee. 2000 bps = 20%.
    ///         프로토콜 수수료 하드캡. 2000 bps = 20%.
    uint256 public constant MAX_FEE_BPS = 2000;

    // ──────────────────────────────────────────────────────────────────────────
    // Per-parent commerce state / 부모별 커머스 상태
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice Price (in native wei) a parent owner charges per subname.
    ///         부모 소유자가 서브네임당 부과하는 가격(native wei).
    mapping(bytes32 parentNode => uint256) public subnamePrice;

    /// @notice Whether subname sales are enabled for a parent node.
    ///         부모 노드의 서브네임 판매 활성화 여부.
    mapping(bytes32 parentNode => bool) public salesEnabled;

    /// @notice Optional access gate per parent: buyers must hold at least
    ///         `gateThreshold` of `gateToken` to register a subname. Works for
    ///         both ERC-20 (amount) and ERC-721/SBT (badge count). zero address
    ///         = no gate (anyone may buy).
    ///         부모별 선택적 접근 게이트: 구매자는 `gateToken`을 `gateThreshold`
    ///         이상 보유해야 서브네임 등록 가능. ERC-20(수량)·ERC-721/SBT(개수)
    ///         모두 동작. zero address면 게이트 없음(누구나 구매).
    mapping(bytes32 parentNode => address) public gateToken;

    /// @notice Minimum balance of `gateToken` a buyer must hold. For an SBT,
    ///         set this to 1 (hold at least one badge).
    ///         구매자가 보유해야 할 `gateToken` 최소량. SBT는 1로 설정(배지 1개+).
    mapping(bytes32 parentNode => uint256) public gateThreshold;

    // ──────────────────────────────────────────────────────────────────────────
    // Events / 이벤트
    // ──────────────────────────────────────────────────────────────────────────

    event DefaultResolverSet(address indexed resolver);
    event FeeRecipientSet(address indexed recipient);
    event ProtocolFeeSet(uint256 bps);
    event SubnameConfigured(
        bytes32 indexed parentNode,
        uint256 price,
        bool enabled
    );
    event SubnameGateConfigured(
        bytes32 indexed parentNode,
        address indexed gateToken,
        uint256 gateThreshold
    );
    event SubnameRegistered(
        bytes32 indexed parentNode,
        bytes32 indexed subnode,
        string label,
        address indexed buyer,
        uint256 pricePaid,
        uint256 protocolFee
    );

    // ──────────────────────────────────────────────────────────────────────────
    // Errors / 에러
    // ──────────────────────────────────────────────────────────────────────────

    error NotParentOwner(bytes32 parentNode, address caller);
    error ParentExpired(bytes32 parentNode);
    error SalesDisabled(bytes32 parentNode);
    error ModuleNotApproved(bytes32 parentNode, address parentOwner);
    error IncorrectPayment(uint256 sent, uint256 required);
    error EmptyLabel();
    error GateNotMet(bytes32 parentNode, address gateToken, uint256 required, uint256 held);
    error FeeTooHigh(uint256 requested, uint256 max);
    error ZeroAddress();
    error NativeTransferFailed(address to);

    // ──────────────────────────────────────────────────────────────────────────
    // Construction / 생성
    // ──────────────────────────────────────────────────────────────────────────

    constructor(
        address _registry,
        address _defaultResolver,
        address _feeRecipient,
        uint256 _protocolFeeBps,
        address _owner
    ) Ownable(_owner) {
        if (_registry == address(0)) revert ZeroAddress();
        if (_protocolFeeBps > MAX_FEE_BPS) {
            revert FeeTooHigh(_protocolFeeBps, MAX_FEE_BPS);
        }
        registry = IDXRegistryMinimal(_registry);
        defaultResolver = _defaultResolver;
        feeRecipient = _feeRecipient;
        protocolFeeBps = _protocolFeeBps;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Owner (protocol) configuration / 프로토콜 오너 설정
    // ──────────────────────────────────────────────────────────────────────────

    function setDefaultResolver(address _resolver) external onlyOwner {
        defaultResolver = _resolver;
        emit DefaultResolverSet(_resolver);
    }

    function setFeeRecipient(address _recipient) external onlyOwner {
        feeRecipient = _recipient;
        emit FeeRecipientSet(_recipient);
    }

    function setProtocolFee(uint256 _bps) external onlyOwner {
        if (_bps > MAX_FEE_BPS) revert FeeTooHigh(_bps, MAX_FEE_BPS);
        protocolFeeBps = _bps;
        emit ProtocolFeeSet(_bps);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Parent-owner commerce configuration / 부모 소유자 커머스 설정
    //   The parent owner sets their own price and toggles sales.
    //   부모 소유자가 자기 가격을 정하고 판매를 토글.
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice Configure (or update) the subname business for `parentNode`.
    ///         Only the current parent owner may call. The node must not be
    ///         expired.
    ///         `parentNode`의 서브네임 사업 설정/갱신. 현재 부모 소유자만 호출.
    ///         만료된 노드는 불가.
    /// @param parentNode The parent name node (e.g. namehash of alice.dex).
    /// @param price      Native-wei price charged per subname.
    /// @param enabled    Whether sales are active.
    function configureSubname(
        bytes32 parentNode,
        uint256 price,
        bool enabled
    ) external {
        _requireParentOwner(parentNode);
        subnamePrice[parentNode] = price;
        salesEnabled[parentNode] = enabled;
        emit SubnameConfigured(parentNode, price, enabled);
    }

    /// @notice Set (or clear) the access gate for `parentNode`. Buyers must hold
    ///         at least `threshold` of `token` to register a subname. Pass
    ///         `token = address(0)` to remove the gate. Only the parent owner.
    ///         For an SBT/ERC-721 gate, set `threshold = 1`. For an ERC-20 gate,
    ///         set `threshold` to the required token amount (in token units).
    ///         `parentNode`의 접근 게이트 설정/해제. 구매자는 `token`을
    ///         `threshold` 이상 보유해야 등록 가능. `token = address(0)`이면
    ///         게이트 해제. 부모 소유자만. SBT/ERC-721은 `threshold = 1`,
    ///         ERC-20은 필요한 토큰 수량으로 설정.
    function setSubnameGate(bytes32 parentNode, address token, uint256 threshold) external {
        _requireParentOwner(parentNode);
        if (token == address(0)) {
            gateToken[parentNode] = address(0);
            gateThreshold[parentNode] = 0;
        } else {
            gateToken[parentNode] = token;
            gateThreshold[parentNode] = threshold;
        }
        emit SubnameGateConfigured(parentNode, gateToken[parentNode], gateThreshold[parentNode]);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Buyer flow / 구매자 흐름
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice Buy a subname under `parentNode`. Pays the parent owner's set
    ///         price; a protocol fee is split to `feeRecipient` and the rest
    ///         goes to the parent owner. The subname is issued (sale-locked) to
    ///         `msg.sender` through the registry. It has no separate duration;
    ///         expiry follows the parent chain recorded in the registry.
    ///         `parentNode` 아래 서브네임 구매. 부모 소유자가 정한 가격 지불,
    ///         프로토콜 수수료는 `feeRecipient`로, 나머지는 부모 소유자에게.
    ///         서브네임은 registry를 통해 판매-잠금으로 `msg.sender`에게 발급.
    ///         별도 기간은 없고 registry의 부모 만료 체인을 따른다.
    /// @param parentNode The parent name node.
    /// @param label      The subname label (e.g. "team" for team.alice.dex).
    function registerSubname(
        bytes32 parentNode,
        string calldata label
    ) external payable nonReentrant returns (bytes32 subnode) {
        // Cheap pre-check only. Full label policy (NFC-only, a-z/0-9/-, min 3
        // codepoints) and live-duplicate rejection are enforced by the registry
        // inside issueSubnodeRecordLocked — single source of truth.
        //   값싼 사전 검사만. 전체 라벨 정책과 라이브 중복 거부는 registry가
        //   issueSubnodeRecordLocked 내부에서 일원 강제한다.
        if (bytes(label).length == 0) revert EmptyLabel();

        if (!salesEnabled[parentNode]) revert SalesDisabled(parentNode);
        if (registry.isExpired(parentNode)) revert ParentExpired(parentNode);

        address parentOwner = registry.owner(parentNode);

        // Pattern-1 guard: the parent owner must have delegated to this module.
        // Surfaced as a clear error instead of an opaque registry revert.
        //   패턴1 가드: 부모 소유자가 이 모듈에 위임했어야 한다. 불투명한
        //   registry revert 대신 명확한 에러 제공.
        if (!registry.isApprovedForAll(parentOwner, address(this))) {
            revert ModuleNotApproved(parentNode, parentOwner);
        }

        uint256 price = subnamePrice[parentNode];
        if (msg.value != price) revert IncorrectPayment(msg.value, price);

        // Access gate: if the parent set a gate token, the buyer must hold at
        // least the threshold. Works for ERC-20 (amount) and SBT/ERC-721 (count).
        //   접근 게이트: 부모가 게이트 토큰을 설정했으면 구매자는 임계치 이상
        //   보유해야 한다. ERC-20(수량)·SBT/ERC-721(개수) 모두 동작.
        address gate = gateToken[parentNode];
        if (gate != address(0)) {
            uint256 held = IGateBalance(gate).balanceOf(msg.sender);
            uint256 required = gateThreshold[parentNode];
            if (held < required) {
                revert GateNotMet(parentNode, gate, required, held);
            }
        }

        // Compute split. protocolFee is bounded by MAX_FEE_BPS (<=20%), so
        // ownerProceeds is always non-negative.
        //   분배 계산. protocolFee는 MAX_FEE_BPS(<=20%) 이내라 ownerProceeds는 항상 >=0.
        uint256 protocolFee = 0;
        if (feeRecipient != address(0) && protocolFeeBps > 0) {
            protocolFee = (price * protocolFeeBps) / 10000;
        }
        uint256 ownerProceeds = price - protocolFee;

        // Effects → Interactions (registry write before value transfers, all
        // after state checks; nonReentrant guards the whole call).
        //   레지스트리 기록 후 자금 전송. 전체는 nonReentrant로 보호.
        //
        // Sale-locked issuance: the registry creates the subnode, validates the
        // label, rejects a live duplicate, marks it sale-locked, and bumps the
        // resolver version — all atomically. The parent cannot later reassign or
        // revoke this subname while it is live.
        //   판매-잠금 발급: registry가 서브노드 생성·라벨 검증·라이브 중복 거부·
        //   판매-잠금 표시·resolver 버전 증가를 원자적으로 수행. 부모는 이후
        //   라이브 동안 이 서브네임을 재지정·회수할 수 없다.
        subnode = registry.issueSubnodeRecordLocked(
            parentNode,
            label,
            msg.sender,
            defaultResolver
        );

        // Payouts.
        if (protocolFee > 0) {
            _sendNative(feeRecipient, protocolFee);
        }
        if (ownerProceeds > 0) {
            _sendNative(parentOwner, ownerProceeds);
        }

        emit SubnameRegistered(parentNode, subnode, label, msg.sender, price, protocolFee);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Views / 조회
    // ──────────────────────────────────────────────────────────────────────────

    /// @notice Quote the current price for a subname under `parentNode`.
    ///         `parentNode` 서브네임의 현재 가격 조회.
    function quote(bytes32 parentNode) external view returns (uint256) {
        return subnamePrice[parentNode];
    }

    /// @notice True if a subname can be bought right now under `parentNode`:
    ///         sales enabled, parent not expired, and the module is delegated.
    ///         지금 `parentNode` 아래 서브네임을 살 수 있는지: 판매 활성 +
    ///         부모 미만료 + 모듈 위임됨.
    function isPurchasable(bytes32 parentNode) external view returns (bool) {
        if (!salesEnabled[parentNode]) return false;
        if (registry.isExpired(parentNode)) return false;
        address parentOwner = registry.owner(parentNode);
        return registry.isApprovedForAll(parentOwner, address(this));
    }

    /// @notice True if `buyer` meets the access gate for `parentNode` (always
    ///         true when no gate is set). Pairs with `isPurchasable` for UIs:
    ///         a buyer can register iff `isPurchasable && meetsGate`.
    ///         `buyer`가 `parentNode`의 접근 게이트를 충족하는지(게이트 미설정 시
    ///         항상 true). UI에선 `isPurchasable && meetsGate`면 등록 가능.
    function meetsGate(bytes32 parentNode, address buyer) external view returns (bool) {
        address gate = gateToken[parentNode];
        if (gate == address(0)) return true;
        return IGateBalance(gate).balanceOf(buyer) >= gateThreshold[parentNode];
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Internal / 내부
    // ──────────────────────────────────────────────────────────────────────────

    /// @dev Require the caller to currently own `parentNode` and that it is not
    ///      expired.
    ///      호출자가 현재 `parentNode`를 소유하고 만료되지 않았을 것을 요구.
    function _requireParentOwner(bytes32 parentNode) internal view {
        if (registry.isExpired(parentNode)) revert ParentExpired(parentNode);
        if (registry.owner(parentNode) != msg.sender) {
            revert NotParentOwner(parentNode, msg.sender);
        }
    }

    function _sendNative(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert NativeTransferFailed(to);
    }
}
