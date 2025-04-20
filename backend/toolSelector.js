const genAI = require("./aiClient");

/**
 * Determines which tool to use next based on user message, facts, and conversation history.
 * @param {string} userMsg
 * @param {Array} facts
 * @param {Object} toolHistory
 * @param {Array} history - conversation history as [{role, text}, ...]
 * @returns {Object} { reasoning, tool, params }
 */
module.exports = async function toolSelector(userMsg, facts, toolHistory, history = []) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemma-3-27b-it" });

    // Few-shot examples for better tool selection
    const examples = [
      { query: 'sgd to myr', tool: 'WEB_SEARCH', params: { query: 'SGD to MYR exchange rate' } },
      { query: 'tell me the date', tool: 'GET_DATE', params: {} },
      { query: 'read https://example.com', tool: 'READ_URL', params: { url: 'https://example.com' } },
      { query: 'hello', tool: 'RESPOND', params: { reply: 'Hello! How can I help you?' } },
      { query: 'generate report for yapweijun1996', tool: 'WEB_SEARCH', params: { query: 'yapweijun1996 report' } }
    ];
    const exampleText = examples.map(ex =>
      `QUERY: "${ex.query}" → TOOL: ${ex.tool} with params ${JSON.stringify(ex.params)}`
    ).join("\n");
    const historySection = history.length
      ? `CONVERSATION HISTORY:\n${history.map(h => `${h.role}: ${h.text}`).join("\n")}\n\n`
      : '';
    const prompt = `You are a tool selector. For each user query, choose the tool that best fulfills the need.
Examples:
${exampleText}
Now decide for this message:
${historySection}
USER MESSAGE: "${userMsg}"
KNOWN FACTS:
${facts.map(f => `- ${f.type}: ${f.value}`).join("\n")}
Available tools:
- WEB_SEARCH: search the web
- READ_URL: fetch and parse a URL
- GET_DATE: get current date/time
- RESPOND: direct reply
Respond with JSON:
{
  "reasoning": "<step-by-step reasoning>",
  "tool": "<tool name>",
  "params": { /* tool parameters */ }
}`;

    const res = await model.generateContent(prompt);
    const text = await res.response.text();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in toolSelector response");
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error(`toolSelector error: ${err.message}`);
    return {
      reasoning: "Error selecting tool, defaulting to web search",
      tool: "WEB_SEARCH",
      params: { query: userMsg }
    };
  }
}; 