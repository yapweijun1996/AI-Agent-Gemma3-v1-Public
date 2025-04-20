// frontend/app.js
// Main chat application logic with WhatsApp-style UI

document.addEventListener('DOMContentLoaded', () => {
  // DOM element references
  const messagesEl = document.getElementById('messages');
  const userInputEl = document.getElementById('userInput');
  const sendButtonEl = document.getElementById('sendButton');
  const clearChatButtonEl = document.getElementById('clearChatButton');
  const copyToastEl = document.getElementById('copyToast');

  // State
  let chatHistory = [];
  let waitingForResponse = false;

  // Modal & typing indicator setup
  const clearConfirmModalEl = document.getElementById('clearConfirmModal');
  const confirmClearBtnEl = document.getElementById('confirmClearBtn');
  const cancelClearBtnEl = document.getElementById('cancelClearBtn');
  // Typing indicator element
  const typingIndicatorEl = document.createElement('div');
  typingIndicatorEl.className = 'message-row agent-row';
  const typingAvatar = document.createElement('div');
  typingAvatar.className = 'avatar';
  // Use Feather icon for typing indicator avatar
  typingAvatar.innerHTML = '<i data-feather="cpu"></i>';
  // Animated typing dots
  const typingMsg = document.createElement('div');
  typingMsg.className = 'message agent typing';
  typingMsg.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  typingIndicatorEl.appendChild(typingAvatar);
  typingIndicatorEl.appendChild(typingMsg);

  // Utility: add a chat message
  function addMessage(role, text, isHTML = false) {
    const row = document.createElement('div');
    row.className = `message-row ${role === 'user' ? 'user-row' : role === 'agent' ? 'agent-row' : 'system-row'}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    // Use Feather icons for avatars
    if (role === 'user') {
      avatar.innerHTML = '<i data-feather="user"></i>';
    } else if (role === 'agent') {
      avatar.innerHTML = '<i data-feather="cpu"></i>';
    }

    const msg = document.createElement('div');
    msg.className = `message ${role === 'user' ? 'user' : role === 'agent' ? 'agent' : 'system'}`;
    if (isHTML) {
      msg.innerHTML = DOMPurify.sanitize(text);
    } else {
      msg.textContent = text;
    }

    if (role === 'user') {
      row.appendChild(msg);
      row.appendChild(avatar);
    } else if (role === 'agent') {
      row.appendChild(avatar);
      row.appendChild(msg);
    } else {
      row.appendChild(msg);
    }

    // Append and timestamp
    messagesEl.appendChild(row);
    const tsEl = document.createElement('div');
    tsEl.className = 'timestamp';
    tsEl.textContent = new Date().toLocaleTimeString();
    // Insert timestamp on left for user, right for agent
    if (role === 'user') {
      row.insertBefore(tsEl, row.firstChild);
    } else {
      row.appendChild(tsEl);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
    // Replace Feather placeholders with actual SVGs
    if (window.feather) feather.replace();
  }

  // UI helpers
  function showThinking() {
    userInputEl.placeholder = '🤖 Thinking...';
    userInputEl.disabled = true;
    sendButtonEl.disabled = true;
    // Show typing indicator
    if (!messagesEl.contains(typingIndicatorEl)) {
      messagesEl.appendChild(typingIndicatorEl);
      // Replace Feather placeholder with actual SVG
      if (window.feather) feather.replace();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  }

  function hideThinking() {
    // Remove typing indicator
    if (messagesEl.contains(typingIndicatorEl)) {
      messagesEl.removeChild(typingIndicatorEl);
    }
    userInputEl.placeholder = 'Type your message...';
    userInputEl.disabled = false;
    sendButtonEl.disabled = false;
    userInputEl.focus();
  }

  // Chat history persistence
  function loadHistory() {
    const stored = localStorage.getItem('chatHistoryJSON');
    if (stored) {
      try {
        chatHistory = JSON.parse(stored);
        chatHistory.forEach(item => {
          const content = item.role === 'agent' ? DOMPurify.sanitize(marked.parse(item.text)) : item.text;
          addMessage(item.role === 'user' ? 'user' : 'agent', content, item.role === 'agent');
        });
      } catch (e) {
        chatHistory = [];
      }
    }
  }

  function saveHistory() {
    localStorage.setItem('chatHistoryJSON', JSON.stringify(chatHistory));
  }

  function clearHistory() {
    // Show custom confirmation modal
    clearConfirmModalEl.hidden = false;
  }

  // Send user message
  function sendMsgWithTimeout() {
    const msg = userInputEl.value.trim();
    if (!msg || waitingForResponse) return;
    if (socket.readyState !== WebSocket.OPEN) {
      addMessage('system', 'Connection lost. Please refresh.', false);
      return;
    }
    // Disable input immediately
    userInputEl.disabled = true;
    sendButtonEl.disabled = true;
    userInputEl.placeholder = '🤖 Thinking...';
    waitingForResponse = true;

    // Add a 30-second timeout for server response
    const responseTimeout = setTimeout(() => {
      if (waitingForResponse) {
        hideThinking();
        waitingForResponse = false;
        addMessage('system', 'The server took too long to respond. Please try again with a simpler query.', false);
      }
    }, 30000);

    // Clear timeout when we get a response
    const originalOnMessage = socket.onmessage;
    socket.onmessage = function(event) {
      clearTimeout(responseTimeout);
      if (originalOnMessage) {
        originalOnMessage.call(socket, event);
      }
    };

    socket.send(JSON.stringify({ message: msg, history: chatHistory }));
    addMessage('user', msg, false);
    // Now show typing indicator below the user message
    if (!messagesEl.contains(typingIndicatorEl)) {
      messagesEl.appendChild(typingIndicatorEl);
      if (window.feather) feather.replace();
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
    chatHistory.push({ role: 'user', text: msg });
    saveHistory();
    userInputEl.value = '';
  }

  // Replace sendMsg with the timeout version
  function sendMsg() {
    sendMsgWithTimeout();
  }

  // WebSocket setup
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(`${protocol}://${window.location.host}`);

  socket.addEventListener('open', () => {
    addMessage('system', 'Connected to server.', false);
  });

  socket.addEventListener('message', event => {
    const data = JSON.parse(event.data);

    if (data.response) {
      hideThinking();
      const html = DOMPurify.sanitize(marked.parse(data.response));
      addMessage('agent', html, true);
      chatHistory.push({ role: 'agent', text: data.response });
      saveHistory();
      waitingForResponse = false;
    }

    if (data.error) {
      hideThinking();
      // Enhanced error display with suggestion if available
      let errorMessage = `Error: ${data.error}`;
      
      // Add more user-friendly error handling
      if (data.error.includes('captcha') || data.error.includes('automated access')) {
        errorMessage = "I'm currently unable to search the web due to security restrictions. Please try a different query or try again later.";
      } else if (data.error.includes('timeout')) {
        errorMessage = "The request took too long to complete. Please try a simpler query.";
      } else if (data.errorType === 'TypeError' || data.errorType === 'ReferenceError') {
        errorMessage = "I'm experiencing a technical issue. Please try again.";
      }
      
      // Add suggestion if available
      if (data.suggestion) {
        errorMessage += `\n\nSuggestion: ${data.suggestion}`;
      }
      
      addMessage('system', errorMessage, false);
      waitingForResponse = false;
    }

    // Handle incoming log entries (bulk or single)
    if (data.progress || data.activityLog) {
      const logs = data.progress || data.activityLog;
      if (Array.isArray(logs)) {
        activityLog = logs;
      } else {
        activityLog.push(logs);
      }
      renderLog();
    }
  });

  socket.addEventListener('close', () => {
    addMessage('system', 'Disconnected from server.', false);
    hideThinking();
    
    // Add reconnection attempt
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 3;
    const reconnectInterval = setInterval(() => {
      if (reconnectAttempts >= maxReconnectAttempts) {
        clearInterval(reconnectInterval);
        addMessage('system', 'Could not reconnect to server. Please refresh the page.', false);
        return;
      }
      
      reconnectAttempts++;
      addMessage('system', `Attempting to reconnect (${reconnectAttempts}/${maxReconnectAttempts})...`, false);
      
      // Create new socket connection
      const newSocket = new WebSocket(`${protocol}://${window.location.host}`);
      
      newSocket.addEventListener('open', () => {
        clearInterval(reconnectInterval);
        socket = newSocket;
        addMessage('system', 'Reconnected to server.', false);
        setupSocketListeners(newSocket);
      });
      
      newSocket.addEventListener('error', () => {
        // Failed reconnect attempt
      });
    }, 5000);
  });

  socket.addEventListener('error', () => {
    addMessage('system', 'Connection error. Please check your internet connection.', false);
    hideThinking();
  });

  // Function to set up socket event listeners (for reconnection)
  function setupSocketListeners(socket) {
    // Re-attach event listeners
    // (Simplified - in production you would need to move all listeners to this function)
  }

  // Event listeners
  sendButtonEl.addEventListener('click', sendMsg);
  userInputEl.addEventListener('keypress', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMsg();
    }
  });
  clearChatButtonEl.addEventListener('click', clearHistory);

  // Initialize
  loadHistory();
  userInputEl.focus();

  // --- Process Log UI ---
  const logDropdownBtn = document.getElementById('logDropdownBtn');
  const logDropdown = document.getElementById('logDropdown');
  const toggleLogDropdownBtn = document.getElementById('toggleLogDropdownBtn');
  const copyLogDropdownBtn = document.getElementById('copyLogDropdownBtn');
  const copyLogBtnEl = document.getElementById('copyLogBtn');
  const processLogEl = document.getElementById('processLog');
  const logContentEl = document.getElementById('log-content');
  const closeLogPanelBtn = document.getElementById('closeLogPanelBtn');
  let activityLog = [];

  function renderLog() {
    logContentEl.innerHTML = '';
    if (activityLog.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'log-empty';
      emptyEl.textContent = 'No log entries yet';
      logContentEl.appendChild(emptyEl);
      return;
    }
    activityLog.forEach((entry, idx) => {
      const entryEl = document.createElement('div');
      entryEl.className = 'log-entry';
      entryEl.dataset.type = entry.step;
      // Index number
      const indexEl = document.createElement('span');
      indexEl.className = 'log-index';
      indexEl.textContent = `${idx + 1}. `;
      // Timestamp
      const ts = document.createElement('span');
      ts.className = 'log-timestamp';
      ts.textContent = new Date(entry.timestamp).toLocaleTimeString();
      // Step name
      const step = document.createElement('span');
      step.className = 'log-step';
      step.textContent = entry.step;
      // Message details
      const msg = document.createElement('span');
      msg.className = 'log-message';
      msg.textContent = entry.message;
      entryEl.append(indexEl, ts, step, msg);
      logContentEl.appendChild(entryEl);
    });
  }

  // Toggle overlay show/hide and update inner toggle text
  function toggleOverlay() {
    const visible = processLogEl.classList.toggle('show');
    const label = visible ? '📋 Hide Process Log' : '📋 Show Process Log';
    toggleLogDropdownBtn.textContent = label;
    logDropdown.classList.remove('show');
    renderLog();
  }
  toggleLogDropdownBtn.addEventListener('click', e => { e.stopPropagation(); toggleOverlay(); });
  closeLogPanelBtn.addEventListener('click', e => {
    e.stopPropagation();
    // Hide the overlay and sync toggle button text
    if (processLogEl.classList.contains('show')) {
      toggleOverlay();
    }
  });

  // Copy log to clipboard, show toast
  function copyLog() {
    const text = activityLog.map(ent => `[${new Date(ent.timestamp).toLocaleTimeString()}] ${ent.step}: ${ent.message}`).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      copyToastEl.classList.add('show');
      setTimeout(() => copyToastEl.classList.remove('show'), 2000);
    });
  }
  copyLogDropdownBtn.addEventListener('click', e => { e.stopPropagation(); copyLog(); });
  copyLogBtnEl.addEventListener('click', e => { e.stopPropagation(); copyLog(); });

  // Expose debug function for header button
  function displayAvailableStepTypes() {
    // Gather unique step types
    const types = [...new Set(activityLog.map(entry => entry.step))];
    if (types.length === 0) {
      alert('No log entries available to analyze');
      return;
    }
    // Simple modal: list types
    alert('Available Step Types:\n' + types.join('\n'));
  }
  window.displayAvailableStepTypes = displayAvailableStepTypes;

  // Dropdown toggle listeners (re-added after ID renames)
  logDropdownBtn.addEventListener('click', e => { e.stopPropagation(); toggleOverlay(); });
  document.addEventListener('click', e => { if (!logDropdown.contains(e.target) && e.target !== logDropdownBtn) logDropdown.classList.remove('show'); });

  // Clear Chat modal buttons
  confirmClearBtnEl.addEventListener('click', () => {
    chatHistory = [];
    localStorage.removeItem('chatHistoryJSON');
    messagesEl.innerHTML = '';
    clearConfirmModalEl.hidden = true;
  });
  cancelClearBtnEl.addEventListener('click', () => {
    clearConfirmModalEl.hidden = true;
  });
}); 