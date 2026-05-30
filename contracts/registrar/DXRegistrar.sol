// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — DXRegistrar
//
// Portions of this contract are derived from the ENS `BaseRegistrarImplementation`,
// originally authored by Nick Johnson and the ENS Labs team, licensed under MIT.
//   Source : https://github.com/ensdomains/ens-contracts
//   File   : contracts/ethregistrar/BaseRegistrarImplementation.sol
//   © 2018-2024 Nick Johnson / ENS Labs
//
// Modifications and additions Copyright (c) 2026 DEXignation, licensed under MIT.
//
// 이 컨트랙트의 일부는 ENS `BaseRegistrarImplementation` (Nick Johnson 및
// ENS Labs, MIT)에서 파생되었습니다. 변경 및 추가 부분은 © 2026 DEXignation,
// MIT License 하에 배포됩니다.
//
// Notable additions by DEXignation / DEXignation의 주요 추가사항:
//   1. Fully on-chain SVG `tokenURI`. ENS NFT metadata is served off-chain;
//      DEXignation embeds the artwork in the contract itself, removing any
//      reliance on external hosting.
//      tokenURI 메타데이터를 모두 온체인에서 생성한다 (Base64 인코딩된 SVG).
//      ENS는 메타데이터를 오프체인에서 제공하지만 DEXignation은 외부 호스팅
//      의존성을 제거하기 위해 컨트랙트 내부에 직접 임베드한다.
//   2. `register()` takes the human-readable `label` so it can be stored
//      for tokenURI rendering. ENS does not store the original label.
//      `register()`가 사람이 읽을 수 있는 `label`을 인자로 받아 저장한다.
//      ENS는 원본 라벨을 저장하지 않지만 DEXignation은 tokenURI 렌더링을
//      위해 보관한다.
//   3. Custom errors replace `require()` calls.
//      가스 효율을 위해 `require` 대신 커스텀 에러를 사용.
//   4. `gracePeriod` set to 70 days (ENS uses 90 days). This is a product
//      decision aligned with DEXignation's renewal policy. Owner can adjust
//      via `setGracePeriod()` if needed.
//      유예 기간은 70일 (ENS는 90일). 제품 정책에 맞춘 결정. 필요시 owner가
//      `setGracePeriod()`로 조정 가능.
//   5. Permissionless `burn()` after `expiry + gracePeriod`. Anyone may
//      burn a fully-expired token so NFT marketplaces and indexers can
//      clear stale listings without requiring action from the previous
//      holder. The implicit burn inside `register()` also emits
//      `NameBurned` for consistency (ADR-012).
//      만료+유예 이후 누구나 호출 가능한 `burn()`. 마켓/인덱서가 보유자
//      행동 없이 stale 항목 정리 가능. `register()` 내 묵시적 burn도
//      일관성을 위해 `NameBurned` 이벤트 emit (ADR-012).
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import {IDXRegistrar} from "./IDXRegistrar.sol";
import {IDXRegistry} from "../registry/IDXRegistry.sol";

/// @title  DXRegistrar
/// @notice Issues 2LD names under a given TLD (`.dex`) as ERC-721 tokens.
///         Lifecycle (register / renew / expiry / grace) is enforced here.
///         EIP-2981 royalty info is exposed so secondary marketplaces
///         (OpenSea, Magic Eden, etc.) can route a configurable share of
///         resale proceeds to the protocol treasury.
///
///         주어진 TLD(`.dex`) 하위의 2LD 이름을 ERC-721 NFT로 발행한다.
///         도메인 생명주기(등록/갱신/만료/유예) 담당. EIP-2981 royalty 정보를
///         노출하여 2차 마켓플레이스가 재판매 수익의 일부를 프로토콜
///         금고로 자동 라우팅하도록 한다.
contract DXRegistrar is ERC721, ERC2981, IDXRegistrar, Ownable {
  IDXRegistry public immutable registry;

  /// @notice namehash of the TLD this registrar governs (e.g. namehash("dex")).
  ///         이 Registrar가 관할하는 TLD의 namehash.
  bytes32 public immutable baseNode;

  /// @notice Human-readable form of the TLD (e.g. "dex").
  ///         TLD의 사람이 읽을 수 있는 형태.
  string public baseNodeName;

  /// @dev tokenId (== labelhash as uint256) => expiry timestamp.
  ///      tokenId에 대응하는 도메인의 만료 시각.
  mapping(uint256 => uint256) expiries;

  /// @dev tokenId => original label string. Used by `tokenURI`.
  ///      tokenId에 대응하는 원본 label 문자열. tokenURI 렌더링용.
  mapping(uint256 => string) names;

  /// @dev tokenId => highest tier ever reached (0=charcoal..4=gold). The card
  ///      color is a "best ever" badge: it ratchets UP when a registration or
  ///      renewal extends the total guaranteed duration into a higher tier, and
  ///      never ratchets down as time passes. (An expired name still shows red,
  ///      handled separately in tokenURI.) This makes the color a durable status
  ///      symbol — buying 15 years earns gold permanently, and 3y+3y renewals
  ///      climb from mud to yellow.
  ///      tokenId => 역대 최고 등급(0=charcoal..4=gold). 카드 색은 "역대 최고"
  ///      배지: 등록·갱신으로 총 보장 기간이 더 높은 등급에 도달하면 올라가고,
  ///      시간이 지나도 내려가지 않는다. (만료된 이름은 tokenURI에서 별도로 red.)
  ///      15년 구매 = 영구 골드, 3년+3년 갱신 = mud→yellow 상승.
  mapping(uint256 => uint8) public highestTier;

  /// @dev Whitelisted controller contracts (e.g. `DXRegistrarController`).
  ///      도메인 등록·갱신을 위임받은 컨트롤러 화이트리스트.
  mapping(address => bool) public controllers;

  /// @notice Grace period after expiry during which renewal is still allowed.
  ///         Owner can adjust this value if needed (7 days ~ 365 days).
  ///         만료 후에도 갱신을 허용하는 유예 기간: 초기값 70일.
  ///         필요시 owner가 `setGracePeriod()`로 7일~365일 범위에서 조정 가능.
  uint256 public gracePeriod = 70 days;

  /// @notice Initial royalty: 2.5% (250 / 10_000). Owner can update via
  ///         `setRoyaltyInfo`. Capped at 10% in the setter to prevent
  ///         hostile rates.
  ///         초기 royalty 2.5%. 오너가 `setRoyaltyInfo`로 변경 가능하며,
  ///         setter에서 10%로 상한.
  uint96 public constant INITIAL_ROYALTY_BPS = 250;
  uint96 public constant MAX_ROYALTY_BPS = 1000; // 10%

  error RoyaltyTooHigh(uint96 requested, uint96 max);
  error GracePeriodOutOfRange(uint256 requested, uint256 min, uint256 max);

  event GracePeriodUpdated(uint256 indexed newGracePeriod);

  constructor(IDXRegistry _registry, bytes32 _baseNode, string memory _baseNodeName)
    ERC721("DEXignation", "DEX")
    Ownable(msg.sender)
  {
    registry = _registry;
    baseNode = _baseNode;
    baseNodeName = _baseNodeName;

    // Default royalty recipient is the contract owner. Owner should call
    // `setRoyaltyInfo` to point at the treasury (or a Safe multisig)
    // once that destination is finalised.
    //
    // 기본 royalty 수령자는 컨트랙트 owner. treasury 또는 Safe multisig 주소가
    // 확정되면 owner가 `setRoyaltyInfo`로 지정.
    _setDefaultRoyalty(msg.sender, INITIAL_ROYALTY_BPS);
  }

  /// @notice Update the default royalty recipient and rate. Owner-only.
  ///         기본 royalty 수령자와 비율 변경. 오너 전용.
  /// @param receiver       Address to receive royalty payments (typically the
  ///                       treasury or a Safe multisig). / royalty 수령 주소.
  /// @param feeNumerator   Royalty in basis points (out of 10000). Capped
  ///                       at `MAX_ROYALTY_BPS` (10%). / 만분율.
  function setRoyaltyInfo(address receiver, uint96 feeNumerator)
    external onlyOwner
  {
    if (feeNumerator > MAX_ROYALTY_BPS) {
      revert RoyaltyTooHigh(feeNumerator, MAX_ROYALTY_BPS);
    }
    _setDefaultRoyalty(receiver, feeNumerator);
  }

  /// @notice Update the grace period (renewal window after expiry).
  ///         Owner-only. Must be between 7 days and 365 days.
  ///         유예 기간 조정. 오너 전용. 7일~365일 범위만 허용.
  /// @param _newGracePeriod   New grace period in seconds.
  function setGracePeriod(uint256 _newGracePeriod) external onlyOwner {
    uint256 minGrace = 7 days;
    uint256 maxGrace = 365 days;
    
    if (_newGracePeriod < minGrace || _newGracePeriod > maxGrace) {
      revert GracePeriodOutOfRange(_newGracePeriod, minGrace, maxGrace);
    }
    
    gracePeriod = _newGracePeriod;
    emit GracePeriodUpdated(_newGracePeriod);
  }

  /// @dev Reverts unless this contract currently owns the TLD node in the
  ///      registry. Prevents accidental operation if ownership has been moved.
  ///      이 컨트랙트가 레지스트리상 TLD의 소유자가 아니면 revert.
  modifier whenOwnsBaseNode() {
    if (registry.owner(baseNode) != address(this)) {
      revert NotBaseNodeOwner();
    }
    _;
  }

  /// @dev Reverts if `msg.sender` is not a whitelisted controller.
  ///      호출자가 화이트리스트된 컨트롤러가 아니면 revert.
  modifier onlyController() {
    if (!controllers[msg.sender]) {
      revert UnauthorizedController();
    }
    _;
  }

  /// @inheritdoc IDXRegistrar
  function addController(address controller) external override onlyOwner {
    controllers[controller] = true;
    emit ControllerAdded(controller);
  }

  /// @inheritdoc IDXRegistrar
  function removeController(address controller) external override onlyOwner {
    controllers[controller] = false;
    emit ControllerRemoved(controller);
  }

  /// @inheritdoc IDXRegistrar
  function setResolver(address resolver) external override onlyOwner {
    registry.setResolver(baseNode, resolver);
  }

  /// @inheritdoc IDXRegistrar
  function nameExpires(uint256 id) external view override returns (uint256) {
    return expiries[id];
  }

  /// @inheritdoc IDXRegistrar
  function available(uint256 id) public view override returns (bool) {
    return expiries[id] + gracePeriod < block.timestamp;
  }

  /// @notice Register a name. Only callable by a whitelisted controller.
  ///         이름을 등록한다. 화이트리스트된 컨트롤러만 호출 가능.
  /// @param label    The original label string (stored for tokenURI).
  ///                 tokenURI 렌더링을 위해 보관할 원본 라벨.
  /// @param id       Token id = uint256(keccak256(label)).
  /// @param owner    Final owner of the NFT / 최종 소유자.
  /// @param duration Registration duration in seconds / 등록 기간(초).
  function register(
    string calldata label,
    uint256 id,
    address owner,
    uint256 duration
  ) external override whenOwnsBaseNode onlyController returns (uint256) {
    if (!available(id)) revert NameNotAvailable(id);

    // Reject zero duration outright, and guard against `duration` values so
    // large that `block.timestamp + duration` would overflow `uint256`.
    //
    // Without this check, an extreme duration could silently wrap to a small
    // expiry, making the registered name immediately treatable as expired.
    // Solidity 0.8 already reverts on overflow for the addition itself, but
    // we surface a domain-specific `InvalidDuration` error so callers see a
    // meaningful failure.
    //
    // duration이 0이거나, `block.timestamp + duration`이 uint256을 넘어가
    // 오버플로우할 정도로 크면 거부한다. Solidity 0.8이 자동 revert지만
    // 의미 있는 에러로 바꿔준다.
    if (duration == 0) revert InvalidDuration();
    if (duration > type(uint256).max - block.timestamp - gracePeriod) {
      revert InvalidDuration();
    }

    // Burn any previously-owned token before re-minting (grace period passed).
    // Emit NameBurned for marketplaces/indexers to clear stale listings, then
    // overwrite names[id] / expiries[id] for the new registration.
    //   이전에 같은 id로 발행되었다가 만료된 토큰이 있으면 소각한다.
    //   마켓/인덱서가 stale 항목을 정리할 수 있도록 NameBurned 이벤트를
    //   emit한 뒤, 새 등록을 위해 names[id] / expiries[id]를 덮어쓴다.
    address prevOwner = _ownerOf(id);
    if (prevOwner != address(0)) {
        _burn(id);
        emit NameBurned(id, prevOwner);
    }

    expiries[id] = block.timestamp + duration;
    names[id] = label;

    // Set the card tier from the purchased duration. A fresh registration
    // overwrites any stale tier from a previously-expired/burned id.
    //   구매 기간으로 카드 등급 설정. 신규 등록은 이전(만료/소각) id의 잔여
    //   등급을 덮어쓴다.
    highestTier[id] = _tierOf(duration);

    _mint(owner, id);

    // Record subnode owner and expiry on the registry. Both calls require
    // this contract to be the parent (`baseNode`) owner, which is enforced
    // by `whenOwnsBaseNode`.
    //   레지스트리에 서브노드의 소유자와 만료 시각을 기록한다. 두 호출 모두
    //   부모(`baseNode`) 소유자만 가능하다.
    registry.setSubnodeOwner(baseNode, bytes32(id), owner);
    registry.setSubnodeExpires(baseNode, bytes32(id), expiries[id]);

    emit NameRegistered(id, owner, block.timestamp + duration);

    return block.timestamp + duration;
  }

  /// @notice Renew a name. The expiry is extended; ownership and resolver
  ///         records are not touched.
  ///         이름의 만료 시각만 연장한다. 소유자/리졸버는 건드리지 않는다.
  function renew(
    uint256 id,
    uint256 duration
  ) external override whenOwnsBaseNode onlyController returns (uint256) {
    // Must still be within (expiry + grace) to renew.
    //   유예 기간 이내여야 갱신 가능.
    if (expiries[id] + gracePeriod < block.timestamp) {
      revert NameNotAvailable(id);
    }

    // Reject zero duration, and guard against `expires + duration` overflow.
    //
    // duration이 0이거나, 누적 만료 시각이 uint256을 넘어 오버플로우할 정도로
    // 크면 거부한다.
    if (duration == 0) revert InvalidDuration();
    if (duration > type(uint256).max - expiries[id]) {
      revert InvalidDuration();
    }

    expiries[id] += duration;

    // Ratchet the card tier UP based on the new total guaranteed duration from
    // now until the (extended) expiry. Renewing 3y then 3y climbs mud→yellow.
    // Never ratchets down: the tier only increases.
    //   현재부터 (연장된) 만료까지의 총 보장 기간 기준으로 카드 등급을 상승.
    //   3년+3년 갱신은 mud→yellow로 오름. 절대 내려가지 않음.
    uint8 newTier = _tierOf(expiries[id] - block.timestamp);
    if (newTier > highestTier[id]) {
      highestTier[id] = newTier;
    }

    registry.setSubnodeExpires(baseNode, bytes32(id), expiries[id]);
    emit NameRenewed(id, expiries[id]);

    return expiries[id];
  }

  /// @notice If the ERC-721 token owner and the registry owner have drifted
  ///         (e.g. after a marketplace transfer), sync the registry back to
  ///         match the token holder.
  ///         ERC-721 소유자와 레지스트리 소유자가 어긋났을 때 레지스트리를
  ///         토큰 보유자로 다시 동기화한다 (마켓플레이스 거래 후 필수).
  function reclaim(uint256 id, address owner) external override whenOwnsBaseNode {
    address tokenOwner = ownerOf(id);
    if (tokenOwner == address(0)) {
      revert TokenOwnerNotFound();
    }
    if (!_isAuthorized(tokenOwner, msg.sender, id)) {
      revert Unauthorized();
    }

    registry.setSubnodeOwner(baseNode, bytes32(id), owner);
  }

  /// @notice Burn an expired domain NFT after the grace period has passed.
  ///         만료된 도메인 NFT를 유예 기간 이후 소각.
  /// @dev    Permissionless cleanup function. Anyone (not just the
  ///         previous holder) may call this to delete the ERC-721 token,
  ///         label string, and expiry record for a name whose lifetime
  ///         has fully ended.
  ///
  ///         Rationale: NFT marketplaces and aggregators index every
  ///         minted token. Without explicit burn, expired domains linger
  ///         as "ghost" listings even after they become re-registerable.
  ///         A permissionless burn lets community members (or automated
  ///         indexers) clean up at the cost of one transaction.
  ///
  ///         Safety: `available(id)` returns true iff `expiry + grace <
  ///         block.timestamp`, so this can never burn an active or
  ///         in-grace token. The previous holder retains full renewal
  ///         rights during the grace period.
  ///
  ///         Side effects: registry subnode owner is NOT cleared here —
  ///         it remains whatever the registry has, which after expiry
  ///         is considered "no owner" by `isExpired()` checks in
  ///         downstream contracts (Resolver, ReverseRegistrar).
  ///
  ///         권한 불필요 정리 함수. 만료+유예 종료된 토큰을 누구나 burn
  ///         가능. NFT 마켓이 stale 항목을 보유자 행동 없이 정리 가능.
  ///         `available(id)` 검사로 활성/유예 토큰은 burn 불가 보장.
  /// @param  id tokenId (labelhash as uint256)
  function burn(uint256 id) external override {
    address prevOwner = _ownerOf(id);
    if (prevOwner == address(0)) {
      revert TokenOwnerNotFound();
    }
    if (!available(id)) {
      revert NotYetBurnable(id, expiries[id] + gracePeriod + 1);
    }

    _burn(id);
    delete expiries[id];
    delete names[id];
    delete highestTier[id];

    emit NameBurned(id, prevOwner);
  }

  /// @notice ERC-721 `ownerOf` that also reverts when the token is expired.
  ///         만료된 토큰은 `ownerOf`도 revert하도록 오버라이드.
  function ownerOf(
    uint256 tokenId
  ) public view override(IERC721, ERC721) returns (address) {
    if (expiries[tokenId] <= block.timestamp) {
      revert TokenExpired(tokenId);
    }
    return super.ownerOf(tokenId);
  }

  /// @notice Fully on-chain NFT metadata. Returns a `data:` URI containing
  ///         Base64-encoded JSON, whose `image` field is a Base64-encoded
  ///         SVG rendered at call time.
  ///         완전히 온체인에서 생성되는 NFT 메타데이터. Base64 인코딩된 JSON
  ///         `data:` URI를 반환하며, `image` 필드는 호출 시점에 렌더된
  ///         Base64 인코딩된 SVG.
  function tokenURI(
    uint256 tokenId
  ) public view override returns (string memory) {
    _requireOwned(tokenId);
    string memory label = names[tokenId];
    if (bytes(label).length == 0) {
      label = "?";
    }
    string memory dotTld = string.concat(".", baseNodeName);

    // Color = the "best ever" tier this name has reached, EXCEPT once the name
    // is actually expired it shows red. The tier ratchets up on register/renew
    // and never down with the passage of time, so a 15-year buy stays gold even
    // years later — but a lapsed name is clearly flagged red.
    //   색 = 이 이름이 도달한 역대 최고 등급. 단, 실제로 만료되면 red. 등급은
    //   등록·갱신 때 오르고 시간 경과로는 안 내려가므로 15년 구매는 수년 뒤에도
    //   골드 유지 — 그러나 만료된 이름은 명확히 red로 표시.
    bool expired = expiries[tokenId] <= block.timestamp;
    uint8 tier = highestTier[tokenId];

    string memory svg = _generateSVG(label, dotTld, tier, expired);
    string memory tierName = _tierNameOf(tier, expired);

    string memory json = string.concat(
      '{"name":"', label, dotTld, '",'
      '"description":"DEXignation Name: ', label, dotTld,
      ' (', tierName, ' tier)",'
      '"attributes":[{"trait_type":"Tier","value":"', tierName, '"}],'
      '"image":"data:image/svg+xml;base64,',
      Base64.encode(bytes(svg)),
      '"}'
    );
    return string.concat(
      "data:application/json;base64,",
      Base64.encode(bytes(json))
    );
  }

  // ════════════════════════════════════════════════════════════════════════
  // On-chain SVG art — hexagonal card, tier-colored by remaining duration.
  //   온체인 SVG 아트 — 육각형 카드, 잔여 기간별 등급 색.
  //
  //   Tiers (by remaining seconds):
  //     expired      → red
  //     0–1 year     → charcoal
  //     1–3 years    → mud
  //     3–5 years    → burnt orange
  //     5–10 years   → yellow
  //     10 years+    → gold
  //
  //   No SVG <filter> is used (grain/shadow) so the art renders identically
  //   across marketplaces and wallets, and stays cheap to encode on-chain.
  //   Gradients, shine, and layered borders are kept. The name is shown in
  //   full, wrapping across up to 3 lines with a font size that scales to the
  //   label length so even a 50-character name fits the hex interior.
  //   필터(grain/shadow) 미사용 → 마켓플레이스·지갑에서 동일 렌더, 온체인
  //   인코딩 저렴. 그라데이션·shine·다층 테두리 유지. 이름은 전부 표시하며,
  //   길이에 따라 폰트가 줄고 최대 3줄로 줄바꿈해 50자도 육각 내부에 들어감.
  // ════════════════════════════════════════════════════════════════════════

  uint256 private constant ONE_YEAR_SECS = 365 days;

  /// @dev Map a guaranteed duration (seconds) to a tier index 0..4:
  ///      0=charcoal (<1y), 1=mud (<3y), 2=burnt orange (<5y),
  ///      3=yellow (<10y), 4=gold (>=10y). Used to ratchet `highestTier`.
  ///      보장 기간(초)을 등급 번호 0~4로 매핑. highestTier 상승 판정에 사용.
  function _tierOf(uint256 duration) internal pure returns (uint8) {
    // Use <= so an exact-N-year purchase lands in the intended tier:
    // exactly 1y → charcoal, 3y → mud, 5y → orange, 10y → yellow, 15y → gold.
    //   <= 사용: 정확히 N년 구매가 의도한 등급에 들어가도록.
    //   1년→charcoal, 3년→mud, 5년→orange, 10년→yellow, 15년→gold.
    if (duration <= 1 * ONE_YEAR_SECS) return 0;
    if (duration <= 3 * ONE_YEAR_SECS) return 1;
    if (duration <= 5 * ONE_YEAR_SECS) return 2;
    if (duration <= 10 * ONE_YEAR_SECS) return 3;
    return 4;
  }

  /// @dev Human-readable tier name for a tier index (0..4), or expired.
  ///      등급 번호(0~4)에 대한 사람이 읽는 등급명, 또는 만료.
  function _tierNameOf(uint8 tier, bool expired)
    internal
    pure
    returns (string memory)
  {
    if (expired) return "Expired";
    if (tier == 0) return "Charcoal";
    if (tier == 1) return "Mud";
    if (tier == 2) return "Burnt Orange";
    if (tier == 3) return "Yellow";
    return "Gold";
  }

  /// @dev Returns the three gradient stops (light/mid/dark), the accent
  ///      border color, and the text color for a tier index (or expired=red).
  ///      Light cards (yellow/gold) use dark text; dark cards use light text.
  ///      등급 번호(또는 만료=red)의 3단 그라데이션·테두리·글자색 반환.
  ///      밝은 카드(yellow/gold)는 어두운 글자, 어두운 카드는 밝은 글자.
  function _tierColorsOf(uint8 tier, bool expired)
    internal
    pure
    returns (
      string memory c0,
      string memory c1,
      string memory c2,
      string memory accent,
      string memory textColor
    )
  {
    if (expired) {
      return ("#ff3226", "#9e0907", "#280303", "#ff5040", "#ffffff");
    } else if (tier == 0) {
      return ("#888f93", "#202326", "#050607", "#9aa1a6", "#ffffff");
    } else if (tier == 1) {
      return ("#a37842", "#5a3f22", "#160d05", "#c79a5e", "#ffffff");
    } else if (tier == 2) {
      return ("#ff7a12", "#c64b00", "#2f0e00", "#ff9a4d", "#ffffff");
    } else if (tier == 3) {
      return ("#ffd02c", "#d6a300", "#382800", "#ffe070", "#3a2a00");
    } else {
      return ("#ffd875", "#b68427", "#352100", "#ffe9a0", "#3a2a00");
    }
  }

  /// @dev Generate the hexagonal SVG card. Pure: same (label, tier, expired)
  ///      always yields the same art.
  ///      육각형 SVG 카드 생성. pure: 같은 (label, tier, expired)은 항상 같은 아트.
  function _generateSVG(
    string memory label,
    string memory dotTld,
    uint8 tier,
    bool expired
  ) internal pure returns (string memory) {
    (
      string memory c0,
      string memory c1,
      string memory c2,
      string memory accent,
      string memory textColor
    ) = _tierColorsOf(tier, expired);

    // Hexagon points for a 400x400 canvas, centered, matching the DEX logo.
    //   400x400 캔버스 기준, DEX 로고 형태의 중앙 육각형 좌표.
    string memory hexPts = "200,40 340,130 340,310 200,400 60,310 60,130";
    string memory hexInner = "200,70 314,143 314,297 200,370 86,297 86,143";

    string memory head = string.concat(
      '<svg width="400" height="400" xmlns="http://www.w3.org/2000/svg">'
      '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
      '<stop offset="0%" stop-color="', c0, '"/>'
      '<stop offset="38%" stop-color="', c1, '"/>'
      '<stop offset="100%" stop-color="', c2, '"/>'
      '</linearGradient>'
      '<radialGradient id="sh" cx="38%" cy="22%" r="72%">'
      '<stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/>'
      '<stop offset="45%" stop-color="#ffffff" stop-opacity="0.05"/>'
      '<stop offset="100%" stop-color="#000000" stop-opacity="0"/>'
      '</radialGradient></defs>'
      '<rect width="400" height="400" fill="#0b0d0e"/>'
    );

    string memory frame = string.concat(
      '<polygon points="', hexPts, '" fill="url(#bg)" stroke="#000000" stroke-width="6"/>'
      '<polygon points="', hexPts, '" fill="none" stroke="', accent, '" stroke-width="5" stroke-opacity="0.9"/>'
      '<polygon points="', hexInner, '" fill="none" stroke="#ffffff" stroke-width="1.5" stroke-opacity="0.16"/>'
      '<polygon points="', hexPts, '" fill="url(#sh)"/>'
    );

    string memory body = _nameSvg(label, dotTld, textColor);

    return string.concat(head, frame, body, "</svg>");
  }

  /// @dev Render the name (wrapped, full) + the .dex suffix as SVG <text>.
  ///      Font size and line count scale with label length so the full name
  ///      always fits — never truncated.
  ///      이름(줄바꿈, 전부) + .dex 접미사를 SVG <text>로 렌더. 폰트·줄 수가
  ///      라벨 길이에 맞춰 조절되어 전체 이름이 항상 들어감 — 잘리지 않음.
  function _nameSvg(
    string memory label,
    string memory dotTld,
    string memory textColor
  ) internal pure returns (string memory) {
    uint256 len = bytes(label).length; // ASCII labels: bytes == chars

    // Choose font size and characters-per-line by length. The hex interior is
    // widest at the vertical center, so we center lines around y=200.
    //   길이에 따라 폰트·줄당 글자수 선택. 육각 내부는 세로 중앙이 가장 넓어
    //   y=200 기준으로 줄을 중앙 정렬.
    uint256 fontSize;
    uint256 perLine;
    if (len <= 10) {
      fontSize = 40; perLine = 10;
    } else if (len <= 16) {
      fontSize = 30; perLine = 16;
    } else if (len <= 24) {
      fontSize = 22; perLine = 12;
    } else if (len <= 36) {
      fontSize = 16; perLine = 18;
    } else {
      fontSize = 12; perLine = 18;
    }

    // Split into up to 3 lines of `perLine` chars.
    //   `perLine`자씩 최대 3줄로 분할.
    string[3] memory lines;
    uint256 lineCount = 0;
    uint256 pos = 0;
    while (pos < len && lineCount < 3) {
      uint256 take = len - pos < perLine ? len - pos : perLine;
      lines[lineCount] = _substr(label, pos, take);
      pos += take;
      lineCount += 1;
    }

    // Vertically center the name block around y=195; .dex sits below it.
    //   이름 블록을 y=195 중심으로 세로 중앙 정렬; .dex는 그 아래.
    uint256 lineH = fontSize + 4;
    uint256 blockTop = 195 - (lineCount * lineH) / 2;

    string memory nameText = "";
    for (uint256 i = 0; i < lineCount; i++) {
      uint256 y = blockTop + i * lineH + fontSize; // baseline
      nameText = string.concat(
        nameText,
        '<text x="200" y="', _u(y),
        '" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="',
        _u(fontSize), '" fill="', textColor, '">',
        lines[i],
        '</text>'
      );
    }

    // .dex suffix, just under the name block.
    //   .dex 접미사, 이름 블록 바로 아래.
    uint256 sufY = blockTop + lineCount * lineH + 30;
    string memory suffix = string.concat(
      '<text x="200" y="', _u(sufY),
      '" text-anchor="middle" font-family="sans-serif" font-weight="400" font-size="20" fill="',
      textColor, '" fill-opacity="0.6">',
      dotTld,
      '</text>'
    );

    return string.concat(nameText, suffix);
  }

  /// @dev Extract `count` bytes from `str` starting at `start`. ASCII-safe.
  ///      `str`의 `start`부터 `count` 바이트 추출. ASCII 전용.
  function _substr(string memory str, uint256 start, uint256 count)
    internal
    pure
    returns (string memory)
  {
    bytes memory s = bytes(str);
    bytes memory out = new bytes(count);
    for (uint256 i = 0; i < count; i++) {
      out[i] = s[start + i];
    }
    return string(out);
  }

  /// @dev uint256 → decimal string (small values; for SVG coordinates).
  ///      uint256 → 십진 문자열(작은 값; SVG 좌표용).
  function _u(uint256 v) internal pure returns (string memory) {
    if (v == 0) return "0";
    uint256 d = v;
    uint256 digits;
    while (d != 0) { digits++; d /= 10; }
    bytes memory buf = new bytes(digits);
    while (v != 0) { digits -= 1; buf[digits] = bytes1(uint8(48 + v % 10)); v /= 10; }
    return string(buf);
  }

  /// @notice EIP-165 interface advertisement. Required because we inherit
  ///         both `ERC721` and `ERC2981`, each of which adds its own
  ///         supported interface IDs.
  ///         EIP-165 인터페이스 광고. ERC721과 ERC2981을 동시 상속하므로
  ///         두 부모의 인터페이스 ID를 모두 반환하도록 override 필요.
  function supportsInterface(bytes4 interfaceId)
    public
    view
    virtual
    override(ERC721, ERC2981, IERC165)
    returns (bool)
  {
    return super.supportsInterface(interfaceId);
  }
}
