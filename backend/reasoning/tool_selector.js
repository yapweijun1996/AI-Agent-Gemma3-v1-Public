/* backend/reasoning/tool_selector.js */
const { createLogger, format, transports } = require('winston');

// Configure logger
const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}] ${message}`;
    })
  ),
  transports: [new transports.Console()]
});

/**
 * Select the most appropriate tool(s) for a given query
 * @param {string} query - User query
 * @param {string} intent - Classified intent
 * @param {Array} facts - Known facts about user
 * @param {Object} history - Chat history context
 * @param {Object} toolHistory - Previously used tools
 * @param {Object} modelProvider - LLM provider
 * @returns {Object} Selected tool and parameters
 */
async function selectTools(query, intent, facts, history, toolHistory, modelProvider) {
  try {
    logger.info(`Selecting tools for query: "${query}" with intent: ${intent}`);
    
    // Directly route any action_request involving reports to the reasoning tool
    const lower = query.toLowerCase();
    if (intent === 'action_request' && lower.includes('report')) {
      return {
        tool: 'REASONING_TOOL',
        parameters: { problem: query },
        reasoning: 'Detected action request to generate report, using reasoning tool'
      };
    }
    // Normalize query for simple pattern matches
    const normalized = lower.trim();
    
    // Special case: full report generation request
    if (normalized.includes('generate report') || normalized.includes('report in detail')) {
      return {
        tool: 'REASONING_TOOL',
        parameters: { problem: query },
        reasoning: 'Detected request to generate a detailed report'
      };
    }
    // Special case: find <username> -> GitHub profile lookup
    const findMatch = normalized.match(/^find\s+([\w-]+)$/i);
    if (findMatch) {
      const username = findMatch[1];
      const url = `https://github.com/${username}`;
      return {
        tool: 'READ_URL',
        parameters: { url },
        reasoning: 'Direct GitHub profile lookup for username'
      };
    }
    // Special case: report generation requests
    if (/report/i.test(normalized)) {
      return {
        tool: 'REASONING_TOOL',
        parameters: { problem: query },
        reasoning: 'Report request detected, using reasoning tool'
      };
    }
    // Get available tools
    const availableTools = require('../tools');
    
    // Check if any tools are available
    if (!availableTools || Object.keys(availableTools).length === 0) {
      logger.error('No tools available');
      return defaultToolSelection(query, intent);
    }
    
    // Use LLM to select the best tool based on intent and query
    const model = modelProvider.getGenerativeModel({ model: "gemini-1.5-flash" });
    
    const toolDescriptions = Object.entries(availableTools)
      .map(([name, tool]) => `${name}: ${tool.description || 'No description available'}`)
      .join('\n');
    
    const prompt = `
I need to select the most appropriate tool to handle this user query.

USER QUERY: "${query}"
QUERY INTENT: ${intent}

AVAILABLE TOOLS:
${toolDescriptions}

KNOWN FACTS ABOUT USER:
${facts.map(f => `- ${f.type}: ${f.value}`).join('\n')}

CONVERSATION HISTORY:
${history || "No previous conversation"}

PREVIOUSLY USED TOOLS:
${JSON.stringify(toolHistory || {})}

Consider these guidelines:
1. For greeting/farewell/thanks intents (social interactions), use RESPOND
2. For factual queries needing external information, use WEB_SEARCH
3. For questions about personal details we already know from facts, use RESPOND
4. For content requiring web page parsing, use READ_URL
5. For content generation tasks, use GENERATE
6. For complex reasoning tasks, use REASONING_TOOL
7. For straightforward conversational responses, use RESPOND

Respond with a JSON object containing your selection:
{
  "reasoning": "Explanation of why this tool was selected",
  "selectedTool": "NAME_OF_SELECTED_TOOL",
  "parameters": {
    "param1": "value1",
    "param2": "value2"
  }
}
`;

    const result = await model.generateContent(prompt);
    const text = await result.response.text();
    
    // Extract JSON object
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('Failed to extract tool selection from LLM response');
      return defaultToolSelection(query, intent);
    }
    
    const toolSelection = JSON.parse(jsonMatch[0]);
    
    // Validate the tool selection
    if (!toolSelection.selectedTool || !availableTools[toolSelection.selectedTool]) {
      logger.warn(`Invalid tool selection: ${toolSelection.selectedTool}`);
      return defaultToolSelection(query, intent);
    }
    
    // Format the response in the expected format
    const formattedResponse = {
      reasoning: toolSelection.reasoning,
      tool: toolSelection.selectedTool,
      parameters: toolSelection.parameters || {}
    };
    
    logger.info(`Selected tool: ${formattedResponse.tool}`);

    return formattedResponse;
    
  } catch (error) {
    logger.error(`Error selecting tool: ${error.message}`);
    return defaultToolSelection(query, intent);
  }
}

/**
 * Default tool selection when LLM selection fails
 * @param {string} query - User query
 * @param {string} intent - Classified intent
 * @returns {Object} Default tool selection
 */
function defaultToolSelection(query, intent) {
  // Special-case: report generation defaults to reasoning tool
  if (/report/i.test(query)) {
    return {
      reasoning: 'Detected report request in default selection',
      tool: 'REASONING_TOOL',
      parameters: { problem: query }
    };
  }
  // Map intents to default tools
  const defaultToolMap = {
    'greeting': {
      tool: 'RESPOND',
      parameters: { reply: 'Hello! How can I assist you today?' }
    },
    'farewell': {
      tool: 'RESPOND',
      parameters: { reply: 'Goodbye! Feel free to return if you need further assistance.' }
    },
    'thanks': {
      tool: 'RESPOND',
      parameters: { reply: "You're welcome! Is there anything else I can help with?" }
    },
    'factual_query': {
      tool: 'WEB_SEARCH',
      parameters: { query: query }
    },
    'personal_query': {
      tool: 'RESPOND',
      parameters: { reply: "I don't have that information about you yet." }
    },
    'opinion_query': {
      tool: 'GENERATE',
      parameters: { prompt: `Generate a thoughtful response to: "${query}"` }
    },
    'action_request': {
      tool: 'REASONING_TOOL',
      parameters: { problem: query }
    },
    'clarification': {
      tool: 'RESPOND',
      parameters: { reply: "I'm not sure I understand. Could you please provide more details?" }
    },
    'feedback': {
      tool: 'RESPOND',
      parameters: { reply: "Thank you for your feedback!" }
    }
  };
  
  // Get the default tool for this intent, or fall back to WEB_SEARCH
  const defaultTool = defaultToolMap[intent] || {
    tool: 'WEB_SEARCH',
    parameters: { query: query }
  };
  
  logger.info(`Using default tool selection for intent ${intent}: ${defaultTool.tool}`);
  
  return {
    reasoning: `Default tool selection based on intent: ${intent}`,
    ...defaultTool
  };
}

module.exports = {
  selectTools
}; 