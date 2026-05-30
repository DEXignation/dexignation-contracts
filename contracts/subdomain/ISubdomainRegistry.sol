// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ISubdomainRegistry
 * @notice DEXignation v2.0 Subdomain Interface
 */
interface ISubdomainRegistry {
  
  // ════════════════════════════════════════════════════════════════════════
  // EVENTS
  // ════════════════════════════════════════════════════════════════════════
  
  event SubdomainCreated(
    bytes32 indexed parentNode,
    string indexed label,
    address indexed owner,
    uint256 expires,
    uint256 price
  );
  
  event SubdomainRenewed(
    bytes32 indexed parentNode,
    string indexed label,
    uint256 expires,
    uint256 price
  );
  
  event SubdomainTransferred(
    bytes32 indexed parentNode,
    string indexed label,
    address indexed newOwner
  );
  
  event SubdomainResolverUpdated(
    bytes32 indexed parentNode,
    string indexed label,
    address indexed resolver
  );
  
  // ════════════════════════════════════════════════════════════════════════
  // FUNCTIONS
  // ════════════════════════════════════════════════════════════════════════
  
  // alice.mycompany.dex 생성 (부모 owner만 가능)
  function createSubdomain(
    bytes32 parentNode,
    string calldata label,
    address owner,
    uint256 duration
  ) external payable returns (bytes32);
  
  // 서브도메인 갱신
  function renewSubdomain(
    bytes32 parentNode,
    string calldata label,
    uint256 duration
  ) external payable returns (uint256);
  
  // 서브도메인 이전
  function transferSubdomain(
    bytes32 parentNode,
    string calldata label,
    address newOwner
  ) external;
  
  // Resolver 설정
  function setResolver(
    bytes32 parentNode,
    string calldata label,
    address resolver
  ) external;
  
  // ════════════════════════════════════════════════════════════════════════
  // VIEW FUNCTIONS
  // ════════════════════════════════════════════════════════════════════════
  
  // 동적 가격 조회
  function getSubdomainPrice(bytes32 parentNode) 
    external view returns (uint256);
  
  // 서브도메인 만료 시간
  function subdomainExpires(
    bytes32 parentNode,
    string calldata label
  ) external view returns (uint256);
  
  // 서브도메인 owner
  function subdomainOwner(
    bytes32 parentNode,
    string calldata label
  ) external view returns (address);
  
  // 서브도메인 resolver
  function subdomainResolver(
    bytes32 parentNode,
    string calldata label
  ) external view returns (address);
  
  // 서브도메인 유효성 확인
  function isSubdomainValid(
    bytes32 parentNode,
    string calldata label
  ) external view returns (bool);
}
