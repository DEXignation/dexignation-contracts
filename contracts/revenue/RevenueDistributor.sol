// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — RevenueDistributor
//
// Receives protocol revenue (native + ERC-20) from the registrar controller
// and forwards it to configurable destinations in fixed proportions.
//
// Typical configuration:
//   Treasury     7000 bps (70%)  — operating budget, runway
//   Staking      2000 bps (20%)  — distributed to DXN stakers
//   Burn          500 bps  (5%)  — sent to a burn address (deflationary)
//   Buffer        500 bps  (5%)  — reserve for refunds / mistakes
//
// Properties:
//   - Pull-style: revenue accrues in this contract; recipients pull or
//     the owner triggers `distribute()`.
//   - Bps must sum to exactly 10_000 in `setShares()`.
//   - Per-token bookkeeping so a delayed distribute() still pays the
//     right proportion of whatever is in the contract.
//   - No internal accounting of "who has claimed what" beyond simple
//     transfers — when `distribute()` runs, the entire balance is split.
//
// 등록 컨트롤러로부터 네이티브/ERC-20 수익을 받아 고정 비율로 라우팅한다.
// pull 방식: 잔액이 누적되다가 `distribute()` 호출 시 일괄 분배.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title  RevenueDistributor
/// @notice Splits incoming revenue between treasury / staking / burn / buffer
///         destinations in configurable proportions.
///         수익을 treasury / staking / burn / buffer로 비율대로 분배.
contract RevenueDistributor is Ownable, ReentrancyGuard {
  using SafeERC20 for IERC20;

  uint256 public constant BPS_DENOMINATOR = 10_000;

  struct Shares {
    address treasury;
    address staking;
    address burnAddress;
    address buffer;
    uint16 treasuryBps;
    uint16 stakingBps;
    uint16 burnBps;
    uint16 bufferBps;
  }

  Shares public shares;

  event SharesUpdated(Shares shares);
  event RevenueDistributed(
    address indexed token, // address(0) for native
    uint256 toTreasury,
    uint256 toStaking,
    uint256 toBurn,
    uint256 toBuffer
  );

  error InvalidBpsTotal(uint256 sum);
  error ZeroAddress();
  error NativeTransferFailed(address to, uint256 amount);

  constructor(Shares memory _shares) Ownable(msg.sender) {
    _validateAndSet(_shares);
  }

  /// @notice Update the distribution shares. Owner-only.
  ///         분배 비율 변경. 오너 전용.
  function setShares(Shares calldata _shares) external onlyOwner {
    _validateAndSet(_shares);
  }

  /// @dev Receive native revenue. The controller can `_sendNative` here
  ///      and the funds will accumulate until `distribute()` is called.
  ///      네이티브 수익 수신. controller가 `_sendNative`로 보내면 잔액이
  ///      누적되었다가 `distribute()` 호출 시 일괄 분배.
  receive() external payable {}

  /// @notice Distribute the entire native balance.
  ///         네이티브 잔액 전액 분배.
  function distributeNative() external nonReentrant {
    uint256 total = address(this).balance;
    if (total == 0) return;

    Shares memory s = shares;
    uint256 toTreasury = (total * s.treasuryBps) / BPS_DENOMINATOR;
    uint256 toStaking  = (total * s.stakingBps)  / BPS_DENOMINATOR;
    uint256 toBurn     = (total * s.burnBps)     / BPS_DENOMINATOR;
    // Buffer absorbs rounding remainder so totals always equal `total`.
    //   반올림 잔여는 buffer가 흡수해 합계가 정확히 total과 일치.
    uint256 toBuffer   = total - toTreasury - toStaking - toBurn;

    _sendNative(s.treasury, toTreasury);
    _sendNative(s.staking, toStaking);
    _sendNative(s.burnAddress, toBurn);
    _sendNative(s.buffer, toBuffer);

    emit RevenueDistributed(address(0), toTreasury, toStaking, toBurn, toBuffer);
  }

  /// @notice Distribute the entire balance of `token`.
  ///         특정 ERC-20 잔액 전액 분배.
  function distributeToken(address token) external nonReentrant {
    uint256 total = IERC20(token).balanceOf(address(this));
    if (total == 0) return;

    Shares memory s = shares;
    uint256 toTreasury = (total * s.treasuryBps) / BPS_DENOMINATOR;
    uint256 toStaking  = (total * s.stakingBps)  / BPS_DENOMINATOR;
    uint256 toBurn     = (total * s.burnBps)     / BPS_DENOMINATOR;
    uint256 toBuffer   = total - toTreasury - toStaking - toBurn;

    if (toTreasury > 0) IERC20(token).safeTransfer(s.treasury, toTreasury);
    if (toStaking > 0)  IERC20(token).safeTransfer(s.staking, toStaking);
    if (toBurn > 0)     IERC20(token).safeTransfer(s.burnAddress, toBurn);
    if (toBuffer > 0)   IERC20(token).safeTransfer(s.buffer, toBuffer);

    emit RevenueDistributed(token, toTreasury, toStaking, toBurn, toBuffer);
  }

  /// @dev Validate that bps fields sum to 10_000 and no destination is
  ///      the zero address (unless its share is 0).
  ///      bps 합계가 10_000이고 share>0인 항목의 주소가 0이 아닌지 검증.
  function _validateAndSet(Shares memory s) internal {
    uint256 sum = uint256(s.treasuryBps) +
                  uint256(s.stakingBps) +
                  uint256(s.burnBps) +
                  uint256(s.bufferBps);
    if (sum != BPS_DENOMINATOR) revert InvalidBpsTotal(sum);

    if (s.treasuryBps > 0 && s.treasury == address(0)) revert ZeroAddress();
    if (s.stakingBps > 0 && s.staking == address(0)) revert ZeroAddress();
    if (s.burnBps > 0 && s.burnAddress == address(0)) revert ZeroAddress();
    if (s.bufferBps > 0 && s.buffer == address(0)) revert ZeroAddress();

    shares = s;
    emit SharesUpdated(s);
  }

  function _sendNative(address to, uint256 amount) internal {
    if (amount == 0) return;
    (bool ok, ) = payable(to).call{value: amount}("");
    if (!ok) revert NativeTransferFailed(to, amount);
  }
}
