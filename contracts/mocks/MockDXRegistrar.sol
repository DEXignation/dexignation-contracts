// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockDXRegistrar {
  mapping(uint256 => uint256) private _expires;
  
  function setExpires(uint256 id, uint256 expires) public {
    _expires[id] = expires;
  }
  
  function nameExpires(uint256 id) external view returns (uint256) {
    return _expires[id];
  }
}
