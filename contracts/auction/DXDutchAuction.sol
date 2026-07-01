// SPDX-License-Identifier: MIT
//
// ════════════════════════════════════════════════════════════════════════════
// DEXignation — DXDutchAuction
//
//   A STANDALONE Dutch (descending-price) auction for `.dex` 2LD domain NFTs.
//   The price starts high and drops in fixed STEPS down to a floor: it holds
//   for a set interval, then falls by a fixed whole amount each step. The first
//   buyer to call `buy` pays the current step price and wins immediately.
//   No bidding, no escrow, no competition needed — so it works even with very
//   few users. This makes it ideal for the initial release of premium names.
//
//   `.dex` 2LD 도메인 NFT를 위한 독립형 네덜란드식(내려부르기) 경매.
//   가격이 높게 시작해 계단식으로 바닥가까지 내려간다: 일정 구간 가격을 유지한
//   뒤 매 계단 고정 정수액만큼 하락. 처음 `buy`를 부른 구매자가 그 계단 가격에
//   즉시 낙찰. 입찰·에스크로·경쟁 불필요 → 유저가 적어도 작동. 프리미엄 이름
//   초기 분양에 적합.
//
//   PER-STEP DROP — two modes, both yielding a fixed WHOLE-NUMBER drop:
//     • rate mode:  dropPerStep = startPrice * stepDropBps / 10000
//                   (rejected at creation if it doesn't divide evenly)
//     • fixed mode: dropPerStep = a caller-given whole amount
//     Every step price is therefore an exact integer — no fractional prices.
//     계단당 하락 — 두 모드 모두 고정 정수 하락:
//       · 비율 모드: dropPerStep = 시작가 × stepDropBps / 10000
//                    (나누어떨어지지 않으면 생성 시 거부)
//       · 정액 모드: dropPerStep = 호출자가 준 정수액
//     따라서 모든 계단 가격은 정확한 정수 — 소수점 없음.
//
//   This is effectively a fixed-price sale whose price is a function of time,
//   so it closely mirrors DXMarketplace.buy(): single-token approval, the NFT
//   stays in the seller's wallet, and purchase settles payment and transfer
//   atomically in one transaction.
//
//   사실상 가격이 시간 함수인 고정가 판매라, DXMarketplace.buy()와 거의 동일:
//   단일 토큰 approve, NFT는 판매자 지갑에 그대로, 구매 시 결제·이전을 한
//   트랜잭션에서 원자적으로 정산.
//
//   MUTUAL EXCLUSION — a name is LISTED, on English AUCTION, or on Dutch
//   AUCTION — never more than one at a time. createAuction refuses if the token
//   is currently fixed-price listed.
//   상호 배타 — 한 이름은 LISTED·영국식·네덜란드식 중 하나만. createAuction이
//   고정가 리스팅 중이면 거부.
// ════════════════════════════════════════════════════════════════════════════

pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IDXRegistrarDutch is IERC721 {
  function nameExpires(uint256 id) external view returns (uint256);
  function notifyMetadataUpdate(uint256 id) external;
  function dutchAuction() external view returns (address);
}

interface IDXMarketplaceCheck2 {
  function isListed(uint256 tokenId) external view returns (bool);
}

interface IDXAuctionCheck2 {
  function isOnAuction(uint256 tokenId) external view returns (bool);
}

/// @title  DXDutchAuction
/// @notice Linear declining-price auction for `.dex` 2LD names, paid in a
///         whitelisted stablecoin. First buyer at the current price wins;
///         payment and transfer are atomic. No escrow, no bidding.
contract DXDutchAuction is Ownable, ReentrancyGuard {
  using SafeERC20 for IERC20;

  IDXRegistrarDutch public immutable registrar;

  // ── Config ──────────────────────────────────────────────────────────────
  address public feeRecipient;
  uint256 public protocolFeeBps;
  uint256 public constant MAX_FEE_BPS = 1000; // 10%
  uint256 public constant MIN_DURATION_LIMIT = 1 days;
  uint256 public constant MAX_DURATION_LIMIT = 30 days;
  uint256 public minAuctionDuration = MIN_DURATION_LIMIT;
  uint256 public maxAuctionDuration = MAX_DURATION_LIMIT;

  IDXMarketplaceCheck2 public marketplace; // mutual-exclusion check (optional)
  IDXAuctionCheck2 public peerAuction;     // English/Dutch mutual-exclusion check (optional)
  mapping(address => bool) public allowedPayToken;

  // ── Auction state ─────────────────────────────────────────────────────────
  struct Auction {
    address seller;
    uint256 tokenId;
    address payToken;
    uint256 startPrice;      // 시작가(높음)
    uint256 floorPrice;      // 바닥가(최저, 이 아래로 안 내려감)
    uint256 startTime;       // 시작 시각
    uint256 endTime;         // 종료 시각
    uint256 stepInterval;    // 한 계단의 길이(초). 예: 5시간 = 18000
    uint256 dropPerStep;     // 계단당 하락액(절대 정수). 비율/정액 모두 이 값으로 환산
    bool    settled;         // 판매 완료/취소
  }

  /// @dev tokenId => auction.  토큰당 진행 경매는 최대 1건.
  mapping(uint256 => Auction) public auctions;

  // ── Events ──────────────────────────────────────────────────────────────
  event FeeRecipientSet(address indexed recipient);
  event ProtocolFeeSet(uint256 bps);
  event PayTokenSet(address indexed token, bool allowed);
  event MarketplaceSet(address indexed marketplace);
  event PeerAuctionSet(address indexed auction);
  event AuctionDurationBoundsSet(uint256 minDuration, uint256 maxDuration);

  event DutchAuctionCreated(
    uint256 indexed tokenId, address indexed seller, address indexed payToken,
    uint256 startPrice, uint256 floorPrice, uint256 startTime, uint256 endTime,
    uint256 stepInterval, uint256 dropPerStep
  );
  event DutchAuctionSold(
    uint256 indexed tokenId, address indexed seller, address indexed buyer,
    address payToken, uint256 price, uint256 fee
  );
  event DutchAuctionCancelled(uint256 indexed tokenId);

  // ── Errors ──────────────────────────────────────────────────────────────
  error ZeroAddress();
  error UnsupportedPayToken(address token);
  error BadPrices();        // floor >= start, or zero
  error BadStep();          // stepInterval zero, or both/neither drop modes set
  error BadDuration();
  error BadDurationBounds();
  error IndivisibleDrop();  // 비율 적용 시 나머지 발생 — 깔끔한 정수 안 됨
  error NotTokenOwner(uint256 tokenId, address caller);
  error AuctionNotApproved(uint256 tokenId);
  error AlreadyAuctioned(uint256 tokenId);
  error ListedElsewhere(uint256 tokenId);
  error AuctionedElsewhere(uint256 tokenId);
  error AuctionNotFound(uint256 tokenId);
  error AuctionEnded(uint256 tokenId);
  error AlreadySettled(uint256 tokenId);
  error SellerNoLongerOwns(uint256 tokenId);
  error NotSeller(uint256 tokenId, address caller);
  error FeeTooHigh(uint256 requested, uint256 max);

  constructor(
    address _registrar, address _feeRecipient, uint256 _protocolFeeBps, address _owner
  ) Ownable(_owner) {
    if (_registrar == address(0)) revert ZeroAddress();
    if (_protocolFeeBps > MAX_FEE_BPS) revert FeeTooHigh(_protocolFeeBps, MAX_FEE_BPS);
    registrar = IDXRegistrarDutch(_registrar);
    feeRecipient = _feeRecipient;
    protocolFeeBps = _protocolFeeBps;
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
    marketplace = IDXMarketplaceCheck2(m); emit MarketplaceSet(m);
  }
  function setPeerAuction(address a) external onlyOwner {
    peerAuction = IDXAuctionCheck2(a); emit PeerAuctionSet(a);
  }
  function setAuctionDurationBounds(uint256 minDuration, uint256 maxDuration) external onlyOwner {
    if (
      minDuration < MIN_DURATION_LIMIT ||
      maxDuration > MAX_DURATION_LIMIT ||
      minDuration > maxDuration
    ) revert BadDurationBounds();
    minAuctionDuration = minDuration;
    maxAuctionDuration = maxDuration;
    emit AuctionDurationBoundsSet(minDuration, maxDuration);
  }

  // ── Create ──────────────────────────────────────────────────────────────
  /// @notice Open a step Dutch auction. The price holds for `stepInterval`
  ///         seconds, then drops by a FIXED whole amount each step, down to
  ///         `floorPrice`. The per-step drop is given in ONE of two modes:
  ///           • rate mode:  stepDropBps > 0, stepDropAmount == 0
  ///               → dropPerStep = startPrice * stepDropBps / 10000
  ///                 (must divide evenly — otherwise IndivisibleDrop)
  ///           • fixed mode: stepDropAmount > 0, stepDropBps == 0
  ///               → dropPerStep = stepDropAmount
  ///         Exactly one mode must be set. Every step price is a whole number;
  ///         there are no fractional prices.
  ///
  ///         계단식 네덜란드 경매 개시. 가격이 `stepInterval`초 동안 유지된 뒤
  ///         매 계단 고정 정수액만큼 떨어져 `floorPrice`까지 내려간다. 계단당
  ///         하락은 두 모드 중 하나로 지정:
  ///           • 비율 모드: stepDropBps>0, stepDropAmount==0
  ///               → dropPerStep = startPrice * stepDropBps / 10000
  ///                 (나누어떨어져야 함, 아니면 IndivisibleDrop으로 거부)
  ///           • 정액 모드: stepDropAmount>0, stepDropBps==0
  ///               → dropPerStep = stepDropAmount
  ///         정확히 한 모드만 지정. 모든 계단 가격은 정수 — 소수점 없음.
  ///
  /// @param startPrice      시작가 (payToken 최소단위, 정수)
  /// @param floorPrice      바닥가 (이 아래로 안 내려감)
  /// @param duration        판매 가능 기간(초). 만료 후 구매 불가, active 아님
  /// @param stepInterval    한 계단의 길이(초). 예: 5시간 = 18000
  /// @param stepDropBps     비율 모드: 시작가 대비 만분율 (예: 500 = 5%). 정액이면 0
  /// @param stepDropAmount  정액 모드: 계단당 하락액(정수). 비율이면 0
  function createAuction(
    uint256 tokenId, address payToken,
    uint256 startPrice, uint256 floorPrice, uint256 duration, uint256 stepInterval,
    uint256 stepDropBps, uint256 stepDropAmount
  ) external {
    if (!allowedPayToken[payToken]) revert UnsupportedPayToken(payToken);
    if (floorPrice == 0 || startPrice <= floorPrice) revert BadPrices();
    if (duration < minAuctionDuration || duration > maxAuctionDuration) revert BadDuration();
    if (stepInterval == 0) revert BadStep();

    // Exactly one of (bps, amount) must be non-zero.
    //   (비율, 정액) 중 정확히 하나만 0이 아니어야 함.
    bool rateMode = stepDropBps > 0 && stepDropAmount == 0;
    bool fixedMode = stepDropAmount > 0 && stepDropBps == 0;
    if (!(rateMode || fixedMode)) revert BadStep();

    uint256 dropPerStep;
    if (rateMode) {
      // Must divide evenly so every step price is a clean integer.
      //   모든 계단 가격이 깔끔한 정수가 되도록 나누어떨어져야 함.
      if ((startPrice * stepDropBps) % 10000 != 0) revert IndivisibleDrop();
      dropPerStep = (startPrice * stepDropBps) / 10000;
    } else {
      dropPerStep = stepDropAmount;
    }
    if (dropPerStep == 0) revert BadStep();

    if (registrar.ownerOf(tokenId) != msg.sender) revert NotTokenOwner(tokenId, msg.sender);
    if (registrar.getApproved(tokenId) != address(this) &&
        !registrar.isApprovedForAll(msg.sender, address(this)))
      revert AuctionNotApproved(tokenId);
    if (_isActive(auctions[tokenId]))
      revert AlreadyAuctioned(tokenId);

    if (address(marketplace) != address(0)) {
      try marketplace.isListed(tokenId) returns (bool listed) {
        if (listed) revert ListedElsewhere(tokenId);
      } catch { /* marketplace down → skip check */ }
    }
    if (address(peerAuction) != address(0) && peerAuction.isOnAuction(tokenId)) {
      revert AuctionedElsewhere(tokenId);
    }

    uint256 startTime = block.timestamp;
    uint256 endTime = startTime + duration;
    auctions[tokenId] = Auction({
      seller: msg.sender, tokenId: tokenId, payToken: payToken,
      startPrice: startPrice, floorPrice: floorPrice,
      startTime: startTime, endTime: endTime, stepInterval: stepInterval,
      dropPerStep: dropPerStep, settled: false
    });
    emit DutchAuctionCreated(
      tokenId, msg.sender, payToken, startPrice, floorPrice,
      startTime, endTime, stepInterval, dropPerStep
    );
    _notifyMetadataUpdate(tokenId);
  }

  // ── Current price (step) ──────────────────────────────────────────────────
  /// @notice The current price. Holds at `startPrice` for the first step, then
  ///         drops by `dropPerStep` at each `stepInterval` boundary, clamped at
  ///         `floorPrice`. Always a whole number — no fractional prices.
  ///         현재가. 첫 계단 동안 `startPrice` 유지, 이후 `stepInterval`마다
  ///         `dropPerStep`씩 하락, `floorPrice`로 클램프. 항상 정수 — 소수점 없음.
  ///
  ///         예) 시작가 100만, 계단 5시간, 계단당 5만:
  ///             0~5h: 100만 · 5~10h: 95만 · 10~15h: 90만 · … · 바닥가 도달 후 고정
  function currentPrice(uint256 tokenId) public view returns (uint256) {
    Auction memory a = auctions[tokenId];
    if (a.seller == address(0)) revert AuctionNotFound(tokenId);

    uint256 steps = (block.timestamp - a.startTime) / a.stepInterval;
    uint256 totalDrop = steps * a.dropPerStep;

    // Clamp to floor (also guards underflow if totalDrop exceeds the spread).
    //   바닥가로 클램프(낙폭이 스프레드를 넘어도 언더플로우 방지).
    if (totalDrop >= a.startPrice - a.floorPrice) {
      return a.floorPrice;
    }
    return a.startPrice - totalDrop;
  }

  // ── Buy ─────────────────────────────────────────────────────────────────
  /// @notice Buy at the current price. Atomic: pulls the buyer's stablecoin and
  ///         transfers the NFT in one transaction. `maxPrice` is the buyer's
  ///         slippage guard — the tx reverts if the live price exceeds it (the
  ///         price only ever declines, so this just protects against a stale
  ///         quote). Pay the exact current price; no overpayment is kept.
  ///         현재가로 구매. 원자적: 구매자 스테이블코인 회수와 NFT 이전을 한
  ///         트랜잭션에서. `maxPrice`는 구매자 슬리피지 가드 — 실시간 가격이 이를
  ///         넘으면 revert(가격은 하락만 하므로 stale 견적 방어용). 정확히 현재가만
  ///         받고 초과분은 보관하지 않음.
  function buy(uint256 tokenId, uint256 maxPrice) external nonReentrant {
    Auction storage a = auctions[tokenId];
    if (a.seller == address(0)) revert AuctionNotFound(tokenId);
    if (a.settled) revert AlreadySettled(tokenId);
    if (block.timestamp >= a.endTime) revert AuctionEnded(tokenId);

    uint256 price = currentPrice(tokenId);
    if (price > maxPrice) revert BadPrices(); // slippage guard

    // Re-check ownership at purchase.
    //   구매 시점 소유권 재확인.
    if (registrar.ownerOf(tokenId) != a.seller) revert SellerNoLongerOwns(tokenId);

    a.settled = true; // effects first (CEI)

    uint256 fee = (feeRecipient != address(0) && protocolFeeBps > 0)
      ? (price * protocolFeeBps) / 10000 : 0;
    uint256 sellerProceeds = price - fee;

    IERC20 pay = IERC20(a.payToken);
    pay.safeTransferFrom(msg.sender, a.seller, sellerProceeds);   // buyer → seller
    if (fee > 0) pay.safeTransferFrom(msg.sender, feeRecipient, fee);
    registrar.safeTransferFrom(a.seller, msg.sender, tokenId);    // NFT → buyer
    // DXRegistrar._update moves registry control + subname subtree to buyer.

    emit DutchAuctionSold(tokenId, a.seller, msg.sender, a.payToken, price, fee);
  }

  // ── Cancel ────────────────────────────────────────────────────────────────
  /// @notice Cancel an unsold Dutch auction. Seller-only.
  ///         미판매 네덜란드식 경매 취소. 판매자 전용.
  function cancelAuction(uint256 tokenId) external {
    Auction storage a = auctions[tokenId];
    if (a.seller == address(0) || a.settled) revert AuctionNotFound(tokenId);
    if (a.seller != msg.sender) revert NotSeller(tokenId, msg.sender);
    a.settled = true;
    emit DutchAuctionCancelled(tokenId);
    _notifyMetadataUpdate(tokenId);
  }

  // ── Views ─────────────────────────────────────────────────────────────────
  /// @notice True if a live (created, not settled, seller still owns) auction
  ///         exists. Used for the AUCTION mark and mutual exclusion.
  ///         진행 중(생성됨·미정산·판매자 소유) 경매가 있으면 true. AUCTION 마크와
  ///         상호 배타 검사에 사용.
  function isOnAuction(uint256 tokenId) external view returns (bool) {
    Auction memory a = auctions[tokenId];
    if (!_isActive(a)) return false;
    try registrar.ownerOf(tokenId) returns (address o) {
      return o == a.seller;
    } catch { return false; }
  }

  function getAuction(uint256 tokenId)
    external view
    returns (address seller, address payToken, uint256 startPrice,
             uint256 floorPrice, uint256 startTime, uint256 endTime, uint256 stepInterval,
             uint256 dropPerStep, bool settled)
  {
    Auction memory a = auctions[tokenId];
    return (a.seller, a.payToken, a.startPrice, a.floorPrice,
            a.startTime, a.endTime, a.stepInterval, a.dropPerStep, a.settled);
  }

  function _isActive(Auction memory a) internal view returns (bool) {
    return a.seller != address(0) && !a.settled && block.timestamp < a.endTime;
  }

  function _notifyMetadataUpdate(uint256 tokenId) internal {
    // Cosmetic ERC-4906 ping. Only call if the registrar still recognizes this
    // contract as its Dutch-auction notifier; otherwise skip silently so the
    // core trade never depends on notifier wiring.
    //   표시용 ERC-4906 알림. registrar가 이 컨트랙트를 Dutch 경매 notifier로
    //   인식할 때만 호출하고, 아니면 조용히 건너뛴다 — 핵심 거래는 이에 의존하지 않음.
    if (registrar.dutchAuction() == address(this)) {
      registrar.notifyMetadataUpdate(tokenId);
    }
  }
}
