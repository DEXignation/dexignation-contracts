// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — IDXRegistrar
//
// Derived from the ENS `BaseRegistrar` interface
//   Source : https://github.com/ensdomains/ens-contracts
//   File   : contracts/ethregistrar/BaseRegistrar.sol
//   © 2018-2024 Nick Johnson / ENS Labs, MIT License
//
// Modifications Copyright (c) 2026 DEXignation, licensed under MIT.
//
// 이 인터페이스는 ENS `BaseRegistrar` (MIT)에서 파생되었습니다.
// 변경 부분은 © 2026 DEXignation, MIT License 하에 배포됩니다.
//
// Notable changes / 주요 변경사항:
//   - `register()` takes the original `label` string so it can be stored
//     for on-chain SVG `tokenURI` rendering.
//     `register()`가 원본 `label` 문자열을 인자로 받아 온체인 SVG tokenURI
//     렌더링에 사용한다.
//   - Voluntary `burn()` allowed after `expiry + grace` so holders can
//     surrender stale domains and clear them from NFT marketplaces (ADR-012).
//     만료+유예 이후 보유자가 자발적으로 `burn()` 호출 가능, NFT 마켓
//     플레이스에서 stale 항목 정리 (ADR-012).
//   - Custom errors throughout.
//     전반에 걸친 커스텀 에러 사용.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {IERC4906} from "@openzeppelin/contracts/interfaces/IERC4906.sol";

/// @title  IDXRegistrar
/// @notice Interface for DEXignation's ERC-721 backed name registrar.
///         ERC-721 기반 DEXignation 네임 Registrar 인터페이스.
interface IDXRegistrar is IERC4906 {

  // ── Events ────────────────────────────────────────────────────────────────

  event ControllerAdded(address indexed controller);
  event ControllerRemoved(address indexed controller);
  event NameRegistered(uint256 indexed id, address indexed owner, uint256 expires);
  event NameRenewed(uint256 indexed id, uint256 expires);

  /// @dev Emitted when an expired token is burned, either by the
  ///      previous holder voluntarily or implicitly during re-registration.
  ///      만료 토큰이 소각될 때 (자발적 또는 재등록 중 묵시적).
  event NameBurned(uint256 indexed id, address indexed burner);

  // ── Errors ────────────────────────────────────────────────────────────────

  /// @dev This contract does not own the TLD node in the registry.
  ///      이 컨트랙트가 레지스트리의 TLD 소유자가 아님.
  error NotBaseNodeOwner();

  /// @dev Caller is not a whitelisted controller.
  ///      호출자가 화이트리스트된 컨트롤러가 아님.
  error UnauthorizedController();

  /// @dev Name is not available (still in expiry+grace window).
  ///      이름이 사용 불가 (만료+유예 기간 내).
  error NameNotAvailable(uint256 id);

  /// @dev Duration parameter is zero or causes overflow.
  ///      duration이 0이거나 오버플로우 유발.
  error InvalidDuration();

  /// @dev Token has no owner (already burned or never minted).
  ///      토큰 소유자가 없음 (소각되었거나 발행된 적 없음).
  error TokenOwnerNotFound();

  /// @dev Caller is not authorised for this token.
  ///      이 토큰에 대해 권한 없음.
  error Unauthorized();

  /// @dev Token is past its expiry timestamp.
  ///      토큰이 만료됨.
  error TokenExpired(uint256 tokenId);

  /// @dev Burn attempted before `expiry + GRACE_PERIOD`.
  ///      만료+유예 기간 이전에 burn 시도.
  error NotYetBurnable(uint256 tokenId, uint256 burnableAt);

  // ── Functions ─────────────────────────────────────────────────────────────

  function addController(address controller) external;
  function removeController(address controller) external;
  function setResolver(address resolver) external;
  function nameExpires(uint256 id) external view returns (uint256);
  function available(uint256 id) external view returns (bool);

  /// @notice Grace period (in seconds) after expiry during which the
  ///         previous owner may still renew.
  ///         만료 후에도 이전 소유자가 갱신할 수 있는 유예 기간(초).
  function gracePeriod() external view returns (uint256);

  function register(
    string calldata label,
    uint256 id,
    address owner,
    uint256 duration
  ) external returns (uint256);

  function renew(uint256 id, uint256 duration) external returns (uint256);

  function reclaim(uint256 id, address owner) external;

  function notifyMetadataUpdate(uint256 id) external;

  /// @notice Burn an expired domain NFT after the grace period has passed.
  ///         만료된 도메인 NFT를 유예 기간 이후 소각.
  /// @dev    Permissionless: anyone can burn an expired token. This allows
  ///         NFT marketplaces and aggregators to clean up stale listings
  ///         without requiring action from the original holder.
  ///         The label string and expiry are deleted along with the token.
  ///         권한 불필요: 만료된 토큰은 누구나 burn 가능. NFT 마켓 등이
  ///         stale 항목을 보유자 행동 없이 정리 가능.
  ///         라벨 문자열과 expiry도 함께 삭제됨.
  /// @param  id tokenId (labelhash as uint256)
  function burn(uint256 id) external;
}
