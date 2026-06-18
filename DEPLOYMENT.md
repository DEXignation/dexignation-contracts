# DEXignation — Polygon Mainnet Deployment Record

> Canonical deployment of the DEXignation (`.dex`) name service core contracts
> on Polygon mainnet (chainId 137), deployed deterministically via CreateX
> with `0xdeed…` vanity addresses.

## Summary

| Field | Value |
|---|---|
| Network | Polygon mainnet (chainId **137**) |
| Deploy method | CreateX `deployCreate2` (permissionless free salt) |
| CreateX factory | `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` |
| Deployer (gas) | `0xd32BEFBB3deBDa5D1Eb43Ccf3Ce46aFE82732572` |
| Contract owner | `0xd32BEFBB3deBDa5D1Eb43Ccf3Ce46aFE82732572` |
| Vanity prefix | `0xdeed` (all 12 core contracts) |
| Deploy blocks | 88717287 – 88717319 |
| Compiler | solc 0.8.28, optimizer runs=200, viaIR=true, evmVersion=cancun |
| TLD | `.dex` |

> **Important:** the `owner` address is embedded in each contract's init code
> (constructor `address _owner`). Re-deploying with a different owner would
> produce different addresses. Do **not** change source or compiler settings if
> these addresses must remain stable.

## Deployed Contracts

| # | Deed | Contract | Address |
|---|------|----------|---------|
| 0 | deed0 | DXRegistry | `0xdEED0a23B6a57d81c69782E2333ab429BA10C332` |
| 1 | deed1 | DXNToken | `0xDEED17AD8aF17Dc6D967B39009b16F484aAf4285` |
| 2 | deed2 | DXRegistrar | `0xDEed2BC23B99610b1928eEa27f332f5c8e9d90aC` |
| 3 | deed3 | DXPriceOracle | `0xDeED39E1B5dFEDD2322919E67697FBa392d45113` |
| 4 | deed4 | DXResolver | `0xdEED4150C60d0861116E0b742Ab6D4f66a77Cb4F` |
| 5 | deed5 | DXReverseRegistrar | `0xdeed57479A57218D80E246AA378bc2580637aa67` |
| 6 | deed6 | DXReservations | `0xDeed6B6Ae907B2c5266aDBB0Cc85e75B8bCb5d9C` |
| 7 | deed7 | DXContributionSBT | `0xDeed7Eb1B1895CEfebBd295d8E75B962E558C9F8` |
| 8 | deed8 | DXNStaking | `0xdeED8a3189771B452aCD890b29e592B4f47D125d` |
| 9 | deed9 | RevenueDistributor | `0xdEEd9070Ae32135D91e2B42758e6ea936Dd31F7E` |
| 10 | deed10 | DXRegistrarController | `0xdeEd10f4cea4a7E77c370d5aFf3078D86d1394eE` |
| 11 | deed11 | DXSubnameRegistrar | `0xDEeD113cc1A2cD3995f29525b0ba7Abf43eb1F3C` |

## Deployment Transactions

| Contract | Block | Tx hash |
|----------|-------|---------|
| DXRegistry | 88717287 | `0x9162227fddf4527d129ad0427e713160cd34131567feaf4ead30a6ebb4b4c7ae` |
| DXNToken | 88717289 | `0x675ddb669cfe9f458985366b2b02bccf5593cc0226fc6fdd9719c958d56f8b1a` |
| DXPriceOracle | 88717292 | `0x28bde6471c3259bd418657105365456c81cce4111e01b291179d3b74c9838034` |
| DXReservations | 88717295 | `0x6c0743f023a0e73d729d2208192f7e4dd0d04de18f8df533d501a0016ef442f5` |
| DXContributionSBT | 88717298 | `0x1b73ee69ef6d80f4f541ce12c16103424da18ab49c398f233ce1c56776b4f9a1` |
| DXRegistrar | 88717301 | `0x6ec4af4a79a0fadb7ef346540cde2a8db8465667b67a12da56de3690ad18a01b` |
| DXResolver | 88717304 | `0xcdbfee23f1916cca1fb93d7c4e8d4bd85bd0e96f940c205f7f30f277eacf33d7` |
| DXNStaking | 88717307 | `0x38d5f1729bb6733786b35b35be2f872da40217ea2a4724fc6442e2b789dd34b3` |
| DXReverseRegistrar | 88717310 | `0x0af14b955bfd96fd5a1e85e354e0e5c1d0e792fdcd41ea682c715d4a52d1064c` |
| RevenueDistributor | 88717313 | `0xd493a226bf02c747054b00599c39331c475f5cebedc28b1bd5dcdb77a2e0f948` |
| DXRegistrarController | 88717316 | `0xee5d658fa2c08922b4502b73d1dc4c857f0cc4582b76c85b51e9eff45a7cedae` |
| DXSubnameRegistrar | 88717319 | `0xc2d61830495dcd86a0b17e0b0c11e58ef3783f2ece9c212ba7004688f90099f1` |

## Constructor Configuration

| Contract | Constructor args |
|----------|------------------|
| DXRegistry | `(owner)` — root node `0x0` owner set to `owner` |
| DXNToken | `("DEXignation Token", "DXN", 100_000_000e18, owner)` — `owner` is initial minter |
| DXPriceOracle | `([8,18,25,40,55]e18, owner)` — 1/2/3/4/5-year rent prices |
| DXReservations | `(owner)` |
| DXContributionSBT | `(owner)` |
| DXRegistrar | `(registry, TLD_NODE, "dex", owner)` — default royalty recipient = `owner` |
| DXResolver | `(registry, owner)` |
| DXNStaking | `(dxnToken, owner)` |
| DXReverseRegistrar | `(registry, resolver)` — no owner concept |
| RevenueDistributor | `(Shares{treasury, staking, nativeStakingProxy, burn, buffer, 6000, 3000, 0, 1000}, owner)` |
| DXRegistrarController | `(registrar, registry, priceOracle, owner)` |
| DXSubnameRegistrar | `(registry, resolver, revenueDistributor, 500, owner)` — 5% protocol fee |

`TLD_NODE = keccak256(0x0 ++ keccak256("dex"))`. Burn address `0x…dEaD`.
RevenueDistributor split: treasury 60% / staking 30% / burn 0% / buffer 10%.

## Post-deploy Wiring (18 calls, all signed by `owner`)

1. `registry.setSubnodeOwner(0x0, hash("dex"), registrar)` — grant TLD to registrar
2. `registry.setSubnodeOwner(0x0, hash("reverse"), owner)` — create reverse node
3. `registry.setSubnodeOwner(reverseNode, hash("addr"), reverseRegistrar)`
4. `registrar.addController(controller)`
5. `priceOracle.setPolUsdOracle(POL/USD feed)`
6. `controller.setAllowedPaymentToken(USDC, true)`
7. `controller.setAllowedPaymentToken(USDT, true)`
8. `controller.setReservations(reservations)`
9. `registrar.setResolver(resolver)`
10. `resolver.setRegistrar(registrar)`
11. `registry.setRecordInvalidator(resolver)`
12. `resolver.setRecordInvalidator(registry, true)`
13. `registry.setSaleModule(subnameRegistrar, true)`
14. `controller.setStakeDiscount(staking, 100e18 threshold, 250 bps)`
15. `dxnStaking.setNotifier(revenueDistributor, true)`
16. `revenueDistributor.setStakingNotifier(staking)`
17. `dxnToken.setMinter(controller, true)`
18. `controller.setDxnReward(dxnToken, 1000 bps, 2e18 atto-USD price)`

## External Addresses (Polygon mainnet)

| Name | Address |
|------|---------|
| Chainlink POL/USD feed | `0xAB594600376Ec9fD91F8e885dADF0CE036862dE0` |
| USDC | `0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359` |
| USDT | `0xc2132D05D31c914a87C6611C10748AEb04B58e8F` |

## Verification State

- 218/218 test suite passing against patched contracts (local hardhat).
- On-chain owner confirmed = `0xd32BEFBB3deBDa5D1Eb43Ccf3Ce46aFE82732572` on all
  ownable contracts (DXRegistry stores root owner in `records[0x0]`;
  DXReverseRegistrar has no owner — both by design).
- DXNToken on-chain identity confirmed: name/symbol/cap match.

## Outstanding Operational Tasks

- [ ] Verify all 12 contracts on Polygonscan (same compiler settings).
- [ ] (Optional) Repoint DXRegistrar royalty recipient to treasury via `setRoyaltyInfo`.
- [ ] (Optional) Transfer ownership to a multisig (Safe) via `transferOwnership` per contract.
- [ ] Build MetaMask Snap + resolver API reading DXResolver for cross-chain `.dex` lookup.

## Notes

- An earlier deployment attempt left abandoned contracts at different `0xdeed…`
  addresses whose owner is the CreateX factory (`0xba5Ed0…`). Those are
  unreachable (no owner control) and must be ignored; the addresses in this
  document are the canonical, owner-controlled deployment.
