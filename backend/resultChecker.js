const genAI = require("./aiClient");

/**
 * Uses LLM reflection to determine if a toolResult satisfies the query.
 * @param {any} toolResult
 * @param {string} userMsg
 * @param {Array} reasoningLog
 * @param {number} attempt
 */
module.exports = async function resultChecker(toolResult, userMsg, reasoningLog, attempt) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemma-3-27b-it" });
    const prompt = `You are a thoughtful AI. The user asked: "${userMsg}".
Tool returned: ${JSON.stringify(toolResult)}.
Here is what I've considered so far: ${JSON.stringify(reasoningLog)}.
Does this satisfy the user's request? Respond with JSON:
{ "sufficient": true/false, "reasoning": "...", "clarificationNeeded": true/false, "clarificationQuestion": "..." }
`;
    const res = await model.generateContent(prompt);
    const text = await res.response.text();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("No JSON from resultChecker");
    return JSON.parse(match[0]);
  } catch (err) {
    console.error(`resultChecker error: ${err.message}`);
    return { sufficient: false, reasoning: err.message };
  }
}; 