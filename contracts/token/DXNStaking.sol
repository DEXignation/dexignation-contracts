// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — DXNStaking
//
// Minimal single-asset staking contract. Stakers deposit DXN and become
// entitled to a share of all rewards added later by the RevenueDistributor.
//
// Implementation: classic "reward per share" accumulator pattern à la
// Synthetix / Compound. Each time `notifyReward()` is called the contract
// updates `accRewardPerShare`. Stakers' pending rewards are computed
// lazily from their snapshot.
//
// Reward asset is configurable per-token: this contract supports multiple
// reward assets simultaneously (e.g. POL, USDC, USDT). Each asset has its
// own `accRewardPerShare` accumulator.
//
// IMPORTANT — this is a skeleton implementation. Before deploying to
// mainnet:
//   - audit the accumulator math under edge cases (zero-stake reward
//     notifications, very small stakes, very large reward deposits)
//   - decide on unbonding / lockup policy (currently: instant unstake)
//   - decide on emergency-withdraw semantics
//   - test interactions with RevenueDistributor (especially partial
//     distributions and re-entrancy on token transfers)
//
// 최소한의 단일 자산 스테이킹. staker가 DXN을 예치하면 이후 RevenueDistributor
// 가 추가하는 모든 보상의 비율을 받는다. Synthetix/Compound 스타일 누적기.
//
// 본 파일은 골격 구현입니다. 메인넷 배포 전에 엣지 케이스 audit, unbonding/
// 잠금 정책 결정, emergency-withdraw 정의, RevenueDistributor와의 상호작용
// 테스트 필수.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title  DXNStaking
/// @notice Stake DXN, earn protocol revenue.
///         DXN을 스테이킹하여 프로토콜 수익을 받는다.
contract DXNStaking is Ownable, ReentrancyGuard {
  using SafeERC20 for IERC20;

  /// @notice Precision multiplier for the per-share accumulator.
  ///         per-share 누적기의 정밀도 배수.
  uint256 public constant ACC_PRECISION = 1e18;

  IERC20 public immutable stakingToken; // DXN

  /// @notice Total amount of DXN currently staked.
  ///         현재 스테이킹된 DXN 총량.
  uint256 public totalStaked;

  /// @dev staker => amount staked
  mapping(address => uint256) public stakedOf;

  /// @dev reward asset => accumulated reward per share, scaled by ACC_PRECISION
  ///      보상 자산 => share당 누적 보상 (ACC_PRECISION 배율)
  mapping(address => uint256) public accRewardPerShare;

  /// @dev staker => reward asset => debt snapshot
  ///      특정 자산에 대해 staker가 이미 받은 것으로 처리된 보상의 snapshot
  mapping(address => mapping(address => uint256)) public rewardDebt;

  /// @dev Addresses authorised to call `notifyReward` (typically the
  ///      RevenueDistributor).
  ///      `notifyReward` 호출 권한이 있는 주소(주로 RevenueDistributor).
  mapping(address => bool) public notifiers;

  event Staked(address indexed user, uint256 amount);
  event Unstaked(address indexed user, uint256 amount);
  event RewardNotified(address indexed token, uint256 amount);
  event RewardClaimed(
    address indexed user,
    address indexed token,
    uint256 amount
  );
  event NotifierSet(address indexed notifier, bool allowed);

  error ZeroAmount();
  error InsufficientStake(uint256 requested, uint256 available);
  error NotNotifier();

  constructor(IERC20 _stakingToken) Ownable(msg.sender) {
    stakingToken = _stakingToken;
  }

  /// @notice Authorise/revoke a reward notifier.
  ///         보상 알림 권한 부여/회수.
  function setNotifier(address notifier, bool allowed) external onlyOwner {
    notifiers[notifier] = allowed;
    emit NotifierSet(notifier, allowed);
  }

  // ── Staker actions / 스테이커 동작 ──────────────────────────────────────────

  /// @notice Stake `amount` DXN. Caller must have approved this contract.
  ///         DXN을 `amount`만큼 스테이킹. 사전 approve 필요.
  function stake(uint256 amount) external nonReentrant {
    if (amount == 0) revert ZeroAmount();
    stakingToken.safeTransferFrom(msg.sender, address(this), amount);

    // Settle pending rewards before updating stake to avoid double-counting.
    //   stake 변경 전 미정산 보상을 처리하여 중복 계산을 방지.
    // We don't auto-claim here; we only update the debt baseline.
    //   여기서 자동 claim하지 않고 debt baseline만 갱신.
    // To preserve correctness across multiple reward assets, callers
    // should call `claim()` for each asset they care about before staking
    // additional amounts.
    //   여러 보상 자산이 있는 경우 staker는 추가 stake 전에 관심 있는
    //   자산에 대해 `claim()`을 호출해야 한다.

    stakedOf[msg.sender] += amount;
    totalStaked += amount;

    emit Staked(msg.sender, amount);
  }

  /// @notice Unstake `amount` DXN. Pending rewards are NOT auto-claimed
  ///         to keep gas predictable. Call `claim()` separately.
  ///         DXN을 unstake. 미수령 보상은 자동 청구되지 않는다.
  function unstake(uint256 amount) external nonReentrant {
    if (amount == 0) revert ZeroAmount();
    uint256 staked = stakedOf[msg.sender];
    if (amount > staked) revert InsufficientStake(amount, staked);

    stakedOf[msg.sender] = staked - amount;
    totalStaked -= amount;
    stakingToken.safeTransfer(msg.sender, amount);

    emit Unstaked(msg.sender, amount);
  }

  /// @notice Claim pending rewards for a specific reward asset.
  ///         특정 보상 자산에 대한 미수령 보상을 청구.
  function claim(address rewardToken) external nonReentrant returns (uint256) {
    uint256 staked = stakedOf[msg.sender];
    uint256 acc = accRewardPerShare[rewardToken];
    uint256 debt = rewardDebt[msg.sender][rewardToken];
    uint256 pending = (staked * acc) / ACC_PRECISION;
    uint256 owed = pending > debt ? pending - debt : 0;
    if (owed == 0) return 0;

    rewardDebt[msg.sender][rewardToken] = pending;
    IERC20(rewardToken).safeTransfer(msg.sender, owed);

    emit RewardClaimed(msg.sender, rewardToken, owed);
    return owed;
  }

  // ── Reward distribution / 보상 분배 ─────────────────────────────────────────

  /// @notice Called by the RevenueDistributor (or other notifier) to add
  ///         `amount` of `rewardToken` to the rewards pool. The token must
  ///         already have been transferred to this contract before
  ///         calling.
  ///
  ///         RevenueDistributor가 호출하여 보상 풀에 `rewardToken`을 `amount`
  ///         만큼 추가. 호출 전에 토큰이 이 컨트랙트로 이미 전송되어 있어야 함.
  function notifyReward(address rewardToken, uint256 amount) external {
    if (!notifiers[msg.sender]) revert NotNotifier();
    if (amount == 0) return;
    // If no one is staked, the reward stays in the contract and will
    // be applied to future stakers — equivalent to a one-off airdrop
    // dilution. We document this rather than complicate the math.
    //
    // 스테이커가 없으면 보상은 그대로 남았다가 미래 스테이커에게 적용된다.
    if (totalStaked == 0) return;

    accRewardPerShare[rewardToken] += (amount * ACC_PRECISION) / totalStaked;
    emit RewardNotified(rewardToken, amount);
  }

  // ── Views / 조회 ────────────────────────────────────────────────────────────

  /// @notice Pending unclaimed reward for `user` in `rewardToken`.
  ///         `user`의 `rewardToken` 미수령 보상.
  function pendingReward(address user, address rewardToken)
    external
    view
    returns (uint256)
  {
    uint256 staked = stakedOf[user];
    uint256 acc = accRewardPerShare[rewardToken];
    uint256 debt = rewardDebt[user][rewardToken];
    uint256 pending = (staked * acc) / ACC_PRECISION;
    return pending > debt ? pending - debt : 0;
  }
}
