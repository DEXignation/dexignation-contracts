// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// ════════════════════════════════════════════════════════════════════════════
// DXSubnameRegistrar (A3 — subname commerce)
//
//   A STANDALONE module that lets a parent-name owner run their own subname
//   business: set a price, enable sales, and earn revenue when buyers register
//   subnames under their name (e.g. team.alice.dex).
//
//   DESIGN — "Pattern 1" (operator delegation), chosen for safety:
//     • This contract touches NO existing contract source. It only *calls*
//       the registry through its public interface.
//     • To issue a subnode under `alice.dex`, the registry requires the caller
//       to be authorised for that node. So the parent owner must first
//       delegate to this module exactly once:
//           registry.setApprovalForAll(address(this), true)
//       That delegation is revocable at any time, and scoped to nodes the
//       owner actually controls — a buggy or malicious module can never affect
//       names whose owners did not opt in.
//     • Because nothing here is baked into the registry, this module can be
//       replaced by deploying a new one and re-delegating; the registry,
//       controller, and resolver remain immutable.
//
//   REVENUE — the buyer pays in native currency. A protocol fee (bps, capped)
//   is forwarded to the RevenueDistributor (which later splits it among
//   treasury/stakers); the remainder goes to the parent owner.
//
//   독립 모듈 (서브네임 커머스). 부모 이름 소유자가 직접 서브네임 사업을 운영:
//   가격 설정, 판매 활성화, 구매자가 자기 이름 아래 서브네임을 등록하면 수익 획득.
//   "패턴 1"(operator 위임) 채택 — 기존 컨트랙트 소스를 전혀 건드리지 않고
//   registry를 인터페이스로 호출만 한다. 부모 소유자가 사전에 한 번
//   `setApprovalForAll(module, true)`로 위임해야 하며, 언제든 회수 가능하고
//   위임한 노드에만 적용된다. 수익은 native로 받아 프로토콜 수수료(bps, 상한)는
//   RevenueDistributor로, 나머지는 부모 소유자에게 전달.
// ════════════════════════════════════════════════════════════════════════════

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "../utils/StringUtils.sol";

/// @dev Minimal registry interface this module depends on. Mirrors the
///      relevant functions of DXRegistry without importing its implementation,
///      keeping the module loosely coupled.
///      이 모듈이 의존하는 최소 registry 인터페이스. 구현을 import하지 않고
///      필요한 함수만 미러링해 결합도를 낮춘다.
interface IDXRegistryMinimal {
  function owner(bytes32 node) external view returns (address);
  function isExpired(bytes32 node) external view returns (bool);
  function isApprovedForAll(address _owner, address operator)
    external view returns (bool);
  function setSubnodeRecord(
    bytes32 node,
    bytes32 label,
    address _owner,
    address _resolver
  ) external;
  function setSubnodeExpires(
    bytes32 node,
    bytes32 label,
    uint256 _expires
  ) external;
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
  using StringUtils for string;
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

  /// @notice Duration (seconds) granted to a purchased subname.
  ///         구매된 서브네임에 부여되는 기간(초).
  mapping(bytes32 parentNode => uint256) public subnameDuration;

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
    uint256 duration,
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
  error InvalidLabel(string label);
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
    uint256 _protocolFeeBps
  ) Ownable(msg.sender) {
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
  //   The parent owner sets their own price/duration and toggles sales.
  //   부모 소유자가 자기 가격·기간을 정하고 판매를 토글.
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice Configure (or update) the subname business for `parentNode`.
  ///         Only the current parent owner may call. The node must not be
  ///         expired.
  ///         `parentNode`의 서브네임 사업 설정/갱신. 현재 부모 소유자만 호출.
  ///         만료된 노드는 불가.
  /// @param parentNode The parent name node (e.g. namehash of alice.dex).
  /// @param price      Native-wei price charged per subname.
  /// @param duration   Lifetime (seconds) granted to each subname.
  /// @param enabled    Whether sales are active.
  function configureSubname(
    bytes32 parentNode,
    uint256 price,
    uint256 duration,
    bool enabled
  ) external {
    _requireParentOwner(parentNode);
    subnamePrice[parentNode] = price;
    subnameDuration[parentNode] = duration;
    salesEnabled[parentNode] = enabled;
    emit SubnameConfigured(parentNode, price, duration, enabled);
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
  function setSubnameGate(
    bytes32 parentNode,
    address token,
    uint256 threshold
  ) external {
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
  ///         goes to the parent owner. The subname is registered to `msg.sender`.
  ///         `parentNode` 아래 서브네임 구매. 부모 소유자가 정한 가격 지불,
  ///         프로토콜 수수료는 `feeRecipient`로, 나머지는 부모 소유자에게.
  ///         서브네임은 `msg.sender`에게 등록.
  /// @param parentNode The parent name node.
  /// @param label      The subname label (e.g. "team" for team.alice.dex).
  function registerSubname(
    bytes32 parentNode,
    string calldata label
  ) external payable nonReentrant returns (bytes32 subnode) {
    if (bytes(label).length == 0) revert EmptyLabel();
    // Same multilingual policy as 2LD: NFC-only (precomposed) characters,
    // ASCII restricted to a-z/0-9/-, and minimum 3 codepoints. Prevents the
    // subname path from becoming a bypass for dots, whitespace, bidi marks,
    // or decomposed look-alike names.
    //   2LD와 동일한 다국어 정책: 완성형(NFC) 전용, ASCII는 a-z/0-9/-,
    //   최소 3 코드포인트. 서브네임이 점·공백·bidi·분해형 우회 경로가
    //   되지 않도록 동일 검증을 강제한다.
    if (!(label.strlen() >= 3 && label.isValidUnicodeLabel())) {
      revert InvalidLabel(label);
    }
    if (!salesEnabled[parentNode]) revert SalesDisabled(parentNode);
    if (registry.isExpired(parentNode)) revert ParentExpired(parentNode);

    address parentOwner = registry.owner(parentNode);

    // Pattern-1 guard: the parent owner must have delegated to this module.
    // We surface a clear, specific error instead of letting the inner
    // setSubnodeRecord revert opaquely.
    //   패턴1 가드: 부모 소유자가 이 모듈에 위임했어야 한다. 내부
    //   setSubnodeRecord가 불투명하게 revert하지 않도록 명확한 에러 제공.
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
    bytes32 labelHash = keccak256(bytes(label));
    subnode = keccak256(abi.encodePacked(parentNode, labelHash));

    registry.setSubnodeRecord(parentNode, labelHash, msg.sender, defaultResolver);

    // Set the subname's expiry if a duration is configured.
    //   기간이 설정돼 있으면 서브네임 만료 설정.
    uint256 duration = subnameDuration[parentNode];
    if (duration > 0) {
      registry.setSubnodeExpires(parentNode, labelHash, block.timestamp + duration);
    }

    // Payouts.
    if (protocolFee > 0) {
      _sendNative(feeRecipient, protocolFee);
    }
    if (ownerProceeds > 0) {
      _sendNative(parentOwner, ownerProceeds);
    }

    emit SubnameRegistered(
      parentNode, subnode, label, msg.sender, price, protocolFee
    );
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
