// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — DXPriceOracle
//
// The "USD-denominated rent prices converted to the native asset via a
// Chainlink Aggregator" pattern follows ENS's `StablePriceOracle` family
// (MIT, https://github.com/ensdomains/ens-contracts). This file extends the
// pattern with:
//
//   - A fixed-tier pricing model (1 / 3 / 5 / 10 years) instead of per-second
//     pricing with optional premium decay.
//   - A dual conversion path (POL/USD direct OR LINK/POL × LINK/USD) to
//     accommodate networks where a direct POL/USD feed is unavailable or
//     less trustworthy.
//   - Strict staleness guards (`maxOracleDelay`) on every read.
//
// Original concepts authored by Nick Johnson / ENS Labs (MIT).
// Modifications and dual-path implementation Copyright (c) 2026 DEXignation,
// MIT License.
//
// "USD 기반 가격을 Chainlink Aggregator로 네이티브 자산 단위로 변환"하는
// 패턴은 ENS `StablePriceOracle` 계열 (MIT)을 따른다. 본 파일은 다음을
// 추가했다:
//   - 1/3/5/10년 고정 구간 가격 모델 (ENS는 초당 가격 + premium decay)
//   - dual-path 환산 (POL/USD 직접 OR LINK/POL × LINK/USD 우회) — POL/USD
//     피드가 없거나 신뢰도가 떨어지는 네트워크 대비
//   - 모든 오라클 read에 staleness 가드 (`maxOracleDelay`)
//
// 원본 컨셉은 Nick Johnson / ENS Labs (MIT) 작성, 변경 및 dual-path 구현은
// © 2026 DEXignation, MIT License.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IDXPriceOracle} from "./IDXPriceOracle.sol";

/// @notice Minimal Chainlink AggregatorV3 interface.
///         최소 Chainlink AggregatorV3 인터페이스.
interface AggregatorV3Interface {
  function decimals() external view returns (uint8);
  function latestRoundData()
    external
    view
    returns (
      uint80 roundId,
      int256 answer,
      uint256 startedAt,
      uint256 updatedAt,
      uint80 answeredInRound
    );
}

/// @title  DXPriceOracle
/// @notice Converts a fixed-tier attoUSD rent price into a wei amount of the
///         native asset (POL), with two selectable conversion paths.
///         고정 구간 attoUSD 가격을 네이티브 자산(POL) wei 단위로 변환.
///         두 가지 환산 경로 선택 가능.
contract DXPriceOracle is IDXPriceOracle, Ownable {

  /// @notice Conversion path.
  ///         가격 산정 경로.
  ///         Direct  : Use a single POL/USD aggregator.
  ///                   POL/USD 피드로 직접 환산.
  ///         ViaLink : Use LINK/USD ÷ LINK/POL as a synthetic POL/USD.
  ///                   LINK/USD ÷ LINK/POL 로 POL/USD를 우회 환산.
  enum PriceSource { Direct, ViaLink }

  PriceSource public priceSource;

  AggregatorV3Interface public polUsdOracle;
  AggregatorV3Interface public linkPolOracle;
  AggregatorV3Interface public linkUsdOracle;

  /// @notice Rent prices, denominated in `attoUSD` (1 USD == 1e18).
  ///         attoUSD($1 = 1e18) 단위의 등록·갱신 가격.
  uint256 public immutable price1Year;
  uint256 public immutable price3Year;
  uint256 public immutable price5Year;
  uint256 public immutable price10Year;

  /// @notice Maximum acceptable staleness for any oracle read.
  ///         오라클 read의 최대 허용 staleness.
  uint256 public maxOracleDelay = 26 hours;

  uint256 internal constant DURATION_1Y = 365 days;
  uint256 internal constant DURATION_3Y = 3 * 365 days;
  uint256 internal constant DURATION_5Y = 5 * 365 days;
  uint256 internal constant DURATION_10Y = 10 * 365 days;

  // ── Premium decay parameters / Premium 감쇠 파라미터 ────────────────────────
  //
  // When a name has just exited its grace period, an additional premium is
  // charged on top of the regular rent. The premium decays via repeated
  // half-lives until it reaches zero after `_premiumDuration` seconds.
  //
  // The model is intentionally simple to keep the on-chain arithmetic
  // friendly: at each `_premiumHalfLife` interval the remaining premium is
  // halved, with a final linear ramp-down to 0 at `_premiumDuration` so the
  // function is continuous.
  //
  // 유예 기간이 막 종료된 이름에는 정상 임대료 위에 추가 premium이 붙는다.
  // 이 premium은 반감기마다 절반씩 줄다가 `_premiumDuration` 초 후에 0이
  // 된다. 온체인 산술이 단순하도록 의도된 모델.
  uint256 public initialPremium;        // attoUSD
  uint256 public premiumDuration;       // seconds, 0 disables premium
  uint256 public premiumHalfLife;       // seconds; 0 disables premium

  event PremiumConfigured(
    uint256 initialPremium,
    uint256 premiumDuration,
    uint256 premiumHalfLife
  );

  /// @param _rentPrices Array of 4 attoUSD prices in order: [1y, 3y, 5y, 10y].
  ///                    1/3/5/10년 attoUSD 가격 배열.
  constructor(uint256[] memory _rentPrices) Ownable(msg.sender) {
    if (_rentPrices.length != 4) revert InvalidRentPricesLength();

    price1Year = _rentPrices[0];
    price3Year = _rentPrices[1];
    price5Year = _rentPrices[2];
    price10Year = _rentPrices[3];

    // Default: premium disabled. Owner enables it via `setPremiumConfig`
    // once a price discovery mechanism (auction / batch sale) is in place.
    //
    // 기본값: premium 비활성. 경매·일괄판매 같은 가격 발견 메커니즘이 준비된
    // 뒤 owner가 `setPremiumConfig`로 활성화한다.
    initialPremium = 0;
    premiumDuration = 0;
    premiumHalfLife = 0;
  }

  /// @notice Configure the premium decay curve. Owner-only.
  ///         Premium 감쇠 곡선 설정. 오너 전용.
  /// @param _initialPremium  attoUSD premium at the moment grace ends.
  ///                         유예 종료 시점의 premium 시작값.
  /// @param _premiumDuration How long the premium decays to 0 (seconds).
  ///                         premium이 0이 될 때까지의 시간(초).
  /// @param _premiumHalfLife Half-life of the decay (seconds). Must be > 0
  ///                         and < `_premiumDuration`. Use 1 day for a
  ///                         steep curve, 7 days for a gentle one.
  ///                         반감기. 0보다 크고 `_premiumDuration`보다 작아야.
  function setPremiumConfig(
    uint256 _initialPremium,
    uint256 _premiumDuration,
    uint256 _premiumHalfLife
  ) external onlyOwner {
    if (_premiumDuration == 0) {
      // Disable premium entirely.
      initialPremium = 0;
      premiumDuration = 0;
      premiumHalfLife = 0;
      emit PremiumConfigured(0, 0, 0);
      return;
    }
    if (_premiumHalfLife == 0 || _premiumHalfLife >= _premiumDuration) {
      revert InvalidPremiumConfig();
    }
    initialPremium = _initialPremium;
    premiumDuration = _premiumDuration;
    premiumHalfLife = _premiumHalfLife;
    emit PremiumConfigured(_initialPremium, _premiumDuration, _premiumHalfLife);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Owner configuration / 오너 설정
  // ──────────────────────────────────────────────────────────────────────────

  /// @notice Configure the Direct (POL/USD) aggregator and switch to it.
  ///         Direct(POL/USD) 오라클 설정 및 전환.
  function setPolUsdOracle(address _polUsdOracle) external onlyOwner {
    polUsdOracle = AggregatorV3Interface(_polUsdOracle);
    priceSource = PriceSource.Direct;
  }

  /// @notice Configure the LINK-based oracles and switch to ViaLink.
  ///         LINK 기반 오라클 설정 및 ViaLink로 전환.
  function setLinkPolOracle(
    address _linkPolOracle,
    address _linkUsdOracle
  ) external onlyOwner {
    linkPolOracle = AggregatorV3Interface(_linkPolOracle);
    linkUsdOracle = AggregatorV3Interface(_linkUsdOracle);
    priceSource = PriceSource.ViaLink;
  }

  /// @notice Switch the active conversion path. The corresponding aggregators
  ///         must already be configured.
  ///         환산 경로를 전환. 해당 오라클이 사전 설정되어 있어야 한다.
  function setPriceSource(PriceSource _source) external onlyOwner {
    if (_source == PriceSource.Direct) {
      if (address(polUsdOracle) == address(0)) revert OracleNotConfigured();
    } else {
      if (
        address(linkPolOracle) == address(0) ||
        address(linkUsdOracle) == address(0)
      ) revert OracleNotConfigured();
    }

    priceSource = _source;
  }

  /// @notice Set the staleness threshold (1h ~ 48h).
  ///         staleness 임계치 설정 (1시간 ~ 48시간).
  function setMaxoracleDelay(uint256 delay) external onlyOwner {
    if (delay < 1 hours || delay > 48 hours) revert InvalidOracleDelay();
    maxOracleDelay = delay;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Price queries / 가격 조회
  // ──────────────────────────────────────────────────────────────────────────

  /// @inheritdoc IDXPriceOracle
  function price(uint256 duration) external view override returns (uint256) {
    return attoUSDToWei(_priceAttoUSD(duration));
  }

  /// @inheritdoc IDXPriceOracle
  function priceAttoUSD(
    uint256 duration
  ) external view override returns (uint256) {
    return _priceAttoUSD(duration);
  }

  /// @inheritdoc IDXPriceOracle
  function premiumAttoUSD(uint256 expiredAt)
    external
    view
    override
    returns (uint256)
  {
    // Premium disabled: short-circuit.
    // premium 비활성화 상태: 빠른 반환.
    if (premiumDuration == 0 || initialPremium == 0) return 0;

    // Future timestamp or "not yet expired": no premium.
    // 미래 시각이거나 아직 만료 전: premium 없음.
    if (expiredAt >= block.timestamp) return 0;

    uint256 elapsed = block.timestamp - expiredAt;
    if (elapsed >= premiumDuration) return 0;

    // Half-life decay: `halvings` whole half-lives have elapsed, plus a
    // fractional remainder which we approximate linearly across the final
    // half-life. Result = initialPremium * (1/2)^halvings * (1 - frac/HL/2)
    //
    // For a linear-decay fallback we instead do:
    //   premium = initialPremium * (premiumDuration - elapsed) / premiumDuration
    // but the half-life curve gives more time for price discovery near the
    // start of the window where the name is most valuable.
    //
    // 반감기 감쇠: `halvings`번의 반감기가 지났고 나머지는 마지막 반감기
    // 안에서 선형 보간한다. 이름 가치가 가장 높은 초기 구간에서 가격 발견
    // 시간을 더 길게 주기 위해 선형 감쇠 대신 반감기 곡선 사용.
    uint256 halvings = elapsed / premiumHalfLife;
    // Cap halvings to avoid shifting by more than 255 (Solidity reverts).
    // halvings를 안전한 상한으로 제한.
    if (halvings >= 256) return 0;

    uint256 base = initialPremium >> halvings;
    uint256 remainder = elapsed - halvings * premiumHalfLife;

    // Linear interp from `base` to `base/2` across the current half-life.
    //   현재 반감기 구간 안에서 base → base/2로 선형 보간.
    uint256 halfwayDelta = (base * remainder) / (2 * premiumHalfLife);
    return base - halfwayDelta;
  }

  /// @inheritdoc IDXPriceOracle
  // The premium getters are inherited from the public state variables, but
  // the interface signatures don't auto-resolve to those if we keep `view`
  // on a separate function. The compiler matches public state-variable
  // getters against view functions of the same name, so no override needed.

  /// @dev Return the attoUSD price for one of the allowed durations.
  ///      허용된 구간(1/3/5/10년)에 대한 attoUSD 가격 반환.
  function _priceAttoUSD(
    uint256 duration
  ) internal view returns (uint256 basePrice) {
    if (duration == 0) revert InvalidDuration();

    if (duration == DURATION_1Y) {
      return price1Year;
    } else if (duration == DURATION_3Y) {
      return price3Year;
    } else if (duration == DURATION_5Y) {
      return price5Year;
    } else if (duration == DURATION_10Y) {
      return price10Year;
    }
    revert InvalidDuration();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // attoUSD → POL(wei) conversion / attoUSD → POL(wei) 환산
  // ──────────────────────────────────────────────────────────────────────────

  /// @dev Dispatch to the selected conversion path.
  ///      선택된 환산 경로로 분기.
  function attoUSDToWei(uint256 amount) internal view returns (uint256) {
    if (priceSource == PriceSource.Direct) {
      return _attoUSDToWeiViaPolUsd(amount);
    }
    return _attoUSDToWeiViaLink(amount);
  }

  /// @dev Direct conversion via the POL/USD aggregator.
  ///      Given:    answer = POL/USD * 10^d
  ///      Result:   wei = amount * 10^d / answer
  ///
  ///      POL/USD 오라클로 직접 환산.
  function _attoUSDToWeiViaPolUsd(
    uint256 amount
  ) internal view returns (uint256) {
    if (address(polUsdOracle) == address(0)) revert OracleNotConfigured();

    (uint256 polUsd, uint256 polUsdScale) = _readPrice(polUsdOracle);
    return (amount * polUsdScale) / polUsd;
  }

  /// @dev Indirect conversion via two LINK aggregators.
  ///      POL/USD = (LINK/USD) / (LINK/POL)
  ///      wei = amount * (LINK/POL) * (LINK/USD scale)
  ///            ─────────────────────────────────────
  ///                (LINK/USD) * (LINK/POL scale)
  ///
  ///      두 개의 LINK 오라클로 우회 환산.
  function _attoUSDToWeiViaLink(
    uint256 amount
  ) internal view returns (uint256) {
    if (address(linkPolOracle) == address(0)) revert OracleNotConfigured();
    if (address(linkUsdOracle) == address(0)) revert OracleNotConfigured();

    (uint256 linkPol, uint256 linkPolScale) = _readPrice(linkPolOracle);
    (uint256 linkUsd, uint256 linkUsdScale) = _readPrice(linkUsdOracle);

    return (amount * linkPol * linkUsdScale) / (linkUsd * linkPolScale);
  }

  /// @dev Read the latest answer from a Chainlink aggregator, applying
  ///      validity and staleness checks.
  ///      Chainlink 오라클의 최신 가격을 읽고 유효성/staleness 검사.
  /// @return priceVal The positive answer as `uint256` / 양의 정수로 변환된 가격
  /// @return scale    `10 ** decimals` / 10^decimals
  function _readPrice(
    AggregatorV3Interface oracle
  ) internal view returns (uint256 priceVal, uint256 scale) {
    (, int256 answer, , uint256 updatedAt, ) = oracle.latestRoundData();

    if (answer <= 0) revert InvalidOraclePrice();

    if (updatedAt == 0 || block.timestamp - updatedAt >= maxOracleDelay) {
      revert StaleOraclePrice();
    }

    priceVal = uint256(answer);
    scale = 10 ** uint256(oracle.decimals());
  }
}
