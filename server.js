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
</script>
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
