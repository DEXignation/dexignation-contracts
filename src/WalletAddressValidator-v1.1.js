/**
 * DEXignation v1.1 - Multi-Wallet Address Validator
 * 
 * 16개 블록체인 주소 검증 (Front-end)
 * - EVM chains (8): Ethereum, Polygon, Arbitrum, Optimism, Base, Avalanche, Fantom, BSC
 * - Non-EVM chains (8): Bitcoin, Dogecoin, Litecoin, Solana, Cosmos, Tron, TON, Ripple
 */

const COIN_VALIDATORS = {
  // ═══════════════════════════════════════════════════════════════════════
  // EVM CHAINS (동일한 검증 로직)
  // ═══════════════════════════════════════════════════════════════════════
  
  60: {
    name: 'Ethereum',
    symbol: 'ETH',
    chainId: 1,
    validate: (addr) => validateEVMAddress(addr),
    example: '0x1234567890123456789012345678901234567890'
  },
  137: {
    name: 'Polygon',
    symbol: 'MATIC',
    chainId: 137,
    validate: (addr) => validateEVMAddress(addr),
    example: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd'
  },
  42161: {
    name: 'Arbitrum',
    symbol: 'ETH',
    chainId: 42161,
    validate: (addr) => validateEVMAddress(addr),
    example: '0x1111111111111111111111111111111111111111'
  },
  10: {
    name: 'Optimism',
    symbol: 'ETH',
    chainId: 10,
    validate: (addr) => validateEVMAddress(addr),
    example: '0x2222222222222222222222222222222222222222'
  },
  8453: {
    name: 'Base',
    symbol: 'ETH',
    chainId: 8453,
    validate: (addr) => validateEVMAddress(addr),
    example: '0x3333333333333333333333333333333333333333'
  },
  43114: {
    name: 'Avalanche',
    symbol: 'AVAX',
    chainId: 43114,
    validate: (addr) => validateEVMAddress(addr),
    example: '0x4444444444444444444444444444444444444444'
  },
  250: {
    name: 'Fantom',
    symbol: 'FTM',
    chainId: 250,
    validate: (addr) => validateEVMAddress(addr),
    example: '0x5555555555555555555555555555555555555555'
  },
  56: {
    name: 'BSC',
    symbol: 'BNB',
    chainId: 56,
    validate: (addr) => validateEVMAddress(addr),
    example: '0x6666666666666666666666666666666666666666'
  },

  // ═══════════════════════════════════════════════════════════════════════
  // NON-EVM CHAINS
  // ═══════════════════════════════════════════════════════════════════════
  
  0: {
    name: 'Bitcoin',
    symbol: 'BTC',
    validate: (addr) => validateBitcoinAddress(addr),
    formats: ['P2PKH (1...)', 'P2SH (3...)', 'Bech32 (bc1...)'],
    examples: [
      '1A1z7agoat7FYN82BWEimYWydLMQD6epP',
      '3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy',
      'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'
    ]
  },
  3: {
    name: 'Dogecoin',
    symbol: 'DOGE',
    validate: (addr) => validateDogeAddress(addr),
    format: 'Base58Check (D...)',
    example: 'DPpJV2FB67ddQEstwMmWPC3GMoQZGZuqyV'
  },
  2: {
    name: 'Litecoin',
    symbol: 'LTC',
    validate: (addr) => validateLitecoinAddress(addr),
    formats: ['Legacy (L/M...)', 'Bech32 (ltc1...)'],
    examples: [
      'LcnEr7UDF7V8247piuswch787yXL9hpyaP',
      'ltc1qw508d6qejxtdg4y5r3zarvary0c5xw7k0ylz5p'
    ]
  },
  501: {
    name: 'Solana',
    symbol: 'SOL',
    validate: (addr) => validateSolanaAddress(addr),
    format: 'Base58 (44 chars)',
    example: '9B5X4z8ThjnCVq2QV4QyDwQCa7L4JcMjkX7KP5sKS8N'
  },
  118: {
    name: 'Cosmos',
    symbol: 'ATOM',
    validate: (addr) => validateCosmosAddress(addr),
    format: 'Bech32 (cosmos1...)',
    example: 'cosmos1vf5wj72aqel0jd89kl58crgu4yqvzm4yzqhc3p'
  },
  195: {
    name: 'Tron',
    symbol: 'TRX',
    validate: (addr) => validateTronAddress(addr),
    format: 'Base58Check (T...)',
    example: 'TLAWdc8xk8PH8wiiX6pPXaeRUTAU6iTMzA'
  },
  607: {
    name: 'TON',
    symbol: 'TON',
    validate: (addr) => validateTonAddress(addr),
    formats: ['User-friendly (EQ.../UQ...)', 'Raw (0:...)'],
    examples: [
      'EQDLvCjjUVGxrJ-7vRlg9vqMf1VFQTX1f6IVJQLrYXZ4Qy6',
      '0:AB4F1B3D5E8F2A6C9B1D5E7F3A2B5C6D9E1F3A4B5C6D'
    ]
  },
  144: {
    name: 'Ripple',
    symbol: 'XRP',
    validate: (addr) => validateRippleAddress(addr),
    format: 'Base58Check (r...)',
    example: 'rN7n7otQDd6FczFgLdlqtyMVrn3p73FBJ9'
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// EVM ADDRESS VALIDATION (모든 EVM 체인 동일)
// ═══════════════════════════════════════════════════════════════════════════

function validateEVMAddress(address) {
  if (!address) return false;
  
  // 16진수 형식 확인 (0x로 시작, 40자 hex)
  const evmRegex = /^0x[a-fA-F0-9]{40}$/;
  return evmRegex.test(address);
}

// ═══════════════════════════════════════════════════════════════════════════
// BITCOIN ADDRESS VALIDATION (P2PKH, P2SH, Bech32)
// ═══════════════════════════════════════════════════════════════════════════

function validateBitcoinAddress(address) {
  if (!address) return false;
  
  // P2PKH (1로 시작): 26-35자
  const p2pkh = /^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address);
  
  // P2SH (3으로 시작): 26-35자
  const p2sh = /^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address);
  
  // Bech32 (bc1로 시작): 42-62자
  const bech32 = /^bc1[a-z0-9]{39,59}$/.test(address);
  
  return p2pkh || p2sh || bech32;
}

// ═══════════════════════════════════════════════════════════════════════════
// DOGECOIN ADDRESS VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function validateDogeAddress(address) {
  if (!address) return false;
  
  // Dogecoin: D로 시작, Base58Check 인코딩, 34자
  return /^D[a-km-zA-HJ-NP-Z1-9]{33}$/.test(address);
}

// ═══════════════════════════════════════════════════════════════════════════
// LITECOIN ADDRESS VALIDATION (Legacy & Bech32)
// ═══════════════════════════════════════════════════════════════════════════

function validateLitecoinAddress(address) {
  if (!address) return false;
  
  // Legacy (L 또는 M으로 시작): 34자
  const legacy = /^[LM][a-km-zA-HJ-NP-Z1-9]{33}$/.test(address);
  
  // Bech32 (ltc1로 시작)
  const bech32 = /^ltc1[a-z0-9]{39,59}$/.test(address);
  
  return legacy || bech32;
}

// ═══════════════════════════════════════════════════════════════════════════
// SOLANA ADDRESS VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function validateSolanaAddress(address) {
  if (!address) return false;
  
  // Base58 인코딩, 정확히 44자
  // I, O, l, 0 제외 (Bitcoin Base58 제약)
  return /^[1-9A-HJ-NP-Za-km-z]{44}$/.test(address);
}

// ═══════════════════════════════════════════════════════════════════════════
// COSMOS ADDRESS VALIDATION (bech32)
// ═══════════════════════════════════════════════════════════════════════════

function validateCosmosAddress(address) {
  if (!address) return false;
  
  // cosmos1 + 38-40자 base32
  return /^cosmos1[a-z0-9]{38,40}$/.test(address);
}

// ═══════════════════════════════════════════════════════════════════════════
// TRON ADDRESS VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function validateTronAddress(address) {
  if (!address) return false;
  
  // T로 시작하는 Base58Check 인코딩, 34자
  return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
}

// ═══════════════════════════════════════════════════════════════════════════
// TON ADDRESS VALIDATION (User-friendly & Raw)
// ═══════════════════════════════════════════════════════════════════════════

function validateTonAddress(address) {
  if (!address) return false;
  
  // User-friendly: EQ... 또는 UQ... (bounceable/non-bounceable)
  const userFriendly = /^[EU]Q[A-Za-z0-9_-]{46,48}$/.test(address);
  
  // Raw: 0:... (hex)
  const raw = /^0:[A-Fa-f0-9]{64}$/.test(address);
  
  return userFriendly || raw;
}

// ═══════════════════════════════════════════════════════════════════════════
// RIPPLE ADDRESS VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

function validateRippleAddress(address) {
  if (!address) return false;
  
  // r로 시작하는 Base58Check 인코딩, 33-35자
  return /^r[a-km-zA-HJ-NP-Z1-9]{33,34}$/.test(address);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN VALIDATION FUNCTION (공개)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validate address for given coin type
 * @param {number} coinType SLIP-44 coin type
 * @param {string} address Address string
 * @returns {object} { isValid: boolean, error?: string }
 */
function validateAddress(coinType, address) {
  const coin = COIN_VALIDATORS[coinType];
  
  if (!coin) {
    return {
      isValid: false,
      error: `Coin type ${coinType} not supported`
    };
  }
  
  if (!address || typeof address !== 'string') {
    return {
      isValid: false,
      error: 'Address must be a non-empty string'
    };
  }
  
  try {
    const isValid = coin.validate(address);
    return {
      isValid,
      coin: coin.name,
      symbol: coin.symbol,
      error: isValid ? undefined : `Invalid ${coin.name} address format`
    };
  } catch (error) {
    return {
      isValid: false,
      error: `Validation error: ${error.message}`
    };
  }
}

/**
 * Get coin info for UI
 * @param {number} coinType SLIP-44 coin type
 * @returns {object} Coin info
 */
function getCoinInfo(coinType) {
  const coin = COIN_VALIDATORS[coinType];
  return coin ? { ...coin, coinType } : null;
}

/**
 * Get all supported coins
 * @returns {array} Array of coin info
 */
function getSupportedCoins() {
  return Object.entries(COIN_VALIDATORS).map(([coinType, coin]) => ({
    coinType: parseInt(coinType),
    ...coin
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT (Node.js / ES Module)
// ═══════════════════════════════════════════════════════════════════════════

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    COIN_VALIDATORS,
    validateAddress,
    getCoinInfo,
    getSupportedCoins,
    validateEVMAddress,
    validateBitcoinAddress,
    validateDogeAddress,
    validateLitecoinAddress,
    validateSolanaAddress,
    validateCosmosAddress,
    validateTronAddress,
    validateTonAddress,
    validateRippleAddress
  };
}

