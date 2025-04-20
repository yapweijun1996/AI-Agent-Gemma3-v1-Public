const { GoogleGenerativeAI } = require("@google/generative-ai");
const config = require("./config");

// Initialize Gemini AI client with API key from config
const genAI = new GoogleGenerativeAI(config.geminiApiKey);

module.exports = genAI; 