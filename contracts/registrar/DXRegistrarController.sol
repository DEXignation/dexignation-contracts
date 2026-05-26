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

  /// @dev commitment hash => timestamp at which it was committed.
  ///      commitment 해시 => commit된 시각.
  mapping(bytes32 commitment => uint256 timestamp) public commitments;

  event ReservationsSet(address indexed reservations);
  event RevenueDistributorSet(address indexed distributor);

  error LabelReserved(string label);

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

  /// @notice A label is valid if it is at least 3 characters long.
  ///         라벨은 3자 이상이어야 유효.
  function isValidLabel(string calldata label) public pure returns (bool) {
    return label.strlen() >= 3;
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
  ///         특정 라벨에 대한 총 가격(임대료 + post-grace premium)을 네이티브
  ///         자산 wei로 반환. 라벨이 미등록 상태이거나 만료되지 않은 등록
  ///         중이면 `rentPrice(duration)`과 동일.
  /// @param  label    Label to be registered. / 등록할 라벨.
  /// @param  duration Registration duration in seconds. / 등록 기간(초).
  function rentPriceFor(
    string calldata label,
    uint256 duration
  ) public view returns (uint256) {
    return _attoUSDToWei(_priceWithPremiumAttoUSD(label, duration));
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
  ///         any post-grace premium is included.
  ///         `rentPriceInToken`과 동일하되, 특정 라벨에 대한 post-grace
  ///         premium까지 포함한다.
  function rentPriceInTokenFor(
    string calldata label,
    uint256 duration,
    address token
  ) public view returns (uint256) {
    return _attoUSDToTokenUnits(_priceWithPremiumAttoUSD(label, duration), token);
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
    _consumeCommitment(label, owner, secret);
    _checkReservation(label, msg.sender);

    bytes32 labelhash = keccak256(bytes(label));
    // Use the label-specific price so any post-grace premium is included.
    //   라벨별 가격을 사용하여 post-grace premium이 반영되도록 한다.
    uint256 price_ = rentPriceFor(label, duration);

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
    uint256 price_ = rentPrice(duration);

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
    _consumeCommitment(label, owner, secret);
    _checkReservation(label, msg.sender);

    if (!available(label)) revert NameNotAvailable(label);

    bytes32 labelhash = keccak256(bytes(label));
    // Use the label-specific token amount so any post-grace premium is
    // pulled along with the base rent.
    //   라벨별 토큰 금액을 사용하여 post-grace premium까지 함께 청구.
    uint256 amount = rentPriceInTokenFor(label, duration, paymentToken);

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
    uint256 amount = rentPriceInToken(duration, paymentToken);
    IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), amount);

    uint256 expires = registrar.renew(uint256(labelhash), duration);

    emit NameRenewedWithToken(label, labelhash, paymentToken, amount, expires);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Commit-reveal / commit-reveal 패턴
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice Compute a commitment hash for the front-running mitigation flow.
  ///         프론트러닝 방지를 위한 commitment 해시 계산.
  function makeCommitment(
    string calldata name,
    address owner,
    bytes32 secret
  ) public pure override returns (bytes32) {
    return keccak256(abi.encode(name, owner, secret));
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

  /// @dev Validate and consume a commitment.
  ///      commitment 검증 및 소비.
  function _consumeCommitment(
    string calldata label,
    address owner,
    bytes32 secret
  ) internal {
    bytes32 commitment = makeCommitment(label, owner, secret);
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
