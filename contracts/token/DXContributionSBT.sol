// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — DXContributionSBT
//
// Soulbound NFT issued to people who contribute to the DEXignation project
// (code, design, content, translation, community moderation, etc.).
//
// "Soulbound" means the NFT cannot be transferred after mint. This is a
// deliberate property:
//   - A contribution badge represents *who did what*. Letting it be sold or
//     traded would destroy that meaning.
//   - Because there is no transfer market, there is no price discovery and
//     no investment-product surface. The badge is recognition, not a
//     security and not a payment instrument.
//
// The owner of this contract (typically a multisig) decides who receives
// badges and what each badge attests to. Tokens can be burned by the owner
// to revoke a badge that was issued in error.
//
// 한국어:
//   DEXignation 프로젝트에 기여한 사람(코드, 디자인, 콘텐츠, 번역, 커뮤니티
//   운영 등)에게 발급하는 양도 불가 NFT (Soulbound).
//
//   양도 불가가 의도된 속성인 이유:
//     - 기여 배지는 *누가 무엇을 했는가*의 기록. 매매 가능하면 의미 상실.
//     - 거래 시장이 없으니 가격 형성·투자상품 표면 없음. 배지는 인정 표시이지
//       증권이나 결제 수단이 아님.
//
//   배지 발급/취소 권한은 owner (multisig 권장)에게 있음.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

contract DXContributionSBT is ERC721, Ownable {
  using Strings for uint256;

  /// @dev Monotonic token id counter. Starts at 1.
  ///      증가형 token id 카운터. 1부터 시작.
  uint256 private _nextId = 1;

  /// @dev tokenId => short category label (e.g. "code", "design", "translation").
  ///      tokenId => 짧은 카테고리 라벨.
  mapping(uint256 => string) public category;

  /// @dev tokenId => longer human-readable description of the contribution.
  ///      tokenId => 기여 내용에 대한 사람이 읽을 수 있는 설명.
  mapping(uint256 => string) public description;

  event ContributionAwarded(
    address indexed contributor,
    uint256 indexed tokenId,
    string category,
    string description
  );
  event ContributionRevoked(uint256 indexed tokenId, address indexed wasOwnedBy);

  error SoulboundNotTransferable();
  error TokenDoesNotExist(uint256 tokenId);

  constructor()
    ERC721("DEXignation Contributor", "DEXC")
    Ownable(msg.sender)
  {}

  /// @notice Mint a contribution badge to `contributor`. Owner-only.
  ///         기여 배지를 `contributor`에게 발급. 오너 전용.
  /// @param contributor   Recipient address. / 수령자 주소.
  /// @param category_     Short category label (e.g. "code", "translation").
  ///                      짧은 카테고리 라벨.
  /// @param description_  Human-readable description (e.g. "Wrote initial
  ///                      Polygon deployment scripts"). / 사람이 읽는 설명.
  /// @return tokenId      The newly minted token id. / 발급된 token id.
  function award(
    address contributor,
    string calldata category_,
    string calldata description_
  ) external onlyOwner returns (uint256 tokenId) {
    tokenId = _nextId++;
    category[tokenId] = category_;
    description[tokenId] = description_;
    _safeMint(contributor, tokenId);
    emit ContributionAwarded(contributor, tokenId, category_, description_);
  }

  /// @notice Revoke a badge by burning the token. Owner-only.
  ///         Use sparingly: revoking a public attestation has reputational
  ///         consequences, so prefer minting a corrective new badge over
  ///         silent revocation when possible.
  ///         배지 취소(소각). 오너 전용. 공개 인정 취소는 평판에 영향이 크므로
  ///         가능하면 정정용 배지를 새로 발급하는 쪽이 나음.
  function revoke(uint256 tokenId) external onlyOwner {
    address holder = _ownerOf(tokenId);
    if (holder == address(0)) revert TokenDoesNotExist(tokenId);
    delete category[tokenId];
    delete description[tokenId];
    _burn(tokenId);
    emit ContributionRevoked(tokenId, holder);
  }

  /// @notice How many badges `who` currently holds.
  ///         `who`가 현재 보유한 배지 수.
  function badgesOf(address who) external view returns (uint256) {
    return balanceOf(who);
  }

  // ── Soulbound enforcement / 양도 불가 강제 ──────────────────────────────────

  /// @dev OpenZeppelin v5 funnels every transfer through `_update`. We
  ///      allow `from == 0` (mint) and `to == 0` (burn), but revert all
  ///      true transfers. This is the canonical way to make an ERC-721
  ///      soulbound under OZ v5.
  ///
  ///      OZ v5에서는 모든 전송이 `_update`를 거친다. mint(`from == 0`)와
  ///      burn(`to == 0`)만 허용하고 실제 전송은 모두 revert. OZ v5에서
  ///      ERC-721을 soulbound로 만드는 정식 방법.
  function _update(address to, uint256 tokenId, address auth)
    internal override returns (address)
  {
    address from = _ownerOf(tokenId);
    if (from != address(0) && to != address(0)) {
      revert SoulboundNotTransferable();
    }
    return super._update(to, tokenId, auth);
  }

  // ── On-chain metadata / 온체인 메타데이터 ───────────────────────────────────

  /// @notice On-chain JSON+SVG, same approach as DXRegistrar — no IPFS,
  ///         no external server dependency.
  ///         온체인 JSON+SVG. DXRegistrar와 동일한 방식 — IPFS·외부 서버
  ///         의존 없음.
  function tokenURI(uint256 tokenId)
    public view override returns (string memory)
  {
    _requireOwned(tokenId);
    string memory cat = category[tokenId];
    string memory desc = description[tokenId];
    if (bytes(cat).length == 0) cat = "general";

    string memory svg = _generateSVG(tokenId, cat);
    string memory json = string.concat(
      "{'name':'DEXignation Contributor #", tokenId.toString(),
      "','description':'", desc,
      "','attributes':[{'trait_type':'category','value':'", cat, "'}],"
      '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)), "'}"
    );
    return string.concat(
      "data:application/json;base64,",
      Base64.encode(bytes(json))
    );
  }

  function _generateSVG(uint256 tokenId, string memory cat)
    internal pure returns (string memory)
  {
    return string.concat(
      "<svg width='400' height='400' xmlns='http://www.w3.org/2000/svg'>"
      '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
      '<stop offset="0%" stop-color="#0D1117"/>'
      '<stop offset="100%" stop-color="#1A2030"/>'
      '</linearGradient></defs>'
      '<rect width="400" height="400" rx="20" fill="url(#bg)"/>'
      '<rect x="8" y="8" width="384" height="384" rx="16" fill="none" stroke="#00DC82" stroke-opacity="0.3"/>'
      '<text x="200" y="120" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#64748B">CONTRIBUTOR</text>'
      '<text x="200" y="200" text-anchor="middle" font-family="sans-serif" font-weight="bold" font-size="44" fill="#00DC82">#',
      tokenId.toString(),
      "</text>"
      '<text x="200" y="260" text-anchor="middle" font-family="monospace" font-size="16" fill="#94A3B8">',
      cat,
      "</text>"
      '<text x="200" y="360" text-anchor="middle" font-family="monospace" font-size="11" fill="#2D3A48">DEXignation \xc2\xb7 Soulbound</text>'
      '</svg>'
    );
  }
}
