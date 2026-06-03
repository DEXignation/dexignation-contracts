// SPDX-License-Identifier: MIT
//
// ════════════════════════════════════════════════════════════════════════════
// DEXignation — DXEnglishAuction
//
//   A STANDALONE timed English (ascending) auction for `.dex` 2LD domain NFTs.
//   Bidders compete upward; the highest bid at close wins. Settlement transfers
//   the name and pays the seller atomically. Mirrors the DXMarketplace design:
//   separate contract, single-token approval, the NFT stays in the seller's
//   wallet until settlement.
//
//   `.dex` 2LD 도메인 NFT를 위한 독립형 시간제 영국식(올려부르기) 경매.
//   입찰자가 경쟁적으로 올려부르고 마감 시 최고가가 낙찰. 정산은 이름 이전과
//   판매자 지급을 원자적으로 처리. DXMarketplace와 같은 설계(별도 컨트랙트,
//   단일 토큰 approve, 정산 전까지 NFT는 판매자 지갑).
//
//   MODEL — NFT-market standard combination:
//     • Escrow (방식 A): a bid pulls the bidder's stablecoin into the contract,
//       so a winner can never be unable to pay.
//     • Pull refunds: an outbid bidder's funds are credited to a ledger and
//       withdrawn by them — never auto-sent — to avoid a malicious-receiver DoS.
//     • Anti-snipe: a bid inside the closing window extends the deadline.
//     • Min increment: a new bid must exceed the current top by a set percent.
//
//     에스크로(방식 A): 입찰 시 스테이블코인을 컨트랙트로 회수 → 낙찰자가 대금
//     없을 수 없음. Pull 환불: 밀린 입찰자 자금은 장부에 적고 본인이 인출(자동
//     송금 안 함) → 악성 수신자 DoS 방지. Anti-snipe: 마감 임박 입찰 시 마감
//     연장. 최소 증가: 직전 최고가 +일정 비율 이상이어야 입찰 인정.
//
//   MUTUAL EXCLUSION — a name is LISTED (fixed-price) or on AUCTION, never both.
//     createAuction checks the fixed-price marketplace and rejects if the token
//     is currently listed there. (The reverse guard lives in DXMarketplace.)
//
//     상호 배타 — 한 이름은 LISTED(고정가) 또는 AUCTION 중 하나만. createAuction이
//     고정가 마켓을 조회해 리스팅 중이면 거부한다(반대 방향 가드는 DXMarketplace).
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IDXRegistrarAuction is IERC721 {
  function nameExpires(uint256 id) external view returns (uint256);
}

/// @dev Optional view into the fixed-price marketplace, used only to enforce
///      mutual exclusion (a name cannot be listed and auctioned at once).
///      고정가 마켓 조회(상호 배타 강제 전용): 한 이름이 동시에 리스팅·경매 불가.
interface IDXMarketplaceCheck {
  function isListed(uint256 tokenId) external view returns (bool);
}

/// @title  DXEnglishAuction
/// @notice Timed ascending auction for `.dex` 2LD names, settled in a
///         whitelisted stablecoin, with escrowed bids, pull refunds,
///         anti-snipe extension, and a minimum bid increment.
contract DXEnglishAuction is Ownable, ReentrancyGuard {
  using SafeERC20 for IERC20;

  IDXRegistrarAuction public immutable registrar;

  // ── Config ──────────────────────────────────────────────────────────────
  address public feeRecipient;
  uint256 public protocolFeeBps;
  uint256 public constant MAX_FEE_BPS = 1000; // 10%

  /// @notice Minimum bid increment over the current top, in bps (e.g. 500 = 5%).
  ///         직전 최고가 대비 최소 입찰 증가율(bps, 500 = 5%).
  uint256 public minIncrementBps;

  /// @notice If a bid lands within `extendWindow` of the end, the deadline is
  ///         pushed to `now + extendBy` (anti-snipe).
  ///         마감 `extendWindow` 이내 입찰 시 마감을 `now + extendBy`로 연장.
  uint256 public extendWindow;
  uint256 public extendBy;

  /// @notice Optional fixed-price marketplace, queried for mutual exclusion.
  ///         상호 배타 강제용 고정가 마켓(선택).
  IDXMarketplaceCheck public marketplace;

  mapping(address => bool) public allowedPayToken;

  // ── Auction state ─────────────────────────────────────────────────────────
  struct Auction {
    address seller;
    uint256 tokenId;
    address payToken;
    uint256 reservePrice;
    uint256 endTime;
    address highestBidder;
    uint256 highestBid;
    bool    settled;
  }

  /// @dev tokenId => auction. A token has at most one live auction.
  ///      tokenId => 경매. 토큰당 진행 경매는 최대 1건.
  mapping(uint256 => Auction) public auctions;

  /// @dev payToken => bidder => withdrawable amount (pull refunds).
  ///      payToken => 입찰자 => 인출 가능액(Pull 환불).
  mapping(address => mapping(address => uint256)) public pendingReturns;

  // ── Events ──────────────────────────────────────────────────────────────
  event FeeRecipientSet(address indexed recipient);
  event ProtocolFeeSet(uint256 bps);
  event PayTokenSet(address indexed token, bool allowed);
  event MarketplaceSet(address indexed marketplace);
  event AuctionParamsSet(uint256 minIncrementBps, uint256 extendWindow, uint256 extendBy);

  event AuctionCreated(
    uint256 indexed tokenId, address indexed seller, address indexed payToken,
    uint256 reservePrice, uint256 endTime
  );
  event BidPlaced(uint256 indexed tokenId, address indexed bidder, uint256 amount);
  event AuctionExtended(uint256 indexed tokenId, uint256 newEndTime);
  event Withdrawn(address indexed payToken, address indexed who, uint256 amount);
  event AuctionSettled(uint256 indexed tokenId, address indexed winner, uint256 amount, uint256 fee);
  event AuctionSettledNoTransfer(uint256 indexed tokenId, address indexed winner, uint256 refund);
  event AuctionCancelled(uint256 indexed tokenId);
  event AuctionEndedNoBid(uint256 indexed tokenId);

  // ── Errors ──────────────────────────────────────────────────────────────
  error ZeroAddress();
  error UnsupportedPayToken(address token);
  error ZeroReserve();
  error NotTokenOwner(uint256 tokenId, address caller);
  error AuctionNotApproved(uint256 tokenId);
  error AlreadyAuctioned(uint256 tokenId);
  error ListedElsewhere(uint256 tokenId);
  error AuctionNotFound(uint256 tokenId);
  error AuctionEnded(uint256 tokenId);
  error AuctionNotYetEnded(uint256 tokenId);
  error AlreadySettled(uint256 tokenId);
  error BidTooLow(uint256 sent, uint256 minRequired);
  error SellerNoLongerOwns(uint256 tokenId); // reserved (settle now ends gracefully)
  error NotSeller(uint256 tokenId, address caller);
  error HasBids(uint256 tokenId);
  error NothingToWithdraw();
  error FeeTooHigh(uint256 requested, uint256 max);
  error BadDuration();

  constructor(
    address _registrar,
    address _feeRecipient,
    uint256 _protocolFeeBps,
    uint256 _minIncrementBps,
    uint256 _extendWindow,
    uint256 _extendBy
  ) Ownable(msg.sender) {
    if (_registrar == address(0)) revert ZeroAddress();
    if (_protocolFeeBps > MAX_FEE_BPS) revert FeeTooHigh(_protocolFeeBps, MAX_FEE_BPS);
    registrar = IDXRegistrarAuction(_registrar);
    feeRecipient = _feeRecipient;
    protocolFeeBps = _protocolFeeBps;
    minIncrementBps = _minIncrementBps;
    extendWindow = _extendWindow;
    extendBy = _extendBy;
  }

  // ── Owner config ──────────────────────────────────────────────────────────
  function setFeeRecipient(address r) external onlyOwner { feeRecipient = r; emit FeeRecipientSet(r); }
  function setProtocolFee(uint256 bps) external onlyOwner {
    if (bps > MAX_FEE_BPS) revert FeeTooHigh(bps, MAX_FEE_BPS);
    protocolFeeBps = bps; emit ProtocolFeeSet(bps);
  }
  function setPayToken(address token, bool allowed) external onlyOwner {
    if (token == address(0)) revert ZeroAddress();
    allowedPayToken[token] = allowed; emit PayTokenSet(token, allowed);
  }
  function setMarketplace(address m) external onlyOwner {
    marketplace = IDXMarketplaceCheck(m); emit MarketplaceSet(m);
  }
  function setAuctionParams(uint256 _minIncrementBps, uint256 _extendWindow, uint256 _extendBy)
    external onlyOwner
  {
    minIncrementBps = _minIncrementBps;
    extendWindow = _extendWindow;
    extendBy = _extendBy;
    emit AuctionParamsSet(_minIncrementBps, _extendWindow, _extendBy);
  }

  // ── Create ──────────────────────────────────────────────────────────────
  /// @notice Open an auction for an owned, approved 2LD. The NFT stays in the
  ///         seller's wallet; only the approval is granted to this contract.
  ///         소유·승인된 2LD 경매 개시. NFT는 판매자 지갑에 그대로, approve만 부여.
  function createAuction(
    uint256 tokenId, address payToken, uint256 reservePrice, uint256 duration
  ) external {
    if (!allowedPayToken[payToken]) revert UnsupportedPayToken(payToken);
    if (reservePrice == 0) revert ZeroReserve();
    if (duration == 0) revert BadDuration();
    if (registrar.ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId, msg.sender);
    if (registrar.getApproved(tokenId) != address(this) &&
        !registrar.isApprovedForAll(msg.sender, address(this)))
      revert AuctionNotApproved(tokenId);
    if (auctions[tokenId].seller != address(0) && !auctions[tokenId].settled)
      revert AlreadyAuctioned(tokenId);

    // Mutual exclusion: refuse if the name is currently fixed-price listed.
    //   상호 배타: 고정가로 리스팅 중이면 거부.
    if (address(marketplace) != address(0)) {
      try marketplace.isListed(tokenId) returns (bool listed) {
        if (listed) revert ListedElsewhere(tokenId);
      } catch { /* marketplace down → skip the check, don't block auctions */ }
    }

    auctions[tokenId] = Auction({
      seller: msg.sender, tokenId: tokenId, payToken: payToken,
      reservePrice: reservePrice, endTime: block.timestamp + duration,
      highestBidder: address(0), highestBid: 0, settled: false
    });
    emit AuctionCreated(tokenId, msg.sender, payToken, reservePrice, block.timestamp + duration);
  }

  // ── Bid ─────────────────────────────────────────────────────────────────
  /// @notice Place a bid. Pulls `amount` of the auction's payToken into escrow.
  ///         The previous top bid is credited to the pull-refund ledger.
  ///         입찰. 경매 payToken을 `amount`만큼 에스크로로 회수. 직전 최고가는
  ///         Pull 환불 장부에 적립.
  function bid(uint256 tokenId, uint256 amount) external nonReentrant {
    Auction storage a = auctions[tokenId];
    if (a.seller == address(0) || a.settled) revert AuctionNotFound(tokenId);
    if (block.timestamp >= a.endTime) revert AuctionEnded(tokenId);

    uint256 minRequired = a.highestBid == 0
      ? a.reservePrice
      : a.highestBid + (a.highestBid * minIncrementBps) / 10000;
    if (amount < minRequired) revert BidTooLow(amount, minRequired);

    // Pull the new bid into escrow first.
    //   새 입찰을 먼저 에스크로로 회수.
    IERC20(a.payToken).safeTransferFrom(msg.sender, address(this), amount);

    // Credit the outbid bidder (pull refund — they withdraw themselves).
    //   밀린 입찰자 적립(Pull 환불 — 본인이 인출).
    if (a.highestBidder != address(0)) {
      pendingReturns[a.payToken][a.highestBidder] += a.highestBid;
    }

    a.highestBidder = msg.sender;
    a.highestBid = amount;

    // Anti-snipe: extend if inside the closing window.
    //   Anti-snipe: 마감 임박이면 연장.
    if (a.endTime - block.timestamp <= extendWindow) {
      a.endTime = block.timestamp + extendBy;
      emit AuctionExtended(tokenId, a.endTime);
    }
    emit BidPlaced(tokenId, msg.sender, amount);
  }

  // ── Withdraw (pull refund) ────────────────────────────────────────────────
  /// @notice Withdraw refunds owed to you for a given pay-token. Effects first
  ///         (CEI); a malicious receiver can only harm itself, never the auction.
  ///         특정 pay-token에 대해 본인에게 쌓인 환불 인출. 효과 먼저(CEI);
  ///         악성 수신자는 자기만 해칠 뿐 경매를 막지 못함.
  function withdraw(address payToken) external nonReentrant {
    uint256 amount = pendingReturns[payToken][msg.sender];
    if (amount == 0) revert NothingToWithdraw();
    pendingReturns[payToken][msg.sender] = 0;
    IERC20(payToken).safeTransfer(msg.sender, amount);
    emit Withdrawn(payToken, msg.sender, amount);
  }

  // ── Settle ────────────────────────────────────────────────────────────────
  /// @notice Settle after close. Callable by ANYONE so the auction can never be
  ///         stuck. Pays the seller from escrow and transfers the name to the
  ///         winner atomically. With no bids, the name simply stays with the
  ///         seller. The winner's funds are already escrowed, so payment cannot
  ///         fail for lack of funds.
  ///         마감 후 정산. 누구나 호출 가능(묶이지 않음). 에스크로에서 판매자에게
  ///         지급하고 이름을 낙찰자에게 원자적으로 이전. 입찰 0건이면 이름은
  ///         판매자에게 그대로. 낙찰 대금은 이미 에스크로돼 결제 실패 불가.
  function settle(uint256 tokenId) external nonReentrant {
    Auction storage a = auctions[tokenId];
    if (a.seller == address(0)) revert AuctionNotFound(tokenId);
    if (a.settled) revert AlreadySettled(tokenId);
    if (block.timestamp < a.endTime) revert AuctionNotYetEnded(tokenId);

    a.settled = true; // effects first (CEI)

    if (a.highestBidder == address(0)) {
      emit AuctionEndedNoBid(tokenId);
      return; // name stays with the seller; nothing escrowed
    }

    // Re-check ownership at settlement (seller may have moved/let it expire).
    // If the seller no longer owns the name we must NOT revert — a revert would
    // roll back the refund credit below and trap the winner's escrowed funds.
    // Instead we end the auction gracefully: credit the winner via the pull
    // ledger (they withdraw themselves) and skip the transfer.
    //   정산 시점 소유권 재확인(판매자가 옮겼거나 만료). 판매자가 더는 소유하지
    //   않으면 revert하면 안 된다 — revert는 아래 환불 적립을 롤백해 낙찰자의
    //   에스크로 자금을 가둔다. 대신 경매를 정상 종료: 낙찰자에게 Pull 환불
    //   적립(본인이 withdraw)하고 이전은 생략한다.
    if (registrar.ownerOf(tokenId) != a.seller) {
      pendingReturns[a.payToken][a.highestBidder] += a.highestBid;
      emit AuctionSettledNoTransfer(tokenId, a.highestBidder, a.highestBid);
      return;
    }

    uint256 fee = (feeRecipient != address(0) && protocolFeeBps > 0)
      ? (a.highestBid * protocolFeeBps) / 10000 : 0;
    uint256 sellerProceeds = a.highestBid - fee;

    IERC20 pay = IERC20(a.payToken);
    pay.safeTransfer(a.seller, sellerProceeds);               // ① escrow → seller
    if (fee > 0) pay.safeTransfer(feeRecipient, fee);
    registrar.safeTransferFrom(a.seller, a.highestBidder, tokenId); // ② NFT → winner
    // ③ DXRegistrar._update moves registry control + subname subtree to winner.

    emit AuctionSettled(tokenId, a.highestBidder, a.highestBid, fee);
  }

  // ── Cancel (only before any bid) ──────────────────────────────────────────
  /// @notice Cancel an auction that has received no bids. Once a bid exists the
  ///         auction cannot be cancelled (bidder protection).
  ///         입찰이 없는 경매만 취소. 입찰 발생 후엔 취소 불가(입찰자 보호).
  function cancelAuction(uint256 tokenId) external {
    Auction storage a = auctions[tokenId];
    if (a.seller == address(0) || a.settled) revert AuctionNotFound(tokenId);
    if (a.seller != msg.sender) revert NotSeller(tokenId, msg.sender);
    if (a.highestBidder != address(0)) revert HasBids(tokenId);
    a.settled = true;
    emit AuctionCancelled(tokenId);
  }

  // ── Views ─────────────────────────────────────────────────────────────────
  /// @notice True if a live (created, not settled, not past end) auction exists.
  ///         Used by DXRegistrar.tokenURI to render the AUCTION mark, and by the
  ///         marketplace for mutual exclusion.
  ///         진행 중(생성됨·미정산·마감 전) 경매가 있으면 true. tokenURI의 AUCTION
  ///         마크 표시와 마켓의 상호 배타 검사에 사용.
  function isOnAuction(uint256 tokenId) external view returns (bool) {
    Auction memory a = auctions[tokenId];
    if (a.seller == address(0) || a.settled) return false;
    if (block.timestamp >= a.endTime) return false;
    try registrar.ownerOf(tokenId) returns (address o) {
      return o == a.seller;
    } catch { return false; }
  }

  function getAuction(uint256 tokenId)
    external view
    returns (address seller, address payToken, uint256 reservePrice,
             uint256 endTime, address highestBidder, uint256 highestBid, bool settled)
  {
    Auction memory a = auctions[tokenId];
    return (a.seller, a.payToken, a.reservePrice, a.endTime,
            a.highestBidder, a.highestBid, a.settled);
  }
}
