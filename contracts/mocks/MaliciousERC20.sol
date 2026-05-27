// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — MaliciousERC20 (test-only)
//
// Family of intentionally-broken ERC-20 implementations used to verify the
// production contracts handle hostile tokens safely. Used in tests only;
// MUST NOT be deployed to mainnet.
//
// 의도적으로 망가뜨린 ERC-20 mock 모음. production 컨트랙트가 악성 토큰을
// 안전하게 처리하는지 검증용. 테스트 전용 — 메인넷 배포 금지.
//
// Behaviours covered / 다루는 동작:
//   - FeeOnTransferERC20:  transfer 시 일정 비율을 수수료로 차감 (USDT-style)
//   - FalseReturnERC20:    transfer/transferFrom 항상 false 반환
//                          (OpenZeppelin SafeERC20이 처리해야 함)
//   - NoReturnERC20:       transfer가 아무것도 반환 안 함 (legacy USDT)
//   - LyingBalanceERC20:   실제와 다른 balanceOf 반환
//   - ReentrantERC20:      transfer 시 caller로 콜백 (재진입 공격 시뮬레이션)
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Charges a fee on every transfer. Recipient receives less than
///         the amount specified by the sender. Common in deflationary
///         tokens; production code that doesn't measure delta will
///         credit the wrong amount.
///         전송 시 수수료 차감. 수신자가 받는 양 < 명시된 양. 디플레이션
///         토큰에서 흔하며, delta를 측정하지 않는 production 코드는 잘못된
///         양을 기록하게 됨.
contract FeeOnTransferERC20 is ERC20 {
  uint256 public feeBps; // basis points, 100 = 1%

  constructor(string memory n, string memory s, uint256 _feeBps) ERC20(n, s) {
    feeBps = _feeBps;
  }

  function mint(address to, uint256 amount) external { _mint(to, amount); }

  function _update(address from, address to, uint256 value) internal override {
    if (from == address(0) || to == address(0)) {
      super._update(from, to, value);
      return;
    }
    uint256 fee = (value * feeBps) / 10000;
    uint256 net = value - fee;
    super._update(from, to, net);
    if (fee > 0) super._update(from, address(0xdead), fee);
  }
}

/// @notice Always returns false from transfer/transferFrom but doesn't
///         revert. Legacy bad behaviour; SafeERC20 should catch this and
///         revert.
///         transfer/transferFrom이 항상 false 반환하지만 revert는 안 함.
///         레거시 잘못된 동작. SafeERC20이 잡아내고 revert해야 함.
contract FalseReturnERC20 {
  string public name = "FalseReturn";
  string public symbol = "FALSE";
  uint8 public decimals = 18;
  uint256 public totalSupply;
  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;

  function mint(address to, uint256 amount) external {
    balanceOf[to] += amount;
    totalSupply += amount;
  }

  function approve(address spender, uint256 amount) external returns (bool) {
    allowance[msg.sender][spender] = amount;
    return true;
  }

  function transfer(address, uint256) external pure returns (bool) {
    return false; // ← Always false
  }

  function transferFrom(address, address, uint256) external pure returns (bool) {
    return false; // ← Always false
  }
}

/// @notice Doesn't return anything from transfer (like the original
///         mainnet USDT pre-2017). SafeERC20 handles this correctly by
///         checking returndatasize.
///         transfer가 아무것도 반환 안 함 (2017년 이전 메인넷 USDT처럼).
///         SafeERC20이 returndatasize 검사로 올바로 처리.
contract NoReturnERC20 {
  string public name = "NoReturn";
  string public symbol = "NORET";
  uint8 public decimals = 18;
  uint256 public totalSupply;
  mapping(address => uint256) public balanceOf;
  mapping(address => mapping(address => uint256)) public allowance;

  function mint(address to, uint256 amount) external {
    balanceOf[to] += amount;
    totalSupply += amount;
  }

  function approve(address spender, uint256 amount) external returns (bool) {
    allowance[msg.sender][spender] = amount;
    return true;
  }

  function transfer(address to, uint256 amount) external {
    require(balanceOf[msg.sender] >= amount, "balance");
    balanceOf[msg.sender] -= amount;
    balanceOf[to] += amount;
    // No return statement — SafeERC20 must handle returndatasize == 0
  }

  function transferFrom(address from, address to, uint256 amount) external {
    require(allowance[from][msg.sender] >= amount, "allowance");
    require(balanceOf[from] >= amount, "balance");
    allowance[from][msg.sender] -= amount;
    balanceOf[from] -= amount;
    balanceOf[to] += amount;
    // No return statement
  }
}

/// @notice Reports a balance that is much larger than reality. Tests
///         that production code which reads `balanceOf` for policy
///         decisions (e.g. holder-discount eligibility) is not tricked
///         into granting benefits it shouldn't — although strictly
///         speaking, the discount check is intentional ("if you hold X,
///         you get Y"), so a malicious token in the discount slot can
///         only harm itself, not the protocol's funds.
///
///         실제보다 훨씬 큰 잔액을 보고. 정책 결정(예: 할인 자격)에
///         `balanceOf`를 사용하는 production 코드가 부당한 혜택을 주지
///         않는지 검증. 엄격히 말해 할인 체크는 "이거 보유하면 그거 받음"
///         의도된 정책이므로, 악성 토큰이 할인 슬롯에 들어가도 자기 자신을
///         해할 뿐 프로토콜 자금에는 위협 안 됨.
contract LyingBalanceERC20 {
  string public name = "LyingBalance";
  string public symbol = "LIES";
  uint8 public decimals = 18;
  uint256 public totalSupply = 1;
  uint256 public reportedBalance;

  constructor(uint256 _reportedBalance) {
    reportedBalance = _reportedBalance;
  }

  function balanceOf(address) external view returns (uint256) {
    return reportedBalance;
  }

  function transfer(address, uint256) external pure returns (bool) {
    return true;
  }

  function approve(address, uint256) external pure returns (bool) {
    return true;
  }

  function transferFrom(address, address, uint256) external pure returns (bool) {
    return true;
  }
}

/// @notice Calls back into the caller during transfer, simulating a
///         reentrant ERC-20. Verifies that production code is protected
///         by `nonReentrant`.
///         transfer 중 caller로 콜백, 재진입 공격 ERC-20 시뮬레이션.
///         production 코드가 `nonReentrant`로 보호되는지 검증.
contract ReentrantERC20 is ERC20 {
  address public reentryTarget;
  bytes public reentryCalldata;
  bool public attackArmed;

  constructor(string memory n, string memory s) ERC20(n, s) {}

  function mint(address to, uint256 amount) external { _mint(to, amount); }

  /// @notice Configure the reentry payload. The next transfer will call
  ///         `target.call(payload)` after balance updates.
  function armReentry(address target, bytes calldata payload) external {
    reentryTarget = target;
    reentryCalldata = payload;
    attackArmed = true;
  }

  function _update(address from, address to, uint256 value) internal override {
    super._update(from, to, value);
    if (attackArmed && reentryTarget != address(0)) {
      attackArmed = false; // single-shot
      (bool ok, ) = reentryTarget.call(reentryCalldata);
      ok; // result ignored — we only care about whether reentry succeeds
    }
  }
}
