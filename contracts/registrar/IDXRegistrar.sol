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
//   - Custom errors throughout.
//     전반에 걸친 커스텀 에러 사용.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";

/// @title  IDXRegistrar
/// @notice Interface for DEXignation's ERC-721 backed name registrar.
///         ERC-721 기반 DEXignation 네임 Registrar 인터페이스.
interface IDXRegistrar is IERC721 {

  // ── Events ────────────────────────────────────────────────────────────────

  event ControllerAdded(address indexed controller);
  event ControllerRemoved(address indexed controller);
  event NameRegistered(uint256 indexed id, address indexed owner, uint256 expires);
  event NameRenewed(uint256 indexed id, uint256 expires);

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

  // ── Functions ─────────────────────────────────────────────────────────────

  function addController(address controller) external;
  function removeController(address controller) external;
  function setResolver(address resolver) external;
  function nameExpires(uint256 id) external view returns (uint256);
  function available(uint256 id) external view returns (bool);

  /// @notice Grace period (in seconds) after expiry during which the
  ///         previous owner may still renew.
  ///         만료 후에도 이전 소유자가 갱신할 수 있는 유예 기간(초).
  function GRACE_PERIOD() external view returns (uint256);

  function register(
    string calldata label,
    uint256 id,
    address owner,
    uint256 duration
  ) external returns (uint256);

  function renew(uint256 id, uint256 duration) external returns (uint256);

  function reclaim(uint256 id, address owner) external;
}
