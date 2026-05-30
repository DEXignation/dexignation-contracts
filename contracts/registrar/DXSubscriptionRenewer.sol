// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// ════════════════════════════════════════════════════════════════════════════
// DXSubscriptionRenewer (auto-renewal subscriptions)
//
//   Lets a name owner opt into automatic renewal. At purchase/any time they:
//     1. approve this module to spend their payment token (e.g. USDC), and
//     2. call `subscribe(label, duration, maxPricePerRenewal)`.
//   When the name nears expiry, ANYONE may call `executeRenewal(label)` — a
//   keeper, a bot, or the owner themselves. The module verifies it is actually
//   time to renew and the price is within the owner's cap, pulls exactly the
//   needed tokens from the owner, and renews through the controller.
//
//   DESIGN — permissionless trigger (option 1), chosen for simplicity & safety:
//     • The contract cannot wake itself; someone must call executeRenewal.
//       Because the contract re-checks timing + price cap on every call, it is
//       safe for anyone to trigger: a too-early or too-expensive call reverts.
//     • No server required. A Chainlink Automation keeper (or any bot) can be
//       layered on later simply by having it call executeRenewal.
//
//   PRICING — auto-renewal uses the STANDARD (undiscounted) price. The
//   controller computes the amount against THIS module as the payer, so the
//   amount the module pulls from the owner equals the amount the controller
//   charges — no shortfall. SBT/staking discounts remain a benefit of *manual*
//   renewal. The owner's `maxPricePerRenewal` cap protects against price spikes.
//
//   SAFETY:
//     • Owner-set spend cap per renewal (maxPricePerRenewal); reverts if the
//       live price exceeds it.
//     • Renewal only within a window before expiry (no early draining).
//     • Owner can cancel anytime; setting the token allowance to zero also
//       disables it at the ERC-20 level.
//     • nonReentrant; pulls only the exact amount needed.
//
//   이름 소유자가 자동 갱신에 가입. (1) 이 모듈에 결제 토큰 approve, (2)
//   `subscribe(label, duration, maxPricePerRenewal)` 호출. 만료가 임박하면
//   누구나(키퍼·봇·소유자 본인) `executeRenewal(label)` 호출 가능. 모듈이
//   갱신 시점·가격 상한을 검증하고, 필요한 만큼만 소유자에게서 받아 컨트롤러로
//   갱신. permissionless 트리거(옵션1) — 단순·안전, 서버 불필요. 자동 갱신은
//   표준(할인 없는) 가격 사용(모듈이 payer이므로 받는 금액=청구 금액 일치).
//   할인은 수동 갱신 혜택으로 유지. maxPricePerRenewal로 가격 급등 방지.
// ════════════════════════════════════════════════════════════════════════════

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Minimal controller interface this module depends on.
///      이 모듈이 의존하는 최소 컨트롤러 인터페이스.
interface IControllerRenew {
  function rentPriceInToken(uint256 duration, address token)
    external view returns (uint256);
  function renewWithToken(
    string calldata label,
    uint256 duration,
    address paymentToken
  ) external;
}

/// @dev Minimal registrar interface for reading expiry.
///      만료 조회용 최소 레지스트라 인터페이스.
interface IRegistrarExpiry {
  function nameExpires(uint256 id) external view returns (uint256);
}

contract DXSubscriptionRenewer is Ownable, ReentrancyGuard {
  using SafeERC20 for IERC20;

  // ──────────────────────────────────────────────────────────────────────────
  // Immutable wiring / 불변 연결
  // ──────────────────────────────────────────────────────────────────────────

  IControllerRenew public immutable controller;
  IRegistrarExpiry public immutable registrar;

  /// @notice How long before expiry a renewal becomes allowed.
  ///         만료 몇 초 전부터 갱신이 허용되는지(갱신 윈도우).
  uint256 public renewalWindow;

  /// @notice Bounds for `renewalWindow` so the owner can't set absurd values.
  ///         `renewalWindow` 허용 범위(비상식적 값 방지).
  uint256 public constant MIN_WINDOW = 1 days;
  uint256 public constant MAX_WINDOW = 90 days;

  // ──────────────────────────────────────────────────────────────────────────
  // Subscription state / 구독 상태
  // ──────────────────────────────────────────────────────────────────────────

  struct Subscription {
    address subscriber;          // who pays (the name owner who subscribed)
    address paymentToken;        // ERC-20 used to pay (e.g. USDC)
    uint256 duration;            // renewal length each cycle (seconds)
    uint256 maxPricePerRenewal;  // owner's spend cap per renewal (token units)
    bool    active;              // subscription on/off
  }

  /// @notice label (string) → subscription. Keyed by the label so anyone can
  ///         trigger by name; tokenId is derived as keccak256(label).
  ///         라벨 → 구독. 라벨로 키잉해 누구나 이름으로 트리거 가능.
  mapping(bytes32 labelHash => Subscription) public subscriptions;

  // ──────────────────────────────────────────────────────────────────────────
  // Events / 이벤트
  // ──────────────────────────────────────────────────────────────────────────

  event RenewalWindowSet(uint256 window);
  event Subscribed(
    bytes32 indexed labelHash,
    address indexed subscriber,
    address paymentToken,
    uint256 duration,
    uint256 maxPricePerRenewal
  );
  event Unsubscribed(bytes32 indexed labelHash, address indexed subscriber);
  event Renewed(
    bytes32 indexed labelHash,
    address indexed subscriber,
    address indexed caller,
    uint256 amountPaid
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Errors / 에러
  // ──────────────────────────────────────────────────────────────────────────

  error ZeroAddress();
  error WindowOutOfRange(uint256 requested, uint256 min, uint256 max);
  error InvalidDuration();
  error InvalidMaxPrice();
  error NotSubscribed(bytes32 labelHash);
  error NotSubscriber(bytes32 labelHash, address caller);
  error TooEarlyToRenew(bytes32 labelHash, uint256 expires, uint256 nowTime);
  error PriceExceedsCap(uint256 price, uint256 cap);

  // ──────────────────────────────────────────────────────────────────────────
  // Construction / 생성
  // ──────────────────────────────────────────────────────────────────────────

  constructor(
    address _controller,
    address _registrar,
    uint256 _renewalWindow
  ) Ownable(msg.sender) {
    if (_controller == address(0) || _registrar == address(0)) {
      revert ZeroAddress();
    }
    if (_renewalWindow < MIN_WINDOW || _renewalWindow > MAX_WINDOW) {
      revert WindowOutOfRange(_renewalWindow, MIN_WINDOW, MAX_WINDOW);
    }
    controller = IControllerRenew(_controller);
    registrar = IRegistrarExpiry(_registrar);
    renewalWindow = _renewalWindow;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Protocol-owner configuration / 프로토콜 오너 설정
  // ──────────────────────────────────────────────────────────────────────────

  function setRenewalWindow(uint256 _window) external onlyOwner {
    if (_window < MIN_WINDOW || _window > MAX_WINDOW) {
      revert WindowOutOfRange(_window, MIN_WINDOW, MAX_WINDOW);
    }
    renewalWindow = _window;
    emit RenewalWindowSet(_window);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Subscriber flow / 구독자 흐름
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice Subscribe `label` to auto-renewal. The caller must separately
  ///         `approve` this module to spend at least `maxPricePerRenewal` of
  ///         `paymentToken` (ideally several cycles' worth).
  ///         `label`을 자동 갱신에 가입. 호출자는 별도로 이 모듈에
  ///         `paymentToken`을 `maxPricePerRenewal` 이상(이상적으론 여러 주기분)
  ///         approve 해야 한다.
  /// @param label              The name label (e.g. "alice" for alice.dex).
  /// @param paymentToken       ERC-20 used to pay (e.g. USDC).
  /// @param duration           Renewal length per cycle (seconds).
  /// @param maxPricePerRenewal Spend cap per renewal, in token units.
  function subscribe(
    string calldata label,
    address paymentToken,
    uint256 duration,
    uint256 maxPricePerRenewal
  ) external {
    if (paymentToken == address(0)) revert ZeroAddress();
    if (duration == 0) revert InvalidDuration();
    if (maxPricePerRenewal == 0) revert InvalidMaxPrice();

    bytes32 labelHash = keccak256(bytes(label));
    subscriptions[labelHash] = Subscription({
      subscriber: msg.sender,
      paymentToken: paymentToken,
      duration: duration,
      maxPricePerRenewal: maxPricePerRenewal,
      active: true
    });

    emit Subscribed(labelHash, msg.sender, paymentToken, duration, maxPricePerRenewal);
  }

  /// @notice Cancel auto-renewal for `label`. Only the current subscriber.
  ///         For full safety the owner should also revoke the ERC-20 allowance.
  ///         `label`의 자동 갱신 취소. 현재 구독자만. 완전한 안전을 위해
  ///         ERC-20 allowance도 0으로 회수하는 것을 권장.
  function unsubscribe(string calldata label) external {
    bytes32 labelHash = keccak256(bytes(label));
    Subscription storage s = subscriptions[labelHash];
    if (!s.active) revert NotSubscribed(labelHash);
    if (s.subscriber != msg.sender) revert NotSubscriber(labelHash, msg.sender);

    delete subscriptions[labelHash];
    emit Unsubscribed(labelHash, msg.sender);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Permissionless renewal / permissionless 갱신
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice Renew `label` if it is within the renewal window and the live
  ///         price is within the subscriber's cap. Callable by ANYONE — the
  ///         contract enforces all conditions, so an out-of-window or
  ///         over-cap call simply reverts.
  ///         갱신 윈도우 안이고 현재 가격이 구독자 상한 내이면 `label` 갱신.
  ///         누구나 호출 가능 — 조건 미충족 시 revert.
  /// @param label The name label to renew.
  function executeRenewal(string calldata label) external nonReentrant {
    bytes32 labelHash = keccak256(bytes(label));
    Subscription memory s = subscriptions[labelHash];
    if (!s.active) revert NotSubscribed(labelHash);

    // 1. Timing: only within `renewalWindow` before expiry.
    //    시점: 만료 `renewalWindow` 이내에서만.
    uint256 expires = registrar.nameExpires(uint256(labelHash));
    if (block.timestamp + renewalWindow < expires) {
      revert TooEarlyToRenew(labelHash, expires, block.timestamp);
    }

    // 2. Price: live standard price must be within the owner's cap.
    //    가격: 현재 표준 가격이 소유자 상한 이내여야.
    uint256 price = controller.rentPriceInToken(s.duration, s.paymentToken);
    if (price > s.maxPricePerRenewal) {
      revert PriceExceedsCap(price, s.maxPricePerRenewal);
    }

    // 3. Pull exactly `price` from the subscriber, approve the controller,
    //    and renew. The controller charges THIS module (payer = module), so
    //    the amount it requires equals `price` — no discount mismatch.
    //    구독자에게서 정확히 `price`만큼 받아 컨트롤러에 approve 후 갱신.
    //    컨트롤러는 이 모듈(payer=모듈)에 청구하므로 요구액=`price` 일치.
    IERC20 token = IERC20(s.paymentToken);
    token.safeTransferFrom(s.subscriber, address(this), price);
    token.forceApprove(address(controller), price);

    controller.renewWithToken(label, s.duration, s.paymentToken);

    // Clear any residual allowance to the controller (defensive).
    //   컨트롤러에 남은 잔여 allowance 정리(방어적).
    token.forceApprove(address(controller), 0);

    emit Renewed(labelHash, s.subscriber, msg.sender, price);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Views / 조회
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice True if `label` can be renewed right now: active subscription,
  ///         inside the window, and live price within cap. Useful for keepers
  ///         deciding whether to call `executeRenewal`.
  ///         지금 `label`을 갱신할 수 있는지: 활성 구독 + 윈도우 내 + 가격 상한
  ///         이내. 키퍼가 `executeRenewal` 호출 여부 판단용.
  function isRenewable(string calldata label) external view returns (bool) {
    bytes32 labelHash = keccak256(bytes(label));
    Subscription memory s = subscriptions[labelHash];
    if (!s.active) return false;

    uint256 expires = registrar.nameExpires(uint256(labelHash));
    if (block.timestamp + renewalWindow < expires) return false;

    uint256 price = controller.rentPriceInToken(s.duration, s.paymentToken);
    if (price > s.maxPricePerRenewal) return false;

    return true;
  }

  /// @notice Read the subscription for `label`.
  ///         `label`의 구독 정보 조회.
  function getSubscription(string calldata label)
    external
    view
    returns (
      address subscriber,
      address paymentToken,
      uint256 duration,
      uint256 maxPricePerRenewal,
      bool active
    )
  {
    Subscription memory s = subscriptions[keccak256(bytes(label))];
    return (s.subscriber, s.paymentToken, s.duration, s.maxPricePerRenewal, s.active);
  }
}
