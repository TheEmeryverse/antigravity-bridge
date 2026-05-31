// Antigravity Bridge Client Logic - Robust & Defensive Version

document.addEventListener('DOMContentLoaded', () => {
  // Safe helper to call Lucide icons
  function updateIcons() {
    if (typeof lucide !== 'undefined' && lucide.createIcons) {
      lucide.createIcons();
    }
  }

  updateIcons();

  // State Management
  let activeConversationId = null;
  let conversations = [];
  try {
    const saved = localStorage.getItem('ag_conversations');
    conversations = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(conversations)) {
      conversations = [];
    }
  } catch (e) {
    console.error('Failed to parse conversations from localStorage:', e);
    conversations = [];
  }
  
  let isStreaming = false;

  // DOM Elements
  const sidebar = document.getElementById('sidebar');
  const menuBtn = document.getElementById('menuBtn');
  const closeSidebar = document.getElementById('closeSidebar');
  const newChatBtn = document.getElementById('newChatBtn');
  const historyList = document.getElementById('historyList');
  const statusDot = document.getElementById('statusDot');
  const statusLabel = document.getElementById('statusLabel');
  const refreshStatusBtn = document.getElementById('refreshStatusBtn');
  const settingsToggle = document.getElementById('settingsToggle');
  const settingsModal = document.getElementById('settingsModal');
  const closeSettingsModal = document.getElementById('closeSettingsModal');
  const modalStatusBox = document.getElementById('modalStatusBox');
  const modalStatusTitle = document.getElementById('modalStatusTitle');
  const modalStatusDesc = document.getElementById('modalStatusDesc');
  const headerChatTitle = document.getElementById('headerChatTitle');
  const welcomeScreen = document.getElementById('welcomeScreen');
  const messagesList = document.getElementById('messagesList');
  const scrollAnchor = document.getElementById('scrollAnchor');
  const streamIndicator = document.getElementById('streamIndicator');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  const continueToggle = document.getElementById('continueToggle');
  const submitBtn = document.getElementById('submitBtn');

  // Configure Marked for Markdown rendering safely
  if (typeof marked !== 'undefined' && marked.setOptions) {
    try {
      marked.setOptions({
        breaks: true,
        highlight: function (code, lang) {
          if (typeof Prism !== 'undefined' && Prism.languages[lang]) {
            return Prism.highlight(code, Prism.languages[lang], lang);
          }
          return code;
        }
      });
    } catch (e) {
      console.warn('Failed to configure marked highlights:', e);
    }
  }

  // Safe Markdown rendering fallback
  function renderMarkdown(content) {
    if (typeof marked !== 'undefined' && marked.parse) {
      try {
        return marked.parse(content);
      } catch (e) {
        console.error('Markdown parsing failed:', e);
      }
    }
    // Safe HTML fallback to prevent script execution while retaining format
    return content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }

  // Check Connection Health
  async function checkHealth() {
    if (statusDot) statusDot.className = 'status-dot status-checking';
    if (statusLabel) statusLabel.textContent = 'Checking Connection...';
    if (modalStatusBox) modalStatusBox.className = 'modal-status-box';
    if (modalStatusTitle) modalStatusTitle.textContent = 'Connecting...';
    if (modalStatusDesc) modalStatusDesc.textContent = 'Checking connectivity...';

    try {
      const response = await fetch('/api/health');
      const data = await response.json();
      
      const config = await loadConfig();
      const targetLabel = config ? config.host : 'remote host';

      if (response.ok && data.status === 'ok') {
        if (statusDot) statusDot.className = 'status-dot status-online';
        if (statusLabel) statusLabel.textContent = 'Connected';
        if (modalStatusBox) modalStatusBox.className = 'modal-status-box online';
        if (modalStatusTitle) modalStatusTitle.textContent = 'Active Bridge';
        if (modalStatusDesc) modalStatusDesc.textContent = `Securely connected to ${targetLabel}`;
      } else {
        throw new Error(data.message || 'Offline');
      }
    } catch (error) {
      if (statusDot) statusDot.className = 'status-dot status-offline';
      if (statusLabel) statusLabel.textContent = 'Offline';
      if (modalStatusBox) modalStatusBox.className = 'modal-status-box offline';
      if (modalStatusTitle) modalStatusTitle.textContent = 'Connection Offline';
      if (modalStatusDesc) modalStatusDesc.textContent = `Could not connect to remote host. Error: ${error.message}`;
    }
  }

  // Load config details from backend dynamically
  async function loadConfig() {
    try {
      const response = await fetch('/api/config');
      const data = await response.json();
      
      const sshTarget = document.getElementById('sshTargetDisplay');
      const cliPath = document.getElementById('cliPathDisplay');
      const mode = document.getElementById('modeDisplay');
      
      if (sshTarget) sshTarget.textContent = data.host;
      if (cliPath) cliPath.textContent = data.cliPath;
      if (mode) mode.textContent = data.mode === 'ssh' ? 'SSH Tunnel' : 'Local Host';
      
      const connectionPill = document.querySelector('.active-connection-pill .pill-text');
      if (connectionPill) {
        connectionPill.textContent = data.mode === 'ssh' ? 'SSH Bridge Active' : 'Local CLI Mode';
      }
      return data;
    } catch (error) {
      console.error('Error fetching config settings:', error);
      return null;
    }
  }

  // Auto-resize input textarea
  if (chatInput) {
    chatInput.addEventListener('input', () => {
      chatInput.style.height = 'auto';
      chatInput.style.height = (chatInput.scrollHeight - 20) + 'px';
    });
  }

  // Mobile Sidebar Toggle
  if (menuBtn && sidebar) menuBtn.addEventListener('click', () => sidebar.classList.add('open'));
  if (closeSidebar && sidebar) closeSidebar.addEventListener('click', () => sidebar.classList.remove('open'));

  // Configuration Modal Toggle
  if (settingsToggle && settingsModal) {
    settingsToggle.addEventListener('click', () => {
      settingsModal.style.display = 'flex';
      checkHealth();
    });
  }
  if (closeSettingsModal && settingsModal) {
    closeSettingsModal.addEventListener('click', () => settingsModal.style.display = 'none');
  }
  
  if (settingsModal) {
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) {
        settingsModal.style.display = 'none';
      }
    });
  }

  // Test Connection Button click
  if (refreshStatusBtn) {
    refreshStatusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      checkHealth();
    });
  }

  // Generate unique conversation ID
  function generateId() {
    return 'conv_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
  }

  // Load chats from history
  function renderConversationsList() {
    if (!historyList) return;
    historyList.innerHTML = '';
    
    if (conversations.length === 0) {
      historyList.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; margin-top: 10px;">No chats yet</div>`;
      return;
    }

    conversations.forEach(conv => {
      const item = document.createElement('div');
      item.className = `history-item ${conv.id === activeConversationId ? 'active' : ''}`;
      item.dataset.id = conv.id;

      const title = document.createElement('span');
      title.className = 'history-title';
      title.textContent = conv.title || 'Untitled Chat';

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-history-btn';
      deleteBtn.innerHTML = '<i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>';
      
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteConversation(conv.id);
      });

      item.appendChild(title);
      item.appendChild(deleteBtn);
      
      item.addEventListener('click', () => {
        loadConversation(conv.id);
        if (sidebar) sidebar.classList.remove('open'); // close sidebar on mobile
      });

      historyList.appendChild(item);
    });

    updateIcons();
  }

  // Delete Conversation
  function deleteConversation(id) {
    conversations = conversations.filter(c => c.id !== id);
    localStorage.setItem('ag_conversations', JSON.stringify(conversations));
    
    if (activeConversationId === id) {
      newConversation();
    } else {
      renderConversationsList();
    }
  }

  // Load a Conversation
  function loadConversation(id) {
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;

    activeConversationId = id;
    if (headerChatTitle) headerChatTitle.textContent = conv.title;
    
    if (welcomeScreen) welcomeScreen.style.display = 'none';
    if (messagesList) {
      messagesList.style.display = 'flex';
      messagesList.innerHTML = '';
    }

    if (Array.isArray(conv.messages)) {
      conv.messages.forEach(msg => {
        appendMessageUI(msg.role, msg.content);
      });
    }

    renderConversationsList();
    scrollToBottom();
  }

  // Start New Conversation
  function newConversation() {
    activeConversationId = null;
    if (headerChatTitle) headerChatTitle.textContent = 'New Chat';
    if (welcomeScreen) welcomeScreen.style.display = 'flex';
    if (messagesList) {
      messagesList.style.display = 'none';
      messagesList.innerHTML = '';
    }
    renderConversationsList();
  }

  if (newChatBtn) newChatBtn.addEventListener('click', newConversation);

  // Append Message UI Element
  function appendMessageUI(role, content) {
    if (!messagesList) return null;
    
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.innerHTML = role === 'user' ? '👤' : '🛸';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    
    bubble.innerHTML = renderMarkdown(content);
    
    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
    messagesList.appendChild(wrapper);
    
    // Highlight code blocks
    if (typeof Prism !== 'undefined' && Prism.highlightAllUnder) {
      try {
        Prism.highlightAllUnder(bubble);
      } catch (e) {
        console.warn('Prism highlighting failed:', e);
      }
    }
    
    return bubble;
  }

  // Scroll Chat to Bottom
  function scrollToBottom() {
    if (scrollAnchor) {
      scrollAnchor.scrollIntoView({ behavior: 'smooth' });
    }
  }

  // Suggestion Cards Clicking
  document.querySelectorAll('.suggestion-card').forEach(card => {
    card.addEventListener('click', () => {
      const prompt = card.dataset.prompt;
      if (chatInput && chatForm) {
        chatInput.value = prompt;
        chatInput.dispatchEvent(new Event('input')); // trigger resize
        chatForm.dispatchEvent(new Event('submit'));
      }
    });
  });

  // Handle Form Submit
  if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isStreaming) return;

      const prompt = chatInput ? chatInput.value.trim() : '';
      if (!prompt) return;

      // Clear input
      if (chatInput) {
        chatInput.value = '';
        chatInput.style.height = 'auto';
      }

      // Safeguard conversation state
      if (!activeConversationId) {
        activeConversationId = generateId();
      }

      let activeConv = conversations.find(c => c.id === activeConversationId);
      if (!activeConv) {
        activeConv = {
          id: activeConversationId,
          title: prompt.substring(0, 30) + (prompt.length > 30 ? '...' : ''),
          messages: []
        };
        conversations.unshift(activeConv);
        localStorage.setItem('ag_conversations', JSON.stringify(conversations));
        
        if (welcomeScreen) welcomeScreen.style.display = 'none';
        if (messagesList) {
          messagesList.style.display = 'flex';
          messagesList.innerHTML = '';
        }
        if (headerChatTitle) headerChatTitle.textContent = activeConv.title;
        renderConversationsList();
      }

      // Append User Message UI
      appendMessageUI('user', prompt);
      scrollToBottom();

      // Save user message to memory
      activeConv.messages.push({ role: 'user', content: prompt });
      localStorage.setItem('ag_conversations', JSON.stringify(conversations));

      // Disable Form input and submit
      isStreaming = true;
      if (submitBtn) submitBtn.disabled = true;
      if (chatInput) chatInput.disabled = true;
      if (streamIndicator) streamIndicator.style.display = 'flex';
      scrollToBottom();

      // Prepare Assistant bubble in UI
      const assistantBubble = appendMessageUI('assistant', '');
      let assistantText = '';

      // Setup Server-Sent Events stream URL
      const continueLatest = continueToggle ? continueToggle.checked : true;
      
      let url = `/api/stream?prompt=${encodeURIComponent(prompt)}`;
      if (continueLatest) {
        url += '&continue=true';
      }

      let eventSource;
      try {
        eventSource = new EventSource(url);
      } catch (err) {
        console.error('Failed to create EventSource:', err);
        if (assistantBubble) {
          assistantBubble.innerHTML = '<span style="color: var(--error);">Failed to initiate connection. Check network status.</span>';
        }
        finishStream();
        return;
      }

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.text && assistantBubble) {
            assistantText += data.text;
            assistantBubble.innerHTML = renderMarkdown(assistantText);
            if (typeof Prism !== 'undefined' && Prism.highlightAllUnder) {
              Prism.highlightAllUnder(assistantBubble);
            }
            scrollToBottom();
          }
        } catch (err) {
          console.error('Failed to parse SSE data:', err);
        }
      };

      eventSource.addEventListener('system', (event) => {
        console.log('Remote system log:', event.data);
      });

      eventSource.addEventListener('done', () => {
        finishStream();
      });

      eventSource.onerror = (err) => {
        console.error('EventSource connection error:', err);
        if (assistantText === '' && assistantBubble) {
          assistantBubble.innerHTML = '<span style="color: var(--error);">Error connecting to Antigravity CLI. Check system status settings.</span>';
        }
        finishStream();
      };

      function finishStream() {
        if (eventSource) {
          eventSource.close();
        }
        
        // Save assistant message to memory safely
        const freshConv = conversations.find(c => c.id === activeConversationId);
        if (freshConv) {
          freshConv.messages.push({ role: 'assistant', content: assistantText });
          localStorage.setItem('ag_conversations', JSON.stringify(conversations));
        }

        // Re-enable UI controls
        isStreaming = false;
        if (submitBtn) submitBtn.disabled = false;
        if (chatInput) {
          chatInput.disabled = false;
          chatInput.focus();
        }
        if (streamIndicator) streamIndicator.style.display = 'none';
      }
    });
  }

  // Listen to Enter key to submit, but Shift+Enter to newline
  if (chatInput && chatForm) {
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatForm.dispatchEvent(new Event('submit'));
      }
    });
  }

  // Initial runs
  checkHealth();
  renderConversationsList();
});
