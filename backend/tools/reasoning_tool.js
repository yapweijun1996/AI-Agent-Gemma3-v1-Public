/* backend/tools/reasoning_tool.js */
const util = require('util');
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
 * REASONING_TOOL - Performs multi-step reasoning to solve complex problems
 * This tool helps break down complex questions into steps and solve them methodically
 */
module.exports = {
  name: "REASONING_TOOL",
  description: "Performs multi-step reasoning to solve complex problems",
  parametersSchema: {
    problem: { type: "string", required: true },
    context: { type: "string", required: false },
    max_steps: { type: "number", required: false }
  },
  
  /**
   * Execute the reasoning process
   * @param {Object} params - Tool parameters
   * @param {Object} context - Execution context
   * @returns {Object} Reasoning results
   */
  async run(params, context) {
    try {
      logger.info(`Running reasoning tool for problem: "${params.problem}"`);
      
      // Validate required parameters
      if (!params.problem) {
        return { 
          error: "Missing required parameter: problem",
          success: false
        };
      }
      
      // Extract needed context
      const { userMsg, toolHistory, reasoningLog, genAI } = context;
      const maxSteps = params.max_steps || 5;
      
      if (!genAI) {
        logger.warn('No LLM provider in context, using default modelProvider');
        // You'd need to handle this by providing access to the model
        return {
          error: "Missing LLM provider in context",
          success: false
        };
      }
      
      // Get the model
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
      
      // First, determine the reasoning approach
      const approachPrompt = `
Given this problem: "${params.problem}"
${params.context ? `Additional context: ${params.context}` : ''}

I need to determine the most effective reasoning approach. Think about:
1. What type of problem is this? (mathematical, logical, factual, etc.)
2. What steps would be most appropriate to solve it?
3. What information do I need to consider?

Respond with a JSON object describing your reasoning approach:
{
  "problemType": "type of problem",
  "reasoningApproach": "description of approach",
  "steps": ["step 1", "step 2", "..."]
}
`;

      const approachResult = await model.generateContent(approachPrompt);
      const approachText = await approachResult.response.text();
      
      // Extract JSON object
      const approachMatch = approachText.match(/\{[\s\S]*\}/);
      if (!approachMatch) {
        logger.warn('Failed to extract reasoning approach');
        return {
          error: "Failed to determine reasoning approach",
          success: false
        };
      }
      
      const approach = JSON.parse(approachMatch[0]);
      logger.info(`Determined reasoning approach: ${approach.reasoningApproach}`);
      
      // Now execute the step-by-step reasoning
      const reasoningPrompt = `
I need to solve this problem through careful step-by-step reasoning:

PROBLEM: "${params.problem}"
${params.context ? `CONTEXT: ${params.context}` : ''}

REASONING APPROACH:
- Problem type: ${approach.problemType}
- Approach: ${approach.reasoningApproach}

I'll solve this by working through the following steps:
${approach.steps.map((step, i) => `${i+1}. ${step}`).join('\n')}

Let me reason through each step:

`;

      const reasoningResult = await model.generateContent(reasoningPrompt);
      const reasoning = await reasoningResult.response.text();
      
      // Extract the steps and conclusion
      const steps = reasoning.split('\n')
        .filter(line => line.trim().length > 0)
        .map(line => line.trim());
      
      // Final verification and conclusion
      const verificationPrompt = `
I've solved this problem:
"${params.problem}"

My reasoning was:
${reasoning}

Let me verify my solution:
1. Have I addressed all aspects of the problem?
2. Is my reasoning sound?
3. Are there any logical errors?
4. Is my conclusion supported by my reasoning?

Based on this verification, my final answer is:
`;

      const verificationResult = await model.generateContent(verificationPrompt);
      const verification = await verificationResult.response.text();
      
      // Extract the answer after 'final answer is:', otherwise fall back to the full verification text
      const conclusionMatch = verification.match(/(?:final answer is:?)\s*([\s\S]*)/i);
      const conclusion = conclusionMatch
        ? conclusionMatch[1].trim()
        : verification.trim();
      
      return {
        success: true,
        problemType: approach.problemType,
        reasoningApproach: approach.reasoningApproach,
        steps: approach.steps,
        reasoning: steps,
        conclusion: conclusion,
        confidence: 0.85
      };
      
    } catch (error) {
      logger.error(`Error in reasoning tool: ${error.message}`);
      return {
        error: `Reasoning process failed: ${error.message}`,
        success: false
      };
    }
  }
}; 