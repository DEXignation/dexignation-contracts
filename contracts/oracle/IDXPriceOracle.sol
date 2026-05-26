// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — IDXPriceOracle
//
// The price-oracle interface concept follows ENS's `IPriceOracle` family
// (MIT, https://github.com/ensdomains/ens-contracts). DEXignation simplifies
// it to a single attoUSD/wei price per duration.
//
// Copyright (c) 2026 DEXignation, MIT License.
//
// 가격 오라클 인터페이스 컨셉은 ENS `IPriceOracle` 계열 (MIT)을 따른다.
// DEXignation은 기간별 단일 attoUSD/wei 가격으로 단순화.
// 본 파일은 © 2026 DEXignation, MIT License.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

interface IDXPriceOracle {

  // ── Errors ────────────────────────────────────────────────────────────────

  /// @dev Constructor rent-prices array length is not 4.
  ///      생성자 가격 배열 길이가 4가 아님.
  error InvalidRentPricesLength();

  /// @dev Aggregator returned a non-positive answer.
  ///      오라클이 0 이하의 가격을 반환.
  error InvalidOraclePrice();

  /// @dev Aggregator answer is older than `maxOracleDelay`.
  ///      오라클 가격이 `maxOracleDelay`보다 오래됨.
  error StaleOraclePrice();

  /// @dev Duration is 0 or not one of the allowed tiers (1/3/5/10 years).
  ///      기간이 0이거나 허용 구간이 아님.
  error InvalidDuration();

  /// @dev The aggregator required by the selected path is not configured.
  ///      선택된 경로에 필요한 오라클이 설정되지 않음.
  error OracleNotConfigured();

  /// @dev Delay parameter outside [1h, 48h].
  ///      delay 파라미터가 [1시간, 48시간] 범위 밖.
  error InvalidOracleDelay();

  // ── Functions ─────────────────────────────────────────────────────────────

  /// @notice Total price for the given duration, in wei of the native asset.
  ///         주어진 기간에 대한 네이티브 자산 wei 단위 총액.
  function price(uint256 duration) external view returns (uint256);

  /// @notice Total price for the given duration, in attoUSD (1 USD = 1e18).
  ///         주어진 기간에 대한 attoUSD 단위 총액.
  function priceAttoUSD(uint256 duration) external view returns (uint256);
}
