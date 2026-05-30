/**
 * DEXignation v1.1 - Multi-Language Text Input Component
 * 
 * 12개 언어 지원 (한글, 중국어, 일본어, 아랍어, 러시아어 등)
 * Unicode NFC 정규화
 * Homoglyph detection & warning
 */

import React, { useState, useCallback, useMemo } from 'react';
import { AlertCircle, CheckCircle, Languages } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════════════════
// LANGUAGE DEFINITIONS (12개 언어)
// ═══════════════════════════════════════════════════════════════════════════

const SUPPORTED_LANGUAGES = {
  en: { name: 'English', nativeName: 'English', flag: '🇺🇸' },
  ko: { name: 'Korean', nativeName: '한국어', flag: '🇰🇷' },
  zh: { name: 'Simplified Chinese', nativeName: '简体中文', flag: '🇨🇳' },
  'zh-Hant': { name: 'Traditional Chinese', nativeName: '繁體中文', flag: '🇭🇰' },
  ja: { name: 'Japanese', nativeName: '日本語', flag: '🇯🇵' },
  vi: { name: 'Vietnamese', nativeName: 'Tiếng Việt', flag: '🇻🇳' },
  th: { name: 'Thai', nativeName: 'ไทย', flag: '🇹🇭' },
  ar: { name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', rtl: true },
  ru: { name: 'Russian', nativeName: 'Русский', flag: '🇷🇺' },
  el: { name: 'Greek', nativeName: 'Ελληνικά', flag: '🇬🇷' },
  he: { name: 'Hebrew', nativeName: 'עברית', flag: '🇮🇱', rtl: true },
  tr: { name: 'Turkish', nativeName: 'Türkçe', flag: '🇹🇷' }
};

// ═══════════════════════════════════════════════════════════════════════════
// HOMOGLYPH DETECTION (다국어 보안)
// ═══════════════════════════════════════════════════════════════════════════

const HOMOGLYPHS = {
  // Cyrillic vs Latin
  'А': { char: 'A', lang: 'Cyrillic', warning: 'Cyrillic А (A) detected' },
  'В': { char: 'B', lang: 'Cyrillic', warning: 'Cyrillic В (B) detected' },
  'Е': { char: 'E', lang: 'Cyrillic', warning: 'Cyrillic Е (E) detected' },
  'Н': { char: 'H', lang: 'Cyrillic', warning: 'Cyrillic Н (H) detected' },
  'К': { char: 'K', lang: 'Cyrillic', warning: 'Cyrillic К (K) detected' },
  'М': { char: 'M', lang: 'Cyrillic', warning: 'Cyrillic М (M) detected' },
  'О': { char: 'O', lang: 'Cyrillic', warning: 'Cyrillic О (O) detected' },
  'Р': { char: 'P', lang: 'Cyrillic', warning: 'Cyrillic Р (P) detected' },
  'С': { char: 'C', lang: 'Cyrillic', warning: 'Cyrillic С (C) detected' },
  'Т': { char: 'T', lang: 'Cyrillic', warning: 'Cyrillic Т (T) detected' },
  'Х': { char: 'X', lang: 'Cyrillic', warning: 'Cyrillic Х (X) detected' },
  'У': { char: 'Y', lang: 'Cyrillic', warning: 'Cyrillic У (Y) detected' },
  
  // Greek vs Latin
  'Α': { char: 'A', lang: 'Greek', warning: 'Greek Α (Alpha) detected' },
  'Β': { char: 'B', lang: 'Greek', warning: 'Greek Β (Beta) detected' },
  'Ε': { char: 'E', lang: 'Greek', warning: 'Greek Ε (Epsilon) detected' },
  'Ζ': { char: 'Z', lang: 'Greek', warning: 'Greek Ζ (Zeta) detected' },
  'Η': { char: 'H', lang: 'Greek', warning: 'Greek Η (Eta) detected' },
  'Ι': { char: 'I', lang: 'Greek', warning: 'Greek Ι (Iota) detected' },
  'Κ': { char: 'K', lang: 'Greek', warning: 'Greek Κ (Kappa) detected' },
  'Μ': { char: 'M', lang: 'Greek', warning: 'Greek Μ (Mu) detected' },
  'Ν': { char: 'N', lang: 'Greek', warning: 'Greek Ν (Nu) detected' },
  'Ο': { char: 'O', lang: 'Greek', warning: 'Greek Ο (Omicron) detected' },
  'Ρ': { char: 'P', lang: 'Greek', warning: 'Greek Ρ (Rho) detected' },
  'Τ': { char: 'T', lang: 'Greek', warning: 'Greek Τ (Tau) detected' },
  'Υ': { char: 'Y', lang: 'Greek', warning: 'Greek Υ (Upsilon) detected' },
  'Χ': { char: 'X', lang: 'Greek', warning: 'Greek Χ (Chi) detected' },
};

// ═══════════════════════════════════════════════════════════════════════════
// Unicode Normalization & Validation Functions
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Unicode NFC Normalization
 * @param {string} text Input text
 * @returns {string} Normalized text
 */
function normalizeUnicode(text) {
  try {
    // NFC 정규화 (합성 형태)
    return text.normalize('NFC');
  } catch (error) {
    console.warn('Unicode normalization failed:', error);
    return text;
  }
}

/**
 * Detect homoglyphs in text
 * @param {string} text Input text
 * @returns {array} Array of detected homoglyphs
 */
function detectHomoglyphs(text) {
  const detected = [];
  
  for (const char of text) {
    if (HOMOGLYPHS[char]) {
      detected.push({
        char,
        ...HOMOGLYPHS[char]
      });
    }
  }
  
  return detected;
}

/**
 * Detect character categories in text
 * @param {string} text Input text
 * @returns {object} Character categories
 */
function detectCharCategories(text) {
  const categories = {
    latin: false,
    korean: false,
    chinese: false,
    japanese: false,
    thai: false,
    arabic: false,
    cyrillic: false,
    greek: false,
    hebrew: false,
    devanagari: false,
    emoji: false,
    digit: false,
    symbol: false
  };
  
  for (const char of text) {
    const code = char.charCodeAt(0);
    
    // Latin (A-Z, a-z)
    if ((code >= 0x41 && code <= 0x5A) || (code >= 0x61 && code <= 0x7A)) {
      categories.latin = true;
    }
    // Korean (AC00-D7A3)
    else if (code >= 0xAC00 && code <= 0xD7A3) {
      categories.korean = true;
    }
    // Chinese (CJK Unified Ideographs)
    else if (code >= 0x4E00 && code <= 0x9FFF) {
      categories.chinese = true;
    }
    // Japanese Hiragana & Katakana
    else if ((code >= 0x3040 && code <= 0x309F) || (code >= 0x30A0 && code <= 0x30FF)) {
      categories.japanese = true;
    }
    // Thai
    else if (code >= 0x0E00 && code <= 0x0E7F) {
      categories.thai = true;
    }
    // Arabic
    else if (code >= 0x0600 && code <= 0x06FF) {
      categories.arabic = true;
    }
    // Cyrillic
    else if (code >= 0x0400 && code <= 0x04FF) {
      categories.cyrillic = true;
    }
    // Greek
    else if (code >= 0x0370 && code <= 0x03FF) {
      categories.greek = true;
    }
    // Hebrew
    else if (code >= 0x0590 && code <= 0x05FF) {
      categories.hebrew = true;
    }
    // Digit
    else if (code >= 0x30 && code <= 0x39) {
      categories.digit = true;
    }
  }
  
  return categories;
}

// ═══════════════════════════════════════════════════════════════════════════
// React Component
// ═══════════════════════════════════════════════════════════════════════════

export const MultiLangTextInput = ({
  nodeHash,
  recordKey = 'description',
  onSubmit,
  maxLength = 500,
  placeholder = 'Enter text in any language...'
}) => {
  const [selectedLang, setSelectedLang] = useState('en');
  const [textValues, setTextValues] = useState({});
  const [homoglyphWarnings, setHomoglyphWarnings] = useState({});
  const [charCounts, setCharCounts] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Handle text input
  const handleTextChange = useCallback((e) => {
    const { value } = e.target;
    
    // Unicode NFC 정규화
    const normalized = normalizeUnicode(value);
    
    // Homoglyph 감지
    const homoglyphs = detectHomoglyphs(normalized);
    
    // 텍스트 길이 확인
    if (normalized.length <= maxLength) {
      setTextValues({
        ...textValues,
        [selectedLang]: normalized
      });
      setCharCounts({
        ...charCounts,
        [selectedLang]: normalized.length
      });
      setHomoglyphWarnings({
        ...homoglyphWarnings,
        [selectedLang]: homoglyphs
      });
      setError(null);
    } else {
      setError(`Text exceeds maximum length of ${maxLength} characters`);
    }
  }, [selectedLang, textValues, maxLength]);

  // Handle language switch
  const handleLangSwitch = useCallback((lang) => {
    setSelectedLang(lang);
    setError(null);
    setSuccess(null);
  }, []);

  // Submit
  const handleSubmit = useCallback(async () => {
    try {
      setIsSubmitting(true);
      setError(null);
      setSuccess(null);
      
      // 현재 언어의 텍스트만 제출
      const currentText = textValues[selectedLang];
      
      if (!currentText || currentText.trim() === '') {
        setError('Text cannot be empty');
        return;
      }
      
      // On-chain submission
      await onSubmit({
        nodeHash,
        recordKey,
        langCode: selectedLang,
        value: currentText,
        normalized: normalizeUnicode(currentText)
      });
      
      setSuccess(`${recordKey} saved in ${SUPPORTED_LANGUAGES[selectedLang].nativeName}`);
      
      // Clear after success
      setTimeout(() => {
        setTextValues({ ...textValues, [selectedLang]: '' });
        setSuccess(null);
      }, 2000);
      
    } catch (err) {
      setError(err.message || 'Failed to save text');
    } finally {
      setIsSubmitting(false);
    }
  }, [textValues, selectedLang, recordKey, nodeHash, onSubmit]);

  const currentText = textValues[selectedLang] || '';
  const currentHomoglyphs = homoglyphWarnings[selectedLang] || [];
  const currentCharCount = charCounts[selectedLang] || 0;
  const charCategories = useMemo(() => detectCharCategories(currentText), [currentText]);
  const isRTL = SUPPORTED_LANGUAGES[selectedLang]?.rtl || false;

  return (
    <div className="w-full max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      {/* Header */}
      <div className="flex items-center gap-2 mb-6">
        <Languages className="w-5 h-5 text-blue-600" />
        <h3 className="text-lg font-semibold text-gray-900">
          Multi-Language {recordKey.charAt(0).toUpperCase() + recordKey.slice(1)}
        </h3>
      </div>

      {/* Language Selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-3">
          Select Language
        </label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
          {Object.entries(SUPPORTED_LANGUAGES).map(([code, lang]) => (
            <button
              key={code}
              onClick={() => handleLangSwitch(code)}
              className={`p-2 rounded-lg text-sm font-medium transition-all ${
                selectedLang === code
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
              title={lang.name}
            >
              <span>{lang.flag}</span>
              <div className="text-xs mt-1">{code}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Language Info */}
      <div className="mb-4 p-3 bg-blue-50 rounded-lg">
        <p className="text-sm text-gray-700">
          <span className="font-semibold">
            {SUPPORTED_LANGUAGES[selectedLang].flag} 
            {SUPPORTED_LANGUAGES[selectedLang].nativeName}
          </span>
          {isRTL && (
            <span className="ml-2 text-xs bg-orange-100 text-orange-800 px-2 py-1 rounded">
              RTL Language
            </span>
          )}
        </p>
      </div>

      {/* Text Input */}
      <div className="mb-6">
        <textarea
          value={currentText}
          onChange={handleTextChange}
          placeholder={placeholder}
          maxLength={maxLength}
          dir={isRTL ? 'rtl' : 'ltr'}
          rows={4}
          className={`w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            isRTL ? 'text-right' : 'text-left'
          } ${error ? 'border-red-500' : 'border-gray-300'}`}
        />
        
        {/* Character Count */}
        <div className="flex justify-between mt-2 text-sm text-gray-500">
          <span>{currentCharCount} / {maxLength} characters</span>
          <div className="h-2 w-24 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all"
              style={{ width: `${(currentCharCount / maxLength) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Homoglyph Warning */}
      {currentHomoglyphs.length > 0 && (
        <div className="mb-4 p-4 bg-orange-50 border border-orange-200 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
            <div>
              <h4 className="font-semibold text-orange-900 mb-2">
                Similar Characters Detected
              </h4>
              <ul className="space-y-1 text-sm text-orange-800">
                {currentHomoglyphs.map((h, i) => (
                  <li key={i}>
                    "{h.char}" ({h.lang}) looks like "{h.char}" (Latin) - Be careful with this name!
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Character Categories */}
      {currentText && (
        <div className="mb-4 p-3 bg-gray-50 rounded-lg">
          <p className="text-sm font-medium text-gray-700 mb-2">Text contains:</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(charCategories).map(([cat, found]) => found && (
              <span key={cat} className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded">
                {cat}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-green-700">{success}</p>
        </div>
      )}

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={isSubmitting || !currentText.trim()}
        className={`w-full py-2 px-4 rounded-lg font-medium transition-all ${
          isSubmitting || !currentText.trim()
            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
            : 'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800'
        }`}
      >
        {isSubmitting ? 'Saving...' : `Save in ${SUPPORTED_LANGUAGES[selectedLang].nativeName}`}
      </button>
    </div>
  );
};

export default MultiLangTextInput;
