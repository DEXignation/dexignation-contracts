// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — DXRegistrarController
//
// Portions of this contract are derived from the ENS `ETHRegistrarController`,
// originally authored by Nick Johnson and the ENS Labs team, MIT License.
//   Source : https://github.com/ensdomains/ens-contracts
//   File   : contracts/ethregistrar/ETHRegistrarController.sol
//   © 2018-2024 Nick Johnson / ENS Labs
//
// Modifications and additions Copyright (c) 2026 DEXignation, MIT License.
//
// 이 컨트랙트의 일부는 ENS `ETHRegistrarController` (MIT)에서 파생되었습니다.
// 변경 및 추가 부분은 © 2026 DEXignation, MIT License 하에 배포됩니다.
//
// Notable additions by DEXignation / DEXignation의 주요 추가사항:
//   1. ERC-20 stablecoin payments (`registerWithToken` / `renewWithToken`)
//      with an owner-managed allow-list (`allowedPaymentTokens`). ENS uses
//      only the native asset.
//      ERC-20 스테이블코인 결제 (`registerWithToken` / `renewWithToken`)
//      및 오너 관리 화이트리스트 (`allowedPaymentTokens`). ENS는 네이티브
//      자산만 사용한다.
//   2. `rentPriceInToken()` converts `attoUSD` quotes (18 decimals) into
//      the target token's decimals using ceiling division. This is the
//      key mechanism for "USD-pegged pricing across multiple stablecoins".
//      `rentPriceInToken()` 함수가 attoUSD($1=1e18) 가격을 토큰 decimals로
//      올림 변환한다. "여러 스테이블 코인에 대한 USD 페그 가격"의 핵심.
//   3. `registerInventoryNames()` — owner-only batch registration for
//      reserved/premium names without payment.
//      `registerInventoryNames()` — 예약어/프리미엄 이름의 무결제 일괄
//      등록 (오너 전용).
//   4. Sets the initial resolver address record (`COIN_TYPE_POLYGON`)
//      atomically during registration, so that the name resolves
//      immediately after the transaction confirms. ENS leaves this to
//      a separate transaction.
//      등록 시 초기 리졸버 주소 레코드(`COIN_TYPE_POLYGON`)를 원자적으로
//      함께 설정한다. ENS는 이를 별도 트랜잭션으로 분리한다.
//   5. Custom errors throughout.
//      전반에 걸친 커스텀 에러 사용.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IDXRegistrarController} from "./IDXRegistrarController.sol";
import {IDXPriceOracle} from "../oracle/IDXPriceOracle.sol";
import {DXRegistrar} from "./DXRegistrar.sol";
import {DXReservations} from "./DXReservations.sol";
import {RevenueDistributor} from "../revenue/RevenueDistributor.sol";
import {IDXRegistry} from "../registry/IDXRegistry.sol";
import {IDXResolver} from "../resolver/IDXResolver.sol";
import "../utils/StringUtils.sol";
import "../utils/EVMCoinUtils.sol";

/// @title  DXRegistrarController
/// @notice User-facing entry point for registering and renewing names.
///         Implements commit-reveal to mitigate front-running, supports
///         both native (POL) and ERC-20 (USDT/USDC) payment, and atomically
///         sets up the initial resolver record so names are usable
///         immediately after registration.
///         이름 등록/갱신의 사용자 진입점. 프론트러닝 방지를 위한 commit-reveal,
///         네이티브(POL) 및 ERC-20(USDT/USDC) 결제, 등록 시 초기 리졸버 주소
///         레코드를 원자적으로 함께 설정해 즉시 사용 가능하게 한다.
contract DXRegistrarController is IDXRegistrarController, Ownable, ReentrancyGuard {
  using StringUtils for string;
  using SafeERC20 for IERC20;

  DXRegistrar public immutable registrar;
  IDXRegistry public immutable registry;
  IDXPriceOracle public immutable priceOracle;

  /// @dev token => allowed. Only owner-approved ERC-20s can be used for payment.
  ///      오너가 승인한 ERC-20만 결제 수단으로 사용 가능.
  mapping(address token => bool) public allowedPaymentTokens;

  /// @dev Initial resolver record is written for Polygon's coin type.
  ///      등록 시 Polygon 코인 타입으로 초기 리졸버 주소를 기록.
  uint256 constant CHAIN_ID_POLYGON = 137;
  uint256 constant COIN_TYPE_POLYGON = COIN_TYPE_DEFAULT | CHAIN_ID_POLYGON;

  /// @notice Default min/max age between `commit()` and `register()`.
  ///         commit-reveal 윈도우 기본값.
  uint256 public constant DEFAULT_MIN_COMMITMENT_AGE = 30;       // 30 seconds
  uint256 public constant DEFAULT_MAX_COMMITMENT_AGE = 1 hours;  // 3600 seconds

  uint256 public minCommitmentAge;
  uint256 public maxCommitmentAge;

  /// @notice Optional reservations registry. If set, the controller will
  ///         refuse open registration for any reserved label. Owner can
  ///         set/unset via `setReservations`. A zero address disables the
  ///         check entirely.
  ///
  ///         선택적 예약 레지스트리. 설정되어 있으면 예약된 라벨의 일반
  ///         등록을 차단한다. zero address면 검사 비활성.
  DXReservations public reservations;

  /// @notice Optional revenue distributor. When set, `withdraw()` and
  ///         `withdrawToken()` route funds here instead of to the owner.
  ///         Zero address falls back to owner-direct withdrawal.
  ///
  ///         선택적 수익 분배 컨트랙트. 설정되어 있으면 `withdraw()`와
  ///         `withdrawToken()`이 owner 대신 이곳으로 송금. 0이면 owner 직접
  ///         송금으로 fallback.
  RevenueDistributor public revenueDistributor;

  // ── MOL holder discount / MOL 홀더 할인 ────────────────────────────────────
  //
  // Holders of at least `molThreshold` MOL on the same chain receive a flat
  // `molDiscountBps`-bps discount on rent and renewal. The discount is read
  // from the caller's current MOL balance at registration time — no snapshot
  // or escrow. This is intentionally simple: borrowing MOL briefly to claim
  // the discount is possible but yields tiny absolute savings (at most a few
  // dollars) and still surfaces the MOL ecosystem to the borrower, which is
  // a desirable marketing side-effect.
  //
  // Disabled by default. Owner activates via `setMolDiscount` once MOL is
  // deployed on Polygon and the threshold has been finalised.
  //
  // 동일 체인에서 `molThreshold` 이상의 MOL을 보유한 사용자는 등록·갱신 시
  // `molDiscountBps` 만분율 할인을 받는다. 등록 시점의 잔액을 직접 조회 —
  // 스냅샷·에스크로 없음. 단순한 설계: 빌려서 할인 받기는 가능하지만 절감액이
  // 매우 작고 빌린 사람도 MOL 생태계에 노출되므로 마케팅 효과로 무방하다.
  //
  // 기본 비활성. MOL이 Polygon에 배포되고 임계치가 확정되면 owner가
  // `setMolDiscount`로 활성화한다.

  /// @notice MOL token contract on this chain. Zero address disables the
  ///         discount entirely.
  ///         이 체인의 MOL 토큰 컨트랙트. 0이면 할인 비활성.
  IERC20 public molToken;

  /// @notice Minimum MOL balance required to qualify for the discount.
  ///         할인 적용 최소 MOL 보유량.
  uint256 public molThreshold;

  /// @notice Discount rate in basis points (1000 = 10%). Hard-capped at 5000
  ///         (50%) in the setter so a mistaken update can never burn the
  ///         entire rent.
  ///         할인율 (만분율, 1000 = 10%). setter에서 5000(50%) 상한.
  uint256 public molDiscountBps;
  uint256 public constant MAX_MOL_DISCOUNT_BPS = 5000;

  /// @dev commitment hash => timestamp at which it was committed.
  ///      commitment 해시 => commit된 시각.
  mapping(bytes32 commitment => uint256 timestamp) public commitments;

  event ReservationsSet(address indexed reservations);
  event RevenueDistributorSet(address indexed distributor);
  event MolDiscountSet(address indexed molToken, uint256 threshold, uint256 discountBps);

  error LabelReserved(string label);
  error MolDiscountTooHigh(uint256 requested, uint256 max);

  constructor(
    DXRegistrar _registrar,
    IDXRegistry _registry,
    IDXPriceOracle _priceOracle
  ) Ownable(msg.sender) {
    registrar = _registrar;
    registry = _registry;
    priceOracle = _priceOracle;

    minCommitmentAge = DEFAULT_MIN_COMMITMENT_AGE;
    maxCommitmentAge = DEFAULT_MAX_COMMITMENT_AGE;
  }

  /// @notice Attach (or detach) a reservations registry. Owner-only.
  ///         예약 레지스트리 연결/해제. 오너 전용.
  /// @param _reservations Address of the DXReservations contract, or
  ///                      `address(0)` to disable reservation checks.
  ///                      DXReservations 컨트랙트 주소. 0이면 검사 해제.
  function setReservations(DXReservations _reservations) external onlyOwner {
    reservations = _reservations;
    emit ReservationsSet(address(_reservations));
  }

  /// @notice Attach (or detach) a revenue distributor. Owner-only.
  ///         When set, `withdraw()`/`withdrawToken()` route funds here.
  ///         수익 분배 컨트랙트 연결/해제. 오너 전용.
  function setRevenueDistributor(RevenueDistributor _distributor) external onlyOwner {
    revenueDistributor = _distributor;
    emit RevenueDistributorSet(address(_distributor));
  }

  /// @notice Configure the MOL holder discount. Owner-only.
  ///
  ///         Pass `_molToken = address(0)` to disable the discount entirely.
  ///         Discount applies to native and ERC-20 priced rent/renewal alike.
  ///
  ///         MOL 홀더 할인 설정. 오너 전용.
  ///         `_molToken = 0`이면 할인 비활성. 네이티브·토큰 결제 모두에 적용.
  ///
  /// @param _molToken     MOL ERC-20 address on this chain (or 0 to disable).
  ///                      이 체인의 MOL ERC-20 주소 (또는 0).
  /// @param _threshold    Minimum MOL units required for the discount.
  ///                      For MOL with 18 decimals, 1,000,000 MOL is
  ///                      `1_000_000 * 10**18`.
  ///                      할인을 받기 위한 최소 MOL 단위. 18 decimals 기준
  ///                      100만 MOL은 `1_000_000 * 10**18`.
  /// @param _discountBps  Discount in basis points (1000 = 10%). Hard cap 5000.
  ///                      할인율 만분율 (1000 = 10%). 상한 5000.
  function setMolDiscount(
    address _molToken,
    uint256 _threshold,
    uint256 _discountBps
  ) external onlyOwner {
    if (_discountBps > MAX_MOL_DISCOUNT_BPS) {
      revert MolDiscountTooHigh(_discountBps, MAX_MOL_DISCOUNT_BPS);
    }
    molToken = IERC20(_molToken);
    molThreshold = _threshold;
    molDiscountBps = _discountBps;
    emit MolDiscountSet(_molToken, _threshold, _discountBps);
  }

  /// @notice Compute the post-discount price for `user`. If MOL discount is
  ///         disabled or the user does not meet the threshold, returns
  ///         `price` unchanged.
  ///         `user`에 대한 할인 후 가격을 계산. MOL 할인이 비활성이거나
  ///         임계치 미달이면 원래 가격을 그대로 반환.
  function _applyMolDiscount(uint256 price, address user)
    internal view returns (uint256)
  {
    if (address(molToken) == address(0) || molDiscountBps == 0) return price;
    if (molToken.balanceOf(user) < molThreshold) return price;
    // Subtract discount. `discountBps <= 5000` is enforced in the setter,
    // so `(price * discountBps) / 10000 <= price` always holds.
    //   setter에서 5000 상한이 강제되므로 항상 `할인액 <= price`.
    return price - (price * molDiscountBps / 10000);
  }

  /// @notice True if `user` currently qualifies for the MOL holder discount.
  ///         Useful for UIs that want to surface "10% off" badges.
  ///         `user`가 현재 MOL 할인 조건을 충족하는지. UI 배지 표시용.
  function isMolEligible(address user) external view returns (bool) {
    if (address(molToken) == address(0) || molDiscountBps == 0) return false;
    return molToken.balanceOf(user) >= molThreshold;
  }

  /// @dev Revert if the label is reserved AND the caller is not its
  ///      authorised claimant.
  ///      라벨이 예약 상태이고 호출자가 지정된 클레임 자격자가 아니면 revert.
  function _checkReservation(string calldata label, address claimant) internal view {
    DXReservations r = reservations;
    if (address(r) == address(0)) return;
    if (!r.isReserved(label)) return;
    if (r.isClaimableBy(label, claimant)) return;
    revert LabelReserved(label);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // View functions / 조회 함수
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice A label is valid if it is (a) at least 3 characters and
  ///         (b) strict ASCII-lowercase with digits and hyphens (no
  ///         leading/trailing/double hyphens). This is the initial
  ///         normalisation policy — see `StringUtils.isValidAsciiLabel`
  ///         for full rationale.
  ///         라벨 유효성: (a) 3자 이상, (b) strict ASCII lowercase + 숫자 +
  ///         하이픈 (선두/말미/연속 하이픈 금지). 초기 정규화 정책 — 자세한
  ///         사유는 `StringUtils.isValidAsciiLabel` 참고.
  function isValidLabel(string calldata label) public pure returns (bool) {
    return label.strlen() >= 3 && label.isValidAsciiLabel();
  }

  /// @inheritdoc IDXRegistrarController
  function available(
    string calldata label
  ) public view override returns (bool) {
    bytes32 labelhash = keccak256(bytes(label));
    return isValidLabel(label) && registrar.available(uint256(labelhash));
  }

  /// @inheritdoc IDXRegistrarController
  function rentPrice(
    uint256 duration
  ) public view override returns (uint256) {
    return priceOracle.price(duration);
  }

  /// @notice Total price (rent + post-grace premium, if any) for a *specific*
  ///         label, in wei of the native asset. If the label has never been
  ///         registered or is still within an unexpired registration, this
  ///         is identical to `rentPrice(duration)`.
  ///
  ///         Does NOT apply the MOL holder discount — use `rentPriceForPayer`
  ///         for that. Wallets can call this for a baseline quote and
  ///         `rentPriceForPayer` to show "your price with MOL discount".
  ///
  ///         특정 라벨에 대한 총 가격(임대료 + post-grace premium)을 네이티브
  ///         자산 wei로 반환. MOL 할인은 적용되지 않음 — 할인 적용된 가격은
  ///         `rentPriceForPayer` 사용. 지갑은 기준 가격으로 이 함수를,
  ///         "MOL 할인 적용 가격"으로 `rentPriceForPayer`를 호출할 수 있다.
  /// @param  label    Label to be registered. / 등록할 라벨.
  /// @param  duration Registration duration in seconds. / 등록 기간(초).
  function rentPriceFor(
    string calldata label,
    uint256 duration
  ) public view returns (uint256) {
    return _attoUSDToWei(_priceWithPremiumAttoUSD(label, duration));
  }

  /// @notice Same as `rentPriceFor`, but applies the MOL holder discount
  ///         based on `payer`'s current MOL balance.
  ///         `rentPriceFor`와 동일하되 `payer`의 MOL 잔액 기준 할인을 적용.
  function rentPriceForPayer(
    string calldata label,
    uint256 duration,
    address payer
  ) public view returns (uint256) {
    return _applyMolDiscount(
      _attoUSDToWei(_priceWithPremiumAttoUSD(label, duration)),
      payer
    );
  }

  /// @notice Convert the attoUSD price for `duration` into the minimum
  ///         units of `token`. Uses ceiling division to avoid
  ///         underpayment due to truncation.
  ///         `duration`에 해당하는 attoUSD 가격을 `token`의 최소 단위로
  ///         올림 변환한다 (절삭으로 인한 부족 결제 방지).
  /// @param duration Duration in seconds / 기간(초)
  /// @param token    ERC-20 token address (must be USD-pegged stablecoin)
  ///                 ERC-20 토큰 주소 (USD 페그 스테이블 코인 가정)
  /// @return Minimum-unit token amount required / 필요한 토큰 최소 단위
  function rentPriceInToken(
    uint256 duration,
    address token
  ) public view override returns (uint256) {
    return _attoUSDToTokenUnits(priceOracle.priceAttoUSD(duration), token);
  }

  /// @notice Same as `rentPriceInToken`, but for a *specific* label so that
  ///         any post-grace premium is included. Does NOT apply MOL discount.
  ///         `rentPriceInToken`과 동일하되 특정 라벨의 post-grace premium
  ///         포함. MOL 할인은 적용되지 않음.
  function rentPriceInTokenFor(
    string calldata label,
    uint256 duration,
    address token
  ) public view returns (uint256) {
    return _attoUSDToTokenUnits(_priceWithPremiumAttoUSD(label, duration), token);
  }

  /// @notice Token-denominated price including the MOL holder discount based
  ///         on `payer`'s MOL balance.
  ///         `payer`의 MOL 잔액 기준 할인이 적용된 토큰 가격.
  function rentPriceInTokenForPayer(
    string calldata label,
    uint256 duration,
    address token,
    address payer
  ) public view returns (uint256) {
    uint256 attoUSD = _applyMolDiscount(
      _priceWithPremiumAttoUSD(label, duration),
      payer
    );
    return _attoUSDToTokenUnits(attoUSD, token);
  }

  /// @dev Compute base rent + premium in attoUSD for a specific label.
  ///      특정 라벨에 대한 임대료 + premium의 attoUSD 합산.
  function _priceWithPremiumAttoUSD(
    string calldata label,
    uint256 duration
  ) internal view returns (uint256) {
    uint256 base = priceOracle.priceAttoUSD(duration);

    // Premium only applies if the name had a previous expiry. If the
    // tokenId has no recorded expiry (`nameExpires == 0`), this is a fresh
    // registration and there's no premium.
    //
    // premium은 이전 만료 기록이 있을 때만 적용. tokenId에 만료 기록이
    // 없으면(`nameExpires == 0`) 첫 등록이므로 premium 없음.
    bytes32 labelhash = keccak256(bytes(label));
    uint256 previousExpires = registrar.nameExpires(uint256(labelhash));
    if (previousExpires == 0) return base;

    // Premium starts only after the grace period has fully elapsed.
    //   premium은 유예 기간이 완전히 지난 뒤부터 적용.
    uint256 graceEndsAt = previousExpires + registrar.GRACE_PERIOD();
    if (block.timestamp <= graceEndsAt) return base;

    uint256 premium = priceOracle.premiumAttoUSD(graceEndsAt);
    return base + premium;
  }

  /// @dev attoUSD → wei using the oracle's current conversion path.
  ///      attoUSD → wei 변환.
  function _attoUSDToWei(uint256 attoUSD) internal view returns (uint256) {
    // The oracle's `price(duration)` already converts; for a custom
    // attoUSD value we re-run the conversion by routing through a
    // synthetic 1-year query and scaling. Simpler: call `price(1y)` and
    // proportion. Even simpler: call a dedicated helper if oracle adds
    // one. For now, the oracle exposes `price(duration)` only, so we
    // emulate by multiplying through `price1Year` / `priceAttoUSD(1y)`.
    //
    // To keep this PR small we re-call the oracle's full conversion path
    // by passing through a temporary 1-year quote.
    //
    // 단순화를 위해 1년치 price()와 priceAttoUSD() 비율로 변환.
    uint256 oneYearAtto = priceOracle.priceAttoUSD(365 days);
    uint256 oneYearWei  = priceOracle.price(365 days);
    if (oneYearAtto == 0) return 0;
    return (attoUSD * oneYearWei) / oneYearAtto;
  }

  /// @dev attoUSD → ERC-20 token minimum units, ceiling-rounded.
  ///      attoUSD → ERC-20 토큰 최소 단위, 올림.
  function _attoUSDToTokenUnits(
    uint256 attoUSD,
    address token
  ) internal view returns (uint256) {
    if (!allowedPaymentTokens[token]) revert TokenNotAllowed(token);

    uint8 d = IERC20Metadata(token).decimals();
    if (d > 18) revert UnsupportedTokenDecimals(d);

    uint256 scaleDown = 10 ** (18 - uint256(d));
    return (attoUSD + scaleDown - 1) / scaleDown;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Registration / renewal — native currency / 네이티브 결제
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice Register a name paid in native currency (POL).
  ///         네이티브 통화(POL)로 결제하여 이름을 등록.
  /// @param label    Label to register / 등록할 라벨
  /// @param owner    Final owner of the NFT / NFT 최종 소유자
  /// @param duration Registration duration in seconds / 등록 기간(초)
  /// @param resolver Resolver contract address / 리졸버 주소
  /// @param secret   Secret used in the prior `commit()` call. Required to
  ///                 mitigate front-running.
  ///                 commit 단계의 secret. 프론트러닝 방지용.
  function register(
    string calldata label,
    address owner,
    uint256 duration,
    address resolver,
    bytes32 secret
  ) external payable override nonReentrant {
    // address(0) = native-currency payment in the commitment binding.
    //   commitment binding에서 네이티브 결제는 address(0).
    _consumeCommitmentFull(label, owner, duration, resolver, address(0), secret);
    _checkReservation(label, msg.sender);

    bytes32 labelhash = keccak256(bytes(label));
    // Label-specific price including post-grace premium AND the MOL holder
    // discount (if caller qualifies). Discount is based on `msg.sender`,
    // not `owner`, because the payer is who actually holds the MOL.
    //
    // 라벨별 가격 (post-grace premium + MOL 할인 적용). 할인 기준은 결제자인
    // `msg.sender`이며, `owner`가 아니다.
    uint256 price_ = rentPriceForPayer(label, duration, msg.sender);

    if (msg.value < price_) revert InsufficientFund(price_, msg.value);
    if (!available(label)) revert NameNotAvailable(label);

    uint256 expires = _executeRegister(label, labelhash, owner, duration, resolver);

    emit NameRegistered(label, labelhash, owner, price_, expires);

    // Refund any excess sent. Native transfer is via low-level `call`.
    //   초과분 환불.
    if (msg.value > price_) {
      _sendNative(msg.sender, msg.value - price_);
    }
  }

  /// @notice Renew a name paid in native currency (POL).
  ///         네이티브 통화(POL)로 결제하여 이름을 갱신.
  function renew(
    string calldata label,
    uint256 duration
  ) external payable override nonReentrant {
    bytes32 labelhash = keccak256(bytes(label));
    // Renewal does not trigger premium decay (the name is still owned),
    // but we still apply the MOL holder discount.
    //   갱신은 premium decay 대상이 아니지만 MOL 할인은 적용.
    uint256 price_ = _applyMolDiscount(rentPrice(duration), msg.sender);

    if (msg.value < price_) revert InsufficientFund(price_, msg.value);

    uint256 expires = registrar.renew(uint256(labelhash), duration);

    emit NameRenewed(label, labelhash, price_, expires);

    if (msg.value > price_) {
      _sendNative(payable(msg.sender), msg.value - price_);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Registration / renewal — ERC-20 token / 토큰 결제
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice Register a name paid in an allowed ERC-20 (e.g. USDT, USDC).
  ///         허용된 ERC-20(예: USDT, USDC)로 결제하여 이름을 등록.
  /// @dev    Caller must have approved this contract for at least the
  ///         required amount before calling.
  ///         호출자는 사전에 이 컨트랙트에 충분한 amount를 approve 해야 한다.
  function registerWithToken(
    string calldata label,
    address owner,
    uint256 duration,
    address resolver,
    address paymentToken,
    bytes32 secret
  ) external override nonReentrant {
    _consumeCommitmentFull(label, owner, duration, resolver, paymentToken, secret);
    _checkReservation(label, msg.sender);

    if (!available(label)) revert NameNotAvailable(label);

    bytes32 labelhash = keccak256(bytes(label));
    // Use the label-specific token amount including post-grace premium AND
    // the MOL holder discount based on caller's MOL balance.
    //   라벨별 토큰 금액 (post-grace premium + MOL 할인 적용).
    uint256 amount = rentPriceInTokenForPayer(label, duration, paymentToken, msg.sender);

    IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), amount);

    uint256 expires = _executeRegister(label, labelhash, owner, duration, resolver);

    emit NameRegisteredWithToken(label, labelhash, owner, paymentToken, amount, expires);
  }

  /// @notice Renew a name paid in an allowed ERC-20.
  ///         허용된 ERC-20으로 결제하여 이름을 갱신.
  function renewWithToken(
    string calldata label,
    uint256 duration,
    address paymentToken
  ) external override nonReentrant {
    bytes32 labelhash = keccak256(bytes(label));
    // Apply MOL discount to the attoUSD price before converting to token.
    //   attoUSD 가격에 MOL 할인 적용 후 토큰 단위로 변환.
    uint256 amount = _attoUSDToTokenUnits(
      _applyMolDiscount(priceOracle.priceAttoUSD(duration), msg.sender),
      paymentToken
    );
    IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), amount);

    uint256 expires = registrar.renew(uint256(labelhash), duration);

    emit NameRenewedWithToken(label, labelhash, paymentToken, amount, expires);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Commit-reveal / commit-reveal 패턴
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice Legacy commitment hash. Kept for ABI compatibility with v1
  ///         clients, but the controller now uses the full-binding form
  ///         (see `makeCommitmentFull`) for reveal. The legacy form alone
  ///         is no longer accepted at register time.
  ///
  ///         레거시 commitment 해시. v1 클라이언트 ABI 호환용으로 남김.
  ///         reveal 시점에는 full-binding 형식(`makeCommitmentFull`)을
  ///         사용하며, 레거시 형식만으로는 더 이상 register 불가.
  function makeCommitment(
    string calldata name,
    address owner,
    bytes32 secret
  ) public pure override returns (bytes32) {
    return keccak256(abi.encode(name, owner, secret));
  }

  /// @notice Strict commitment hash binding ALL register-time parameters.
  ///         The hash includes the resolver, duration, and payment token so
  ///         an MEV bot that observes the reveal cannot replay it with
  ///         different parameters (e.g. swap in a malicious resolver).
  ///
  ///         Pass `paymentToken = address(0)` for native-currency payment.
  ///
  ///         모든 register-time 파라미터를 묶은 strict commitment. resolver,
  ///         duration, payment token까지 포함하므로 MEV 봇이 reveal을 보고
  ///         다른 파라미터로 재현(예: 악성 resolver 주입) 불가.
  ///
  ///         네이티브 결제 시 `paymentToken = address(0)`.
  function makeCommitmentFull(
    string calldata label,
    address owner,
    uint256 duration,
    address resolver,
    address paymentToken,
    bytes32 secret
  ) public pure returns (bytes32) {
    return keccak256(
      abi.encode(label, owner, duration, resolver, paymentToken, secret)
    );
  }

  /// @notice Commit the hash. Caller must wait `minCommitmentAge` before
  ///         revealing via `register()` / `registerWithToken()`.
  ///         commit. 호출자는 `register()` 호출 전에 `minCommitmentAge` 만큼
  ///         대기해야 한다.
  function commit(bytes32 commitment) public override {
    if (commitments[commitment] + maxCommitmentAge >= block.timestamp) {
      revert UnexpiredCommitmentExists(commitment);
    }
    commitments[commitment] = block.timestamp;
  }

  /// @dev Validate and consume a strict commitment. Reverts if the
  ///      commitment was never made, is too new, too old, or does not
  ///      bind to the parameters being revealed.
  ///      strict commitment 검증·소비. 미존재/너무 새것/너무 오래된 것/파라
  ///      미터 미일치 모두 revert.
  function _consumeCommitmentFull(
    string calldata label,
    address owner,
    uint256 duration,
    address resolver,
    address paymentToken,
    bytes32 secret
  ) internal {
    bytes32 commitment = makeCommitmentFull(
      label, owner, duration, resolver, paymentToken, secret
    );
    uint256 ts = commitments[commitment];
    if (ts == 0) revert CommitmentNotFound(commitment);
    if (ts + minCommitmentAge > block.timestamp) {
      revert CommitmentTooNew(commitment);
    }
    if (ts + maxCommitmentAge <= block.timestamp) {
      revert CommitmentTooOld(commitment);
    }
    delete commitments[commitment];
  }

  /// @dev (Removed in v2.) The legacy 3-arg `_consumeCommitment` has been
  ///      replaced by `_consumeCommitmentFull` so register-time parameters
  ///      are cryptographically bound to the commit.
  ///      (v2에서 제거.) 레거시 3-인자 `_consumeCommitment`는 register-time
  ///      파라미터 binding을 위해 `_consumeCommitmentFull`로 대체됨.

  // ──────────────────────────────────────────────────────────────────────────
  // Owner-only configuration / 오너 전용 설정
  // ──────────────────────────────────────────────────────────────────────────

  /// @inheritdoc IDXRegistrarController
  function setAllowedPaymentToken(
    address token,
    bool allowed
  ) external override onlyOwner {
    allowedPaymentTokens[token] = allowed;
  }

  /// @inheritdoc IDXRegistrarController
  function setCommitmentAgeSettings(
    uint256 minAge,
    uint256 maxAge
  ) external override onlyOwner {
    if (minAge >= maxAge) revert MaxCommitmentAgeTooLow();
    minCommitmentAge = minAge;
    maxCommitmentAge = maxAge;
  }

  /// @notice Withdraw native balance. Routes to `revenueDistributor` if
  ///         configured, otherwise to the contract owner (fallback for
  ///         single-operator deployments).
  ///         네이티브 잔액 송금. `revenueDistributor`가 설정되어 있으면
  ///         그곳으로, 아니면 owner로 송금(단일 운영자 배포용 fallback).
  function withdraw() public override onlyOwner nonReentrant {
    address dest = address(revenueDistributor) == address(0)
      ? owner()
      : address(revenueDistributor);
    _sendNative(dest, address(this).balance);
  }

  /// @notice Withdraw the full balance of `token`. Routes to
  ///         `revenueDistributor` if configured, otherwise to the owner.
  ///         특정 토큰 잔액 송금. 라우팅 규칙은 `withdraw()`와 동일.
  function withdrawToken(address token) public override onlyOwner nonReentrant {
    IERC20 t = IERC20(token);
    address dest = address(revenueDistributor) == address(0)
      ? owner()
      : address(revenueDistributor);
    t.safeTransfer(dest, t.balanceOf(address(this)));
  }

  /// @notice Recover tokens accidentally sent to this contract.
  ///         Distinct from `withdrawToken`: this is for tokens that are
  ///         NOT part of the protocol's revenue (e.g. an accidentally
  ///         transferred random ERC-20), where the owner needs to send
  ///         them to a specific recipient rather than the distributor.
  ///
  ///         잘못 보내진 토큰 회수. `withdrawToken`과 구분되며, 프로토콜
  ///         수익이 아닌 임의의 토큰을 owner가 특정 수신자에게 직접 보낼 때
  ///         사용한다.
  function recoverFunds(
    address token,
    address to,
    uint256 amount
  ) external onlyOwner nonReentrant {
    IERC20 t = IERC20(token);
    t.safeTransfer(to, amount);
  }

  /// @notice Owner-only batch registration for reserved/premium names.
  ///         예약어/프리미엄 이름의 오너 전용 일괄 등록.
  function registerInventoryNames(
    string[] calldata labels,
    address recipient,
    uint256 duration,
    address resolver
  ) external override onlyOwner nonReentrant {
    if (recipient == address(0)) revert InvalidRecipient();
    // Validates `duration` against the oracle's allowed durations
    // (reverts with DXPriceOracle.InvalidDuration if not 1/3/5/10 years).
    //   가격 오라클의 허용 기간(1/3/5/10년)인지 검증.
    priceOracle.priceAttoUSD(duration);

    uint256 len = labels.length;
    for (uint256 i = 0; i < len; i++) {
      if (!available(labels[i])) revert NameNotAvailable(labels[i]);
      bytes32 labelhash = keccak256(bytes(labels[i]));
      uint256 expires = _executeRegister(labels[i], labelhash, recipient, duration, resolver);
      emit NameRegistered(labels[i], labelhash, recipient, 0, expires);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internal helpers / 내부 헬퍼
  // ──────────────────────────────────────────────────────────────────────────

  /// @dev Core registration steps shared by all entry points. The controller
  ///      temporarily takes ownership in the registry so it can set the
  ///      resolver + initial address record, then hands ownership over to
  ///      the final owner.
  ///      모든 진입점이 공유하는 핵심 등록 절차. 컨트롤러가 일시적으로 레지스트리
  ///      소유권을 취해 리졸버 + 초기 주소 레코드를 설정한 뒤 최종 소유자에게
  ///      이전한다.
  function _executeRegister(
    string calldata label,
    bytes32 labelhash,
    address owner,
    uint256 duration,
    address resolver
  ) internal returns (uint256 expires) {
    // 1. Register with `this` as the temporary subnode owner so that
    //    subsequent setResolver / setAddr calls succeed.
    //    1. 임시 소유자로 `this`를 두어 setResolver / setAddr가 가능하도록 한다.
    expires = registrar.register(label, uint256(labelhash), address(this), duration);

    bytes32 subnode = keccak256(
      abi.encodePacked(registrar.baseNode(), labelhash)
    );

    // 2. Wire up resolver + initial Polygon-coin-type address record.
    //    2. 리졸버 설정 + 초기 Polygon 주소 레코드 기록.
    registry.setResolver(subnode, resolver);
    IDXResolver(resolver).setAddr(
      subnode,
      COIN_TYPE_POLYGON,
      abi.encodePacked(owner)
    );

    // 3. Transfer registry ownership to the real owner.
    //    3. 레지스트리 소유권을 실제 소유자에게 이전.
    registry.setOwner(subnode, owner);

    // 4. Transfer the ERC-721 NFT to the real owner.
    //    4. ERC-721 NFT를 실제 소유자에게 이전.
    registrar.transferFrom(address(this), owner, uint256(labelhash));
  }

  /// @dev Native transfer via low-level `call`. Reverts on failure.
  ///      저수준 `call`로 네이티브 송금. 실패 시 revert.
  function _sendNative(address to, uint256 amount) internal {
    if (amount == 0) return;
    (bool sent, ) = payable(to).call{value: amount}("");
    if (!sent) revert NativeTransferFailed(to, amount);
  }
}
