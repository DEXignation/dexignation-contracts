// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title SubdomainManager
 * @notice DEXignation v2.0 - Subdomain Management with Dynamic Pricing
 * 
 * Features:
 * - alice.mycompany.dex 구조 (부모 도메인 필수)
 * - 동적 가격 (부모 도메인 유효기간 기반)
 * - 한글 서브도메인 지원
 * - NFT 기반 소유권 관리
 */

interface IDXRegistry {
  function owner(bytes32 node) external view returns (address);
}

interface IDXRegistrar {
  function nameExpires(uint256 id) external view returns (uint256);
}

contract SubdomainManager {
  
  // ════════════════════════════════════════════════════════════════════════
  // STATE VARIABLES
  // ════════════════════════════════════════════════════════════════════════
  
  IDXRegistry public registry;
  IDXRegistrar public registrar;
  
  address public owner;
  
  // 기본 가격 (1 ether = $1 POL)
  uint256 public constant BASE_PRICE = 1 ether;
  
  // 최소 서브도메인 유효기간
  uint256 public constant SUBDOMAIN_MIN_DURATION = 28 days;
  
  // 동적 가격 기준
  uint256 public constant PRICE_THRESHOLD_HIGH = 5 * 365 days;  // 5년 이상
  uint256 public constant PRICE_THRESHOLD_MID = 2 * 365 days;   // 2-5년
  
  // parentNode => (label => SubdomainInfo)
  mapping(bytes32 => mapping(string => SubdomainInfo)) public subdomains;
  
  struct SubdomainInfo {
    address owner;
    uint256 expires;
    address resolver;
  }
  
  // ════════════════════════════════════════════════════════════════════════
  // EVENTS (중복 제거됨)
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
  // MODIFIERS
  // ════════════════════════════════════════════════════════════════════════
  
  modifier onlyParentOwner(bytes32 parentNode) {
    require(registry.owner(parentNode) == msg.sender, "Not parent owner");
    _;
  }
  
  modifier onlySubdomainOwner(bytes32 parentNode, string calldata label) {
    require(subdomains[parentNode][label].owner == msg.sender, "Not subdomain owner");
    _;
  }
  
  modifier onlyOwner() {
    require(msg.sender == owner, "Not owner");
    _;
  }
  
  // ════════════════════════════════════════════════════════════════════════
  // CONSTRUCTOR
  // ════════════════════════════════════════════════════════════════════════
  
  constructor(IDXRegistry _registry, IDXRegistrar _registrar) {
    registry = _registry;
    registrar = _registrar;
    owner = msg.sender;
  }
  
  // ════════════════════════════════════════════════════════════════════════
  // DYNAMIC PRICING (핵심)
  // ════════════════════════════════════════════════════════════════════════
  
  /**
   * @notice 동적 가격 계산 (부모 도메인 유효기간 기반)
   * 
   * 가격 정책:
   * - 부모 유효기간 ≥ 5년: $1
   * - 부모 유효기간 2-5년: $2
   * - 부모 유효기간 < 2년: $3
   */
  function getSubdomainPrice(bytes32 parentNode) 
    public view returns (uint256) 
  {
    uint256 parentExpires = registrar.nameExpires(uint256(parentNode));
    
    if (parentExpires <= block.timestamp) {
      return 0; // 부모 도메인 만료됨
    }
    
    uint256 timeLeft = parentExpires - block.timestamp;
    
    if (timeLeft >= PRICE_THRESHOLD_HIGH) {
      return BASE_PRICE; // $1
    } else if (timeLeft >= PRICE_THRESHOLD_MID) {
      return BASE_PRICE * 2; // $2
    } else {
      return BASE_PRICE * 3; // $3
    }
  }
  
  // ════════════════════════════════════════════════════════════════════════
  // CORE FUNCTIONS
  // ════════════════════════════════════════════════════════════════════════
  
  /**
   * @notice 서브도메인 생성
   */
  function createSubdomain(
    bytes32 parentNode,
    string calldata label,
    address subOwner,
    uint256 duration
  ) external payable onlyParentOwner(parentNode) returns (bytes32) {
    
    require(bytes(label).length > 0, "Label empty");
    require(subOwner != address(0), "Invalid owner");
    require(duration >= SUBDOMAIN_MIN_DURATION, "Duration too short");
    
    uint256 parentExpires = registrar.nameExpires(uint256(parentNode));
    require(parentExpires > block.timestamp, "Parent expired");
    require(subdomains[parentNode][label].owner == address(0), "Subdomain exists");
    
    uint256 price = getSubdomainPrice(parentNode);
    require(msg.value >= price, "Insufficient payment");
    
    subdomains[parentNode][label].owner = subOwner;
    subdomains[parentNode][label].expires = block.timestamp + duration;
    
    bytes32 subNode = keccak256(abi.encodePacked(
      parentNode, 
      keccak256(abi.encodePacked(label))
    ));
    
    emit SubdomainCreated(parentNode, label, subOwner, block.timestamp + duration, price);
    
    if (msg.value > price) {
      (bool success, ) = msg.sender.call{value: msg.value - price}("");
      require(success, "Refund failed");
    }
    
    return subNode;
  }
  
  /**
   * @notice 서브도메인 갱신
   */
  function renewSubdomain(
    bytes32 parentNode,
    string calldata label,
    uint256 duration
  ) external payable onlySubdomainOwner(parentNode, label) returns (uint256) {
    
    require(duration >= SUBDOMAIN_MIN_DURATION, "Duration too short");
    
    uint256 parentExpires = registrar.nameExpires(uint256(parentNode));
    require(parentExpires > block.timestamp, "Parent expired");
    
    uint256 price = getSubdomainPrice(parentNode);
    require(msg.value >= price, "Insufficient payment");
    
    subdomains[parentNode][label].expires += duration;
    uint256 newExpires = subdomains[parentNode][label].expires;
    
    emit SubdomainRenewed(parentNode, label, newExpires, price);
    
    if (msg.value > price) {
      (bool success, ) = msg.sender.call{value: msg.value - price}("");
      require(success, "Refund failed");
    }
    
    return newExpires;
  }
  
  /**
   * @notice 서브도메인 이전
   */
  function transferSubdomain(
    bytes32 parentNode,
    string calldata label,
    address newOwner
  ) external onlySubdomainOwner(parentNode, label) {
    
    require(newOwner != address(0), "Invalid owner");
    
    subdomains[parentNode][label].owner = newOwner;
    
    emit SubdomainTransferred(parentNode, label, newOwner);
  }
  
  /**
   * @notice Resolver 설정
   */
  function setResolver(
    bytes32 parentNode,
    string calldata label,
    address resolver
  ) external onlySubdomainOwner(parentNode, label) {
    
    subdomains[parentNode][label].resolver = resolver;
    
    emit SubdomainResolverUpdated(parentNode, label, resolver);
  }
  
  // ════════════════════════════════════════════════════════════════════════
  // VIEW FUNCTIONS
  // ════════════════════════════════════════════════════════════════════════
  
  function subdomainExpires(
    bytes32 parentNode,
    string calldata label
  ) external view returns (uint256) {
    return subdomains[parentNode][label].expires;
  }
  
  function subdomainOwner(
    bytes32 parentNode,
    string calldata label
  ) external view returns (address) {
    return subdomains[parentNode][label].owner;
  }
  
  function subdomainResolver(
    bytes32 parentNode,
    string calldata label
  ) external view returns (address) {
    return subdomains[parentNode][label].resolver;
  }
  
  function isSubdomainValid(
    bytes32 parentNode,
    string calldata label
  ) external view returns (bool) {
    return subdomains[parentNode][label].owner != address(0) &&
           subdomains[parentNode][label].expires > block.timestamp;
  }
  
  // ════════════════════════════════════════════════════════════════════════
  // ADMIN FUNCTIONS
  // ════════════════════════════════════════════════════════════════════════
  
  function withdraw() external onlyOwner {
    uint256 balance = address(this).balance;
    require(balance > 0, "No balance");
    
    (bool success, ) = msg.sender.call{value: balance}("");
    require(success, "Withdrawal failed");
  }
  
  function getBalance() external view returns (uint256) {
    return address(this).balance;
  }
  
  receive() external payable {}
}
