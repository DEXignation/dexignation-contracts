// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — DXNStaking (v2)
//
// Stake DXN, earn protocol revenue distributed in multiple assets.
//
// Design / 설계:
//   - Synthetix-style "rewardPerShare" accumulator per reward asset.
//   - `stake` / `unstake` / `claim` always settle the caller's rewardDebt
//     across ALL currently-active reward assets so a fresh staker cannot
//     claim historical rewards.
//   - `notifyReward()` is restricted to authorised notifiers AND measures
//     the actual balance delta — a malicious or buggy notifier cannot
//     inflate accRewardPerShare beyond what was really deposited.
//   - Reward assets are tracked in a small array so settlement is O(n)
//     per state change; this is acceptable for the small fixed set we
//     expect (POL, USDC, USDT, maybe a couple more).
//
//   - Synthetix식 "rewardPerShare" 누적기를 보상 자산별로 유지.
//   - `stake`/`unstake`/`claim`은 항상 모든 활성 보상 자산에 대해 호출자의
//     rewardDebt를 정산하므로, 신규 staker가 과거 보상을 가져갈 수 없음.
//   - `notifyReward()`는 권한 있는 notifier만 호출 가능하며, 실제 입금 잔액
//     변동을 측정해 부풀려진 accRewardPerShare를 막음.
//   - 보상 자산은 작은 배열로 추적해 상태 변경 시 O(n) 정산. 예상 자산 수
//     (POL, USDC, USDT, 한두 개 더)가 작아 허용 가능한 비용.
//
// IMPORTANT — still a skeleton. Before mainnet:
//   - Decide lockup / cooldown policy (currently: instant unstake).
//   - Define emergency-withdraw semantics.
//   - Cap the number of active reward assets to avoid O(n) gas blowup.
//   - Independent security audit.
//
// 메인넷 전 결정 필요:
//   - lockup / cooldown 정책
//   - emergency-withdraw 정의
//   - 활성 보상 자산 개수 상한 (O(n) 가스 폭증 방지)
//   - 독립 보안 audit
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract DXNStaking is Ownable, ReentrancyGuard {
  using SafeERC20 for IERC20;

  /// @notice Precision multiplier for the per-share accumulator.
  ///         per-share 누적기의 정밀도 배수.
  uint256 public constant ACC_PRECISION = 1e18;

  /// @notice Hard cap on the number of reward assets. Each stake/unstake/
  ///         claim iterates this list, so unbounded growth would brick the
  ///         contract via out-of-gas. 16 covers POL + every realistic
  ///         stablecoin and partner token combo.
  ///         보상 자산 개수 상한. stake/unstake/claim이 이 리스트를 순회하므로
  ///         무한 증가 시 OOG로 컨트랙트가 멈출 수 있어 제한.
  uint256 public constant MAX_REWARD_ASSETS = 16;

  IERC20 public immutable stakingToken; // DXN

  /// @notice Total amount of DXN currently staked.
  ///         현재 스테이킹된 DXN 총량.
  uint256 public totalStaked;

  /// @dev staker => amount staked
  mapping(address => uint256) public stakedOf;

  /// @dev reward asset => accumulated reward per share, scaled by ACC_PRECISION
  ///      보상 자산 => share당 누적 보상 (ACC_PRECISION 배율).
  mapping(address => uint256) public accRewardPerShare;

  /// @dev staker => reward asset => debt snapshot
  ///      특정 자산에 대해 staker가 이미 받은 것으로 처리된 보상 snapshot.
  mapping(address => mapping(address => uint256)) public rewardDebt;

  /// @dev List of active reward assets. Append-only after `addRewardAsset`,
  ///      never removed (removal would break debt accounting).
  ///      활성 보상 자산 리스트. `addRewardAsset` 호출 시 append-only이며
  ///      제거 불가 (debt 회계가 깨짐).
  address[] public rewardAssets;
  mapping(address => bool) public isRewardAsset;

  /// @dev Addresses authorised to call `notifyReward` (typically the
  ///      RevenueDistributor).
  mapping(address => bool) public notifiers;

  // ── Events ──────────────────────────────────────────────────────────────────

  event RewardAssetAdded(address indexed token);
  event Staked(address indexed user, uint256 amount);
  event Unstaked(address indexed user, uint256 amount);
  event RewardNotified(address indexed token, uint256 amount);
  event RewardClaimed(
    address indexed user,
    address indexed token,
    uint256 amount
  );
  event NotifierSet(address indexed notifier, bool allowed);

  // ── Errors ──────────────────────────────────────────────────────────────────

  error ZeroAmount();
  error InsufficientStake(uint256 requested, uint256 available);
  error NotNotifier();
  error UnknownRewardAsset(address token);
  error AlreadyRegistered(address token);
  error TooManyRewardAssets();
  error ZeroAddress();

  constructor(IERC20 _stakingToken, address _owner) Ownable(_owner) {
    if (address(_stakingToken) == address(0)) revert ZeroAddress();
    stakingToken = _stakingToken;
  }

  // ── Owner config ────────────────────────────────────────────────────────────

  /// @notice Register a reward asset. Once registered, the asset can be
  ///         used in `notifyReward` and is included in every settlement.
  ///         Registration is one-way to keep accounting consistent.
  ///
  ///         보상 자산 등록. 등록되면 `notifyReward`에 사용 가능하고 모든
  ///         정산에 포함됨. 회계 일관성을 위해 등록은 일방향(제거 불가).
  function addRewardAsset(address token) external onlyOwner {
    if (token == address(0)) revert ZeroAddress();
    if (isRewardAsset[token]) revert AlreadyRegistered(token);
    if (rewardAssets.length >= MAX_REWARD_ASSETS) revert TooManyRewardAssets();
    rewardAssets.push(token);
    isRewardAsset[token] = true;
    emit RewardAssetAdded(token);
  }

  function setNotifier(address notifier, bool allowed) external onlyOwner {
    notifiers[notifier] = allowed;
    emit NotifierSet(notifier, allowed);
  }

  // ── Staker actions ──────────────────────────────────────────────────────────

  /// @notice Stake `amount` DXN. Caller must have approved this contract.
  ///         Pending rewards across all reward assets are auto-claimed
  ///         before the stake balance changes — this is required for
  ///         correctness; otherwise the new amount would retroactively
  ///         dilute or inflate the caller's historical share.
  ///
  ///         DXN을 `amount`만큼 스테이킹. 사전 approve 필요. stake 잔액 변경
  ///         전 모든 보상 자산에 대한 미수령 보상을 자동 청구 — 이 단계가
  ///         없으면 추가 amount가 호출자의 과거 share를 소급해 희석/팽창시킴.
  function stake(uint256 amount) external nonReentrant {
    if (amount == 0) revert ZeroAmount();

    _settleAll(msg.sender);

    stakingToken.safeTransferFrom(msg.sender, address(this), amount);
    stakedOf[msg.sender] += amount;
    totalStaked += amount;

    // Reset debt baseline to the new staked amount across all assets so
    // future rewards accrue from the *current* accRewardPerShare.
    //   모든 자산에 대해 새 staked 기준으로 debt baseline 재설정.
    _refreshDebt(msg.sender);

    emit Staked(msg.sender, amount);
  }

  /// @notice Unstake `amount` DXN. Pending rewards across all reward assets
  ///         are auto-claimed first.
  ///         DXN을 unstake. 미수령 보상은 모든 자산에 대해 자동 청구.
  function unstake(uint256 amount) external nonReentrant {
    if (amount == 0) revert ZeroAmount();
    uint256 staked = stakedOf[msg.sender];
    if (amount > staked) revert InsufficientStake(amount, staked);

    _settleAll(msg.sender);

    stakedOf[msg.sender] = staked - amount;
    totalStaked -= amount;

    _refreshDebt(msg.sender);

    stakingToken.safeTransfer(msg.sender, amount);
    emit Unstaked(msg.sender, amount);
  }

  /// @notice Manually claim pending rewards for ALL registered reward
  ///         assets. Useful for periodic harvesting without changing the
  ///         stake amount.
  ///         등록된 모든 보상 자산의 미수령 보상을 일괄 청구. stake 변경
  ///         없이 주기적 수확용.
  function claimAll() external nonReentrant {
    _settleAll(msg.sender);
    _refreshDebt(msg.sender);
  }

  /// @notice Claim pending reward for a single asset.
  ///         특정 자산 하나만 청구.
  function claim(address rewardToken) external nonReentrant returns (uint256) {
    if (!isRewardAsset[rewardToken]) revert UnknownRewardAsset(rewardToken);
    uint256 paid = _settleOne(msg.sender, rewardToken);
    // Refresh debt only for the claimed asset.
    //   청구한 자산만 debt 갱신.
    rewardDebt[msg.sender][rewardToken] =
      (stakedOf[msg.sender] * accRewardPerShare[rewardToken]) / ACC_PRECISION;
    return paid;
  }

  // ── Reward distribution ─────────────────────────────────────────────────────

  /// @notice Called by the RevenueDistributor (or other notifier) AFTER
  ///         transferring `amount` of `rewardToken` to this contract.
  ///
  ///         This implementation measures the actual balance delta since
  ///         the last `notifyReward` for this token, so a notifier can
  ///         neither over-report nor under-report what was deposited.
  ///         An optimistic `amount` argument is accepted as a hint but
  ///         the contract uses min(amount, deltaBalance) — preventing
  ///         both inflation attacks and silent under-distribution.
  ///
  ///         RevenueDistributor가 `rewardToken`을 이 컨트랙트로 전송한
  ///         *후* 호출. 이 구현은 마지막 `notifyReward` 이후 잔액 변동을
  ///         실측하므로 notifier가 부풀리거나 과소 보고할 수 없음.
  ///         `amount` 인자는 hint로 받되 실제로는 min(amount, deltaBalance)
  ///         를 사용.
  function notifyReward(address rewardToken, uint256 amount) external {
    if (!notifiers[msg.sender]) revert NotNotifier();
    if (!isRewardAsset[rewardToken]) revert UnknownRewardAsset(rewardToken);

    // Compute actual delta: current balance minus what's already been
    // accounted as rewards (the "credited" portion) and minus what's
    // staked (for stakingToken == rewardToken edge cases).
    //
    // 실제 delta 계산: 현재 잔액에서 이미 보상으로 기록된 부분과
    // (stakingToken == rewardToken인 엣지 케이스에 대비해) staked 잔액을 뺀 값.
    uint256 currentBalance = IERC20(rewardToken).balanceOf(address(this));
    uint256 accounted = _accountedBalance(rewardToken);
    uint256 available = currentBalance > accounted ? currentBalance - accounted : 0;

    // Use min(hint, actual) so a notifier can pass amount=type(uint256).max
    // to mean "sweep everything new", or pass the exact transferred value
    // for stricter accounting.
    //   hint와 실제 중 작은 값 사용. amount=max로 호출하면 "새로 들어온 거 다",
    //   정확한 값으로 호출하면 엄격 회계.
    uint256 reward = amount < available ? amount : available;
    if (reward == 0) return;

    // If no one is staked, reward is left in the contract for future
    // stakers. We update the "accounted" tracker accordingly so the next
    // notify doesn't double-count it.
    //
    // staker가 0이면 보상은 컨트랙트에 남겨두고 미래 staker에게 적용.
    // 다음 notify가 중복 계산하지 않도록 accounted를 갱신.
    if (totalStaked == 0) {
      _carriedOver[rewardToken] += reward;
      emit RewardNotified(rewardToken, reward);
      return;
    }

    // Include any previously carried-over rewards now that there's stake.
    //   stake가 생긴 시점에 이전에 carry-over된 보상도 함께 분배.
    uint256 carried = _carriedOver[rewardToken];
    if (carried > 0) {
      reward += carried;
      _carriedOver[rewardToken] = 0;
    }

    accRewardPerShare[rewardToken] += (reward * ACC_PRECISION) / totalStaked;
    _totalDistributed[rewardToken] += reward;
    emit RewardNotified(rewardToken, reward);
  }

  /// @dev Tracks rewards arrived while totalStaked was 0; counted in
  ///      the next non-zero notify.
  ///      totalStaked가 0일 때 도착한 보상 추적. 다음 0이 아닌 notify에
  ///      포함됨.
  mapping(address => uint256) private _carriedOver;

  /// @dev Total rewards ever distributed via notifyReward, per asset.
  ///      Used to compute "accounted balance" without per-staker iteration.
  ///      자산별 누적 분배 총량. per-staker 순회 없이 "accounted balance"
  ///      계산용.
  mapping(address => uint256) private _totalDistributed;

  /// @dev Tokens already claimed by stakers, per asset. Together with
  ///      `_totalDistributed`, this gives the balance still owed.
  ///      자산별 staker가 이미 청구한 총량. `_totalDistributed`와 함께
  ///      미지급 잔액 계산.
  mapping(address => uint256) private _totalClaimed;

  /// @dev How much of the contract's `rewardToken` balance is reserved
  ///      either for unclaimed rewards or as carried-over future rewards.
  ///      The notifier's "available" pool is `balance - this`.
  ///      컨트랙트가 보유한 `rewardToken` 잔액 중 미지급 보상 + carry-over
  ///      예약분. notifier가 보는 "available"은 `balance - 이 값`.
  function _accountedBalance(address rewardToken) internal view returns (uint256) {
    uint256 unclaimed = _totalDistributed[rewardToken] > _totalClaimed[rewardToken]
      ? _totalDistributed[rewardToken] - _totalClaimed[rewardToken]
      : 0;
    uint256 accounted = unclaimed + _carriedOver[rewardToken];

    // Edge case: if reward asset == staking asset, the user-staked amount
    // also sits in this contract's balance and must be excluded.
    //   엣지 케이스: 보상 자산 == staking 자산이면 staker 예치금도 잔액에
    //   포함되어 있으므로 제외해야 함.
    if (rewardToken == address(stakingToken)) {
      accounted += totalStaked;
    }
    return accounted;
  }

  // ── Internal settlement ─────────────────────────────────────────────────────

  /// @dev Pay out `user`'s accrued reward for `rewardToken` and update
  ///      claim bookkeeping. Returns the amount paid.
  ///      `user`의 `rewardToken` 미수령 보상 지급 + 청구 회계 갱신.
  function _settleOne(address user, address rewardToken)
    internal returns (uint256 paid)
  {
    uint256 staked = stakedOf[user];
    uint256 acc = accRewardPerShare[rewardToken];
    uint256 pending = (staked * acc) / ACC_PRECISION;
    uint256 debt = rewardDebt[user][rewardToken];
    if (pending <= debt) return 0;

    paid = pending - debt;
    _totalClaimed[rewardToken] += paid;
    IERC20(rewardToken).safeTransfer(user, paid);
    emit RewardClaimed(user, rewardToken, paid);
  }

  /// @dev Settle every registered reward asset for `user`. O(n) in the
  ///      number of reward assets (capped at MAX_REWARD_ASSETS).
  ///      `user`의 모든 등록된 보상 자산을 정산. 보상 자산 수에 대해 O(n).
  function _settleAll(address user) internal {
    uint256 len = rewardAssets.length;
    for (uint256 i = 0; i < len; i++) {
      _settleOne(user, rewardAssets[i]);
    }
  }

  /// @dev Reset `user`'s debt baseline for every reward asset to match
  ///      their current staked amount. Must be called after any change
  ///      to `stakedOf[user]`.
  ///      `user`의 모든 보상 자산에 대해 debt baseline을 현재 staked
  ///      기준으로 재설정. `stakedOf[user]` 변경 후 반드시 호출.
  function _refreshDebt(address user) internal {
    uint256 staked = stakedOf[user];
    uint256 len = rewardAssets.length;
    for (uint256 i = 0; i < len; i++) {
      address token = rewardAssets[i];
      rewardDebt[user][token] = (staked * accRewardPerShare[token]) / ACC_PRECISION;
    }
  }

  // ── Views ───────────────────────────────────────────────────────────────────

  /// @notice Pending unclaimed reward for `user` in `rewardToken`.
  ///         `user`의 `rewardToken` 미수령 보상.
  function pendingReward(address user, address rewardToken)
    external view returns (uint256)
  {
    uint256 staked = stakedOf[user];
    uint256 acc = accRewardPerShare[rewardToken];
    uint256 pending = (staked * acc) / ACC_PRECISION;
    uint256 debt = rewardDebt[user][rewardToken];
    return pending > debt ? pending - debt : 0;
  }

  /// @notice Number of registered reward assets.
  ///         등록된 보상 자산 개수.
  function rewardAssetsLength() external view returns (uint256) {
    return rewardAssets.length;
  }

  /// @notice The amount of `rewardToken` available for the next notify
  ///         call (i.e. arrived but not yet attributed).
  ///         다음 notify에 사용 가능한 `rewardToken` 잔액 (도착했지만 아직
  ///         attribute 안 된 금액).
  function pendingNotify(address rewardToken) external view returns (uint256) {
    uint256 bal = IERC20(rewardToken).balanceOf(address(this));
    uint256 accounted = _accountedBalance(rewardToken);
    return bal > accounted ? bal - accounted : 0;
  }
}
