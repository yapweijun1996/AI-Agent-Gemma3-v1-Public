/* backend/server.js */
const express = require("express");
const WebSocket = require("ws");
const path = require("path");
const runPipeline = require("./reasoningPipeline");
const config = require("./config");
// Use shared logger for structured debug/info logging
const logger = require('./logger');

// Start HTTP server (serves frontend static files)
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
const PORT = config.port || 3004;
const server = app.listen(PORT, () => {
	logger.info(`HTTP server listening on port ${PORT}`);
});

// Attach WebSocket server for chat
const wss = new WebSocket.Server({ server });
wss.on('connection', ws => {
	logger.info('New WebSocket client connected');
	// Maintain a server-side session history for this WebSocket
	const sessionHistory = [];

	ws.on('message', async raw => {
		logger.debug('[WS] Raw message', { raw });
		let userMsg;
		let clientHistory = [];
		try {
			// Parse user message and client-side chat history
			const parsed = JSON.parse(raw);
			userMsg = parsed.message;
			clientHistory = Array.isArray(parsed.history) ? parsed.history : [];
			logger.debug('[WS] Parsed message', { userMsg, clientHistory });
		} catch {
			ws.send(JSON.stringify({ error: 'Invalid request payload' }));
			return;
		}
		// Initialize sessionHistory with client history on first message
		if (sessionHistory.length === 0 && clientHistory.length) {
			sessionHistory.push(...clientHistory);
		}
		// Update server-managed history with the user's turn
		sessionHistory.push({ role: 'user', text: userMsg });
		try {
			// Stream each pipeline step back to client
			const onProgress = entry => {
				ws.send(JSON.stringify({ progress: entry }));
				logger.debug(`[Pipeline] ${entry.step}: ${entry.message}`);
			};
			const { finalResponse, reasoningLog } = await runPipeline(userMsg, sessionHistory, onProgress);
			// Log final response at info level
			logger.info(`[Pipeline] Final Response: ${finalResponse}`);
			// Update server-managed history with the agent's turn
			sessionHistory.push({ role: 'agent', text: finalResponse });
			// Send final response and full reasoning log to frontend
			ws.send(JSON.stringify({ response: finalResponse, reasoningLog }));
			logger.debug('[WS] Sending response', { response: finalResponse, reasoningLog });
		} catch (err) {
			logger.error(`Pipeline error: ${err.message}`);
			ws.send(JSON.stringify({ response: 'Error processing request.', error: err.message }));
		}
	});

	ws.on('close', () => {
		logger.info('WebSocket client disconnected');
	});
});

// Optionally provide a health check endpoint
app.get('/healthz', (req, res) => res.sendStatus(200));