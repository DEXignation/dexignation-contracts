// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — MockERC20 (test only)
//
// Minimal mintable ERC-20 used by Hardhat tests and local deployments to
// simulate USDT / USDC. Not intended for production deployment.
//
// Copyright (c) 2026 DEXignation, MIT License.
//
// Hardhat 테스트 및 로컬 배포에서 USDT / USDC를 흉내 내기 위한 최소
// mintable ERC-20. 프로덕션 배포 대상 아님.
// 본 파일은 © 2026 DEXignation, MIT License.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title  MockERC20
/// @notice Test-only ERC-20 with configurable decimals.
///         decimals를 임의 지정할 수 있는 테스트 전용 ERC-20.
contract MockERC20 is ERC20 {
  uint8 private immutable _customDecimals;

  constructor(
    string memory name_,
    string memory symbol_,
    uint8 decimals_
  ) ERC20(name_, symbol_) {
    _customDecimals = decimals_;
  }

  function decimals() public view override returns (uint8) {
    return _customDecimals;
  }

  /// @notice Open mint — anyone can call. Test only.
  ///         누구나 호출 가능한 mint. 테스트 전용.
  function mint(address to, uint256 amount) external {
    _mint(to, amount);
  }
}
