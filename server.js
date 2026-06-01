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

// Mobile Layout Optimization Helpers
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

  // 2. Click outside sidebar to close drawer on mobile
  document.addEventListener('click', (e) => {
    if (isMobile()) {
      const sidebar = document.querySelector('[aria-label="Sidebar"]');
      const toggleButton = document.querySelector('[data-testid="sidebar-toggle"]');
      if (sidebar && toggleButton) {
        const sidebarParent = sidebar.closest('.flex-grow') || sidebar.parentElement;
        // If sidebar is open and click was outside sidebar and outside toggle button
        if (sidebarParent && sidebarParent.offsetWidth > 0 && !sidebar.contains(e.target) && !toggleButton.contains(e.target)) {
          toggleButton.click();
        }
      }
    }
  });
})();
</script>

<style>
/* Material 3 Tonal Color System Overrides */
:root {
  /* Surface elevations */
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
