const express = require('express');
const http = require('http');
const httpProxy = require('http-proxy');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3333;

// Configure settings
const CONNECTION_MODE = process.env.AG_CONNECTION_MODE || 'ssh';
const SSH_HOST = process.env.AG_SSH_HOST || '127.0.0.1';
const SSH_USER = process.env.AG_SSH_USER || 'username';
const SSH_KEY_PATH = process.env.AG_SSH_KEY_PATH || path.join(process.env.HOME || '', '.ssh/id_ed25519_antigravity');

// The port the Antigravity 2.0 Web UI runs on the Mac Mini
const REMOTE_PORT = 56345;
// The local port we will bind the SSH tunnel to
const TUNNEL_PORT = 56345;

console.log('Antigravity 2.0 Web Proxy Starting...');
console.log(`- Connection Mode: ${CONNECTION_MODE}`);

let tunnelProcess = null;

if (CONNECTION_MODE === 'ssh') {
  console.log(`- SSH Host: ${SSH_USER}@${SSH_HOST}`);
  console.log(`- SSH Key Path: ${SSH_KEY_PATH}`);

  // Verify SSH Key exists
  if (!fs.existsSync(SSH_KEY_PATH)) {
    console.warn(`[Warning] SSH Key not found at: ${SSH_KEY_PATH}. Remote connection will likely fail.`);
  }

  // Establish SSH Tunnel
  // -N: Do not execute a remote command (just port forward)
  // -L: Forward local port to remote port
  const sshArgs = [
    '-i', SSH_KEY_PATH,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ExitOnForwardFailure=yes',
    '-N',
    '-L', `${TUNNEL_PORT}:localhost:${REMOTE_PORT}`,
    `${SSH_USER}@${SSH_HOST}`
  ];

  console.log(`Establishing SSH tunnel: localhost:${TUNNEL_PORT} -> ${SSH_USER}@${SSH_HOST}:localhost:${REMOTE_PORT}...`);
  tunnelProcess = spawn('ssh', sshArgs);

  tunnelProcess.stdout.on('data', (data) => console.log(`[SSH Tunnel]: ${data.toString().trim()}`));
  tunnelProcess.stderr.on('data', (data) => console.error(`[SSH Tunnel Error]: ${data.toString().trim()}`));

  tunnelProcess.on('close', (code) => {
    console.log(`[SSH Tunnel] Process closed with code ${code}`);
  });

  tunnelProcess.on('error', (err) => {
    console.error('[SSH Tunnel] Failed to start SSH tunnel process:', err);
  });
}

// Create HTTP Proxy
const proxy = httpProxy.createProxyServer({
  target: `http://localhost:${TUNNEL_PORT}`,
  ws: true,
  changeOrigin: true
});

// Proxy error handling
proxy.on('error', (err, req, res) => {
  console.error('Proxy Error:', err.message);
  if (res.writeHead) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Antigravity 2.0 is starting or offline. Please wait and refresh.');
  }
});

// Intercept HTML requests and inject window.nativeStorage mock
app.use((req, res, next) => {
  const acceptHeader = req.headers.accept || '';
  if (acceptHeader.includes('text/html')) {
    const options = {
      hostname: '127.0.0.1',
      port: TUNNEL_PORT,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        'host': `localhost:${TUNNEL_PORT}`,
        'accept-encoding': 'identity' // Avoid compression to allow text replacement
      }
    };

    const proxyReq = http.request(options, (proxyRes) => {
      if (proxyRes.statusCode !== 200) {
        res.status(proxyRes.statusCode);
        proxyRes.pipe(res);
        return;
      }

      let data = '';
      proxyRes.on('data', (chunk) => {
        data += chunk;
      });

      proxyRes.on('end', () => {
        const mockScript = `
<script>
// Early theme loader to prevent visual flash
(function() {
  const savedTheme = localStorage.getItem('ag_active_theme') || 'slate-minimalist';
  document.documentElement.setAttribute('data-theme', savedTheme);
})();

window.nativeStorage = {
  async getItems() {
    const items = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      items[key] = localStorage.getItem(key);
    }
    return items;
  },
  async updateItems(changes) {
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === undefined) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, value);
      }
    }
    if (this._listener) {
      this._listener(changes);
    }
  },
  onChanged(callback) {
    this._listener = callback;
    return () => {
      if (this._listener === callback) {
        this._listener = null;
      }
    };
  }
};

window.electronNative = {
  zoomLevel: 0, // Default to 0 (100% zoom) to prevent the 120% default fallback zoom
  getZoomLevel() {
    return this.zoomLevel;
  },
  zoomIn() {
    this.zoomLevel = Math.min(this.zoomLevel + 1, 8);
    this.applyZoom();
  },
  zoomOut() {
    this.zoomLevel = Math.max(this.zoomLevel - 1, -8);
    this.applyZoom();
  },
  resetZoom() {
    this.zoomLevel = 0;
    this.applyZoom();
  },
  applyZoom() {
    const zoomFactor = Math.pow(1.2, this.zoomLevel);
    document.documentElement.style.zoom = zoomFactor;
    window.dispatchEvent(new Event('resize'));
  },
  minimize() {},
  maximize() {},
  unmaximize() {},
  isMaximized() { return false; },
  close() {},
  toggleDevTools() {},
  openExternal(url) {
    window.open(url, '_blank');
  }
};

// Initialize default zoom
window.electronNative.applyZoom();

// Mobile Layout & Theme Selector Injections
(function() {
  const isMobile = () => window.innerWidth < 768;

  // 1. Auto-close sidebar on mobile at startup
  if (isMobile()) {
    const checkSidebar = setInterval(() => {
      const toggleButton = document.querySelector('[data-testid="sidebar-toggle"]');
      const sidebar = document.querySelector('[aria-label="Sidebar"]');
      if (toggleButton && sidebar) {
        const sidebarParent = sidebar.closest('.flex-grow') || sidebar.parentElement;
        if (sidebarParent && sidebarParent.offsetWidth > 0) {
          toggleButton.click(); // close it
        }
        clearInterval(checkSidebar);
      }
    }, 200);
  }

  // 2. Monitor mobile sidebar open/closed state & control backdrop
  let backdrop = null;
  const updateMobileSidebarState = () => {
    const sidebar = document.querySelector('[aria-label="Sidebar"]');
    if (!sidebar) return;
    
    const sidebarParent = sidebar.closest('.flex-grow') || sidebar.parentElement;
    if (!sidebarParent) return;

    // Detect if sidebar is open based on its inline width (React collapsible splits set style.width = "0px")
    const isClosed = sidebarParent.style.width === '0px' || window.getComputedStyle(sidebarParent).display === 'none';
    const isOpen = !isClosed;

    if (window.innerWidth < 768) {
      document.documentElement.setAttribute('data-sidebar-open', isOpen ? 'true' : 'false');
      
      // Manage backdrop
      if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'mobile-sidebar-backdrop';
        backdrop.style.cssText = 'position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0, 0, 0, 0.4); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); z-index: 9998; opacity: 0; pointer-events: none; transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1);';
        document.body.appendChild(backdrop);
        backdrop.onclick = () => {
          const toggleButton = document.querySelector('[data-testid="sidebar-toggle"]');
          if (toggleButton) toggleButton.click();
        };
      }

      if (isOpen) {
        backdrop.style.opacity = '1';
        backdrop.style.pointerEvents = 'auto';
        document.body.style.overflow = 'hidden';
      } else {
        backdrop.style.opacity = '0';
        backdrop.style.pointerEvents = 'none';
        document.body.style.overflow = '';
      }
    } else {
      document.documentElement.removeAttribute('data-sidebar-open');
      if (backdrop) {
        backdrop.style.opacity = '0';
        backdrop.style.pointerEvents = 'none';
      }
      document.body.style.overflow = '';
    }
  };
  setInterval(updateMobileSidebarState, 150);

  // 3. Inject dynamic theme selector widget into sidebar
  const injectThemeSelector = () => {
    if (document.getElementById('theme-selector-container')) return;
    
    const sidebar = document.querySelector('[aria-label="Sidebar"]');
    if (sidebar) {
      const container = document.createElement('div');
      container.id = 'theme-selector-container';
      container.style.cssText = 'padding: 16px; border-top: 1px solid var(--border-color); display: flex; flex-direction: column; gap: 8px; margin-top: auto;';

      const title = document.createElement('div');
      title.innerText = 'APPEARANCE';
      title.style.cssText = 'font-size: 10px; font-weight: 600; color: var(--text-muted); letter-spacing: 0.05em; margin-bottom: 4px;';

      const row = document.createElement('div');
      row.style.cssText = 'display: flex; gap: 8px; align-items: center; justify-content: space-between;';

      const themes = [
        { id: 'slate-minimalist', color: 'hsl(220, 60%, 55%)', label: 'Slate' },
        { id: 'tokyo-dusk', color: 'hsl(270, 60%, 62%)', label: 'Tokyo' },
        { id: 'sage-spruce', color: 'hsl(150, 45%, 45%)', label: 'Sage' },
        { id: 'rose-pine', color: 'hsl(12, 45%, 60%)', label: 'Rose' },
        { id: 'obsidian-amber', color: 'hsl(38, 70%, 55%)', label: 'Amber' }
      ];

      themes.forEach(t => {
        const btn = document.createElement('button');
        btn.className = 'theme-btn';
        btn.setAttribute('data-theme-id', t.id);
        btn.title = t.label;
        btn.style.cssText = 'width: 24px; height: 24px; border-radius: 50%; border: 2px solid transparent; background-color: ' + t.color + '; cursor: pointer; transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); padding: 0; display: inline-flex; align-items: center; justify-content: center; position: relative;';

        const updateBtnStyles = () => {
          const currentTheme = document.documentElement.getAttribute('data-theme') || 'slate-minimalist';
          if (currentTheme === t.id) {
            btn.style.borderColor = 'var(--text-primary)';
            btn.style.transform = 'scale(1.15)';
          } else {
            btn.style.borderColor = 'transparent';
            btn.style.transform = 'scale(1)';
          }
        };

        updateBtnStyles();
        document.documentElement.addEventListener('theme-changed', updateBtnStyles);

        btn.onclick = (e) => {
          e.stopPropagation();
          document.documentElement.setAttribute('data-theme', t.id);
          localStorage.setItem('ag_active_theme', t.id);
          document.documentElement.dispatchEvent(new CustomEvent('theme-changed'));
        };

        btn.onmouseenter = () => {
          const currentTheme = document.documentElement.getAttribute('data-theme') || 'slate-minimalist';
          if (currentTheme !== t.id) {
            btn.style.borderColor = 'var(--border-color)';
            btn.style.transform = 'scale(1.08)';
          }
        };
        btn.onmouseleave = () => {
          const currentTheme = document.documentElement.getAttribute('data-theme') || 'slate-minimalist';
          if (currentTheme !== t.id) {
            btn.style.borderColor = 'transparent';
            btn.style.transform = 'scale(1)';
          }
        };

        row.appendChild(btn);
      });

      container.appendChild(title);
      container.appendChild(row);

      // Force sidebar wrapper to be flex so theme widget aligns at the bottom
      sidebar.style.display = 'flex';
      sidebar.style.flexDirection = 'column';
      sidebar.style.justifyContent = 'space-between';

      sidebar.appendChild(container);
    }
  };
  setInterval(injectThemeSelector, 1000);
})();
</script>

<style>
/* Material 3 Tonal Color System Overrides - Transitions enabled */
:root,
div, aside, main, header, footer, button, a, input, textarea, pre, code {
  transition: background-color 0.3s cubic-bezier(0.4, 0, 0.2, 1), 
              color 0.3s cubic-bezier(0.4, 0, 0.2, 1), 
              border-color 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

:root {
  /* Default Theme: Slate Minimalist */
  --bg-primary: hsl(220, 16%, 8%) !important;
  --bg-secondary: hsl(220, 14%, 11%) !important;
  --bg-tertiary: hsl(220, 12%, 16%) !important;
  --bg-glass: hsl(220, 14%, 11%) !important;

  --border-color: hsla(220, 10%, 25%, 0.12) !important;
  --border-glow: transparent !important;

  --text-primary: hsl(220, 15%, 93%) !important;
  --text-secondary: hsl(220, 10%, 58%) !important;
  --text-muted: hsl(220, 8%, 40%) !important;

  /* Refined Accent - Slate Blue */
  --accent: hsl(220, 60%, 55%) !important;
  --accent-light: hsl(220, 70%, 70%) !important;
  --accent-gradient: linear-gradient(135deg, hsl(220, 60%, 55%) 0%, hsl(220, 50%, 45%) 100%) !important;
  --accent-glow: hsla(220, 60%, 55%, 0.15) !important;

  --success: hsl(152, 55%, 48%) !important;
  --success-glow: hsla(152, 55%, 48%, 0.1) !important;
  --warning: hsl(38, 80%, 55%) !important;
  --error: hsl(0, 65%, 55%) !important;
}

/* Tokyo Dusk (Midnight Lavender) */
:root[data-theme="tokyo-dusk"] {
  --bg-primary: hsl(240, 14%, 9%) !important;
  --bg-secondary: hsl(240, 12%, 12%) !important;
  --bg-tertiary: hsl(240, 10%, 18%) !important;
  --bg-glass: hsl(240, 12%, 12%) !important;

  --border-color: hsla(240, 10%, 25%, 0.14) !important;

  --text-primary: hsl(240, 15%, 93%) !important;
  --text-secondary: hsl(240, 10%, 65%) !important;
  --text-muted: hsl(240, 8%, 45%) !important;

  --accent: hsl(270, 60%, 62%) !important;
  --accent-light: hsl(270, 70%, 75%) !important;
  --accent-gradient: linear-gradient(135deg, hsl(270, 60%, 62%) 0%, hsl(250, 50%, 55%) 100%) !important;
  --accent-glow: hsla(270, 60%, 62%, 0.15) !important;
}

/* Sage Spruce (Eucalyptus Forest) */
:root[data-theme="sage-spruce"] {
  --bg-primary: hsl(150, 12%, 8%) !important;
  --bg-secondary: hsl(150, 10%, 11%) !important;
  --bg-tertiary: hsl(150, 8%, 16%) !important;
  --bg-glass: hsl(150, 10%, 11%) !important;

  --border-color: hsla(150, 10%, 25%, 0.15) !important;

  --text-primary: hsl(150, 10%, 92%) !important;
  --text-secondary: hsl(150, 6%, 65%) !important;
  --text-muted: hsl(150, 6%, 45%) !important;

  --accent: hsl(150, 45%, 45%) !important;
  --accent-light: hsl(150, 55%, 60%) !important;
  --accent-gradient: linear-gradient(135deg, hsl(150, 45%, 45%) 0%, hsl(160, 40%, 35%) 100%) !important;
  --accent-glow: hsla(150, 45%, 45%, 0.12) !important;
}

/* Rose Pine (Warm Espresso) */
:root[data-theme="rose-pine"] {
  --bg-primary: hsl(10, 8%, 9%) !important;
  --bg-secondary: hsl(10, 6%, 12%) !important;
  --bg-tertiary: hsl(10, 6%, 17%) !important;
  --bg-glass: hsl(10, 6%, 12%) !important;

  --border-color: hsla(10, 8%, 25%, 0.15) !important;

  --text-primary: hsl(10, 10%, 93%) !important;
  --text-secondary: hsl(10, 6%, 66%) !important;
  --text-muted: hsl(10, 4%, 46%) !important;

  --accent: hsl(12, 45%, 60%) !important;
  --accent-light: hsl(12, 55%, 70%) !important;
  --accent-gradient: linear-gradient(135deg, hsl(12, 45%, 60%) 0%, hsl(355, 40%, 52%) 100%) !important;
  --accent-glow: hsla(12, 45%, 60%, 0.15) !important;
}

/* Obsidian Onyx (Black Amber) */
:root[data-theme="obsidian-amber"] {
  --bg-primary: hsl(0, 0%, 5%) !important;
  --bg-secondary: hsl(0, 0%, 9%) !important;
  --bg-tertiary: hsl(0, 0%, 14%) !important;
  --bg-glass: hsl(0, 0%, 9%) !important;

  --border-color: hsla(0, 0%, 20%, 0.18) !important;

  --text-primary: hsl(0, 0%, 94%) !important;
  --text-secondary: hsl(0, 0%, 65%) !important;
  --text-muted: hsl(0, 0%, 45%) !important;

  --accent: hsl(38, 70%, 55%) !important;
  --accent-light: hsl(38, 80%, 68%) !important;
  --accent-gradient: linear-gradient(135deg, hsl(38, 70%, 55%) 0%, hsl(30, 65%, 48%) 100%) !important;
  --accent-glow: hsla(38, 70%, 55%, 0.15) !important;
}

/* Thin Custom Scrollbars */
::-webkit-scrollbar {
  width: 5px !important;
  height: 5px !important;
}
::-webkit-scrollbar-track {
  background: transparent !important;
}
::-webkit-scrollbar-thumb {
  background: var(--border-color) !important;
  border-radius: 10px !important;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted) !important;
}

/* CSS overrides for mobile viewports */
@media (max-width: 768px) {
  /* 1. Main split-pane container */
  div.flex.w-full.h-full.flex-row {
    position: relative !important;
  }

  /* 2. Left Sidebar Panel (First child of main split pane) */
  div.flex.w-full.h-full.flex-row > div:first-child {
    position: fixed !important;
    left: 0 !important;
    top: 0 !important;
    bottom: 0 !important;
    width: 280px !important; /* Drawer width */
    height: 100% !important;
    z-index: 9999 !important;
    background-color: var(--bg-secondary) !important; /* Dark sidebar bg */
    box-shadow: 5px 0 25px rgba(0, 0, 0, 0.5) !important;
    transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1) !important;
    border-right: 1px solid var(--border-color) !important;
    overscroll-behavior: contain !important;
  }

  /* Force off-screen when closed and back when open */
  :root[data-sidebar-open="false"] div.flex.w-full.h-full.flex-row > div:first-child {
    transform: translateX(-100%) !important;
  }
  :root[data-sidebar-open="true"] div.flex.w-full.h-full.flex-row > div:first-child {
    transform: translateX(0) !important;
  }

  /* 3. Right Content Panel (Second child of main split pane) */
  div.flex.w-full.h-full.flex-row > div:nth-child(2) {
    width: 100% !important;
    max-width: 100% !important;
    flex-grow: 1 !important;
  }

  /* 4. Hide resizer sashes and drag sashes on mobile */
  .cursor-col-resize, .cursor-row-resize {
    display: none !important;
    width: 0 !important;
    height: 0 !important;
  }
  
  /* 5. Clean up padding/margins for compact mobile layout */
  .p-10, .p-8, .p-6 {
    padding: 0.75rem !important;
  }
  .px-10, .px-8, .px-6 {
    padding-left: 0.75rem !important;
    padding-right: 0.75rem !important;
  }
  .py-10, .py-8, .py-6 {
    padding-top: 0.75rem !important;
    padding-bottom: 0.75rem !important;
  }
  
  /* 6. Adjust input area margins and padding */
  .max-w-3xl, .max-w-2xl {
    max-width: 100% !important;
    width: 100% !important;
  }

  /* 7. Mobile Safe Area & Input Area Padding */
  div:has(textarea), form:has(textarea) {
    padding-bottom: calc(0.75rem + env(safe-area-inset-bottom)) !important;
  }

  /* 8. Larger Touch Target Areas */
  button, a, [role="button"], [data-testid="sidebar-toggle"] {
    min-width: 44px !important;
    min-height: 44px !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
  }

  [aria-label="Sidebar"] a, 
  [aria-label="Sidebar"] button {
    padding: 12px 16px !important;
    font-size: 15px !important;
  }

  /* 9. Scrollable code blocks */
  pre, code, .code-block {
    max-width: 100% !important;
    overflow-x: auto !important;
    white-space: pre !important;
  }
}
</style>
`;
        const injectedHtml = data.replace('<head>', '<head>' + mockScript);
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.send(injectedHtml);
      });
    });

    proxyReq.on('error', (err) => {
      console.error('Error fetching HTML from backend:', err);
      // Fallback to normal proxy in case backend isn't ready
      proxy.web(req, res);
    });

    proxyReq.end();
  } else {
    next();
  }
});

// Redirect all other HTTP traffic through the proxy
app.all('*', (req, res) => {
  proxy.web(req, res);
});

// Create Server and handle WebSocket upgrade requests
const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  proxy.ws(req, socket, head);
});

// Start listening
server.listen(PORT, () => {
  console.log(`Antigravity 2.0 Web Proxy is listening at http://localhost:${PORT}`);
});

// Cleanup tunnel on process exit
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);

function cleanup() {
  console.log('Shutting down server and cleaning up SSH tunnel...');
  if (tunnelProcess) {
    tunnelProcess.kill();
  }
  process.exit(0);
}
