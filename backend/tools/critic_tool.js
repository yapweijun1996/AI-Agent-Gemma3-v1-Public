/* backend/tools/critic_tool.js */
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
 * CRITIC_TOOL - Evaluates response quality and suggests improvements
 * This tool helps ensure responses are accurate, complete, and helpful
 */
module.exports = {
  name: "CRITIC_TOOL",
  description: "Evaluates response quality and suggests improvements",
  parametersSchema: {
    userQuery: { type: "string", required: true },
    proposedResponse: { type: "string", required: true },
    facts: { type: "array", required: false },
    context: { type: "string", required: false }
  },
  
  /**
   * Evaluate a proposed response
   * @param {Object} params - Tool parameters
   * @param {Object} context - Execution context
   * @returns {Object} Evaluation results
   */
  async run(params, context) {
    try {
      logger.info(`Evaluating response for query: "${params.userQuery}"`);
      
      // Validate required parameters
      if (!params.userQuery || !params.proposedResponse) {
        return { 
          error: "Missing required parameters: userQuery and proposedResponse",
          success: false
        };
      }
      
      // Extract needed context
      const { genAI } = context;
      
      if (!genAI) {
        logger.warn('No LLM provider in context');
        return {
          error: "Missing LLM provider in context",
          success: false
        };
      }
      
      // Get the model
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const prompt = `
You are a critical evaluator for AI responses. Evaluate this proposed response:

USER QUERY: "${params.userQuery}"

PROPOSED RESPONSE: 
"""
${params.proposedResponse}
"""

${params.facts && params.facts.length > 0 ? `
KNOWN FACTS: 
${params.facts.map(f => `- ${f.type}: ${f.value}`).join('\n')}
` : ''}

${params.context ? `ADDITIONAL CONTEXT: ${params.context}` : ''}

Evaluate the response on these criteria:
1. Accuracy (1-10): Is the information factually correct?
2. Completeness (1-10): Does it fully address the user's query?
3. Relevance (1-10): Is it directly relevant to what was asked?
4. Clarity (1-10): Is it clearly expressed and easy to understand?
5. Helpfulness (1-10): Does it actually help the user?

Respond with a JSON object:
{
  "accuracy": score (1-10),
  "completeness": score (1-10),
  "relevance": score (1-10),
  "clarity": score (1-10),
  "helpfulness": score (1-10),
  "overallScore": weighted average of above scores,
  "strengthsAndWeaknesses": "Brief analysis of strengths and weaknesses",
  "improvementSuggestions": ["specific suggestion 1", "specific suggestion 2"],
  "factualErrors": ["error 1", "error 2"] (or empty array if none),
  "passesQualityCheck": true/false (true if overallScore >= 7)
}
`;

      const result = await model.generateContent(prompt);
      const text = await result.response.text();
      
      // Extract JSON object
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('Failed to extract evaluation result');
        return {
          error: "Failed to evaluate response",
          success: false
        };
      }
      
      const evaluation = JSON.parse(jsonMatch[0]);
      
      // Log the overall evaluation
      logger.info(`Response evaluation: Score=${evaluation.overallScore}, Passes=${evaluation.passesQualityCheck}`);
      
      return {
        success: true,
        evaluation
      };
      
    } catch (error) {
      logger.error(`Error in critic tool: ${error.message}`);
      return {
        error: `Evaluation failed: ${error.message}`,
        success: false
      };
    }
  }
}; 