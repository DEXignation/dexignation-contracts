// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — DXReservations
//
// Reserved-label registry. Tracks which labels are blocked from normal
// open registration, typically because:
//   - they correspond to a known brand / trademark held by a third party
//     ("samsung", "binance", "kbbank") and DEXignation chooses to let the
//     legitimate holder claim them through a separate verified flow;
//   - they are protocol-owned premium labels held back for a planned
//     auction or batch sale;
//   - they have been flagged for policy reasons (offensive content,
//     country names with disputed status, etc.).
//
// Once an auction or claim flow finalises, the auction contract calls
// `releaseLabel()` so the label becomes openly registrable.
//
// 예약 라벨 레지스트리. 일반 공개 등록에서 차단되는 라벨을 추적한다.
// 사유 예시:
//   - 제3자 상표(예: "samsung", "binance", "kbbank") — 합법적 보유자가
//     별도의 검증 절차로 클레임할 수 있도록 보류
//   - 프로토콜이 보유한 프리미엄 라벨로 경매·일괄 판매 대기
//   - 정책상 차단 라벨
//
// 경매·클레임 절차가 끝나면 경매 컨트랙트가 `releaseLabel()`을 호출하여
// 일반 등록을 열어준다.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title  DXReservations
/// @notice Append-only-ish registry of reserved labelhashes with an
///         optional reason code. Each entry can be released exactly once
///         by the owner or by an authorised auction contract.
///
///         예약된 labelhash 레지스트리. 각 엔트리는 owner 또는 권한 부여된
///         경매 컨트랙트가 한 번만 해제할 수 있다.
contract DXReservations is Ownable {

  enum ReservationReason {
    None,
    Trademark,        // 1
    Premium,          // 2
    Policy,           // 3
    Custom            // 4
  }

  struct Reservation {
    bool reserved;
    ReservationReason reason;
    address claimableBy;   // 0 = no specific claimant
    uint64 createdAt;
  }

  /// @dev labelhash => reservation entry
  mapping(bytes32 => Reservation) public reservations;

  /// @dev Auction/claim contracts authorised to call `releaseLabel`.
  ///      예약 해제 권한을 위임받은 컨트랙트(주로 경매 컨트랙트).
  mapping(address => bool) public releasers;

  event LabelReserved(
    bytes32 indexed labelhash,
    ReservationReason indexed reason,
    address claimableBy
  );
  event ClaimableByUpdated(bytes32 indexed labelhash, address claimableBy);
  event LabelReleased(bytes32 indexed labelhash, address indexed releasedBy);
  event ReleaserSet(address indexed releaser, bool allowed);

  error AlreadyReserved(bytes32 labelhash);
  error NotReserved(bytes32 labelhash);
  error NotAuthorised();

  constructor() Ownable(msg.sender) {}

  /// @notice Mark a label as reserved. Owner-only.
  ///         라벨을 예약 상태로 표시. 오너 전용.
  function reserveLabel(
    string calldata label,
    ReservationReason reason,
    address claimableBy
  ) external onlyOwner {
    bytes32 lh = keccak256(bytes(label));
    if (reservations[lh].reserved) revert AlreadyReserved(lh);
    reservations[lh] = Reservation({
      reserved: true,
      reason: reason,
      claimableBy: claimableBy,
      createdAt: uint64(block.timestamp)
    });
    emit LabelReserved(lh, reason, claimableBy);
  }

  /// @notice Bulk reservation for efficient setup.
  ///         초기 셋업 효율을 위한 일괄 예약.
  function reserveLabels(
    string[] calldata labels,
    ReservationReason reason
  ) external onlyOwner {
    uint256 len = labels.length;
    for (uint256 i = 0; i < len; i++) {
      bytes32 lh = keccak256(bytes(labels[i]));
      if (reservations[lh].reserved) revert AlreadyReserved(lh);
      reservations[lh] = Reservation({
        reserved: true,
        reason: reason,
        claimableBy: address(0),
        createdAt: uint64(block.timestamp)
      });
      emit LabelReserved(lh, reason, address(0));
    }
  }

  /// @notice Update the authorised claimant for an existing reservation.
  ///         예약을 해제하지 않고 기존 예약 라벨의 클레임 자격자를 변경한다.
  /// @dev    Passing address(0) clears the claimant and blocks all claimants.
  ///         address(0)을 넘기면 클레임 자격자가 없어져 모두 차단된다.
  function setClaimableBy(
    string calldata label,
    address claimableBy
  ) external onlyOwner {
    bytes32 lh = keccak256(bytes(label));
    if (!reservations[lh].reserved) revert NotReserved(lh);
    reservations[lh].claimableBy = claimableBy;
    emit ClaimableByUpdated(lh, claimableBy);
  }

  /// @notice Release a previously reserved label. Owner or authorised
  ///         releaser only.
  ///         예약을 해제. 오너 또는 권한 받은 releaser만 호출 가능.
  function releaseLabel(string calldata label) external {
    if (msg.sender != owner() && !releasers[msg.sender]) revert NotAuthorised();
    bytes32 lh = keccak256(bytes(label));
    if (!reservations[lh].reserved) revert NotReserved(lh);
    delete reservations[lh];
    emit LabelReleased(lh, msg.sender);
  }

  /// @notice Authorise / revoke a releaser (typically an auction contract).
  ///         경매 등 외부 컨트랙트의 해제 권한 부여/회수.
  function setReleaser(address releaser, bool allowed) external onlyOwner {
    releasers[releaser] = allowed;
    emit ReleaserSet(releaser, allowed);
  }

  // ── View helpers / 조회 헬퍼 ────────────────────────────────────────────────

  /// @notice True if the label is currently reserved.
  ///         라벨이 현재 예약 상태이면 true.
  function isReserved(string calldata label) external view returns (bool) {
    return reservations[keccak256(bytes(label))].reserved;
  }

  /// @notice True if the label is reserved AND `claimant` is the address
  ///         allowed to claim it (e.g. via auction or trademark proof).
  ///         라벨이 예약 상태이고 `claimant`가 클레임 자격자이면 true.
  function isClaimableBy(string calldata label, address claimant)
    external
    view
    returns (bool)
  {
    Reservation memory r = reservations[keccak256(bytes(label))];
    return r.reserved && r.claimableBy != address(0) && r.claimableBy == claimant;
  }
}
