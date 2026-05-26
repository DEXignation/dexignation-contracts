// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — MockPriceOracle (test only)
//
// A thin wrapper over `@chainlink/local`'s `MockV3Aggregator` so that the
// mock can be emitted as a separate Hardhat artifact for clarity in tests
// and deployment scripts.
//
//   @chainlink/local — Apache-2.0, © Chainlink Labs.
//   https://github.com/smartcontractkit/chainlink-local
//
// This wrapper Copyright (c) 2026 DEXignation, MIT License. The underlying
// `MockV3Aggregator` is governed by its original Apache-2.0 license; see
// THIRD-PARTY-LICENSES.md at the repository root.
//
// `@chainlink/local`의 `MockV3Aggregator` (Apache-2.0)를 얇게 감싸 별도
// Hardhat 아티팩트로 만들기 위한 래퍼. 본 래퍼는 © 2026 DEXignation,
// MIT License. 내부 `MockV3Aggregator`는 원본 Apache-2.0 적용 — 자세한
// 내용은 저장소 루트의 THIRD-PARTY-LICENSES.md 참고.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {MockV3Aggregator} from "@chainlink/local/src/data-feeds/MockV3Aggregator.sol";

/// @title  MockPriceOracle
/// @notice Test-only Chainlink aggregator mock.
///         테스트 전용 Chainlink aggregator 목.
contract MockPriceOracle is MockV3Aggregator {
  constructor(uint8 decimals_, int256 initialAnswer)
    MockV3Aggregator(decimals_, initialAnswer)
  {}
}
