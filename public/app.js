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
  let activeProjectPath = null;
  let sshHost = 'username@localhost';
  let userHome = '/Users/username';

  // DOM Elements
  const sidebar = document.getElementById('sidebar');
  const menuBtn = document.getElementById('menuBtn');
  const closeSidebar = document.getElementById('closeSidebar');
  const newChatBtn = document.getElementById('newChatBtn');
  const historyList = document.getElementById('historyList');
  const projectsList = document.getElementById('projectsList');
  const createProjectBtn = document.getElementById('createProjectBtn');
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
  
  const activeProjectBadge = document.getElementById('activeProjectBadge');
  const activeProjectName = document.getElementById('activeProjectName');
  const shellPromptContainer = document.getElementById('shellPromptContainer');

  // Workspace Selector Modal DOM Elements
  const clearProjectBtn = document.getElementById('clearProjectBtn');
  const workspaceModal = document.getElementById('workspaceModal');
  const closeWorkspaceModal = document.getElementById('closeWorkspaceModal');
  const workspaceSelectBtn = document.getElementById('workspaceSelectBtn');
  const workspaceDeselectBtn = document.getElementById('workspaceDeselectBtn');
  const workspaceStatusCard = document.getElementById('workspaceStatusCard');
  const workspaceCardIcon = document.getElementById('workspaceCardIcon');
  const workspaceCardTitle = document.getElementById('workspaceCardTitle');
  const workspaceCardDesc = document.getElementById('workspaceCardDesc');
  
  const modalProjectsList = document.getElementById('modalProjectsList');
  const modalNewProjectName = document.getElementById('modalNewProjectName');
  const modalCreateProjectBtn = document.getElementById('modalCreateProjectBtn');
  const modalGlobalModeBtn = document.getElementById('modalGlobalModeBtn');

  // Model Selector DOM Elements & Initialization
  const modelSelector = document.getElementById('modelSelector');
  let activeModel = localStorage.getItem('ag_active_model') || 'MODEL_PLACEHOLDER_M20';
  if (modelSelector) {
    modelSelector.value = activeModel;
    modelSelector.addEventListener('change', () => {
      activeModel = modelSelector.value;
      localStorage.setItem('ag_active_model', activeModel);
      console.log(`Active model changed to: ${activeModel}`);
    });
  }

  // Quotas Modal DOM Elements
  const viewQuotasBtn = document.getElementById('viewQuotasBtn');
  const quotasModal = document.getElementById('quotasModal');
  const closeQuotasModal = document.getElementById('closeQuotasModal');
  const quotaLoading = document.getElementById('quotaLoading');
  const quotaError = document.getElementById('quotaError');
  const quotaErrorText = document.getElementById('quotaErrorText');
  const quotaDisplay = document.getElementById('quotaDisplay');

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
      
      // Update config variables
      sshHost = data.host;
      userHome = data.home;
      
      // Update shell user string in prompt
      const shellUserElement = document.querySelector('.shell-user');
      if (shellUserElement) {
        shellUserElement.textContent = data.host;
      }
      
      return data;
    } catch (error) {
      console.error('Error fetching config settings:', error);
      return null;
    }
  }

  // Copy Code Button Helper
  function addCopyButtons(container) {
    if (!container) return;
    const preBlocks = container.querySelectorAll('pre');
    preBlocks.forEach(pre => {
      if (pre.querySelector('.copy-code-btn')) return;

      const codeBlock = pre.querySelector('code');
      if (!codeBlock) return;

      const btn = document.createElement('button');
      btn.className = 'copy-code-btn';
      btn.type = 'button';
      btn.innerHTML = '<i data-lucide="copy" style="width: 12px; height: 12px;"></i> <span>Copy</span>';

      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const codeText = codeBlock.textContent;
        try {
          await navigator.clipboard.writeText(codeText);
          btn.classList.add('copied');
          btn.querySelector('span').textContent = 'Copied';
          const icon = btn.querySelector('i');
          if (icon) icon.setAttribute('data-lucide', 'check');
          updateIcons();

          setTimeout(() => {
            btn.classList.remove('copied');
            btn.querySelector('span').textContent = 'Copy';
            if (icon) icon.setAttribute('data-lucide', 'copy');
            updateIcons();
          }, 2000);
        } catch (err) {
          console.error('Failed to copy text:', err);
        }
      });

      pre.appendChild(btn);
    });
    updateIcons();
  }

  // Update UI relative to active project selection
  function updateActiveProjectUI() {
    let relativePath = '~';
    const folderName = activeProjectPath ? activeProjectPath.split('/').pop() : null;

    if (activeProjectPath) {
      if (userHome && activeProjectPath.startsWith(userHome)) {
        relativePath = activeProjectPath.replace(userHome, '~');
      } else {
        relativePath = activeProjectPath;
      }
      
      // Update header badge
      if (activeProjectName) activeProjectName.textContent = folderName;
      if (activeProjectBadge) {
        activeProjectBadge.classList.add('project-active');
        activeProjectBadge.title = `Active Workspace: ${relativePath} (Click to switch)`;
      }
      if (clearProjectBtn) clearProjectBtn.style.display = 'flex';
      
      // Set header icon to folder
      const activeProjectIcon = document.getElementById('activeProjectIcon');
      if (activeProjectIcon) activeProjectIcon.setAttribute('data-lucide', 'folder');

      // Update Welcome Screen Workspace Status Card
      if (workspaceStatusCard) workspaceStatusCard.classList.add('active');
      if (workspaceCardIcon) {
        workspaceCardIcon.innerHTML = '<i data-lucide="folder"></i>';
      }
      if (workspaceCardTitle) workspaceCardTitle.textContent = `Workspace: ${folderName}`;
      if (workspaceCardDesc) {
        workspaceCardDesc.textContent = relativePath;
        workspaceCardDesc.title = activeProjectPath;
      }
      if (workspaceDeselectBtn) workspaceDeselectBtn.style.display = 'flex';
      
    } else {
      // Global mode
      if (activeProjectName) activeProjectName.textContent = 'Global Mode';
      if (activeProjectBadge) {
        activeProjectBadge.classList.remove('project-active');
        activeProjectBadge.title = 'Global Mode: prompts run in user home (Click to select workspace)';
      }
      if (clearProjectBtn) clearProjectBtn.style.display = 'none';
      
      // Set header icon to globe
      const activeProjectIcon = document.getElementById('activeProjectIcon');
      if (activeProjectIcon) activeProjectIcon.setAttribute('data-lucide', 'globe');

      // Update Welcome Screen Workspace Status Card
      if (workspaceStatusCard) workspaceStatusCard.classList.remove('active');
      if (workspaceCardIcon) {
        workspaceCardIcon.innerHTML = '<i data-lucide="globe"></i>';
      }
      if (workspaceCardTitle) workspaceCardTitle.textContent = 'Global Terminal Mode';
      if (workspaceCardDesc) {
        workspaceCardDesc.textContent = 'Prompts run in user home directory. Files are not bound to a workspace.';
        workspaceCardDesc.removeAttribute('title');
      }
      if (workspaceDeselectBtn) workspaceDeselectBtn.style.display = 'none';
    }

    // Update shell prompt path
    const shellPath = document.querySelector('.shell-path');
    if (shellPath) shellPath.textContent = relativePath;

    // Synchronize active highlights in sidebar and modal project list items
    document.querySelectorAll('.project-item').forEach(el => {
      if (el.dataset.path === activeProjectPath) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });

    updateIcons();
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

  // Fetch and Render Projects List
  async function fetchProjects() {
    const listLoadingHtml = '<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 10px 0;">Loading...</div>';
    if (projectsList) projectsList.innerHTML = listLoadingHtml;
    if (modalProjectsList) modalProjectsList.innerHTML = listLoadingHtml;

    try {
      const response = await fetch('/api/projects');
      if (!response.ok) throw new Error('Failed to load projects');
      const projects = await response.json();

      // Render Sidebar projects
      if (projectsList) {
        projectsList.innerHTML = '';
        if (projects.length === 0) {
          projectsList.innerHTML = '<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 10px 0;">No projects found</div>';
        } else {
          projects.forEach(proj => {
            const item = createProjectItemElement(proj, 'sidebar');
            projectsList.appendChild(item);
          });
        }
      }

      // Render Modal projects
      if (modalProjectsList) {
        modalProjectsList.innerHTML = '';
        if (projects.length === 0) {
          modalProjectsList.innerHTML = '<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 10px 0; grid-column: 1/-1;">No projects found</div>';
        } else {
          projects.forEach(proj => {
            const item = createProjectItemElement(proj, 'modal');
            modalProjectsList.appendChild(item);
          });
        }
      }
      
    } catch (e) {
      console.error(e);
      const errorHtml = '<div style="text-align: center; color: var(--error); font-size: 0.8rem; padding: 10px 0;">Error loading projects</div>';
      if (projectsList) projectsList.innerHTML = errorHtml;
      if (modalProjectsList) modalProjectsList.innerHTML = errorHtml;
    }

    updateIcons();
  }

  // Helper to create project elements
  function createProjectItemElement(proj, context) {
    const item = document.createElement('div');
    item.className = `project-item ${proj.path === activeProjectPath ? 'active' : ''}`;
    item.dataset.path = proj.path;

    const icon = document.createElement('span');
    icon.className = 'project-icon';
    icon.innerHTML = '<i data-lucide="folder" style="width: 16px; height: 16px;"></i>';

    const name = document.createElement('span');
    name.className = 'project-name';
    name.textContent = proj.name;

    item.appendChild(icon);
    item.appendChild(name);

    item.addEventListener('click', () => {
      if (activeProjectPath === proj.path) {
        activeProjectPath = null; // deselect
      } else {
        activeProjectPath = proj.path;
        // Auto-close sidebar on mobile
        if (sidebar && context === 'sidebar') {
          sidebar.classList.remove('open');
        }
      }
      updateActiveProjectUI();
      
      // Auto-close modal if clicked inside modal
      if (context === 'modal' && workspaceModal) {
        workspaceModal.style.display = 'none';
      }
    });

    return item;
  }

  // Refactored unified create project function
  async function createNewProjectFolder(name) {
    try {
      const response = await fetch('/api/projects', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name })
      });
      const data = await response.json();
      if (response.ok && data.status === 'ok') {
        // Select the newly created project automatically
        activeProjectPath = data.path;
        await fetchProjects();
        updateActiveProjectUI();
      } else {
        alert(`Failed to create project: ${data.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Error creating project:', err);
      alert('Failed to create project. Check console for details.');
    }
  }

  // Create Project Click Event
  if (createProjectBtn) {
    createProjectBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = prompt('Enter new project directory name:');
      if (!name) return;
      const trimmedName = name.trim();
      if (trimmedName === '') return;
      await createNewProjectFolder(trimmedName);
    });
  }

  // Create project logic from Modal
  if (modalCreateProjectBtn && modalNewProjectName) {
    modalCreateProjectBtn.addEventListener('click', async () => {
      const name = modalNewProjectName.value.trim();
      if (!name) return;
      await createNewProjectFolder(name);
      modalNewProjectName.value = '';
      if (workspaceModal) workspaceModal.style.display = 'none';
    });
    
    // Add Enter key support to modal project name input
    modalNewProjectName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        modalCreateProjectBtn.click();
      }
    });
  }

  // Workspace Modal Events
  if (activeProjectBadge) {
    activeProjectBadge.addEventListener('click', (e) => {
      if (e.target.closest('#clearProjectBtn')) return;
      if (workspaceModal) {
        workspaceModal.style.display = 'flex';
        fetchProjects(); // refresh projects
      }
    });
  }

  if (clearProjectBtn) {
    clearProjectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      activeProjectPath = null;
      updateActiveProjectUI();
    });
  }

  if (closeWorkspaceModal && workspaceModal) {
    closeWorkspaceModal.addEventListener('click', () => {
      workspaceModal.style.display = 'none';
    });
  }
  
  if (workspaceModal) {
    workspaceModal.addEventListener('click', (e) => {
      if (e.target === workspaceModal) {
        workspaceModal.style.display = 'none';
      }
    });
  }

  if (modalGlobalModeBtn) {
    modalGlobalModeBtn.addEventListener('click', () => {
      activeProjectPath = null;
      updateActiveProjectUI();
      if (workspaceModal) workspaceModal.style.display = 'none';
    });
  }

  // Welcome page actions
  if (workspaceSelectBtn && workspaceModal) {
    workspaceSelectBtn.addEventListener('click', () => {
      workspaceModal.style.display = 'flex';
      fetchProjects();
    });
  }

  if (workspaceDeselectBtn) {
    workspaceDeselectBtn.addEventListener('click', () => {
      activeProjectPath = null;
      updateActiveProjectUI();
    });
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
    
    addCopyButtons(bubble);
    
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
      if (assistantBubble) {
        assistantBubble.classList.add('blinking-cursor');
      }
      let assistantText = '';

      // Setup Server-Sent Events stream URL
      const continueLatest = continueToggle ? continueToggle.checked : true;
      
      let url = `/api/stream?prompt=${encodeURIComponent(prompt)}`;
      if (continueLatest) {
        url += '&continue=true';
      }
      if (activeProjectPath) {
        url += `&projectPath=${encodeURIComponent(activeProjectPath)}`;
      }
      if (activeModel) {
        url += `&model=${encodeURIComponent(activeModel)}`;
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
        
        // Remove blinking cursor class and add copy buttons
        if (assistantBubble) {
          assistantBubble.classList.remove('blinking-cursor');
          addCopyButtons(assistantBubble);
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

  // Quota Modal Logic
  if (viewQuotasBtn && quotasModal) {
    viewQuotasBtn.addEventListener('click', () => {
      // Open modal
      quotasModal.style.display = 'flex';
      
      // Reset modal UI state
      if (quotaLoading) quotaLoading.style.display = 'flex';
      if (quotaError) quotaError.style.display = 'none';
      if (quotaDisplay) {
        quotaDisplay.style.display = 'none';
        quotaDisplay.innerHTML = '';
      }
      
      // Fetch quotas from API
      fetch('/api/quota')
        .then(response => {
          if (!response.ok) {
            throw new Error(`Server returned HTTP ${response.status}`);
          }
          return response.json();
        })
        .then(data => {
          if (quotaLoading) quotaLoading.style.display = 'none';
          if (quotaDisplay && data.quotaMarkdown) {
            quotaDisplay.innerHTML = renderMarkdown(data.quotaMarkdown);
            quotaDisplay.style.display = 'block';
            
            // Re-render any icons inside the markdown if needed
            updateIcons();
          } else {
            throw new Error('Response did not contain quotaMarkdown data');
          }
        })
        .catch(err => {
          console.error('Failed to load quotas:', err);
          if (quotaLoading) quotaLoading.style.display = 'none';
          if (quotaErrorText) {
            quotaErrorText.textContent = `Failed to retrieve quota statistics: ${err.message}`;
          }
          if (quotaError) quotaError.style.display = 'flex';
        });
    });
  }

  if (closeQuotasModal && quotasModal) {
    closeQuotasModal.addEventListener('click', () => {
      quotasModal.style.display = 'none';
    });

    // Close on overlay click
    quotasModal.addEventListener('click', (e) => {
      if (e.target === quotasModal) {
        quotasModal.style.display = 'none';
      }
    });
  }

  // Initial runs
  checkHealth();
  renderConversationsList();
  fetchProjects();
  updateActiveProjectUI();
});
