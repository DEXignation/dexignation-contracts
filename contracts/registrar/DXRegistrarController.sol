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

  /// @dev commitment hash => timestamp at which it was committed.
  ///      commitment 해시 => commit된 시각.
  mapping(bytes32 commitment => uint256 timestamp) public commitments;

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
    if (!allowedPaymentTokens[token]) revert TokenNotAllowed(token);

    // attoUSD uses 18 decimals; tokens with decimals > 18 cannot be
    // safely down-scaled, so we reject them.
    //   attoUSD가 18 decimals이므로 18 초과 decimals 토큰은 안전하게
    //   down-scale할 수 없어 거부한다.
    uint8 d = IERC20Metadata(token).decimals();
    if (d > 18) revert UnsupportedTokenDecimals(d);

    uint256 attoUSD = priceOracle.priceAttoUSD(duration);

    // attoUSD (1e18-scaled) → token-decimals-scaled, ceiling division.
    //   attoUSD를 토큰 decimals로 변환. 올림 처리.
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

    bytes32 labelhash = keccak256(bytes(label));
    uint256 price_ = rentPrice(duration);

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

    if (!available(label)) revert NameNotAvailable(label);

    bytes32 labelhash = keccak256(bytes(label));
    uint256 amount = rentPriceInToken(duration, paymentToken);

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

  /// @notice Withdraw native balance to the contract owner.
  ///         네이티브 잔액을 오너로 송금.
  function withdraw() public override onlyOwner nonReentrant {
    _sendNative(owner(), address(this).balance);
  }

  /// @notice Withdraw the full balance of `token` to the contract owner.
  ///         토큰 잔액을 오너로 송금.
  function withdrawToken(address token) public override onlyOwner nonReentrant {
    IERC20 t = IERC20(token);
    t.safeTransfer(owner(), t.balanceOf(address(this)));
  }

  /// @notice Recover tokens accidentally sent to this contract.
  ///         실수로 잘못 보내진 토큰 회수.
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
