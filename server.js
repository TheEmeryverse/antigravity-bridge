const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Configure settings
const CONNECTION_MODE = process.env.AG_CONNECTION_MODE || 'ssh';
const SSH_HOST = process.env.AG_SSH_HOST || '127.0.0.1';
const SSH_USER = process.env.AG_SSH_USER || 'username';
const SSH_KEY_PATH = process.env.AG_SSH_KEY_PATH || path.join(process.env.HOME || '', '.ssh/id_ed25519_antigravity');
const CLI_PATH = process.env.AG_CLI_PATH || 'agy';

console.log('Antigravity Bridge Starting...');
console.log(`- Connection Mode: ${CONNECTION_MODE}`);
if (CONNECTION_MODE === 'ssh') {
  console.log(`- SSH Host: ${SSH_USER}@${SSH_HOST}`);
  console.log(`- SSH Key Path: ${SSH_KEY_PATH}`);
}
console.log(`- Remote/Local CLI Path: ${CLI_PATH}`);

// Verify SSH Key exists if in SSH mode
if (CONNECTION_MODE === 'ssh' && !fs.existsSync(SSH_KEY_PATH)) {
  console.warn(`[Warning] SSH Key not found at: ${SSH_KEY_PATH}. Remote connection will likely fail.`);
}

/**
 * Health check endpoint to verify remote connectivity or local CLI availability.
 */
app.get('/api/health', (req, res) => {
  if (CONNECTION_MODE === 'ssh') {
    // Run a quick ssh echo to verify credentials & network
    const sshArgs = [
      '-i', SSH_KEY_PATH,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=3',
      `${SSH_USER}@${SSH_HOST}`,
      'echo "OK"'
    ];
    
    const child = spawn('ssh', sshArgs);
    let output = '';
    
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });
    
    child.on('close', (code) => {
      if (code === 0 && output.trim() === 'OK') {
        res.json({ status: 'ok', message: 'SSH connection verified' });
      } else {
        res.status(500).json({ status: 'error', message: 'SSH connection failed', details: output.trim() });
      }
    });
  } else {
    // Local mode: verify if CLI exists
    if (fs.existsSync(CLI_PATH)) {
      res.json({ status: 'ok', message: 'Local agy CLI exists' });
    } else {
      res.status(500).json({ status: 'error', message: `Local agy CLI not found at ${CLI_PATH}` });
    }
  }
});

/**
 * SSE endpoint to stream responses from agy CLI.
 * Expects query params:
 * - prompt: The message/prompt to send
 * - conversationId: (Optional) ID of previous conversation
 * - continue: (Optional) "true" to continue the latest session
 */
app.get('/api/stream', (req, res) => {
  const { prompt, conversationId, continue: continueLatest } = req.query;
  
  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt parameter' });
  }

  // Setup Server-Sent Events headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Construct CLI arguments
  const args = ['--print'];
  if (conversationId) {
    args.push('--conversation', conversationId);
  } else if (continueLatest === 'true') {
    args.push('--continue');
  }

  let child;
  
  if (CONNECTION_MODE === 'ssh') {
    // SSH mode executes a Ruby JSON wrapper to safely invoke agy without command-injection vulnerability
    const rubyWrapper = `ruby -rjson -e 'c=JSON.parse(STDIN.read); exec("${CLI_PATH}", *(c["args"]+[c["prompt"]]))'`;
    const sshArgs = [
      '-i', SSH_KEY_PATH,
      '-o', 'StrictHostKeyChecking=no',
      `${SSH_USER}@${SSH_HOST}`,
      rubyWrapper
    ];
    
    child = spawn('ssh', sshArgs);
    
    // Write JSON payload to stdin of SSH connection
    const payload = JSON.stringify({ args, prompt });
    child.stdin.write(payload);
    child.stdin.end();
  } else {
    // Local mode: Execute directly
    child = spawn(CLI_PATH, [...args, prompt]);
  }

  // Handle process stdout stream
  child.stdout.on('data', (data) => {
    const text = data.toString();
    res.write(`data: ${JSON.stringify({ text })}\n\n`);
  });

  // Handle process stderr stream (errors / system prompts)
  child.stderr.on('data', (data) => {
    const errorText = data.toString();
    console.error(`agy stderr: ${errorText}`);
    // Only send non-debug lines to frontend if desired, or send as a system log event
    res.write(`event: system\ndata: ${JSON.stringify({ log: errorText })}\n\n`);
  });

  // Handle process closure
  child.on('close', (code) => {
    console.log(`agy process closed with code ${code}`);
    res.write('event: done\ndata: {}\n\n');
    res.end();
  });

  // Handle process error
  child.on('error', (err) => {
    console.error('Failed to start agy child process:', err);
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  });

  // If the client closes the connection, terminate the child process
  req.on('close', () => {
    console.log('Client disconnected, killing child process');
    child.kill();
  });
});

// Configuration config fetcher for frontend
app.get('/api/config', (req, res) => {
  res.json({
    host: CONNECTION_MODE === 'ssh' ? `${SSH_USER}@${SSH_HOST}` : 'localhost',
    cliPath: CLI_PATH,
    mode: CONNECTION_MODE
  });
});

// Serve frontend SPA for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start listening
app.listen(PORT, () => {
  console.log(`Antigravity Bridge is listening at http://localhost:${PORT}`);
});
