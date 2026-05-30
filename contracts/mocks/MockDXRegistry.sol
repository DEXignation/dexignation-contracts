// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MockDXRegistry {
  mapping(bytes32 => address) private _owners;
  
  function setOwner(bytes32 node, address owner) public {
    _owners[node] = owner;
  }
  
  function owner(bytes32 node) external view returns (address) {
    return _owners[node];
  }
}
