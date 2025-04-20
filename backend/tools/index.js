const fs = require('fs');
const path = require('path');

const tools = {};

fs.readdirSync(__dirname).forEach(file => {
  if (file !== 'index.js' && file.endsWith('.js')) {
    const tool = require(path.join(__dirname, file));
    if (tool && tool.name) {
      tools[tool.name] = tool;
    }
  }
});

// Log available tools
console.log(`Loaded ${Object.keys(tools).length} tools: ${Object.keys(tools).join(', ')}`);

module.exports = tools; 