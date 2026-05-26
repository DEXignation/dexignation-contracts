// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — IDXRegistrarController
//
// Derived from the ENS `IETHRegistrarController` interface, MIT License.
//   Source : https://github.com/ensdomains/ens-contracts
//   © 2018-2024 Nick Johnson / ENS Labs
//
// Modifications Copyright (c) 2026 DEXignation, MIT License.
//
// 이 인터페이스는 ENS `IETHRegistrarController` (MIT)에서 파생되었습니다.
// 변경 부분은 © 2026 DEXignation, MIT License 하에 배포됩니다.
//
// DEXignation additions / DEXignation 추가사항:
//   - Token-payment functions and events
//     토큰 결제 함수 및 이벤트
//   - `registerInventoryNames()` for owner pre-registration
//     오너 사전 등록을 위한 `registerInventoryNames()`
//   - Withdrawal entry points (`withdraw`, `withdrawToken`)
//     출금 함수 (`withdraw`, `withdrawToken`)
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {IDXRegistrar} from "./IDXRegistrar.sol";
import {IDXPriceOracle} from "../oracle/IDXPriceOracle.sol";

interface IDXRegistrarController {

  // ── Events ────────────────────────────────────────────────────────────────

  event NameRegistered(
    string label,
    bytes32 labelhash,
    address owner,
    uint256 price,
    uint256 expires
  );

  event NameRenewed(
    string label,
    bytes32 labelhash,
    uint256 price,
    uint256 expires
  );

  event NameRegisteredWithToken(
    string label,
    bytes32 labelhash,
    address owner,
    address paymentToken,
    uint256 tokenAmount,
    uint256 expires
  );

  event NameRenewedWithToken(
    string label,
    bytes32 labelhash,
    address paymentToken,
    uint256 tokenAmount,
    uint256 expires
  );

  // ── Errors ────────────────────────────────────────────────────────────────

  /// @dev Sent value is below the required rent price.
  ///      결제 금액이 가격보다 부족.
  error InsufficientFund(uint256 requiredPrice, uint256 sentPrice);

  /// @dev `recipient` is the zero address.
  ///      `recipient`가 zero address.
  error InvalidRecipient();

  /// @dev Name is not available.
  ///      이름 사용 불가.
  error NameNotAvailable(string name);

  /// @dev Payment token is not on the allow-list.
  ///      결제 토큰이 허용 목록에 없음.
  error TokenNotAllowed(address token);

  /// @dev Token has > 18 decimals (incompatible with attoUSD scale).
  ///      토큰 decimals가 18 초과 (attoUSD 스케일과 호환 불가).
  error UnsupportedTokenDecimals(uint8 decimals);

  /// @dev An unexpired commitment for the same hash already exists.
  ///      같은 해시의 만료되지 않은 commitment가 이미 존재.
  error UnexpiredCommitmentExists(bytes32 commitment);

  /// @dev `commit()` was never called for this commitment.
  ///      해당 commitment에 대한 `commit()` 호출이 없었음.
  error CommitmentNotFound(bytes32 commitment);

  /// @dev `commit()` was too recent (within `minCommitmentAge`).
  ///      `commit()`이 너무 최근 (minCommitmentAge 미경과).
  error CommitmentTooNew(bytes32 commitment);

  /// @dev `commit()` was too old (past `maxCommitmentAge`).
  ///      `commit()`이 너무 오래됨 (maxCommitmentAge 경과).
  error CommitmentTooOld(bytes32 commitment);

  /// @dev `maxCommitmentAge` <= `minCommitmentAge`.
  ///      maxCommitmentAge가 minCommitmentAge보다 작거나 같음.
  error MaxCommitmentAgeTooLow();

  /// @dev Low-level native transfer failed.
  ///      네이티브 전송 실패.
  error NativeTransferFailed(address to, uint256 amount);

  // ── Functions ─────────────────────────────────────────────────────────────

  function available(string calldata label) external view returns (bool);

  function rentPrice(uint256 duration) external view returns (uint256);

  /// @return Token amount required, in the token's minimum units (ceiling).
  ///         필요한 토큰 양 (토큰 최소 단위, 올림).
  function rentPriceInToken(
    uint256 duration,
    address token
  ) external view returns (uint256);

  function register(
    string calldata label,
    address owner,
    uint256 duration,
    address resolver,
    bytes32 secret
  ) external payable;

  function registerWithToken(
    string calldata label,
    address owner,
    uint256 duration,
    address resolver,
    address paymentToken,
    bytes32 secret
  ) external;

  function renew(string calldata label, uint256 duration) external payable;

  function renewWithToken(
    string calldata label,
    uint256 duration,
    address paymentToken
  ) external;

  function setAllowedPaymentToken(address token, bool allowed) external;

  function makeCommitment(
    string calldata name,
    address owner,
    bytes32 secret
  ) external pure returns (bytes32);

  function commit(bytes32 commitment) external;

  function setCommitmentAgeSettings(uint256 minAge, uint256 maxAge) external;

  function withdraw() external;

  function withdrawToken(address token) external;

  function registerInventoryNames(
    string[] calldata labels,
    address owner,
    uint256 duration,
    address resolver
  ) external;
}
