// backend/coTHelper.js
// Centralizes Chain-of-Thought prompts and JSON extraction
const genAI = require('./aiClient');

/**
 * Runs an LLM chain-of-thought prompt over given question and facts.
 * Returns parsed JSON object { reasoning: string[], result: any } or throws.
 * @param {string} userMsg - original user message
 * @param {Array<{type:string,value:string}>} factsArray - list of fact objects
 * @param {string[]} steps - numbered CoT instruction steps (e.g. ["Find birth year", ...])
 * @param {string} jsonSchema - JSON schema instructions, e.g. '{"reasoning":[],"age":0}'
 */
async function runCoT(userMsg, factsArray, steps, jsonSchema) {
  const factList = factsArray.map(f => `${f.type}: ${f.value}`).join('\n');
  const stepList = steps.map((s,i) => `${i+1}. ${s}`).join('\n');
  const prompt = `You are a helpful assistant using chain-of-thought reasoning with rich common-sense and real-world reasoning.
User asks: "${userMsg}"
Known facts:
${factList}

Think step by step, applying practical common-sense:
${stepList}

Respond with valid JSON exactly in this format:
${jsonSchema}`;
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const res = await model.generateContent(prompt);
  const text = await res.response.text();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in CoT response');
  return JSON.parse(match[0]);
}

module.exports = { runCoT }; 