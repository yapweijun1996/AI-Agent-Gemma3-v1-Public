# AI-Agent-Gemma-v1-Public

## Table of Contents
- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Running the Project](#running-the-project)
- [Usage](#usage)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

## Overview
AI-Agent-Gemma-v1 is a local generative AI assistant providing step-by-step reasoning via a WebSocket chat interface. It consists of a Node.js backend (Express + WebSocket) and a static HTML/CSS/JavaScript frontend.

## Prerequisites
- Node.js >= 18.x
- npm >= 8.x (bundled with Node.js)
- Git

## Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/AI-Agent-Gemma3-v1-Public.git
   cd AI-Agent-Gemma3-v1-Public
   ```
2. Install backend dependencies:
   ```bash
   cd backend
   npm install
   ```
3. (Optional) The frontend is served statically; no additional setup is required.

## Configuration
1. In the project root, create a `.env` file:
   ```bash
   touch .env
   ```
2. Populate `.env` with:
   ```ini
   # Required API Key
   GEMINI_API_KEY=your_primary_google_generative_api_key

   # Optional fallback and other keys
   GEMINI_API_KEY2=your_secondary_google_generative_api_key  # fallback
   OPENAI_API_KEY=your_openai_api_key                        # optional for OpenAI tools
   WEATHER_API_KEY=your_weather_api_key                      # optional for weather tool

   # Server settings
   PORT=3004           # defaults to 3004 if omitted
   LOG_LEVEL=info      # set to debug/info/warn/error

   # Model settings
   DEFAULT_MODEL=gemma-3-27b-it        # optional, fallback is gemini-1.5-flash
   FALLBACK_MODEL=gemini-1.5-flash     # optional

   # Tool settings
   WEB_SEARCH_ENABLED=true             # set false to disable web search
   SEARCH_TIMEOUT=15000                # in milliseconds
   ```
3. Save the `.env` file.

## Running the Project
1. Start the backend server from the project root:
   ```bash
   cd backend
   node server.js
   ```
2. Open your browser at [http://localhost:3004](http://localhost:3004) to access the chat interface.

## Usage
- **Send Message**: Type in the input box and press the send icon or Enter.
- **Clear Chat**: Click the trash icon to reset the conversation.
- **View Process Log**: Click the settings icon, then "Show Process Log" to see reasoning steps.
- **Copy Log/Conversation**: Use the copy icons to copy content to the clipboard.

## Troubleshooting
- **Server Not Starting**: Verify your `.env` is in the project root and contains a valid `GEMINI_API_KEY`.
- **Port Conflicts**: Change `PORT` in `.env` if port 3004 is in use.
- **Missing Dependencies**: Run `npm install` inside the `backend` directory.
- **Verbose Logs**: Set `LOG_LEVEL=debug` in `.env` for more detailed output.

## Contributing
Contributions are welcome! Fork the repository, create a feature branch, and submit a pull request. Report any issues on the GitHub issues page.

## License
This project is licensed under the MIT License. See [LICENSE](LICENSE.md) for details. 

## Screenshot
<img width="1440" alt="Screenshot 2025-04-20 at 9 14 01 PM" src="https://github.com/user-attachments/assets/811d9de6-8324-4e44-88c6-2b5d24ee1b2e" />
