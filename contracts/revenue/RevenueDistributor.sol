// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — RevenueDistributor (v2)
//
// Receives protocol revenue (native + ERC-20) from the registrar controller
// and forwards it to configurable destinations in fixed proportions.
//
// v2 changes vs v1:
//   - `distributeToken()` calls `staking.notifyReward()` atomically after
//     transferring tokens to the staking contract, so stakers actually
//     accrue the reward in the same transaction (no separate keeper).
//   - `distributeNative()` no longer attempts to send native to the
//     staking contract by default. Native revenue is routed to a configurable
//     "nativeStakingProxy" — typically the treasury, or a WPOL wrap-and-notify
//     helper — because DXNStaking only handles ERC-20 rewards.
//   - `setStaking()` lets the owner attach the staking contract address
//     (zero disables auto-notify).
//
// v2 변경점:
//   - `distributeToken()`이 staking 계약으로 토큰 전송 후 동일 트랜잭션에서
//     `notifyReward()`까지 호출 → 별도 keeper 없이 보상 누적.
//   - `distributeNative()`는 staking에 네이티브를 보내지 않음. DXNStaking은
//     ERC-20만 다루므로 native는 `nativeStakingProxy` (treasury 또는 WPOL
//     wrap-and-notify 헬퍼)로 우회.
//   - `setStaking()`으로 owner가 staking 주소 연결/해제 (0이면 자동 notify
//     비활성).
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Minimal interface to call DXNStaking.notifyReward without circular import.
///      순환 import 회피용 최소 인터페이스.
interface IRewardNotifier {
  function notifyReward(address rewardToken, uint256 amount) external;
  function isRewardAsset(address token) external view returns (bool);
}

contract RevenueDistributor is Ownable, ReentrancyGuard {
  using SafeERC20 for IERC20;

  uint256 public constant BPS_DENOMINATOR = 10_000;

  struct Shares {
    address treasury;
    address staking;           // ERC-20 staking destination (DXNStaking).
    address nativeStakingProxy; // Receives native share (e.g. treasury or WPOL helper).
    address burnAddress;
    address buffer;
    uint16 treasuryBps;
    uint16 stakingBps;
    uint16 burnBps;
    uint16 bufferBps;
  }

  Shares public shares;

  /// @notice Optional staking contract for atomic ERC-20 notifyReward calls.
  ///         Zero disables auto-notify (tokens still transfer to `shares.staking`
  ///         but no notifyReward is fired — useful during migrations).
  ///         ERC-20 자동 notifyReward용 staking 컨트랙트 (선택). 0이면 자동
  ///         notify 비활성 (토큰은 여전히 `shares.staking`으로 전송됨, 마이그
  ///         레이션 중 유용).
  IRewardNotifier public stakingNotifier;

  event SharesUpdated(Shares shares);
  event StakingNotifierSet(address indexed notifier);
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
  error StakingNotRewardAsset(address token);

  constructor(Shares memory _shares, address _owner) Ownable(_owner) {
    _validateAndSet(_shares);
  }

  /// @notice Update the distribution shares. Owner-only.
  function setShares(Shares calldata _shares) external onlyOwner {
    _validateAndSet(_shares);
  }

  /// @notice Attach (or detach) the staking contract used for atomic
  ///         notifyReward calls during `distributeToken`. Zero address
  ///         disables auto-notify but still transfers the staking share
  ///         to `shares.staking`.
  ///
  ///         `distributeToken`에서 원자적 notifyReward에 사용할 staking
  ///         컨트랙트 연결/해제. 0이면 자동 notify 비활성.
  function setStakingNotifier(IRewardNotifier _notifier) external onlyOwner {
    stakingNotifier = _notifier;
    emit StakingNotifierSet(address(_notifier));
  }

  /// @dev Receive native revenue. The controller `_sendNative`s here and
  ///      the funds accumulate until `distributeNative()` is called.
  receive() external payable {}

  /// @notice Distribute the entire native balance. Note that the "staking"
  ///         share is sent to `nativeStakingProxy` (not the ERC-20 staking
  ///         contract), since DXNStaking only handles ERC-20 rewards.
  ///         네이티브 잔액 전액 분배. "staking" 몫은 `nativeStakingProxy`로
  ///         이동 (DXNStaking은 ERC-20만 다루므로).
  function distributeNative() external nonReentrant {
    uint256 total = address(this).balance;
    if (total == 0) return;

    Shares memory s = shares;
    uint256 toTreasury = (total * s.treasuryBps) / BPS_DENOMINATOR;
    uint256 toStaking  = (total * s.stakingBps)  / BPS_DENOMINATOR;
    uint256 toBurn     = (total * s.burnBps)     / BPS_DENOMINATOR;
    uint256 toBuffer   = total - toTreasury - toStaking - toBurn;

    _sendNative(s.treasury, toTreasury);
    // Route staking share to the native-aware proxy so a transfer to a
    // pure-ERC20 staking contract (which would lack `receive()`) cannot
    // brick distribution.
    //   네이티브 staking 몫은 native-aware proxy로 라우팅. ERC-20만 받는
    //   staking 컨트랙트(`receive()` 부재)에 보내 분배가 멈추는 사고 방지.
    _sendNative(s.nativeStakingProxy, toStaking);
    _sendNative(s.burnAddress, toBurn);
    _sendNative(s.buffer, toBuffer);

    emit RevenueDistributed(address(0), toTreasury, toStaking, toBurn, toBuffer);
  }

  /// @notice Distribute the entire balance of `token`. If `stakingNotifier`
  ///         is set, the staking share is transferred AND immediately
  ///         notified so stakers accrue the reward atomically.
  ///
  ///         특정 ERC-20 잔액 전액 분배. `stakingNotifier`가 설정되어
  ///         있으면 staking 몫 전송 직후 동일 트랜잭션에서 notifyReward까지
  ///         호출 → 원자적 누적.
  function distributeToken(address token) external nonReentrant {
    uint256 total = IERC20(token).balanceOf(address(this));
    if (total == 0) return;

    Shares memory s = shares;
    uint256 toTreasury = (total * s.treasuryBps) / BPS_DENOMINATOR;
    uint256 toStaking  = (total * s.stakingBps)  / BPS_DENOMINATOR;
    uint256 toBurn     = (total * s.burnBps)     / BPS_DENOMINATOR;
    uint256 toBuffer   = total - toTreasury - toStaking - toBurn;

    if (toTreasury > 0) IERC20(token).safeTransfer(s.treasury, toTreasury);

    if (toStaking > 0) {
      IERC20(token).safeTransfer(s.staking, toStaking);
      IRewardNotifier notifier = stakingNotifier;
      if (address(notifier) != address(0)) {
        // Refuse to notify a non-registered asset: silently skipping would
        // leak tokens to the staking contract without ever crediting them.
        // Reverting forces the operator to call addRewardAsset first.
        //   미등록 자산을 notify하지 않음: 무시하면 토큰만 staking에 쌓이고
        //   누적은 안 됨. revert로 운영자가 addRewardAsset을 먼저 호출하게
        //   강제.
        if (!notifier.isRewardAsset(token)) revert StakingNotRewardAsset(token);
        notifier.notifyReward(token, toStaking);
      }
    }

    if (toBurn > 0)   IERC20(token).safeTransfer(s.burnAddress, toBurn);
    if (toBuffer > 0) IERC20(token).safeTransfer(s.buffer, toBuffer);

    emit RevenueDistributed(token, toTreasury, toStaking, toBurn, toBuffer);
  }

  function _validateAndSet(Shares memory s) internal {
    uint256 sum = uint256(s.treasuryBps) +
                  uint256(s.stakingBps) +
                  uint256(s.burnBps) +
                  uint256(s.bufferBps);
    if (sum != BPS_DENOMINATOR) revert InvalidBpsTotal(sum);

    if (s.treasuryBps > 0 && s.treasury == address(0)) revert ZeroAddress();
    if (s.stakingBps > 0) {
      if (s.staking == address(0)) revert ZeroAddress();
      if (s.nativeStakingProxy == address(0)) revert ZeroAddress();
    }
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
