// SPDX-License-Identifier: MIT
//
// ─────────────────────────────────────────────────────────────────────────────
// DEXignation — DXReverseRegistrar
//
// Derived from the ENS `ReverseRegistrar` and the EIP-181 reverse resolution
// pattern. ENS originals are MIT-licensed.
//   Source : https://github.com/ensdomains/ens-contracts
//   File   : contracts/reverseRegistrar/ReverseRegistrar.sol
//   © 2018-2024 Nick Johnson / ENS Labs
//
// Modifications Copyright (c) 2026 DEXignation, MIT License.
//
// 이 컨트랙트는 ENS `ReverseRegistrar` 및 EIP-181 역방향 해결 패턴 (MIT)
// 에서 파생되었습니다. 변경 부분은 © 2026 DEXignation, MIT License 하에
// 배포됩니다.
// ─────────────────────────────────────────────────────────────────────────────

pragma solidity ^0.8.28;

import {IDXRegistry} from "../registry/IDXRegistry.sol";
import {DXNamehash} from "../utils/DXNamehash.sol";

/// @title  DXReverseRegistrar
/// @notice Claims the `{addr}.addr.reverse` reverse node for an address and
///         wires it to the default resolver. Follows the EIP-181 pattern.
///         주소에 대한 `{addr}.addr.reverse` 역방향 노드를 클레임하고 기본
///         리졸버에 연결한다. EIP-181 패턴.
contract DXReverseRegistrar {
  IDXRegistry public immutable registry;

  /// @notice Pre-computed namehash of "addr.reverse".
  ///         "addr.reverse"의 사전 계산된 namehash.
  bytes32 public immutable reverseNamesParentNode;

  /// @notice Default resolver attached on claim.
  ///         claim 시 기본으로 연결되는 리졸버.
  address public immutable resolver;

  event ReverseClaimed(address indexed owner, bytes32 indexed node);

  error ZeroAddress();

  constructor(
    IDXRegistry _registry,
    address _resolver
  ) {
    if (_resolver == address(0)) {
      revert ZeroAddress();
    }
    registry = _registry;
    reverseNamesParentNode = DXNamehash.reverseAddrParentNode();
    resolver = _resolver;
  }

  /// @notice Claim the `{msg.sender}.addr.reverse` node for `owner`.
  ///         호출자 주소의 역방향 노드를 `owner`로 클레임.
  /// @dev    The caller's address is used as the label; only the caller
  ///         can claim their own reverse node.
  ///         호출자의 주소가 라벨로 사용된다. 본인만 자신의 역방향 노드를
  ///         클레임할 수 있다.
  /// @param  owner Final owner of the reverse node / 역방향 노드의 최종 소유자
  /// @return reverseNode The namehash of the claimed reverse node / 클레임한 역방향 노드의 해시
  function claim(address owner) public returns (bytes32) {
    if (owner == address(0)) {
      revert ZeroAddress();
    }

    bytes32 reverseLabelHash = DXNamehash.addrReverseLabelHash(msg.sender);
    bytes32 reverseNode = keccak256(abi.encodePacked(reverseNamesParentNode, reverseLabelHash));

    // Temporarily take ownership so we can set the resolver, then hand off.
    //   임시로 소유권을 가져와 리졸버를 설정한 뒤 owner에게 이전.
    registry.setSubnodeOwner(reverseNamesParentNode, reverseLabelHash, address(this));
    registry.setResolver(reverseNode, resolver);
    registry.setOwner(reverseNode, owner);

    emit ReverseClaimed(owner, reverseNode);

    return reverseNode;
  }
}
