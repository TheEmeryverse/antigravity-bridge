// Antigravity Bridge Client Logic

document.addEventListener('DOMContentLoaded', () => {
  // Initialize Lucide Icons
  lucide.createIcons();

  // State Management
  let activeConversationId = null;
  let conversations = JSON.parse(localStorage.getItem('ag_conversations')) || [];
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

  // Configure Marked for Markdown rendering
  marked.setOptions({
    breaks: true,
    highlight: function (code, lang) {
      if (Prism.languages[lang]) {
        return Prism.highlight(code, Prism.languages[lang], lang);
      }
      return code;
    }
  });

  // Load config details from backend
  async function loadConfig() {
    try {
      const response = await fetch('/api/config');
      const data = await response.json();
      document.getElementById('sshTargetDisplay').textContent = data.host;
      document.getElementById('cliPathDisplay').textContent = data.cliPath;
      document.getElementById('modeDisplay').textContent = data.mode === 'ssh' ? 'SSH Tunnel' : 'Local Host';
      
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

  // Check Connection Health
  async function checkHealth() {
    statusDot.className = 'status-dot status-checking';
    statusLabel.textContent = 'Checking Connection...';
    modalStatusBox.className = 'modal-status-box';
    modalStatusTitle.textContent = 'Connecting...';
    
    const config = await loadConfig();
    const targetLabel = config ? config.host : 'remote host';
    modalStatusDesc.textContent = `Checking network connectivity to ${targetLabel}...`;

    try {
      const response = await fetch('/api/health');
      const data = await response.json();
      
      if (response.ok && data.status === 'ok') {
        statusDot.className = 'status-dot status-online';
        statusLabel.textContent = 'Connected';
        modalStatusBox.className = 'modal-status-box online';
        modalStatusTitle.textContent = 'Active Bridge';
        modalStatusDesc.textContent = `Securely connected to ${targetLabel}`;
      } else {
        throw new Error(data.message || 'Offline');
      }
    } catch (error) {
      statusDot.className = 'status-dot status-offline';
      statusLabel.textContent = 'Offline';
      modalStatusBox.className = 'modal-status-box offline';
      modalStatusTitle.textContent = 'Connection Offline';
      modalStatusDesc.textContent = `Could not connect to ${targetLabel}. Error: ${error.message}`;
    }
  }

  // Auto-resize input textarea
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = (chatInput.scrollHeight - 20) + 'px';
  });

  // Mobile Sidebar Toggle
  menuBtn.addEventListener('click', () => sidebar.classList.add('open'));
  closeSidebar.addEventListener('click', () => sidebar.classList.remove('open'));

  // Configuration Modal Toggle
  settingsToggle.addEventListener('click', () => {
    settingsModal.style.display = 'flex';
    checkHealth();
  });
  closeSettingsModal.addEventListener('click', () => settingsModal.style.display = 'none');
  
  // Close modal if clicked outside
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) {
      settingsModal.style.display = 'none';
    }
  });

  // Test Connection Button click
  refreshStatusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    checkHealth();
  });

  // Generate unique conversation ID
  function generateId() {
    return 'conv_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
  }

  // Load chats from history
  function renderConversationsList() {
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
        sidebar.classList.remove('open'); // close sidebar on mobile
      });

      historyList.appendChild(item);
    });

    lucide.createIcons();
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
    headerChatTitle.textContent = conv.title;
    
    welcomeScreen.style.display = 'none';
    messagesList.style.display = 'flex';
    messagesList.innerHTML = '';

    conv.messages.forEach(msg => {
      appendMessageUI(msg.role, msg.content);
    });

    renderConversationsList();
    scrollToBottom();
  }

  // Start New Conversation
  function newConversation() {
    activeConversationId = null;
    headerChatTitle.textContent = 'New Chat';
    welcomeScreen.style.display = 'flex';
    messagesList.style.display = 'none';
    messagesList.innerHTML = '';
    renderConversationsList();
  }

  newChatBtn.addEventListener('click', newConversation);

  // Append Message UI Element
  function appendMessageUI(role, content) {
    const wrapper = document.createElement('div');
    wrapper.className = `message-wrapper ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.innerHTML = role === 'user' ? '👤' : '🛸';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    
    // Parse Markdown
    bubble.innerHTML = marked.parse(content);
    
    wrapper.appendChild(avatar);
    wrapper.appendChild(bubble);
    messagesList.appendChild(wrapper);
    
    // Highlight code blocks
    Prism.highlightAllUnder(bubble);
    
    return bubble;
  }

  // Scroll Chat to Bottom
  function scrollToBottom() {
    scrollAnchor.scrollIntoView({ behavior: 'smooth' });
  }

  // Suggestion Cards Clicking
  document.querySelectorAll('.suggestion-card').forEach(card => {
    card.addEventListener('click', () => {
      const prompt = card.dataset.prompt;
      chatInput.value = prompt;
      chatInput.dispatchEvent(new Event('input')); // trigger resize
      chatForm.dispatchEvent(new Event('submit'));
    });
  });

  // Handle Form Submit
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isStreaming) return;

    const prompt = chatInput.value.trim();
    if (!prompt) return;

    // Clear input
    chatInput.value = '';
    chatInput.style.height = 'auto';

    // If starting a new conversation, create the ID first
    if (!activeConversationId) {
      activeConversationId = generateId();
      const newConv = {
        id: activeConversationId,
        title: prompt.substring(0, 30) + (prompt.length > 30 ? '...' : ''),
        messages: []
      };
      conversations.unshift(newConv);
      localStorage.setItem('ag_conversations', JSON.stringify(conversations));
      
      welcomeScreen.style.display = 'none';
      messagesList.style.display = 'flex';
      messagesList.innerHTML = '';
      headerChatTitle.textContent = newConv.title;
      renderConversationsList();
    }

    // Append User Message UI
    appendMessageUI('user', prompt);
    scrollToBottom();

    // Save user message to memory
    const activeConv = conversations.find(c => c.id === activeConversationId);
    activeConv.messages.push({ role: 'user', content: prompt });
    localStorage.setItem('ag_conversations', JSON.stringify(conversations));

    // Disable Form input and submit
    isStreaming = true;
    submitBtn.disabled = true;
    chatInput.disabled = true;
    streamIndicator.style.display = 'flex';
    scrollToBottom();

    // Prepare Assistant bubble in UI
    const assistantBubble = appendMessageUI('assistant', '');
    let assistantText = '';

    // Setup Server-Sent Events stream URL
    const continueLatest = continueToggle.checked;
    
    // Construct the stream endpoint with query parameters
    let url = `/api/stream?prompt=${encodeURIComponent(prompt)}`;
    if (continueLatest) {
      url += '&continue=true';
    }
    
    // Note: If they have multiple messages in this conversation, we can optionally pass the conversation ID.
    // In our backend, passing conversationId resumes that exact context, but `--continue` resumes the latest session.
    // Since `--continue` is simpler and standard in the CLI, we prioritize that.

    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.text) {
          assistantText += data.text;
          assistantBubble.innerHTML = marked.parse(assistantText);
          Prism.highlightAllUnder(assistantBubble);
          scrollToBottom();
        }
      } catch (err) {
        console.error('Failed to parse SSE data:', err);
      }
    };

    eventSource.addEventListener('system', (event) => {
      // Handle system outputs or diagnostic stderr lines
      console.log('Remote system log:', event.data);
    });

    eventSource.addEventListener('done', () => {
      finishStream();
    });

    eventSource.onerror = (err) => {
      console.error('EventSource connection error:', err);
      if (assistantText === '') {
        assistantBubble.innerHTML = '<span style="color: var(--error);">Error connecting to Antigravity CLI. Check system status settings.</span>';
      }
      finishStream();
    };

    function finishStream() {
      eventSource.close();
      
      // Save assistant message to memory
      activeConv.messages.push({ role: 'assistant', content: assistantText });
      localStorage.setItem('ag_conversations', JSON.stringify(conversations));

      // Re-enable UI controls
      isStreaming = false;
      submitBtn.disabled = false;
      chatInput.disabled = false;
      streamIndicator.style.display = 'none';
      chatInput.focus();
    }
  });

  // Listen to Enter key to submit, but Shift+Enter to newline
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event('submit'));
    }
  });

  // Initial runs
  checkHealth();
  renderConversationsList();
});
