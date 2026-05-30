// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title IDXRegistrar
 * @notice Interface for DEXignation registrar contract
 */
interface IDXRegistrar {
  
  // ════════════════════════════════════════════════════════════════════════
  // EVENTS
  // ════════════════════════════════════════════════════════════════════════
  
  event NameRegistered(
    bytes32 indexed id,
    address indexed owner,
    uint256 expires
  );
  
  event NameRenewed(bytes32 indexed id, uint256 expires);
  
  event GracePeriodUpdated(uint256 indexed newGracePeriod);
  
  // ════════════════════════════════════════════════════════════════════════
  // VIEW FUNCTIONS
  // ════════════════════════════════════════════════════════════════════════
  
  /**
   * @notice Returns the expiration date of a name
   */
  function expiries(bytes32 id) external view returns (uint256);
  
  /**
   * @notice Returns the grace period in seconds
   * @dev v1.1: Changed from constant to dynamic variable (70 days default)
   */
  function gracePeriod() external view returns (uint256);
  
  /**
   * @notice Returns true if a name is available for registration
   */
  function available(bytes32 id) external view returns (bool);
  
  // ════════════════════════════════════════════════════════════════════════
  // REGISTRATION FUNCTIONS
  // ════════════════════════════════════════════════════════════════════════
  
  /**
   * @notice Registers a name
   */
  function register(
    bytes32 id,
    address owner,
    uint256 duration
  ) external;
  
  /**
   * @notice Renews a name
   */
  function renew(bytes32 id, uint256 duration) external;
  
  /**
   * @notice Burns an expired name (after grace period)
   */
  function burn(bytes32 id) external;
  
  /**
   * @notice Sets the grace period
   * @dev v1.1: New function for dynamic grace period management
   */
  function setGracePeriod(uint256 _newGracePeriod) external;
}
