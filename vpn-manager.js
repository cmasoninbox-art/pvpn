// Per-country Tor exit manager. Spawns one Tor instance per country (non-root,
// user-owned DataDirectory) so premium users can pick a geo exit. Free tier uses
// the system Tor on 9050 (random slow exit). No sudo required.
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { SocksProxyAgent } = require('socks-proxy-agent');

const TOR_BIN = 'tor';
const BASE_PORT = 9100;            // country instances start here
const DATA_ROOT = path.join(__dirname, '.tor-exits');

const instances = {}; // code -> { port, proc, agent }
let torAvailable = null; // cached availability check

function checkTorAvailable() {
  if (torAvailable !== null) return torAvailable;
  try {
    execSync('which tor', { stdio: 'ignore' });
    torAvailable = true;
  } catch (_) {
    torAvailable = false;
  }
  return torAvailable;
}

function ensureCountry(code) {
  if (!checkTorAvailable()) {
    throw new Error('Tor binary not available on this system');
  }
  if (instances[code]) return instances[code];
  const port = BASE_PORT + Object.keys(instances).length;
  const dataDir = path.join(DATA_ROOT, code);
  fs.mkdirSync(dataDir, { recursive: true });
  const proc = spawn(TOR_BIN, [
    '--DataDirectory', dataDir,
    '--SocksPort', String(port),
    '--ExitNodes', `{${code}}`,
    '--CookieAuthentication', '0',
    '--RunAsDaemon', '0',
  ], { stdio: 'ignore' });
  const agent = new SocksProxyAgent(`socks5://127.0.0.1:${port}`);
  const rec = { port, proc, agent, ready: false };
  instances[code] = rec;
  // Tor takes a few seconds to bootstrap; mark ready on first successful use.
  return rec;
}

// Returns a SocksProxyAgent for the given country (premium). Lazily spawned.
function agentForCountry(code) {
  const rec = ensureCountry(code);
  return rec.agent;
}

// Persistent US-pinned Tor exit for the FREE tier: a free VPN, permanently America.
let freeUsRec = null;
function getFreeUs() {
  if (!checkTorAvailable()) {
    throw new Error('Tor binary not available on this system');
  }
  if (freeUsRec) return freeUsRec.agent;
  const port = BASE_PORT + 90;
  const dataDir = path.join(DATA_ROOT, 'free-us');
  fs.mkdirSync(dataDir, { recursive: true });
  const proc = spawn(TOR_BIN, [
    '--DataDirectory', dataDir,
    '--SocksPort', String(port),
    '--ExitNodes', '{us}',
    '--CookieAuthentication', '0',
    '--RunAsDaemon', '0',
  ], { stdio: 'ignore' });
  freeUsRec = { port, proc, agent: new SocksProxyAgent(`socks5://127.0.0.1:${port}`) };
  return freeUsRec.agent;
}

function shutdownAll() {
  Object.values(instances).forEach(i => { try { i.proc.kill(); } catch (_) {} });
  if (freeUsRec) { try { freeUsRec.proc.kill(); } catch (_) {} }
}

// Pre-spawn all country Tor instances so first premium request is instant.
function warmup(codes) {
  if (!checkTorAvailable()) return; // skip on systems without tor
  getFreeUs(); // FREE tier always uses a US-pinned exit
  (codes || []).forEach(c => { if (c && c !== 'us') ensureCountry(c); });
}

module.exports = { agentForCountry, getFreeUs, checkTorAvailable, warmup, shutdownAll, FREE_SOCKS: 'socks5://127.0.0.1:9050' };
