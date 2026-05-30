// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — MockUSDT (test only)
//
// Simulates Tether (USDT)'s NON-STANDARD approve behaviour: USDT on mainnet
// reverts if you call approve(spender, X) when the current allowance is already
// non-zero and X is also non-zero — you must approve(spender, 0) first. This
// mock reproduces that quirk so we can prove our subscription module's use of
// SafeERC20.forceApprove handles USDT correctly.
//
// USDT의 비표준 approve 동작을 흉내낸다: 메인넷 USDT는 현재 allowance가 0이
// 아닌데 0이 아닌 값으로 approve하면 revert한다(먼저 0으로 approve 필요). 이
// 모의로 구독 모듈의 forceApprove가 USDT를 올바르게 처리함을 증명한다.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title  MockUSDT
/// @notice Test-only token reproducing USDT's "must reset to zero" approve rule.
///         USDT의 "0으로 먼저 리셋해야 함" approve 규칙을 재현하는 테스트 토큰.
contract MockUSDT is ERC20 {
  uint8 private immutable _customDecimals;

  constructor(uint8 decimals_) ERC20("Tether USD", "USDT") {
    _customDecimals = decimals_;
  }

  function decimals() public view override returns (uint8) {
    return _customDecimals;
  }

  function mint(address to, uint256 amount) external {
    _mint(to, amount);
  }

  /// @dev USDT-style guard: block changing a non-zero allowance directly to
  ///      another non-zero value. Callers must approve(spender, 0) first.
  ///      USDT식 가드: 0이 아닌 allowance를 다른 0이 아닌 값으로 직접 변경 금지.
  ///      호출자는 먼저 approve(spender, 0)을 해야 한다.
  function approve(address spender, uint256 value)
    public
    override
    returns (bool)
  {
    if (value != 0 && allowance(msg.sender, spender) != 0) {
      revert("USDT: approve from non-zero to non-zero");
    }
    return super.approve(spender, value);
  }
}
