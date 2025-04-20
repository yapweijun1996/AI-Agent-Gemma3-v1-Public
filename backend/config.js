// backend/config.js - Centralized configuration with fallbacks
const path = require('path');
// Load environment variables from project root .env
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// Utility function to check if a variable is empty or undefined
const isEmpty = (value) => {
  return value === undefined || value === null || value === '';
};

// Helper to get config from environment with fallbacks
const getConfig = (key, defaultValue = '', required = false) => {
  const value = process.env[key] || defaultValue;
  
  if (required && isEmpty(value)) {
    console.error(`Required configuration ${key} is missing!`);
    process.exit(1);
  }
  
  return value;
};

// Core configurations
const config = {
  // Server settings
  port: parseInt(getConfig('PORT', '3004')),
  environment: getConfig('NODE_ENV', 'development'),
  logLevel: getConfig('LOG_LEVEL', 'info'),
  
  // API Keys with fallback mechanism
  geminiApiKey: getConfig('GEMINI_API_KEY', '', true),
  geminiApiKeyBackup: getConfig('GEMINI_API_KEY2', ''),
  
  // Model settings
  defaultModel: getConfig('DEFAULT_MODEL', 'gemma-3-27b-it'),
  fallbackModel: getConfig('FALLBACK_MODEL', 'gemini-1.5-flash'),
  
  // Tool settings
  webSearchEnabled: getConfig('WEB_SEARCH_ENABLED', 'true') === 'true',
  searchTimeout: parseInt(getConfig('SEARCH_TIMEOUT', '15000')),
  
  // Function to test API key validity
  testApiKey: async function(apiKey) {
    try {
      const { GoogleGenerativeAI } = require("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent("Test");
      return result && result.response ? true : false;
    } catch (error) {
      console.error(`API key test failed: ${error.message}`);
      return false;
    }
  },
  
  // Get a working API key (primary or backup)
  getWorkingApiKey: async function() {
    // Try primary key first
    if (await this.testApiKey(this.geminiApiKey)) {
      return this.geminiApiKey;
    }
    
    // Try backup key if available
    if (this.geminiApiKeyBackup && await this.testApiKey(this.geminiApiKeyBackup)) {
      console.log('Using backup API key');
      return this.geminiApiKeyBackup;
    }
    
    // No working keys found
    console.error('No working API keys available!');
    return null;
  }
};

module.exports = config; 