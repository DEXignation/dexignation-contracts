// SPDX-License-Identifier: MIT
//
// ════════════════════════════════════════════════════════════════════════════
// DEXignation — DXMarketplace
//
//   A STANDALONE fixed-price marketplace for `.dex` 2LD domain NFTs.
//   Sellers list at a fixed stablecoin price; a buyer who pays that price
//   receives the domain in the SAME transaction. No auction, no oracle.
//
//   `.dex` 2LD 도메인 NFT를 위한 독립형 고정가 마켓플레이스.
//   판매자가 스테이블코인 고정가로 리스팅하고, 그 가격을 낸 구매자는 같은
//   트랜잭션에서 도메인을 받는다. 경매 없음, 오라클 없음.
//
//   DESIGN — "Pattern 1" (operator delegation):
//     • This contract touches NO existing contract storage. It calls the
//       DXRegistrar (an ERC-721) only through its public interface.
//     • To sell, the seller approves THIS marketplace for the single token:
//           registrar.approve(address(this), tokenId)
//       (NOT setApprovalForAll — single-token scope only, to minimise blast
//        radius if this module is ever compromised.)
//     • The NFT stays in the seller's wallet the whole time it is listed.
//       It moves only at the moment of purchase, atomically with payment.
//     • Replaceable: deploy a new marketplace, re-approve. Registrar,
//       registry, controller, resolver all remain untouched.
//
//   기존 컨트랙트 스토리지를 전혀 건드리지 않는 "패턴 1"(operator 위임).
//   판매자는 단일 토큰만 approve(setApprovalForAll 아님)하며, 리스팅 중에도
//   NFT는 판매자 지갑에 그대로 있다가 구매 순간에만 결제와 원자적으로 이동한다.
//
//   SUBNAMES — selling a 2LD sells everything under it. `.dex` subnames are
//   registry records hierarchically owned by the parent, so when the parent
//   NFT transfers, DXRegistrar._update moves registry control to the buyer and
//   the entire subtree follows automatically. There is NOTHING to do here for
//   subnames: 2LD transfer == whole-tree transfer. We DO refuse to list a name
//   that is expired or not owned, and re-check ownership at purchase time.
//
//   서브네임 — 2LD를 팔면 그 아래 전부가 함께 넘어간다. `.dex` 서브네임은
//   부모가 계층적으로 소유하는 registry 레코드라, 부모 NFT가 이전되면
//   DXRegistrar._update가 registry 제어권을 구매자에게 옮기고 서브트리 전체가
//   자동으로 따라온다. 따라서 서브네임을 위해 여기서 할 일은 없다(2LD 이전 =
//   전체 트리 이전). 만료/미소유 이름은 리스팅을 거부하고, 구매 시점에 소유권을
//   재확인한다.
//
//   PAYMENT — stablecoins only (USDC/USDT), whitelisted. Price is denominated
//   directly in the pay-token's smallest unit, so NO price oracle is needed.
//   A protocol fee (bps, capped) is routed to `feeRecipient` (typically the
//   RevenueDistributor); the remainder goes to the seller.
//
//   결제 — 화이트리스트된 스테이블코인(USDC/USDT)만. 가격은 결제 토큰의 최소
//   단위로 직접 표기하므로 오라클 불필요. 프로토콜 수수료(bps, 상한)는
//   feeRecipient(보통 RevenueDistributor)로, 나머지는 판매자에게.
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @dev Minimal view into DXRegistrar that this module relies on. We avoid
///      importing the full implementation to keep coupling loose. `ownerOf`
///      reverts on expired tokens in DXRegistrar, which we treat as
///      "not listable / not purchasable".
///      이 모듈이 의존하는 DXRegistrar 최소 인터페이스. 결합도를 낮추려 전체
///      구현은 import하지 않는다. DXRegistrar의 `ownerOf`는 만료 토큰에서
///      revert하므로, 이를 "리스팅/구매 불가"로 취급한다.
interface IDXRegistrarMarket is IERC721 {
  function nameExpires(uint256 id) external view returns (uint256);
  function notifyMetadataUpdate(uint256 id) external;
  function marketplace() external view returns (address);
}

/// @dev Optional view into the auction contracts, used only to enforce mutual
///      exclusion: a name on auction cannot also be fixed-price listed.
///      경매 컨트랙트 조회(상호 배타 전용): 경매 중인 이름은 고정가 리스팅 불가.
interface IDXAuctionCheck {
  function isOnAuction(uint256 tokenId) external view returns (bool);
}

/// @title  DXMarketplace
/// @notice Fixed-price, atomic P2P sales of `.dex` 2LD domain NFTs in
///         whitelisted stablecoins. Listings are fully on-chain, so the
///         contract itself is the public storefront — no backend DB required.
///         화이트리스트 스테이블코인 기반 `.dex` 2LD 도메인 NFT의 고정가·원자적
///         P2P 판매. 리스팅이 완전 온체인이라 컨트랙트 자체가 공개 진열대다.
contract DXMarketplace is Ownable, ReentrancyGuard {
  using SafeERC20 for IERC20;

  // ──────────────────────────────────────────────────────────────────────────
  // Immutable wiring / 불변 연결
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice The DEXignation 2LD registrar (the ERC-721 being traded).
  ///         거래 대상인 DEXignation 2LD Registrar(ERC-721).
  IDXRegistrarMarket public immutable registrar;

  // ──────────────────────────────────────────────────────────────────────────
  // Fee configuration / 수수료 설정
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice Where the protocol fee is sent (e.g. RevenueDistributor / treasury).
  ///         Zero address disables the fee entirely.
  ///         프로토콜 수수료 수신처(RevenueDistributor/treasury). 0이면 비활성.
  address public feeRecipient;

  /// @notice Protocol fee in basis points (e.g. 250 = 2.5%). Capped at MAX_FEE_BPS.
  ///         프로토콜 수수료(만분율, 250 = 2.5%). MAX_FEE_BPS 상한.
  uint256 public protocolFeeBps;

  /// @notice Hard cap on the protocol fee. 1000 bps = 10%.
  ///         프로토콜 수수료 하드캡. 1000 bps = 10%.
  uint256 public constant MAX_FEE_BPS = 1000;

  // ──────────────────────────────────────────────────────────────────────────
  // Pay-token whitelist / 결제 토큰 화이트리스트
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice Allowed stablecoins for payment (USDC/USDT addresses on this chain).
  ///         Restricting to known stablecoins keeps "price" oracle-free and
  ///         blocks fee-on-transfer / malicious token shenanigans.
  ///         결제 허용 스테이블코인(이 체인의 USDC/USDT 주소). 알려진
  ///         스테이블코인으로 제한하여 가격을 오라클 없이 유지하고,
  ///         전송 수수료/악성 토큰 문제를 차단한다.
  mapping(address => bool) public allowedPayToken;

  /// @notice English/Dutch auction contracts, queried for mutual exclusion.
  ///         A name currently on either auction cannot be fixed-price listed.
  ///         Either may be zero (check skipped for that one).
  ///         영국식/네덜란드식 경매 컨트랙트(상호 배타 조회). 어느 경매든 진행
  ///         중인 이름은 고정가 리스팅 불가. 0이면 해당 검사 생략.
  IDXAuctionCheck public englishAuction;
  IDXAuctionCheck public dutchAuction;

  event AuctionContractsSet(address indexed english, address indexed dutch);

  // ──────────────────────────────────────────────────────────────────────────
  // Listing state (fully on-chain) / 리스팅 상태(완전 온체인)
  // ──────────────────────────────────────────────────────────────────────────

  struct Listing {
    address seller;     // 판매자
    address payToken;   // 결제 스테이블코인
    uint256 price;      // 가격(payToken 최소단위)
    bool    active;     // 활성 여부
  }

  /// @dev tokenId => listing. A token has at most one active listing.
  ///      tokenId => 리스팅. 토큰당 활성 리스팅은 최대 1건.
  mapping(uint256 => Listing) public listings;

  // ──────────────────────────────────────────────────────────────────────────
  // Events / 이벤트
  // ──────────────────────────────────────────────────────────────────────────

  event FeeRecipientSet(address indexed recipient);
  event ProtocolFeeSet(uint256 bps);
  event PayTokenSet(address indexed token, bool allowed);

  event Listed(
    uint256 indexed tokenId,
    address indexed seller,
    address indexed payToken,
    uint256 price
  );
  event PriceUpdated(uint256 indexed tokenId, uint256 newPrice);
  event Cancelled(uint256 indexed tokenId, address indexed seller);
  event Sold(
    uint256 indexed tokenId,
    address indexed seller,
    address indexed buyer,
    address payToken,
    uint256 price,
    uint256 protocolFee
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Errors / 에러
  // ──────────────────────────────────────────────────────────────────────────

  error ZeroAddress();
  error UnsupportedPayToken(address token);
  error ZeroPrice();
  error NotTokenOwner(uint256 tokenId, address caller);
  error MarketplaceNotApproved(uint256 tokenId);
  error AlreadyListed(uint256 tokenId);
  error OnAuction(uint256 tokenId);
  error NotListed(uint256 tokenId);
  error NotSeller(uint256 tokenId, address caller);
  error SellerNoLongerOwns(uint256 tokenId);
  error FeeTooHigh(uint256 requested, uint256 max);

  // ──────────────────────────────────────────────────────────────────────────
  // Construction / 생성
  // ──────────────────────────────────────────────────────────────────────────

  constructor(
    address _registrar,
    address _feeRecipient,
    uint256 _protocolFeeBps,
    address _owner
  ) Ownable(_owner) {
    if (_registrar == address(0)) revert ZeroAddress();
    if (_protocolFeeBps > MAX_FEE_BPS) {
      revert FeeTooHigh(_protocolFeeBps, MAX_FEE_BPS);
    }
    registrar = IDXRegistrarMarket(_registrar);
    feeRecipient = _feeRecipient;       // may be zero (fee disabled)
    protocolFeeBps = _protocolFeeBps;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Owner configuration / 오너 설정
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice Set the protocol fee recipient. Zero address disables the fee.
  ///         프로토콜 수수료 수신처 설정. 0이면 수수료 비활성.
  function setFeeRecipient(address recipient) external onlyOwner {
    feeRecipient = recipient;
    emit FeeRecipientSet(recipient);
  }

  /// @notice Set the protocol fee (bps). Capped at MAX_FEE_BPS (10%).
  ///         프로토콜 수수료(bps) 설정. MAX_FEE_BPS(10%) 상한.
  function setProtocolFee(uint256 bps) external onlyOwner {
    if (bps > MAX_FEE_BPS) revert FeeTooHigh(bps, MAX_FEE_BPS);
    protocolFeeBps = bps;
    emit ProtocolFeeSet(bps);
  }

  /// @notice Whitelist (or remove) a stablecoin for payment. Owner-only.
  ///         결제용 스테이블코인 화이트리스트 등록/해제. 오너 전용.
  function setPayToken(address token, bool allowed) external onlyOwner {
    if (token == address(0)) revert ZeroAddress();
    allowedPayToken[token] = allowed;
    emit PayTokenSet(token, allowed);
  }

  /// @notice Set the auction contracts queried for mutual exclusion. Owner-only.
  ///         Pass address(0) for either to disable that check.
  ///         상호 배타 조회용 경매 컨트랙트 설정. 오너 전용. 0이면 해당 검사 비활성.
  function setAuctionContracts(address english, address dutch) external onlyOwner {
    englishAuction = IDXAuctionCheck(english);
    dutchAuction = IDXAuctionCheck(dutch);
    emit AuctionContractsSet(english, dutch);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Seller flow / 판매자 흐름
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice List a `.dex` 2LD NFT for sale at a fixed stablecoin price.
  ///         Selling the 2LD sells everything beneath it: subnames are
  ///         registry records owned by the parent, so they transfer with the
  ///         NFT automatically (handled in DXRegistrar._update). The NFT stays
  ///         in the seller's wallet — only the approval is granted to this
  ///         marketplace.
  ///
  ///         `.dex` 2LD NFT를 고정 스테이블코인 가격에 판매 등록한다. 2LD를
  ///         팔면 그 아래 전부가 함께 팔린다(서브네임은 부모 소유 registry
  ///         레코드라 NFT와 함께 자동 이전; DXRegistrar._update가 처리). NFT는
  ///         판매자 지갑에 그대로 있고, 이 마켓에는 approve만 부여된다.
  ///
  /// @param tokenId   The 2LD token id (== uint256(labelhash)).
  /// @param payToken  Whitelisted stablecoin used for payment.
  /// @param price     Fixed price in payToken's smallest unit (e.g. 6 decimals).
  function list(uint256 tokenId, address payToken, uint256 price) external {
    if (!allowedPayToken[payToken]) revert UnsupportedPayToken(payToken);
    if (price == 0) revert ZeroPrice();

    // Must be the current owner. DXRegistrar.ownerOf reverts on expired tokens,
    // so an expired name cannot be listed.
    //   현재 소유자여야 함. DXRegistrar.ownerOf는 만료 토큰에서 revert하므로
    //   만료된 이름은 리스팅 불가.
    if (registrar.ownerOf(tokenId) != msg.sender) {
      revert NotTokenOwner(tokenId, msg.sender);
    }

    // Single-token approval check. We deliberately accept BOTH a single-token
    // approval and operator approval here (getApproved OR isApprovedForAll),
    // but we recommend single-token in the UI. At minimum, this marketplace
    // must be authorised to move the token at purchase time.
    //   단일 토큰 승인 확인. getApproved 또는 isApprovedForAll 중 하나면 통과
    //   (UI에서는 단일 토큰 권장). 최소한 구매 시점에 토큰을 옮길 권한이 있어야 함.
    if (
      registrar.getApproved(tokenId) != address(this) &&
      !registrar.isApprovedForAll(msg.sender, address(this))
    ) {
      revert MarketplaceNotApproved(tokenId);
    }

    // Mutual exclusion: a name on either auction cannot be fixed-price listed.
    // try/catch so a paused/replaced auction contract can never block listing.
    //   상호 배타: 어느 경매든 진행 중인 이름은 고정가 리스팅 불가. 경매
    //   컨트랙트가 멈추거나 교체돼도 리스팅을 막지 않도록 try/catch로 감쌈.
    if (address(englishAuction) != address(0)) {
      try englishAuction.isOnAuction(tokenId) returns (bool onAuction) {
        if (onAuction) revert OnAuction(tokenId);
      } catch { /* auction down → skip this check */ }
    }
    if (address(dutchAuction) != address(0)) {
      try dutchAuction.isOnAuction(tokenId) returns (bool onAuction) {
        if (onAuction) revert OnAuction(tokenId);
      } catch { /* auction down → skip this check */ }
    }

    if (listings[tokenId].active) revert AlreadyListed(tokenId);

    listings[tokenId] = Listing({
      seller: msg.sender,
      payToken: payToken,
      price: price,
      active: true
    });

    emit Listed(tokenId, msg.sender, payToken, price);
    _notifyMetadataUpdate(tokenId);
    // The SVG "LISTED" mark is still derived at render time by
    // DXRegistrar.tokenURI calling isListed(tokenId) below. The notification
    // only tells NFT indexers to refresh their cached metadata.
    //   SVG의 "LISTED" 마크는 여전히 렌더 시점에 DXRegistrar.tokenURI가 아래
    //   isListed(tokenId)를 호출해 파생한다. 알림은 NFT 인덱서 캐시 갱신용이다.
  }

  /// @notice Update the price of an existing listing. Seller-only.
  ///         Price lives only here and is shown by the site; the SVG mark is a
  ///         boolean ("for sale"), so a price change needs no SVG regeneration.
  ///         기존 리스팅 가격 변경. 판매자 전용. 가격은 여기에만 있고 사이트가
  ///         표시하며, SVG 마크는 불리언("판매중")이라 가격 변경에 SVG 재생성 불필요.
  function updatePrice(uint256 tokenId, uint256 newPrice) external {
    Listing storage l = listings[tokenId];
    if (!l.active) revert NotListed(tokenId);
    if (l.seller != msg.sender) revert NotSeller(tokenId, msg.sender);
    if (newPrice == 0) revert ZeroPrice();
    l.price = newPrice;
    emit PriceUpdated(tokenId, newPrice);
    _notifyMetadataUpdate(tokenId);
  }

  /// @notice Cancel a listing. Seller-only. The SVG mark disappears
  ///         automatically on next render (isListed becomes false).
  ///         리스팅 취소. 판매자 전용. SVG 마크는 다음 렌더 시 자동 사라짐
  ///         (isListed가 false가 됨).
  function cancel(uint256 tokenId) external {
    Listing storage l = listings[tokenId];
    if (!l.active) revert NotListed(tokenId);
    if (l.seller != msg.sender) revert NotSeller(tokenId, msg.sender);
    l.active = false;
    emit Cancelled(tokenId, msg.sender);
    _notifyMetadataUpdate(tokenId);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Buyer flow / 구매자 흐름
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice Buy a listed domain. Atomic: pulls the buyer's stablecoin and
  ///         transfers the NFT in the SAME transaction. If anything fails, the
  ///         whole call reverts — a buyer can never pay without receiving the
  ///         NFT, and a seller can never lose the NFT without being paid.
  ///
  ///         The buyer must first `approve` this marketplace to spend `price`
  ///         of the listing's payToken.
  ///
  ///         리스팅된 도메인 구매. 원자적: 같은 트랜잭션에서 구매자의
  ///         스테이블코인을 회수하고 NFT를 이전한다. 하나라도 실패하면 전체
  ///         revert — 구매자가 NFT 없이 지불하거나, 판매자가 대금 없이 NFT를
  ///         잃는 일이 불가능하다. 구매자는 먼저 이 마켓에 payToken을 `price`
  ///         만큼 approve해야 한다.
  ///
  /// @param tokenId  The listed 2LD token id.
  function buy(uint256 tokenId) external nonReentrant {
    Listing memory l = listings[tokenId];
    if (!l.active) revert NotListed(tokenId);

    // Re-check ownership at purchase time. Between list() and buy() the seller
    // may have transferred the NFT elsewhere or let it expire. DXRegistrar
    // .ownerOf reverts on expiry; a mismatch reverts here.
    //   구매 시점 소유권 재확인. list()와 buy() 사이에 판매자가 NFT를 옮겼거나
    //   만료됐을 수 있다. DXRegistrar.ownerOf는 만료 시 revert하고, 불일치면
    //   여기서 revert.
    if (registrar.ownerOf(tokenId) != l.seller) {
      revert SellerNoLongerOwns(tokenId);
    }

    // ── Effects: close the listing BEFORE any external interaction (CEI). ──
    //    효과: 외부 상호작용 전에 리스팅을 먼저 닫는다(CEI 패턴).
    listings[tokenId].active = false;

    // ── Interactions ──
    uint256 fee = 0;
    if (feeRecipient != address(0) && protocolFeeBps > 0) {
      fee = (l.price * protocolFeeBps) / 10000;
    }
    uint256 sellerProceeds = l.price - fee;

    IERC20 pay = IERC20(l.payToken);
    // Buyer → seller (net). SafeERC20 reverts if the transfer fails or returns
    // false (handles non-standard USDT-style return values).
    //   구매자 → 판매자(차감 후). SafeERC20이 실패/false 반환 시 revert
    //   (비표준 USDT 반환값 처리).
    pay.safeTransferFrom(msg.sender, l.seller, sellerProceeds);
    if (fee > 0) {
      pay.safeTransferFrom(msg.sender, feeRecipient, fee);
    }

    // NFT: seller → buyer. Uses the approval the seller granted at list time.
    // DXRegistrar._update then atomically moves registry control to the buyer
    // and invalidates stale resolver records; the entire subname subtree
    // follows because subnames are registry records owned by the parent.
    //   NFT: 판매자 → 구매자. 판매자가 리스팅 때 부여한 approve 사용.
    //   DXRegistrar._update가 registry 제어권을 구매자로 옮기고 옛 레코드를
    //   무효화하며, 서브네임 서브트리 전체가 부모를 따라 함께 이전된다.
    registrar.safeTransferFrom(l.seller, msg.sender, tokenId);

    emit Sold(tokenId, l.seller, msg.sender, l.payToken, l.price, fee);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Views / 조회
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice True if `tokenId` currently has an active listing AND the listed
  ///         seller still owns it. DXRegistrar.tokenURI calls this to decide
  ///         whether to render the "FOR SALE" mark, so a stale listing (seller
  ///         moved the NFT) does NOT show the mark.
  ///         `tokenId`에 활성 리스팅이 있고 등록된 판매자가 여전히 소유하면
  ///         true. DXRegistrar.tokenURI가 "FOR SALE" 마크 표시 여부 판단에
  ///         호출하므로, stale 리스팅(판매자가 NFT를 옮김)은 마크가 안 뜬다.
  /// @dev    Wrapped in try/catch on the registrar side: if this contract is
  ///         ever paused/replaced, tokenURI still renders (without the mark).
  ///         registrar 쪽에서 try/catch로 감싸므로, 이 컨트랙트가 멈추거나
  ///         교체돼도 tokenURI는 (마크 없이) 정상 렌더된다.
  function isListed(uint256 tokenId) external view returns (bool) {
    Listing memory l = listings[tokenId];
    if (!l.active) return false;
    // ownerOf reverts if expired; guard so this view never reverts.
    //   만료 시 ownerOf가 revert하므로, 이 view가 절대 revert하지 않도록 가드.
    try registrar.ownerOf(tokenId) returns (address currentOwner) {
      return currentOwner == l.seller;
    } catch {
      return false;
    }
  }

  /// @notice Convenience getter returning the full listing tuple.
  ///         리스팅 전체 튜플 반환 편의 함수.
  function getListing(uint256 tokenId)
    external
    view
    returns (address seller, address payToken, uint256 price, bool active)
  {
    Listing memory l = listings[tokenId];
    return (l.seller, l.payToken, l.price, l.active);
  }

  function _notifyMetadataUpdate(uint256 tokenId) internal {
    // Cosmetic ERC-4906 ping. Only call if still the registrar's marketplace notifier.
    //   표시용 ERC-4906 알림. registrar의 marketplace notifier일 때만 호출.
    if (registrar.marketplace() == address(this)) {
      registrar.notifyMetadataUpdate(tokenId);
    }
  }
}
