/* backend/reasoning/intent_classifier.js */
const { createLogger, format, transports } = require('winston');
const logger = require('../logger');

// Configure logger
const loggerConfig = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}] ${message}`;
    })
  ),
  transports: [new transports.Console()]
});

// Valid intent categories
const VALID_INTENTS = [
  'greeting',     // Simple hello or social greeting
  'farewell',     // User is saying goodbye
  'thanks',       // Expressing gratitude
  'factual_query', // Asking for factual information
  'personal_query', // Asking about personal details already discussed
  'opinion_query', // Asking for opinions or evaluations
  'action_request', // Asking the agent to do something
  'clarification', // Asking for clarification
  'feedback'      // Giving feedback about the agent
];

/**
 * Intent classifier module for detecting user message intentions
 * This helps route requests to the appropriate tools and responses
 */

/**
 * Classify user intent using both rule-based and ML approaches
 * @param {string} userMsg - User's message
 * @param {object} context - Context including history and facts
 * @param {object} genAI - The Gemini API object
 * @returns {object} Intent classification with confidence score
 */
async function classifyIntent(userMsg, context, genAI) {
  // First do quick rule-based classification for common patterns
  const quickIntent = quickClassify(userMsg);
  if (quickIntent.confidence > 0.9) {
    return quickIntent;
  }
  
  // For more complex intents, use the LLM
  return await mlClassify(userMsg, context, genAI);
}

/**
 * Quick rule-based classifier for high-confidence matches
 * @param {string} msg - User message
 * @returns {object} Intent and confidence
 */
function quickClassify(msg) {
  const msgLower = msg.toLowerCase().trim();
  
  // Report generation requests should be high-confidence action_request
  if (msgLower.includes('report')) {
    return { intent: 'action_request', confidence: 0.95 };
  }
  
  // Greeting detection
  if (/^(hi|hello|hey|hi there|good morning|good afternoon|good evening)$/i.test(msgLower)) {
    return { intent: 'greeting', confidence: 0.95 };
  }
  
  // Farewell detection
  if (/^(bye|goodbye|see you|later|until next time)$/i.test(msgLower)) {
    return { intent: 'farewell', confidence: 0.95 };
  }
  
  // Thanks detection
  if (/^(thanks|thank you|thx|ty|appreciate it)$/i.test(msgLower)) {
    return { intent: 'thanks', confidence: 0.95 };
  }
  
  // Report request detection (high confidence if explicitly mentions report creation)
  if (/write (a |the )?report|create (a |the )?report|generate (a |the )?report/i.test(msgLower)) {
    return { intent: 'action_request', confidence: 0.9 };
  }
  
  // Personal query detection
  if (/my|mine|i have|do i have|what is my|where is my|when is my/i.test(msgLower)) {
    return { intent: 'personal_query', confidence: 0.8 };
  }
  
  // For all other cases, return a low confidence default
  return { intent: 'unknown', confidence: 0.3 };
}

/**
 * ML-based intent classifier using Gemini
 * @param {string} msg - User message
 * @param {object} context - Context including history and facts
 * @param {object} genAI - The Gemini API object
 * @returns {object} Intent classification with confidence
 */
async function mlClassify(msg, context, genAI) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const prompt = `
Classify the user's message into one of these intent categories:
- greeting: Simple greetings or conversation starters
- farewell: Messages indicating the user is leaving
- thanks: Expressions of gratitude
- personal_query: Questions about personal information or preferences
- factual_query: Questions seeking factual information
- action_request: Requests for the system to perform a specific action (e.g., create something, write something)
- clarification: User is asking for clarification or explanation
- feedback: User is providing feedback on system performance

User message: "${msg}"
${context.historyContext ? `Recent conversation context: ${context.historyContext}` : ''}
${context.facts && context.facts.length > 0 ? `Known facts: ${context.facts.map(f => `${f.type}: ${f.value}`).join(', ')}` : ''}

Respond with only a JSON object in this format:
{
  "intent": "THE_INTENT_CATEGORY",
  "confidence": CONFIDENCE_SCORE_BETWEEN_0_AND_1,
  "explanation": "Brief explanation of why this intent was chosen"
}`;

    const result = await model.generateContent(prompt);
    const responseText = await result.response.text();
    
    // Extract JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const classification = JSON.parse(jsonMatch[0]);
      logger.debug(`[INTENT] ML classified as ${classification.intent} (${classification.confidence})`);
      return classification;
    } else {
      logger.error('[INTENT] Failed to extract JSON from ML classifier response');
      return { intent: 'unknown', confidence: 0.5 };
    }
  } catch (error) {
    logger.error(`[INTENT] Error in ML classification: ${error.message}`);
    return { intent: 'unknown', confidence: 0.5 };
  }
}

/**
 * Get tool recommendations based on intent
 * @param {string} intent - Classified intent
 * @returns {Array} Recommended tools for this intent
 */
function getToolRecommendations(intent) {
  const toolMap = {
    'greeting': ['RESPOND'],
    'farewell': ['RESPOND'],
    'thanks': ['RESPOND'],
    'factual_query': ['WEB_SEARCH', 'READ_URL', 'REASONING_TOOL'],
    'personal_query': ['RESPOND'],
    'opinion_query': ['GENERATE', 'WEB_SEARCH', 'REASONING_TOOL'],
    'action_request': ['REASONING_TOOL', 'GENERATE'],
    'clarification': ['RESPOND'],
    'feedback': ['RESPOND']
  };
  
  return toolMap[intent] || ['WEB_SEARCH', 'RESPOND'];
}

module.exports = {
  classifyIntent,
  getToolRecommendations,
  VALID_INTENTS
}; 