// SPDX-License-Identifier: MIT
//
// Test harness that exposes `DXNamehash.namehash` as an external view
// function for tests. Not deployed to production.
//
// DXNamehash.namehash를 테스트에서 호출할 수 있도록 외부 함수로 노출하는
// 테스트 하네스. 프로덕션 배포 대상 아님.

pragma solidity ^0.8.28;

import {DXNamehash} from "../../contracts/utils/DXNamehash.sol";

contract DXNamehashTestHarness {
    function namehash(string memory name) external pure returns (bytes32) {
        return DXNamehash.namehash(name);
    }

    function reverseAddrParentNode() external pure returns (bytes32) {
        return DXNamehash.reverseAddrParentNode();
    }

    function reverseNode(address addr) external pure returns (bytes32) {
        return DXNamehash.reverseNode(addr);
    }
}
