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

// Rewrite Origin and Referer headers to bypass Go backend CORS/Origin security checks
proxy.on('proxyReq', (proxyReq, req, res, options) => {
  proxyReq.setHeader('Origin', `http://localhost:${TUNNEL_PORT}`);
  if (req.headers.referer) {
    try {
      const refererUrl = new URL(req.headers.referer);
      const targetReferer = req.headers.referer.replace(refererUrl.host, `localhost:${TUNNEL_PORT}`);
      proxyReq.setHeader('Referer', targetReferer);
    } catch (e) {
      // Ignore URL parsing errors for relative referers
    }
  }
});

proxy.on('proxyReqWs', (proxyReq, req, socket, options, head) => {
  proxyReq.setHeader('Origin', `http://localhost:${TUNNEL_PORT}`);
  if (req.headers.referer) {
    try {
      const refererUrl = new URL(req.headers.referer);
      const targetReferer = req.headers.referer.replace(refererUrl.host, `localhost:${TUNNEL_PORT}`);
      proxyReq.setHeader('Referer', targetReferer);
    } catch (e) {
      // Ignore URL parsing errors
    }
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
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<script>
// Early theme loader to prevent visual flash
(function() {
  document.documentElement.setAttribute('data-theme', 'oxford-navy');
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
        const sidebarParent = sidebar.closest('.border-border') || sidebar.closest('.flex-grow') || sidebar.parentElement;
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
    
    const sidebarParent = sidebar.closest('.border-border') || sidebar.closest('.flex-grow') || sidebar.parentElement;
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

  // 3. Inject dynamic theme selector widget into sidebar (removed)
})();
</script>

<style>
/* Material 3 Tonal Color System Overrides - Transitions enabled */
:root,
div, aside, main, header, footer, button, a, input, textarea, pre, code {
  transition: background-color 0.35s cubic-bezier(0.4, 0, 0.2, 1), 
              color 0.35s cubic-bezier(0.4, 0, 0.2, 1), 
              border-color 0.35s cubic-bezier(0.4, 0, 0.2, 1) !important;
}

/* Typography settings - Regal Serif + Minimalist Sans UI */
body, html, button, input, textarea, select, span, p, a {
  font-family: 'Inter', -apple-system, sans-serif !important;
  letter-spacing: -0.01em !important;
}

/* Editorial Serif Headings */
h1, h2, h3, h4,
.text-xl, .text-2xl, .text-3xl, .text-4xl,
[data-testid="workspace-title"],
[data-testid="chat-header"],
div[aria-label="Sidebar"] .font-semibold,
.font-serif {
  font-family: 'Instrument Serif', Georgia, serif !important;
  letter-spacing: 0em !important;
  font-weight: 400 !important;
}

pre, code, .font-mono {
  font-family: 'JetBrains Mono', monospace !important;
  font-size: 13px !important;
}

/* Core Page Theme Overrides - Mapping Custom HSL Variables to App classes */
.bg-background,
html,
body,
.theme-standalone {
  background-color: var(--bg-primary) !important;
  color: var(--text-primary) !important;
}

.bg-sidebar {
  background-color: var(--bg-secondary) !important;
}

/* Constrain main chat content to a centered book-like column */
div.animate-fade-in {
  max-width: 44rem !important; /* ~700px, optimal line length */
  width: 100% !important;
  margin-left: auto !important;
  margin-right: auto !important;
  padding-left: 1.5rem !important;
  padding-right: 1.5rem !important;
}

.flex-grow.overflow-y-auto {
  display: flex !important;
  flex-direction: column !important;
  align-items: center !important;
}

.flex-grow.overflow-y-auto > div {
  width: 100% !important;
  max-width: 44rem !important;
}

/* Right pane Header bar overrides */
div.flex-1.flex.flex-col.min-w-0.h-full > div:first-child {
  position: relative !important;
  display: flex !important;
  justify-content: space-between !important;
  align-items: center !important;
  height: 3.5rem !important;
  padding-left: 1.5rem !important;
  padding-right: 1.5rem !important;
  border-bottom: 0.5px solid var(--border-color) !important;
  background-color: var(--bg-primary) !important;
}

/* Hide Open IDE button in top right */
[data-testid="open-editor-single"] {
  display: none !important;
}

/* Minimalist header links */
div.flex-1.flex.flex-col.min-w-0.h-full > div:first-child a,
div.flex-1.flex.flex-col.min-w-0.h-full > div:first-child button:not([data-testid="sidebar-toggle"]) {
  background-color: transparent !important;
  border: none !important;
  color: var(--text-secondary) !important;
  font-size: 0.85rem !important;
  padding: 0.25rem 0.5rem !important;
  font-family: 'Inter', -apple-system, sans-serif !important;
  text-transform: lowercase !important;
  letter-spacing: -0.01em !important;
  transition: color 0.2s ease !important;
}

div.flex-1.flex.flex-col.min-w-0.h-full > div:first-child a:hover,
div.flex-1.flex.flex-col.min-w-0.h-full > div:first-child button:not([data-testid="sidebar-toggle"]):hover {
  color: var(--accent) !important;
  background-color: transparent !important;
}

/* Hide standard icons inside top-right header buttons */
div.flex-1.flex.flex-col.min-w-0.h-full > div:first-child a svg,
div.flex-1.flex.flex-col.min-w-0.h-full > div:first-child button:not([data-testid="sidebar-toggle"]) svg {
  display: none !important;
}

/* Make writing pad look like a clean floating sheet */
.bg-card {
  background-color: var(--bg-tertiary) !important;
  border: 0.5px solid var(--border-color) !important;
  border-radius: 8px !important;
  padding: 0.75rem !important;
  box-shadow: none !important;
}

.bg-card-border {
  background-color: transparent !important;
  background-image: none !important;
  padding: 0 !important;
}

/* Clean Borders */
.border-border,
.border-slate-800,
.border-gray-800,
.border-t, .border-b, .border-l, .border-r, .border {
  border-color: var(--border-color) !important;
  border-width: 0.5px !important;
}

.text-foreground {
  color: var(--text-primary) !important;
}

.text-secondary-foreground,
.text-slate-300,
.text-gray-300 {
  color: var(--text-secondary) !important;
}

.text-muted-foreground,
.text-slate-400,
.text-slate-500,
.text-gray-400,
.text-gray-500 {
  color: var(--text-muted) !important;
}

/* Simplify prompt toolbar buttons */
.bg-card button {
  background: transparent !important;
  border: none !important;
  color: var(--text-secondary) !important;
  font-size: 0.8rem !important;
  padding: 0.25rem 0.5rem !important;
  border-radius: 4px !important;
  font-family: 'Inter', sans-serif !important;
  transition: all 0.2s ease !important;
  display: inline-flex !important;
  align-items: center !important;
  gap: 0.25rem !important;
  height: auto !important;
  min-height: auto !important;
  min-width: auto !important;
}

.bg-card button:hover {
  color: var(--accent) !important;
  background: hsla(0, 0%, 50%, 0.05) !important;
}

/* Add custom lowercase text labels to card icon buttons */
button[aria-label="Add context"]::after {
  content: "attach" !important;
  font-size: 0.8rem !important;
  margin-left: 0.25rem !important;
}

button[aria-label="Record voice memo"]::after {
  content: "voice" !important;
  font-size: 0.8rem !important;
  margin-left: 0.25rem !important;
}

button[aria-label="Add context"] svg,
button[aria-label="Record voice memo"] svg,
button[aria-label="Select Environment"] svg {
  width: 12px !important;
  height: 12px !important;
  opacity: 0.6 !important;
}

/* Sidebar Plus New Conversation button */
div.bg-sidebar button:has(span),
div.bg-sidebar button[data-testid="new-conversation-button"],
div.bg-sidebar button.w-full {
  background-color: transparent !important;
  border: 0.5px solid var(--border-color) !important;
  color: var(--text-primary) !important;
  border-radius: 6px !important;
  font-family: 'Instrument Serif', Georgia, serif !important;
  font-size: 1.1rem !important;
  font-style: italic !important;
  transition: all 0.2s ease !important;
  box-shadow: none !important;
  padding: 0.5rem 1rem !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  width: calc(100% - 2rem) !important;
  margin-left: 1rem !important;
  margin-right: 1rem !important;
}

div.bg-sidebar button:hover {
  border-color: var(--accent) !important;
  color: var(--accent) !important;
  background-color: transparent !important;
}

/* Hide folder icons in sidebar to clear clutter */
div.bg-sidebar svg[class*="folder"],
div.bg-sidebar svg[class*="directory"] {
  display: none !important;
}

div.bg-sidebar svg {
  opacity: 0.3 !important;
}

/* Clean Editorial Conversation list items */
div.animate-fade-in > div {
  background-color: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
}

/* Focus and text inputs */
[role="combobox"][aria-label="Message input"],
[contenteditable="true"] {
  color: var(--text-primary) !important;
  background-color: transparent !important;
}

/* Accent overrides */
.text-blue-500,
.text-blue-600 {
  color: var(--accent) !important;
}

.bg-blue-500,
.bg-blue-600 {
  background-color: var(--accent) !important;
}

.hover\:bg-blue-600:hover,
.hover\:bg-primary\/90:hover {
  background-color: var(--accent-light) !important;
}

/* Minimalist Clean-up: remove heavy gradients and shadow panels */
.shadow-sm, .shadow-md, .shadow-lg, .shadow-xl, .shadow-2xl {
  box-shadow: none !important;
}

/* Clean divider spacing in list elements */
div.animate-fade-in > div {
  border-bottom: 0.5px solid var(--border-color) !important;
  padding-bottom: 1.5rem !important;
  padding-top: 1.5rem !important;
}

:root {
  /* Oxford Navy (Default Dark) */
  --bg-primary: hsl(222, 20%, 9%) !important;
  --bg-secondary: hsl(222, 16%, 12%) !important;
  --bg-tertiary: hsl(222, 14%, 16%) !important;
  --bg-glass: hsl(222, 16%, 12%) !important;

  --border-color: hsla(222, 12%, 50%, 0.08) !important;
  --border-glow: transparent !important;

  --text-primary: hsl(40, 15%, 90%) !important;
  --text-secondary: hsl(218, 12%, 68%) !important;
  --text-muted: hsl(218, 8%, 48%) !important;

  /* Accent - Warm Gold/Brass */
  --accent: hsl(43, 40%, 65%) !important;
  --accent-light: hsl(43, 45%, 72%) !important;
  --accent-gradient: linear-gradient(135deg, hsl(43, 40%, 65%) 0%, hsl(43, 30%, 55%) 100%) !important;
  --accent-glow: hsla(43, 40%, 65%, 0.15) !important;

  --success: hsl(152, 55%, 48%) !important;
  --success-glow: hsla(152, 55%, 48%, 0.1) !important;
  --warning: hsl(38, 80%, 55%) !important;
  --error: hsl(0, 65%, 55%) !important;
}

/* Other themes removed */

/* Thin Custom Scrollbars */
::-webkit-scrollbar {
  width: 4px !important;
  height: 4px !important;
}
::-webkit-scrollbar-track {
  background: transparent !important;
}
::-webkit-scrollbar-thumb {
  background: var(--border-color) !important;
  border-radius: 4px !important;
}
::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted) !important;
}

/* Premium Fluid Animations */

/* 1. Fluid hover states for interactive buttons & links */
button, 
a, 
[role="button"] {
  transition: transform 0.15s cubic-bezier(0.2, 0.8, 0.2, 1), 
              background-color 0.15s cubic-bezier(0.2, 0.8, 0.2, 1), 
              color 0.15s cubic-bezier(0.2, 0.8, 0.2, 1), 
              border-color 0.15s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
}

button:hover, 
a:hover, 
[role="button"]:hover {
  transform: translateY(-1px);
}

button:active, 
a:active, 
[role="button"]:active {
  transform: translateY(0) scale(0.99);
}

/* Sidebar toggle button custom playfulness */
[data-testid="sidebar-toggle"] {
  transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
}
[data-testid="sidebar-toggle"]:hover {
  transform: translateY(-1px) rotate(4deg) !important;
}
[data-testid="sidebar-toggle"]:active {
  transform: scale(0.95) !important;
}

/* 2. Writing pad container clean flat focus border */
.bg-card {
  transition: border-color 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
}

.bg-card:hover {
  border-color: hsla(43, 40%, 65%, 0.2) !important;
}

.bg-card:focus-within {
  border-color: var(--accent) !important;
}

/* 3. Premium Entry Animation for Chat Messages */
div.animate-fade-in > div {
  opacity: 1;
  transform: translateY(0);
  transition: opacity 0.35s cubic-bezier(0.2, 0.8, 0.2, 1), 
              transform 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
}

@starting-style {
  div.animate-fade-in > div {
    opacity: 0;
    transform: translateY(8px);
  }
}

/* 4. Sidebar conversation list item entry stagger & hover transition */
@keyframes listSlideIn {
  from {
    opacity: 0;
    transform: translateX(-4px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

[aria-label="Sidebar"] a,
[aria-label="Sidebar"] .cursor-pointer,
[aria-label="Sidebar"] [role="button"],
[aria-label="Sidebar"] button:not([data-testid="sidebar-toggle"]) {
  animation: listSlideIn 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) both;
  transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), 
              color 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), 
              background-color 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
}

[aria-label="Sidebar"] a:hover,
[aria-label="Sidebar"] .cursor-pointer:hover,
[aria-label="Sidebar"] [role="button"]:hover,
[aria-label="Sidebar"] button:not([data-testid="sidebar-toggle"]):hover {
  transform: translateX(3px) !important;
  color: var(--accent) !important;
  background-color: hsla(222, 12%, 50%, 0.03) !important;
}

[aria-label="Sidebar"] a:nth-child(1), [aria-label="Sidebar"] .cursor-pointer:nth-child(1), [aria-label="Sidebar"] [role="button"]:nth-child(1) { animation-delay: 0.02s; }
[aria-label="Sidebar"] a:nth-child(2), [aria-label="Sidebar"] .cursor-pointer:nth-child(2), [aria-label="Sidebar"] [role="button"]:nth-child(2) { animation-delay: 0.04s; }
[aria-label="Sidebar"] a:nth-child(3), [aria-label="Sidebar"] .cursor-pointer:nth-child(3), [aria-label="Sidebar"] [role="button"]:nth-child(3) { animation-delay: 0.06s; }
[aria-label="Sidebar"] a:nth-child(4), [aria-label="Sidebar"] .cursor-pointer:nth-child(4), [aria-label="Sidebar"] [role="button"]:nth-child(4) { animation-delay: 0.08s; }
[aria-label="Sidebar"] a:nth-child(5), [aria-label="Sidebar"] .cursor-pointer:nth-child(5), [aria-label="Sidebar"] [role="button"]:nth-child(5) { animation-delay: 0.10s; }
[aria-label="Sidebar"] a:nth-child(6), [aria-label="Sidebar"] .cursor-pointer:nth-child(6), [aria-label="Sidebar"] [role="button"]:nth-child(6) { animation-delay: 0.12s; }
[aria-label="Sidebar"] a:nth-child(7), [aria-label="Sidebar"] .cursor-pointer:nth-child(7), [aria-label="Sidebar"] [role="button"]:nth-child(7) { animation-delay: 0.14s; }
[aria-label="Sidebar"] a:nth-child(8), [aria-label="Sidebar"] .cursor-pointer:nth-child(8), [aria-label="Sidebar"] [role="button"]:nth-child(8) { animation-delay: 0.16s; }

/* 5. Desktop Sidebar Open/Close Slide Animation */
div.flex.w-full.h-full > div.border-border.flex {
  display: flex !important; /* Force display: flex to prevent display: none from blocking transition */
  overflow: hidden !important;
  transition: width 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
}

div.border-border.flex > div[aria-label="Sidebar"] {
  min-width: 256px !important;
  width: 256px !important;
}


/* CSS overrides for mobile viewports */
@media (max-width: 768px) {
  /* 1. Sidebar wrapper as a fixed overlay drawer */
  div.border-border.flex:has(.bg-sidebar) {
    position: fixed !important;
    left: 0 !important;
    top: 0 !important;
    bottom: 0 !important;
    width: 280px !important;
    height: 100% !important;
    z-index: 9999 !important;
    background-color: var(--bg-secondary) !important;
    box-shadow: 5px 0 25px rgba(0, 0, 0, 0.5) !important;
    transition: transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) !important;
    border-right: 1px solid var(--border-color) !important;
    overscroll-behavior: contain !important;
  }

  div.border-border.flex:has(.bg-sidebar) > div[aria-label="Sidebar"] {
    min-width: unset !important;
    width: 100% !important;
  }

  /* Force off-screen when closed and back when open */
  :root[data-sidebar-open="false"] div.border-border.flex:has(.bg-sidebar) {
    transform: translateX(-100%) !important;
  }
  :root[data-sidebar-open="true"] div.border-border.flex:has(.bg-sidebar) {
    transform: translateX(0) !important;
  }

  /* 2. Right Content Panel fills full width */
  div.border-border.flex:has(.bg-sidebar) + div {
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
    padding: 0.5rem !important;
  }
  .px-10, .px-8, .px-6 {
    padding-left: 0.5rem !important;
    padding-right: 0.5rem !important;
  }
  .py-10, .py-8, .py-6 {
    padding-top: 0.5rem !important;
    padding-bottom: 0.5rem !important;
  }
  
  /* Optimize chat area margins and padding on mobile screen */
  div.animate-fade-in {
    padding-left: 0.75rem !important;
    padding-right: 0.75rem !important;
  }
  
  /* 6. Adjust input area margins and padding */
  .max-w-3xl, .max-w-2xl {
    max-width: 100% !important;
    width: 100% !important;
  }

  /* 7. Mobile Safe Area & Input Area Padding */
  div:has(textarea), form:has(textarea) {
    padding-bottom: calc(0.5rem + env(safe-area-inset-bottom)) !important;
  }

  /* Optimize card button layouts to avoid wrapping/overflow */
  .bg-card {
    padding: 0.5rem !important;
  }

  .bg-card button {
    padding: 4px 6px !important;
    font-size: 11px !important;
  }

  /* 8. Larger Touch Target Areas */
  button, a, [role="button"], [data-testid="sidebar-toggle"] {
    min-width: 40px !important;
    min-height: 40px !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
  }

  [aria-label="Sidebar"] a, 
  [aria-label="Sidebar"] button {
    padding: 10px 14px !important;
    font-size: 14px !important;
  }

  /* 9. Scrollable code blocks */
  pre, code, .code-block {
    max-width: 100% !important;
    font-size: 11px !important;
    overflow-x: auto !important;
    white-space: pre !important;
  }
}
</style>
`;
        const injectedHtml = data.replace('<head>', '<head>' + mockScript);
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
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
