// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — DXNToken
//
// DXN is the protocol's ERC-20 governance / utility token.
//
// IMPORTANT — legal & operational note:
//   This contract is a *framework skeleton*. The semantics that determine
//   whether DXN counts as a security in any given jurisdiction — what
//   holders receive, who controls emission, how distribution happens —
//   are policy decisions that must be made *before* deployment. The code
//   does not encode any utility/revenue-share commitment; it only provides
//   the on-chain plumbing (mintable supply with a hard cap, ERC-20Votes
//   for off-chain or on-chain governance, and a single-owner pause hook
//   if needed via inheritance).
//
//   Do NOT deploy this contract publicly until:
//     1. A token economic model has been written down and reviewed.
//     2. Legal counsel has reviewed it in every jurisdiction where DEXignation
//        operates (Korea: 가상자산이용자보호법 / 자본시장법 검토 필수).
//     3. A vesting / distribution schedule has been defined.
//     4. Mint authority has been moved to a multisig or governance contract.
//
// 중요 — 법무·운영 안내:
//   본 컨트랙트는 *프레임워크 골격*입니다. DXN이 어느 관할에서 증권성으로
//   분류될지는 *배포 전* 결정되어야 할 정책 사안입니다. 코드 자체는
//   utility/수익분배 약속을 인코딩하지 않으며, 다음 인프라만 제공합니다:
//     - 하드캡이 있는 mintable supply
//     - ERC20Votes (오프체인/온체인 거버넌스 모두 지원)
//     - 필요 시 상속을 통한 pause 가능
//
//   다음 4가지가 완료되기 전에는 절대 공개 배포하지 마십시오:
//     1. 토큰 경제 모델 문서화 및 내부 검토
//     2. 운영 관할 법규 검토 (한국: 가상자산이용자보호법 / 자본시장법 검토)
//     3. vesting / distribution 일정 확정
//     4. mint 권한이 단일 owner에서 multisig 또는 거버넌스 컨트랙트로 이전
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {ERC20Votes} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/// @title  DXNToken
/// @notice ERC-20 governance token with EIP-2612 permit and ERC-20 Votes
///         for snapshot-based governance.
///
///         EIP-2612 permit과 ERC-20 Votes(스냅샷 기반 거버넌스 지원)를 가진
///         ERC-20 거버넌스 토큰.
contract DXNToken is ERC20, ERC20Permit, ERC20Votes, Ownable {

  /// @notice Hard cap on total supply. The mint function refuses to push
  ///         supply beyond this value.
  ///         총 발행량 하드캡. 이 값을 넘는 mint는 거부.
  uint256 public immutable cap;

  /// @notice Set of addresses with mint authority. The deployer is added
  ///         in the constructor; ownership of the mint capability can be
  ///         transferred to a governance contract by removing the deployer
  ///         and adding the new minter.
  ///
  ///         mint 권한을 가진 주소 집합. 배포자는 생성자에서 추가되며,
  ///         나중에 거버넌스 컨트랙트로 이전하려면 배포자 제거 + 신규
  ///         minter 추가의 두 단계로 수행.
  mapping(address => bool) public minters;

  event MinterSet(address indexed minter, bool allowed);

  error NotMinter(address caller);
  error CapExceeded(uint256 attempted, uint256 cap);
  error ZeroAddress();

  /// @param name_     ERC-20 token name. / 토큰 이름.
  /// @param symbol_   ERC-20 token symbol (e.g. "DXN"). / 심볼.
  /// @param cap_      Total supply cap (in wei units; for 18-decimals
  ///                  tokens this is `tokens * 1e18`). Must fit in uint208
  ///                  because ERC20Votes packs voting units into uint208.
  ///                  18 decimals 기준 `tokens * 1e18`. ERC20Votes가 uint208에
  ///                  voting unit을 패킹하므로 그 한도 내여야 한다.
  constructor(
    string memory name_,
    string memory symbol_,
    uint256 cap_
  )
    ERC20(name_, symbol_)
    ERC20Permit(name_)
    Ownable(msg.sender)
  {
    if (cap_ == 0) revert CapExceeded(0, 0);
    if (cap_ > type(uint208).max) revert CapExceeded(cap_, type(uint208).max);
    cap = cap_;
    minters[msg.sender] = true;
    emit MinterSet(msg.sender, true);
  }

  /// @notice Authorise or revoke a minter. Owner-only.
  ///         minter 권한 부여/회수. 오너 전용.
  function setMinter(address minter, bool allowed) external onlyOwner {
    if (minter == address(0)) revert ZeroAddress();
    minters[minter] = allowed;
    emit MinterSet(minter, allowed);
  }

  /// @notice Mint new DXN to `to`. Caller must be an authorised minter.
  ///         Reverts if the post-mint supply would exceed `cap`.
  ///         DXN을 신규 발행하여 `to`에게 전달. minter만 호출 가능.
  ///         발행 후 총량이 cap을 넘으면 revert.
  function mint(address to, uint256 amount) external {
    if (!minters[msg.sender]) revert NotMinter(msg.sender);
    uint256 newSupply = totalSupply() + amount;
    if (newSupply > cap) revert CapExceeded(newSupply, cap);
    _mint(to, amount);
  }

  // ── Solidity multi-inheritance plumbing / 다중 상속 plumbing ────────────────

  /// @dev Override ERC20Votes's default `_maxSupply` (uint208.max) so the
  ///      voting-units machinery also enforces our business cap. With this
  ///      override, attempting to mint beyond `cap` reverts via either our
  ///      `CapExceeded` (in `mint`) or the inherited `ERC20ExceededSafeSupply`
  ///      from ERC20Votes — both reachable, but the cheaper path triggers
  ///      first.
  ///
  ///      ERC20Votes의 기본 `_maxSupply`(uint208.max)를 우리 비즈니스 cap으로
  ///      override. cap 초과 mint 시 `CapExceeded` 또는 `ERC20ExceededSafeSupply`
  ///      중 하나로 revert.
  function _maxSupply() internal view override returns (uint256) {
    return cap;
  }

  function _update(
    address from,
    address to,
    uint256 value
  ) internal override(ERC20, ERC20Votes) {
    super._update(from, to, value);
  }

  function nonces(address owner)
    public
    view
    override(ERC20Permit, Nonces)
    returns (uint256)
  {
    return super.nonces(owner);
  }
}
