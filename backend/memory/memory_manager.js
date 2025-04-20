/* backend/memory/memory_manager.js */
const { createLogger, format, transports } = require('winston');
const logger = require('../logger');
const fs = require('fs').promises;
const path = require('path');

// Configure logger
const loggerInstance = createLogger({
  level: 'warn',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message }) => {
      return `${timestamp} ${level}: ${message}`;
    })
  ),
  transports: [new transports.Console()]
});

// Path to store memory files
const MEMORY_DIR = path.join(__dirname, '../data/memory');

/**
 * Memory Manager class for hierarchical fact management
 * Stores and retrieves facts about users across different memory layers
 */
class MemoryManager {
  constructor() {
    // In-memory storage for current session
    this.sessionMemory = [];
    
    // Persistent memory for user-specific info
    this.userProfileMemory = [];
    
    // Persistent memory for general knowledge
    this.generalKnowledge = [];
    
    // Initialize file-based memory storage
    this.initialize();
  }
  
  async initialize() {
    try {
      await fs.mkdir(MEMORY_DIR, { recursive: true });
      loggerInstance.info('Memory system initialized');
    } catch (error) {
      loggerInstance.error('Failed to initialize memory system:', error);
    }
  }
  
  /**
   * Store a fact in memory
   * @param {Object} fact - Fact to store with type and value
   * @param {string} persistence - Where to store: 'session', 'user', or 'general'
   * @returns {boolean} Success indicator
   */
  storeFact(fact, persistence = 'session') {
    try {
      if (!fact.type || !fact.value) {
        loggerInstance.warn('Attempted to store invalid fact', fact);
        return false;
      }
      
      const enrichedFact = {
        ...fact,
        timestamp: Date.now(),
      };
      
      if (persistence === 'user') {
        const existingIndex = this.userProfileMemory.findIndex(f => f.type === fact.type);
        
        if (existingIndex >= 0) {
          this.userProfileMemory[existingIndex] = enrichedFact;
        } else {
          this.userProfileMemory.push(enrichedFact);
        }
        loggerInstance.info(`Stored fact in user profile: ${fact.type}=${fact.value}`);
      } else if (persistence === 'general') {
        const existingIndex = this.generalKnowledge.findIndex(f => f.type === fact.type);
        
        if (existingIndex >= 0) {
          this.generalKnowledge[existingIndex] = enrichedFact;
        } else {
          this.generalKnowledge.push(enrichedFact);
        }
        loggerInstance.info(`Stored fact in general knowledge: ${fact.type}=${fact.value}`);
      } else {
        // Default to session memory
        const existingIndex = this.sessionMemory.findIndex(f => f.type === fact.type);
        
        if (existingIndex >= 0) {
          this.sessionMemory[existingIndex] = enrichedFact;
        } else {
          this.sessionMemory.push(enrichedFact);
        }
        loggerInstance.info(`Stored fact in session memory: ${fact.type}=${fact.value}`);
      }
      return true;
    } catch (error) {
      loggerInstance.error(`Error storing fact: ${error.message}`);
      return false;
    }
  }
  
  /**
   * Store multiple facts at once
   * @param {Array} facts - Array of fact objects
   * @param {string} persistence - Where to store
   * @returns {number} Number of successfully stored facts
   */
  storeFacts(facts, persistence = 'session') {
    if (!Array.isArray(facts)) {
      loggerInstance.warn('storeFacts called with non-array argument');
      return 0;
    }
    
    let successCount = 0;
    for (const fact of facts) {
      if (this.storeFact(fact, persistence)) {
        successCount++;
      }
    }
    
    loggerInstance.info(`Stored ${successCount}/${facts.length} facts`);
    return successCount;
  }
  
  /**
   * Get all facts from memory
   * @returns {Array} All facts
   */
  getAllFacts() {
    return [
      ...this.sessionMemory,
      ...this.userProfileMemory,
      ...this.generalKnowledge
    ];
  }
  
  /**
   * Retrieve facts that are relevant to the given query
   * @param {string} query - The user query
   * @param {Object} genAI - Gemini API object for processing  
   * @returns {Array} Relevant facts
   */
  async getRelevantFacts(query, genAI) {
    try {
      const allFacts = this.getAllFacts();
      
      if (allFacts.length === 0) {
        return [];
      }
      
      // For small fact collections, we can return all facts
      if (allFacts.length <= 5) {
        loggerInstance.info(`Returning all ${allFacts.length} facts (small collection)`);
        return allFacts;
      }
      
      // Use LLM to determine relevance
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const prompt = `
You are helping an AI assistant retrieve relevant facts from its memory.

USER QUERY: "${query}"

AVAILABLE FACTS:
${allFacts.map((fact, idx) => `[${idx}] ${fact.type}: ${fact.value}`).join('\n')}

Return only the indices of facts that are MOST RELEVANT to answering the user's query.
Format your response as a JSON array of numbers, e.g., [0, 2, 5]
If no facts are relevant, return an empty array: []
`;

      const result = await model.generateContent(prompt);
      const text = await result.response.text();
      
      // Extract JSON array from response
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        loggerInstance.warn('Failed to extract relevant fact indices from LLM response');
        return allFacts; // Return all facts as fallback
      }
      
      const indices = JSON.parse(jsonMatch[0]);
      
      // Guard against invalid indices
      const validIndices = indices.filter(idx => 
        Number.isInteger(idx) && idx >= 0 && idx < allFacts.length
      );
      
      const relevantFacts = validIndices
        .map(idx => allFacts[idx]);
      
      loggerInstance.info(`Retrieved ${relevantFacts.length} relevant facts out of ${allFacts.length} total`);
      return relevantFacts;
      
    } catch (error) {
      loggerInstance.error(`Error retrieving relevant facts: ${error.message}`);
      return this.getAllFacts(); // Return all facts as fallback
    }
  }
  
  /**
   * Check if memory has an answer for a query
   * @param {string} query - The query to check
   * @param {Object} genAI - Gemini API object
   * @returns {Object} Result with found status and answer if found
   */
  async checkMemoryForAnswer(query, genAI) {
    try {
      const relevantFacts = await this.getRelevantFacts(query, genAI);
      
      if (relevantFacts.length === 0) {
        return { found: false };
      }
      
      // Check if the facts only contain the user's request without actual information
      if (relevantFacts.length === 1 && 
          relevantFacts[0].type === 'user_request' && 
          relevantFacts[0].value.toLowerCase().includes(query.toLowerCase())) {
        // Don't treat a stored request as an answer to the same request
        loggerInstance.info('Found only user request in memory, not treating as answer');
        return { found: false };
      }
      
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const prompt = `
You are helping an AI assistant determine if it can answer a query using facts from its memory.

USER QUERY: "${query}"

RELEVANT FACTS:
${relevantFacts.map(fact => `- ${fact.type}: ${fact.value}`).join('\n')}

Can you answer the user's question using ONLY the facts above?
Be careful not to confuse stored requests with actual answers.
Only answer true if you have SPECIFIC INFORMATION that directly answers the query.

Respond with a JSON object:
{
  "canAnswer": true/false,
  "answer": "The answer based on facts" (only if canAnswer is true),
  "confidence": 0.0-1.0 (your confidence in the answer),
  "missingInformation": "What information is missing to answer" (only if canAnswer is false),
  "isUserRequestOnly": true/false (true if the facts only contain a restatement of the user's request)
}
`;

      const result = await model.generateContent(prompt);
      const text = await result.response.text();
      
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        loggerInstance.warn('Failed to extract memory check result from LLM response');
        return { found: false };
      }
      
      const memoryCheck = JSON.parse(jsonMatch[0]);
      
      // Additional check to prevent treating requests as answers
      if (memoryCheck.isUserRequestOnly) {
        loggerInstance.info('LLM detected that memory only contains user request, not treating as answer');
        return { found: false };
      }
      
      if (memoryCheck.canAnswer && memoryCheck.answer) {
        // Validate that the answer is not just repeating the question
        if (memoryCheck.answer.toLowerCase().includes(`requested to ${query.toLowerCase()}`)) {
          loggerInstance.warn('Answer appears to be a restatement of the request, not treating as valid answer');
          return { found: false };
        }
        
        loggerInstance.info(`Found answer in memory with confidence ${memoryCheck.confidence}`);
        return {
          found: true,
          answer: memoryCheck.answer,
          confidence: memoryCheck.confidence
        };
      } else {
        loggerInstance.info(`Memory check: ${memoryCheck.missingInformation}`);
        return { 
          found: false, 
          reason: memoryCheck.missingInformation
        };
      }
      
    } catch (error) {
      loggerInstance.error(`Error checking memory for answer: ${error.message}`);
      return { found: false, error: error.message };
    }
  }
  
  /**
   * Check if the memory system has an answer for a personal query using file storage
   * @param {string} userId - User identifier
   * @param {string} query - The personal query
   * @param {object} genAI - Gemini API object for processing
   * @returns {string|null} The answer if found, null otherwise
   */
  async checkPersonalQuery(userId, query, genAI) {
    try {
      // First check existing in-memory facts
      const memoryCheck = await this.checkMemoryForAnswer(query, genAI);
      if (memoryCheck.found) {
        return memoryCheck.answer;
      }
      
      // Then check user's file-based storage
      const userMemory = await this.getUserMemory(userId);
      
      if (Object.keys(userMemory).length === 0) {
        return null;
      }
      
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const memoryData = JSON.stringify(userMemory);
      const prompt = `
You are a helpful assistant trying to answer a personal query from a user based on previously stored information.

USER QUERY: "${query}"

STORED USER INFORMATION:
${memoryData}

Can this query be answered using ONLY the stored information above? If yes, provide the answer.
If no, respond with "INSUFFICIENT_DATA".

Be concise and only use information from the memory data. Do not make up facts.
`;

      const result = await model.generateContent(prompt);
      const response = await result.response.text();
      
      if (response.includes("INSUFFICIENT_DATA")) {
        return null;
      }
      
      loggerInstance.info(`Found memory-based answer for user ${userId}'s query`);
      return response;
    } catch (error) {
      loggerInstance.error(`Error checking personal query for user ${userId}:`, error);
      return null;
    }
  }
  
  /**
   * Store a memory item for a user in file storage
   * @param {string} userId - User identifier
   * @param {string} key - Memory key
   * @param {any} value - Memory value
   * @returns {boolean} Success indicator
   */
  async storeUserMemory(userId, key, value) {
    try {
      const userMemory = await this.getUserMemory(userId);
      userMemory[key] = {
        value,
        timestamp: Date.now()
      };
      
      await fs.writeFile(
        this.getUserMemoryPath(userId),
        JSON.stringify(userMemory, null, 2)
      );
      
      loggerInstance.info(`Stored memory for user ${userId}: ${key}`);
      
      // Also store as a fact in memory
      this.storeFact({ 
        type: key, 
        value: value 
      }, 'user');
      
      return true;
    } catch (error) {
      loggerInstance.error(`Error storing memory for user ${userId}:`, error);
      return false;
    }
  }
  
  /**
   * Retrieve a memory item for a user from file storage
   * @param {string} userId - User identifier
   * @param {string} key - Memory key
   * @returns {any|null} Memory value or null if not found
   */
  async retrieveUserMemory(userId, key) {
    try {
      const userMemory = await this.getUserMemory(userId);
      return userMemory[key]?.value || null;
    } catch (error) {
      loggerInstance.error(`Error retrieving memory for user ${userId}:`, error);
      return null;
    }
  }
  
  /**
   * Get user's memory object from file storage
   * @param {string} userId - User identifier
   * @returns {object} User memory object
   */
  async getUserMemory(userId) {
    const memoryPath = this.getUserMemoryPath(userId);
    
    try {
      const data = await fs.readFile(memoryPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist yet, return empty object
        return {};
      }
      loggerInstance.error(`Error reading memory file for user ${userId}:`, error);
      return {};
    }
  }
  
  /**
   * Get the file path for a user's memory
   * @param {string} userId - User identifier 
   * @returns {string} File path
   */
  getUserMemoryPath(userId) {
    // Sanitize userId to make it safe for file system
    const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(MEMORY_DIR, `${safeUserId}.json`);
  }
  
  /**
   * Clear session memory
   */
  clearSessionMemory() {
    const count = this.sessionMemory.length;
    this.sessionMemory = [];
    loggerInstance.info(`Cleared ${count} facts from session memory`);
  }
  
  /**
   * Get memory stats
   * @returns {Object} Statistics about the memory
   */
  getStats() {
    return {
      sessionMemoryCount: this.sessionMemory.length,
      userProfileMemoryCount: this.userProfileMemory.length,
      generalKnowledgeCount: this.generalKnowledge.length,
      totalFactsCount: this.sessionMemory.length + this.userProfileMemory.length + this.generalKnowledge.length,
      sessionFactTypes: [...new Set(this.sessionMemory.map(f => f.type))],
      userFactTypes: [...new Set(this.userProfileMemory.map(f => f.type))],
      generalFactTypes: [...new Set(this.generalKnowledge.map(f => f.type))]
    };
  }
}

// Export a singleton instance
module.exports = new MemoryManager(); 