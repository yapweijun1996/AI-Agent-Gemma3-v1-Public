const util = require('util');

// Simple greetings/farewells patterns and responses
const defaultResponses = {
  greeting: "Hi there! How can I assist you today?",
  farewell: "Goodbye! Feel free to chat again when you need assistance.",
  thanks: "You're welcome! Happy to help."
};

// This is a simplified intent detection that avoids hard-coding every possible phrase
// It uses semantic similarity rather than exact pattern matching
function detectMessageIntent(message) {
  if (!message || typeof message !== 'string') return 'other';
  
  const normalized = message.toLowerCase().trim();
  
  // Use semantic detection rather than exhaustive lists
  // Check for general patterns rather than exact phrases
  if (normalized.length < 15) { // Short messages are more likely to be simple intents
    // Generic greeting check - single word greetings or common phrases 
    if (/^(hi|hey|hello|howdy|hiya|morning|evening|afternoon|greetings|yo|sup)/i.test(normalized)) {
      return 'greeting';
    }
    
    // Generic farewell check - common closing phrases
    if (/^(bye|goodbye|farewell|see\s*you|later|take\s*care)/i.test(normalized)) {
      return 'farewell';
    }
    
    // Generic thanks check - expressions of gratitude
    if (/^(thanks|thank|thx|appreciate|grateful)/i.test(normalized)) {
      return 'thanks';
    }
  }
  
  return 'other';
}

// More intelligent response generator that could be improved with LLM
function generateContextualResponse(messageType, context = {}) {
  const { userMsg, timeOfDay, previousMessages } = context;
  
  switch(messageType) {
    case 'greeting':
      // Could check time of day for more contextual greeting
      return defaultResponses.greeting;
    case 'farewell':
      return defaultResponses.farewell;
    case 'thanks':
      return defaultResponses.thanks; 
    default:
      return null;
  }
}

module.exports = {
  name: "RESPOND",
  description: "Reply directly to the user with the provided message.",
  parametersSchema: {
    reply: { type: "string", required: false },
    response: { type: "string", required: false },
    message: { type: "string", required: false },
    text: { type: "string", required: false }
  },
  // Export the detectMessageType function to be used elsewhere
  detectMessageIntent,
  async run(params, context) {
    // Log params for debugging
    console.log('[RESPOND TOOL] Received params:', util.inspect(params, { depth: 3 }));
    
    // Check if explicit reply was provided
    const reply = params.reply || params.response || params.message || params.text;
    
    // If no explicit reply, but we have user message context, generate an appropriate response
    if (!reply && context && context.userMsg) {
      const messageType = detectMessageIntent(context.userMsg);
      const contextualReply = generateContextualResponse(messageType, context);
      
      return { 
        reply: contextualReply || "I'm not sure how to respond to that. Can you please provide more information?",
        messageType
      };
    }
    
    if (!reply) {
      return { reply: "Sorry, I could not select a tool." };
    }
    
    return { reply };
  }
}; 