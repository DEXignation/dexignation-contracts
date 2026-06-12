# Deployments

Deployed address registry for DEXignation contracts. The `ignition/deployments/`
build cache is git-ignored, so any addresses needed for operations are tracked
here instead.

> Source verification (Polygonscan) is deferred until after the audit, to verify
> against the final reviewed code in a single pass.

---

## Polygon Mainnet (chain 137)

Deployed: 2026-06-12
Modules: `DXDeployPolygon.ts` (core) + `DXDeployTradingPolygon.ts` (trading)

### Core

| Contract | Address | Role |
|----------|---------|------|
| DXRegistry | `0xCF223951E5bc4fdc6020B13841164063EB3f8BD2` | Name registry (source of truth for ownership, expiry, sale-lock) |
| DXRegistrar | `0x955e12C3FbEED058794078726DcAA2f984194e7B` | `.dex` 2LD issuance, NFT, expiry management |
| DXResolver | `0x67f1986B4be10F2504A4028B560cAC10A105d359` | Record resolution (addr/text/contenthash/agent/multilingual) |
| DXRegistrarController | `0x6aEe51C1D1B7493223c005BEf23D7368093d0FA7` | Registration entry point (commit-reveal, payment, discounts) |
| DXPriceOracle | `0x4431afFF966288794e157fAC4E2a38d9A8cC8835` | Rent pricing, POL/USD conversion |
| DXReverseRegistrar | `0xe75Bc8FA45544c0F42B534D8271D279296e640F0` | Reverse resolution (addr → name) |
| DXReservations | `0xdCB2d72a601701826eac1B18cE6d2959e345858D` | Trademark / premium label reservations |
| **DXSubnameRegistrar** | `0x78De395499ADE08b091d1F0f71bcFeE3b3C58e29` | **Subname sale-lock commerce module** |
| RevenueDistributor | `0x5A3638Df11feF62076fEe45C8E95D751c7eD671a` | Revenue split (treasury/staking/burn/buffer) |
| DXNToken | `0x60E7A992bE5cCA6b674350588A1eE9E1eF5047C1` | DXN governance / utility token |
| DXNStaking | `0x90f3636D853DD54dcD96D1E37B419C70cE522fb6` | DXN staking (discounts, rewards) |
| DXContributionSBT | `0xf091Cc297256DcD24702bAC7D5B9009616e4caeA` | Contributor SBT (non-transferable badge) |

### Trading

| Contract | Address | Role |
|----------|---------|------|
| DXMarketplace | `0x8a432bDf993871badBe591347F425750Ba182B95` | Fixed-price secondary sales |
| DXEnglishAuction | `0xC2AE35d59Db850A723178Ed35A28dfCD068FaFbb` | English (ascending) auction |
| DXDutchAuction | `0x4B5F75c9e348711C56aAd45aC2a8EFCD68657719` | Dutch (descending) auction |
| DXSubscriptionRenewer | `0x511e04A19fA0a61FC36348a332Ca057FfDB49e63` | Subscription auto-renewal |

### External dependencies (Polygon mainnet)

| Item | Address |
|------|---------|
| Chainlink POL/USD feed | `0xAB594600376Ec9fD91F8e885dADF0CE036862dE0` |
| USDC | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |

---

## Polygon Amoy Testnet (chain 80002)

Deployed: 2026-06-12
Module: `DXDeployAmoyMock.ts` (mock price feed — the live Amoy Chainlink feed is
dead and reverts on read, so a MockPriceOracle is deployed in its place)

> For testnet verification. Includes core + subname module only; no
> RevenueDistributor, DXN, or trading layer.

| Contract | Address |
|----------|---------|
| DXRegistry | `0x60E7A992bE5cCA6b674350588A1eE9E1eF5047C1` |
| DXRegistrar | `0x955e12C3FbEED058794078726DcAA2f984194e7B` |
| DXResolver | `0x67f1986B4be10F2504A4028B560cAC10A105d359` |
| DXRegistrarController | `0x6aEe51C1D1B7493223c005BEf23D7368093d0FA7` |
| DXPriceOracle | `0xf091Cc297256DcD24702bAC7D5B9009616e4caeA` |
| DXReverseRegistrar | `0xe75Bc8FA45544c0F42B534D8271D279296e640F0` |
| DXReservations | `0x4431afFF966288794e157fAC4E2a38d9A8cC8835` |
| DXSubnameRegistrar | `0x55f54f515B1778352428B7BfF93659312013f29a` |
| MockPolUsd (price feed) | `0xCF223951E5bc4fdc6020B13841164063EB3f8BD2` |
| TestUSDC | `0xdCB2d72a601701826eac1B18cE6d2959e345858D` |
| TestUSDT | `0xD4f9D757662e6fd9C33EbCE83384EFbE2a17a762` |

> Note: some addresses match those on mainnet (e.g. DXRegistrar `0x955e...`).
> This is expected — Ignition derives addresses deterministically from the
> deployer nonce, so the same nonce on a different chain yields the same address.
> They are distinct contracts on distinct networks.

---

## Post-deployment operations

### Opening subname sales (done by each parent-domain owner)

Sale-module authorisation (`setSaleModule`) is handled automatically at deploy
time. Before selling, each parent owner only needs to **delegate** the module:

```
registry.setApprovalForAll(<DXSubnameRegistrar>, true)
```

Then configure the sale via
`DXSubnameRegistrar.configureSubname(node, price, duration, enabled)`.

### Authority checks

- `DXRegistry` root-node (0x0) owner = admin wallet (holds `setSaleModule` authority)
- `RevenueDistributor` treasury / feeRecipient = intended wallet
- Confirm the scheduled fund-sweeping target matches

### Constructor args for verification

Key contracts whose verification requires constructor arguments:

- DXSubnameRegistrar: `(registry, resolver, revenueDistributor, 500)`
- DXRegistrar: `(registry, TLD_NODE, "dex")`
- DXRegistrarController: `(registrar, registry, priceOracle)`
- DXResolver: `(registry)`
- RevenueDistributor: distribution-config struct (treasury/staking/burn/buffer BPS)
