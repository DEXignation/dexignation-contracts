# Third-Party Licenses / 외부 라이선스 고지

This document lists third-party open-source software incorporated into
DEXignation's smart contracts. We are deeply grateful to the projects below
and to the broader Ethereum/Polygon open-source community.

본 문서는 DEXignation 스마트 컨트랙트에 포함된 외부 오픈소스 소프트웨어를
정리합니다. 아래 프로젝트와 더 넓은 Ethereum/Polygon 오픈소스 커뮤니티에
깊이 감사드립니다.

---

## 1. Ethereum Name Service (ENS) — `ensdomains/ens-contracts`

- **Repository**: https://github.com/ensdomains/ens-contracts
- **Maintainer**: Nick Johnson and ENS Labs
- **License**: MIT
- **Used by**: Architectural patterns and partial implementations across the
  registry, registrar, registrar-controller, reverse-registrar, namehash
  utilities, and string-length helper.
- **저장소**: https://github.com/ensdomains/ens-contracts
- **유지보수**: Nick Johnson 및 ENS Labs
- **라이선스**: MIT
- **사용 범위**: 레지스트리, Registrar, Registrar Controller, Reverse Registrar,
  namehash 유틸리티, 문자열 길이 헬퍼 등 전반의 아키텍처 패턴 및 부분 구현.

The relevant DEXignation files reference their ENS counterparts in the file
header. DEXignation does not re-license ENS code; the ENS portions remain
under the original MIT License reproduced below.

해당 DEXignation 파일은 각 파일 헤더에서 ENS 원본 파일을 명시합니다.
DEXignation은 ENS 코드를 재라이선스하지 않으며, ENS 파생 부분은 아래
원본 MIT 라이선스 하에 유지됩니다.

### Files derived from ENS / ENS에서 파생된 파일

| DEXignation file                              | ENS counterpart                                               |
| --------------------------------------------- | ------------------------------------------------------------- |
| `contracts/registry/DXRegistry.sol`           | `contracts/registry/ENSRegistry.sol`                          |
| `contracts/registry/IDXRegistry.sol`          | `contracts/registry/ENS.sol`                                  |
| `contracts/registrar/DXRegistrar.sol`         | `contracts/ethregistrar/BaseRegistrarImplementation.sol`      |
| `contracts/registrar/IDXRegistrar.sol`        | `contracts/ethregistrar/BaseRegistrar.sol`                    |
| `contracts/registrar/DXRegistrarController.sol` | `contracts/ethregistrar/ETHRegistrarController.sol`         |
| `contracts/registrar/IDXRegistrarController.sol` | `contracts/ethregistrar/IETHRegistrarController.sol`       |
| `contracts/registrar/DXReverseRegistrar.sol`  | `contracts/reverseRegistrar/ReverseRegistrar.sol`             |
| `contracts/utils/DXNamehash.sol`              | Algorithm per EIP-137; pattern from ENS sources               |
| `contracts/utils/StringUtils.sol`             | `contracts/ethregistrar/StringUtils.sol`                      |
| `contracts/oracle/DXPriceOracle.sol`          | `contracts/ethregistrar/StablePriceOracle.sol` (pattern only) |
| `contracts/oracle/IDXPriceOracle.sol`         | `contracts/ethregistrar/IPriceOracle.sol`                     |

### ENS License (MIT, reproduced verbatim)

```
The MIT License (MIT)

Copyright (c) 2018 True Names Limited

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 2. OpenZeppelin Contracts — `OpenZeppelin/openzeppelin-contracts`

- **Repository**: https://github.com/OpenZeppelin/openzeppelin-contracts
- **License**: MIT
- **Used by**:
  - `ERC721`, `IERC721` — base for the domain NFT.
  - `Ownable` — admin authority.
  - `IERC20`, `IERC20Metadata`, `SafeERC20`, `ERC20` — stablecoin payment and
    test mock.
  - `ReentrancyGuard` — re-entrancy protection on the controller.
  - `Base64` — encoding for the on-chain `tokenURI`.

OpenZeppelin Contracts are imported via npm and are not redistributed in this
repository. They remain under the original MIT License.

OpenZeppelin Contracts는 npm으로 가져오며 본 저장소에 재배포되지 않습니다.
원본 MIT License 하에 유지됩니다.

---

## 3. Chainlink — `smartcontractkit/chainlink-local`

- **Repository**: https://github.com/smartcontractkit/chainlink-local
- **License**: Apache License 2.0
- **Used by**: `contracts/mocks/MockPriceOracle.sol` extends
  `MockV3Aggregator` from `@chainlink/local` for Hardhat tests. This is a
  test-only dependency and is not deployed to production networks.

`@chainlink/local`의 `MockV3Aggregator`를 Hardhat 테스트용으로 확장하기 위해
사용. 테스트 전용이며 프로덕션 네트워크에는 배포되지 않습니다.

The full Apache 2.0 License text is available at
https://www.apache.org/licenses/LICENSE-2.0.

---

## 4. Chainlink Price Feeds (on-chain dependency)

- **Provider**: Chainlink data feeds, accessed via the standard
  `AggregatorV3Interface`.
- **Used by**: `DXPriceOracle` reads `latestRoundData()` from POL/USD,
  LINK/USD, and LINK/POL aggregators on Polygon.

Chainlink price feed contracts are external on-chain services and are not
incorporated into this codebase; only their interface is referenced.

Chainlink 가격 피드 컨트랙트는 외부 온체인 서비스이며 본 코드베이스에
포함되지 않습니다. 인터페이스만 참조합니다.

---

## Summary table / 요약

| Component                          | License    | Distribution                |
| ---------------------------------- | ---------- | --------------------------- |
| ENS-derived files                  | MIT        | Included in this repo       |
| OpenZeppelin Contracts             | MIT        | Pulled via npm              |
| `@chainlink/local` (test mock)     | Apache-2.0 | Pulled via npm              |
| Chainlink mainnet price feeds      | N/A        | External on-chain service   |

---

If you spot an attribution we have missed, please open an issue or a pull
request and we will address it promptly.

누락된 출처 표기가 있다면 이슈 또는 PR을 열어주세요. 신속히 반영하겠습니다.
