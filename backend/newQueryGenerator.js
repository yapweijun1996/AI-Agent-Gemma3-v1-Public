const genAI = require("./aiClient");

/**
 * Suggests a refined search term when previous searches fail.
 * @param {string} userMsg
 * @param {object} toolHistory
 * @param {Array} reasoningLog
 * @param {number} attempt
 */
module.exports = async function newQueryGenerator(userMsg, toolHistory, reasoningLog, attempt) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });
    const prompt = `The user asked: "${userMsg}" but the search results were insufficient.
Tools used: ${JSON.stringify(toolHistory)}.
What refined keyword or phrase should I try next? Output only the phrase.`;
    const res = await model.generateContent(prompt);
    const text = await res.response.text();
    return text.trim().split("\n")[0];
  } catch (err) {
    console.error(`newQueryGenerator error: ${err.message}`);
    return userMsg;
  }
}; 