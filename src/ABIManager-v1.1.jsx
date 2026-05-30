/**
 * DEXignation v1.1 - Smart Contract ABI Manager
 * 
 * EIP-205 구현
 * - Generic ABI (모든 체인)
 * - Chain-specific ABI (Ethereum, Polygon, Arbitrum 등)
 * - dApp 자동 연동
 */

import React, { useState, useCallback } from 'react';
import { Plus, Trash2, Copy, CheckCircle, AlertCircle } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// CHAIN DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const SUPPORTED_CHAINS = {
  0: { name: 'Generic', symbol: '∀', color: 'gray' },
  1: { name: 'Ethereum', symbol: 'ETH', color: 'blue' },
  137: { name: 'Polygon', symbol: 'MATIC', color: 'purple' },
  42161: { name: 'Arbitrum', symbol: 'ARB', color: 'blue-600' },
  10: { name: 'Optimism', symbol: 'OP', color: 'red' },
  8453: { name: 'Base', symbol: 'BASE', color: 'blue' },
  43114: { name: 'Avalanche', symbol: 'AVAX', color: 'red' },
  250: { name: 'Fantom', symbol: 'FTM', color: 'blue' },
  56: { name: 'BSC', symbol: 'BNB', color: 'yellow' }
};

// ═══════════════════════════════════════════════════════════════════════════
// ABI MANAGER COMPONENT
// ═══════════════════════════════════════════════════════════════════════════

export const ABIManager = ({ nodeHash, onSubmit }) => {
  const [abiList, setAbiList] = useState([]);
  const [selectedChain, setSelectedChain] = useState(0);
  const [abiJson, setAbiJson] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);

  // ═══════════════════════════════════════════════════════════════════════════
  // Validation & Formatting
  // ═══════════════════════════════════════════════════════════════════════════

  const validateABI = useCallback((json) => {
    if (!json.trim()) {
      return { valid: false, error: 'ABI cannot be empty' };
    }

    try {
      const parsed = JSON.parse(json);
      
      // Check if it's an array (standard ABI format)
      if (!Array.isArray(parsed)) {
        return { 
          valid: false, 
          error: 'ABI must be a JSON array of contract functions' 
        };
      }

      // Validate each item in ABI
      for (const item of parsed) {
        if (!item.type) {
          return { 
            valid: false, 
            error: 'Each ABI item must have a "type" field' 
          };
        }
      }

      return { valid: true, parsed };
    } catch (e) {
      return { 
        valid: false, 
        error: `Invalid JSON: ${e.message}` 
      };
    }
  }, []);

  const formatABI = useCallback((json) => {
    try {
      const parsed = JSON.parse(json);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return json;
    }
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // ABI Management
  // ═══════════════════════════════════════════════════════════════════════════

  const handleAddABI = useCallback(() => {
    const validation = validateABI(abiJson);
    
    if (!validation.valid) {
      setError(validation.error);
      return;
    }

    const newABI = {
      chainId: selectedChain,
      chainName: SUPPORTED_CHAINS[selectedChain].name,
      abiJson: formatABI(abiJson),
      timestamp: new Date().toISOString(),
      size: abiJson.length
    };

    if (editingIndex !== null) {
      // Update existing
      const updated = [...abiList];
      updated[editingIndex] = newABI;
      setAbiList(updated);
      setSuccess(`ABI for ${newABI.chainName} updated`);
      setEditingIndex(null);
    } else {
      // Check for duplicates
      const duplicate = abiList.find(a => a.chainId === selectedChain);
      if (duplicate) {
        setError(`ABI for ${newABI.chainName} already exists. Edit it instead.`);
        return;
      }
      
      setAbiList([...abiList, newABI]);
      setSuccess(`ABI for ${newABI.chainName} added`);
    }

    setAbiJson('');
    setSelectedChain(0);
    setError(null);

    setTimeout(() => setSuccess(null), 3000);
  }, [abiJson, selectedChain, validateABI, formatABI, abiList, editingIndex]);

  const handleEditABI = useCallback((index) => {
    const abi = abiList[index];
    setSelectedChain(abi.chainId);
    setAbiJson(abi.abiJson);
    setEditingIndex(index);
  }, [abiList]);

  const handleDeleteABI = useCallback((index) => {
    const abi = abiList[index];
    if (window.confirm(`Delete ABI for ${abi.chainName}?`)) {
      const updated = abiList.filter((_, i) => i !== index);
      setAbiList(updated);
      setSuccess(`ABI for ${abi.chainName} deleted`);
      setTimeout(() => setSuccess(null), 3000);
    }
  }, [abiList]);

  const handleCopyABI = useCallback((index) => {
    const abi = abiList[index];
    navigator.clipboard.writeText(abi.abiJson);
    setSuccess('ABI copied to clipboard');
    setTimeout(() => setSuccess(null), 2000);
  }, [abiList]);

  // ═══════════════════════════════════════════════════════════════════════════
  // Submit ABIs to Smart Contract
  // ═══════════════════════════════════════════════════════════════════════════

  const handleSubmitAll = useCallback(async () => {
    if (abiList.length === 0) {
      setError('No ABI to submit');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      for (const abi of abiList) {
        await onSubmit({
          nodeHash,
          chainId: abi.chainId,
          contentType: 4, // JSON (EIP-205)
          data: abi.abiJson
        });
      }

      setSuccess(`All ABIs submitted successfully (${abiList.length} chains)`);
      setAbiList([]);
      
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err.message || 'Failed to submit ABIs');
    } finally {
      setIsSubmitting(false);
    }
  }, [abiList, nodeHash, onSubmit]);

  return (
    <div className="w-full max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Smart Contract ABI Manager (v1.1)
        </h2>
        <p className="text-gray-600">
          Store and manage contract ABIs for different blockchains
        </p>
      </div>

      {/* Chain Selector & ABI Input */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Chain Selector */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Select Chain
          </label>
          <select
            value={selectedChain}
            onChange={(e) => setSelectedChain(parseInt(e.target.value))}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {Object.entries(SUPPORTED_CHAINS).map(([chainId, chain]) => (
              <option key={chainId} value={chainId}>
                {chain.symbol} {chain.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-2">
            ℹ️ Chain 0 = Generic ABI (fallback for all chains)
          </p>
        </div>

        {/* Chain Info */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-3">
            Chain Info
          </label>
          <div className="p-4 bg-gray-50 rounded-lg">
            <div className="text-2xl font-bold text-gray-900 mb-1">
              {SUPPORTED_CHAINS[selectedChain].symbol}
            </div>
            <div className="text-sm text-gray-600">
              {SUPPORTED_CHAINS[selectedChain].name}
            </div>
            <div className="text-xs text-gray-500 mt-2">
              Chain ID: {selectedChain}
            </div>
          </div>
        </div>
      </div>

      {/* ABI Editor */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Contract ABI (JSON)
        </label>
        <textarea
          value={abiJson}
          onChange={(e) => setAbiJson(e.target.value)}
          placeholder={`[
  {
    "type": "function",
    "name": "swap",
    "inputs": [...],
    "outputs": [...]
  },
  ...
]`}
          rows={10}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="text-xs text-gray-500 mt-2">
          Paste your contract ABI in JSON format
        </p>
      </div>

      {/* Error/Success Messages */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-green-700">{success}</p>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-3 mb-8">
        <button
          onClick={handleAddABI}
          disabled={!abiJson.trim()}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
        >
          <Plus className="w-4 h-4" />
          {editingIndex !== null ? 'Update ABI' : 'Add ABI'}
        </button>
        {editingIndex !== null && (
          <button
            onClick={() => {
              setEditingIndex(null);
              setAbiJson('');
              setSelectedChain(0);
            }}
            className="px-4 py-2 bg-gray-300 text-gray-700 rounded-lg hover:bg-gray-400 font-medium"
          >
            Cancel Edit
          </button>
        )}
      </div>

      {/* ABI List */}
      <div className="mb-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Stored ABIs ({abiList.length})
        </h3>
        
        {abiList.length === 0 ? (
          <div className="p-8 bg-gray-50 rounded-lg text-center">
            <p className="text-gray-500">No ABIs added yet</p>
          </div>
        ) : (
          <div className="space-y-3">
            {abiList.map((abi, index) => (
              <div
                key={index}
                className="p-4 border border-gray-200 rounded-lg flex justify-between items-start hover:bg-gray-50 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold text-gray-900">
                      {abi.chainName}
                    </span>
                    <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                      Chain {abi.chainId}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {abi.size} bytes • {
                      abi.abiJson.match(/{"type":"function"/g)?.length || 0
                    } functions
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    Added: {new Date(abi.timestamp).toLocaleString()}
                  </div>
                </div>
                
                <div className="flex gap-2">
                  <button
                    onClick={() => handleCopyABI(index)}
                    className="p-2 text-gray-600 hover:text-blue-600 rounded-lg hover:bg-blue-50"
                    title="Copy ABI"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleEditABI(index)}
                    className="p-2 text-gray-600 hover:text-orange-600 rounded-lg hover:bg-orange-50"
                    title="Edit ABI"
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => handleDeleteABI(index)}
                    className="p-2 text-gray-600 hover:text-red-600 rounded-lg hover:bg-red-50"
                    title="Delete ABI"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Submit Button */}
      {abiList.length > 0 && (
        <button
          onClick={handleSubmitAll}
          disabled={isSubmitting}
          className={`w-full py-3 px-4 rounded-lg font-bold text-white transition-all ${
            isSubmitting
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700 active:bg-green-800'
          }`}
        >
          {isSubmitting ? 'Submitting...' : `Submit All ABIs (${abiList.length} chains)`}
        </button>
      )}

      {/* Integration Guide */}
      <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <h4 className="font-semibold text-blue-900 mb-2">💡 Integration Guide</h4>
        <pre className="text-xs text-blue-800 bg-blue-100 p-3 rounded overflow-auto">
{`// dApp에서 ABI 자동 조회 및 사용
const { data: abi } = await resolver.ABI(
  nodeHash,
  137, // Polygon
  4    // JSON content type
);

// ABI 파싱 및 contract 인스턴스 생성
const abiArray = JSON.parse(abi);
const contract = new ethers.Contract(
  contractAddress,
  abiArray,
  provider
);

// 자동으로 모든 함수 호출 가능
await contract.swap(...args);`}
        </pre>
      </div>
    </div>
  );
};

export default ABIManager;
