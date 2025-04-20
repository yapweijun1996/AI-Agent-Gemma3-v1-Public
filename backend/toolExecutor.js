const tools = require("./tools");

/**
 * Runs a tool by name with given parameters and context.
 * @param {string} toolName
 * @param {object} params
 * @param {object} context
 * @returns {Promise<any>} tool result
 */
module.exports = async function toolExecutor(toolName, params, context) {
  const tool = tools[toolName];
  if (!tool) {
    throw new Error(`Tool '${toolName}' not found`);
  }
  return await tool.run(params, context);
}; 