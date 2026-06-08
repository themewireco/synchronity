#!/usr/bin/env node
// Synchronity desktop bridge — a zero-dependency stdio <-> Streamable HTTP proxy.
// Forwards Claude Desktop's MCP stdio to the hosted Synchronity gateway (/mcp).
// Self-updates from the gateway on startup (best-effort).
const http = require('http');
const https = require('https');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const GATEWAY = (process.env.GATEWAY_URL || 'https://api.synchronity.app').replace(/\/$/, '');
let sid = null;

function get(urlStr) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'https:' ? https : http;
    lib.get(urlStr, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
    }).on('error', reject);
  });
}

async function checkUpdate() {
  try {
    const localManifestPath = path.join(__dirname, '..', 'manifest.json');
    let localVersion = '0.1.0';
    try {
      const m = JSON.parse(fs.readFileSync(localManifestPath, 'utf8'));
      localVersion = m.version || '0.1.0';
    } catch (e) {}

    const remoteManifestStr = await get(GATEWAY + '/setup/mcpb/manifest');
    const remoteManifest = JSON.parse(remoteManifestStr);
    const remoteVersion = remoteManifest.version;

    if (remoteVersion && remoteVersion !== localVersion) {
      const remoteServerJs = await get(GATEWAY + '/setup/mcpb/server.js');
      fs.writeFileSync(localManifestPath, JSON.stringify(remoteManifest, null, 2));
      fs.writeFileSync(__filename, remoteServerJs);
      process.stderr.write(`[Synchronity] Auto-updated from v${localVersion} to v${remoteVersion}.\n`);
      process.stderr.write(`[Synchronity] Restart Claude Desktop to apply the update.\n`);
    }
  } catch (err) {
    process.stderr.write(`[Synchronity] Update check failed: ${err.message}\n`);
  }
}

function post(body) {
  return new Promise((resolve, reject) => {
    const u = new URL(GATEWAY + '/mcp');
    const lib = u.protocol === 'https:' ? https : http;
    const d = JSON.stringify(body);
    const h = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Content-Length': Buffer.byteLength(d),
    };
    if (sid) h['Mcp-Session-Id'] = sid;
    const r = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname,
      method: 'POST',
      headers: h,
    }, (res) => {
      if (!sid && res.headers['mcp-session-id']) sid = res.headers['mcp-session-id'];
      const ct = res.headers['content-type'] || '';
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ ct, text: Buffer.concat(chunks).toString() }));
    });
    r.on('error', reject);
    r.write(d);
    r.end();
  });
}

function parse(ct, text) {
  if (ct.includes('text/event-stream'))
    return text.split('\n')
      .filter(l => l.startsWith('data: '))
      .map(l => { try { return JSON.parse(l.slice(6)); } catch { return null; } })
      .filter(Boolean);
  try { return [JSON.parse(text)]; } catch { return []; }
}

readline.createInterface({ input: process.stdin, terminal: false })
  .on('line', async (line) => {
    if (!line.trim()) return;
    try {
      const { ct, text } = await post(JSON.parse(line));
      parse(ct, text).forEach(m => process.stdout.write(JSON.stringify(m) + '\n'));
    } catch (e) { process.stderr.write('[Synchronity] ' + e.message + '\n'); }
  })
  .on('close', () => process.exit(0));

// Background self-update check
checkUpdate().catch(() => {});
