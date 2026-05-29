// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — IDXResolver
//
// Loosely inspired by ENS resolver profile interfaces (MIT,
// https://github.com/ensdomains/ens-contracts). The DEXignation resolver is
// a single, slim contract rather than a multi-profile composition, so the
// interface is original work.
//
// Copyright (c) 2026 DEXignation, MIT License.
//
// ENS 리졸버 프로파일 인터페이스 (MIT)에서 컨셉을 차용했으나, DEXignation
// 리졸버는 다중 프로파일 합성 대신 단일 슬림 컨트랙트라 인터페이스는
// 신규 작성.
// 본 파일은 © 2026 DEXignation, MIT License.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

interface IDXResolver {

  // ── Events ────────────────────────────────────────────────────────────────

  /// @dev Emitted when a `(node, coinType)` address record changes.
  ///      `(node, coinType)` 주소 레코드가 변경될 때.
  event AddrChanged(
    bytes32 indexed node,
    uint256 indexed coinType,
    bytes addrBytes
  );

  /// @dev Emitted when an operator approval is set.
  ///      operator 승인이 설정될 때.
  event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

  /// @dev Emitted when a reverse name is set or cleared.
  ///      역방향 이름이 설정/제거될 때.
  event NameChanged(bytes32 indexed node, string name);

  /// @dev Emitted when a text record changes. Follows EIP-634.
  ///      텍스트 레코드가 변경될 때. EIP-634 준수.
  event TextChanged(
    bytes32 indexed node,
    string indexed indexedKey,
    string key,
    string value
  );

  /// @dev Emitted when a contenthash record changes. Follows EIP-1577.
  ///      contenthash 레코드가 변경될 때. EIP-1577 준수.
  event ContenthashChanged(bytes32 indexed node, bytes hash);

  // ── Errors ────────────────────────────────────────────────────────────────

  /// @dev Caller is not authorised for this node.
  ///      호출자가 해당 노드에 대한 권한이 없음.
  error Unauthorized();

  /// @dev Address bytes are not 0 or 20 length for an EVM coin type.
  ///      EVM 코인 타입인데 주소 바이트 길이가 0 또는 20이 아님.
  error InvalidEVMAddress(uint256 coinType, bytes addr);

  /// @dev Text record key exceeds the configured maximum length.
  ///      텍스트 레코드 키가 허용 최대 길이를 초과.
  error TextKeyTooLong(uint256 length, uint256 maxLength);

  /// @dev Text record value exceeds the configured maximum length.
  ///      텍스트 레코드 값이 허용 최대 길이를 초과.
  error TextValueTooLong(uint256 length, uint256 maxLength);

  /// @dev Contenthash exceeds the configured maximum length.
  ///      contenthash가 허용 최대 길이를 초과.
  error ContenthashTooLong(uint256 length, uint256 maxLength);

  // ── Address records (ENSIP-9/11) ──────────────────────────────────────────

  function setAddr(
    bytes32 node,
    uint256 coinType,
    bytes calldata addrBytes
  ) external;

  function addr(
    bytes32 node,
    uint256 coinType
  ) external view returns (bytes memory);

  function hasAddr(
    bytes32 node,
    uint256 coinType
  ) external view returns (bool);

  // ── Reverse records ───────────────────────────────────────────────────────

  function name(bytes32 node) external view returns (string memory);

  function setName(bytes32 node, string calldata newName) external;

  // ── Text records (EIP-634) ────────────────────────────────────────────────

  /// @notice Read a text record. Returns empty string if not set or
  ///         the node is expired.
  ///         텍스트 레코드 읽기. 미설정이거나 만료된 경우 빈 문자열 반환.
  /// @param  node namehash of the .dex name
  /// @param  key  free-form key (e.g. "url", "com.twitter", "avatar")
  function text(
    bytes32 node,
    string calldata key
  ) external view returns (string memory);

  /// @notice Set a text record. Empty value deletes the record.
  ///         텍스트 레코드 설정. 빈 값이면 삭제.
  function setText(
    bytes32 node,
    string calldata key,
    string calldata value
  ) external;

  // ── Content records (EIP-1577) ────────────────────────────────────────────

  /// @notice Read the contenthash record. Returns empty bytes if not set
  ///         or the node is expired.
  ///         contenthash 읽기. 미설정/만료 시 빈 바이트.
  function contenthash(bytes32 node) external view returns (bytes memory);

  /// @notice Set the contenthash. Empty bytes deletes the record.
  ///         The encoding follows EIP-1577 (multicodec-prefixed CIDs for
  ///         IPFS/IPNS/Swarm/Arweave content references).
  ///         contenthash 설정. 빈 바이트면 삭제. EIP-1577 인코딩 사용
  ///         (IPFS/IPNS/Swarm/Arweave를 multicodec prefix로 구분).
  function setContenthash(bytes32 node, bytes calldata hash) external;

  // ── Approval ──────────────────────────────────────────────────────────────

  function setApprovalForAll(address operator, bool approved) external;

  function isApprovedForAll(address owner, address operator) external view returns (bool);

  // ── ERC-165 ───────────────────────────────────────────────────────────────

  function supportsInterface(bytes4 interfaceId) external view returns (bool);
}
