const express = require('express');
const exphbs = require('express-handlebars');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const { SocksProxyAgent } = require('socks-proxy-agent');
const vpnMgr = require('./vpn-manager');

// Load .env if present
try { require('dotenv').config(); } catch (_) {}

// Stripe
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-07-29.dahlia' });

const app = express();
app.use(express.json());


app.engine('handlebars', exphbs.engine({ defaultLayout: false }));
app.set('view engine', 'handlebars');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

const crypto = require('crypto');
const ADMIN_USER = process.env.ADMIN_USER || 'Smoke';
const ADMIN_PASS = process.env.ADMIN_PASS || 'aimadness';
const SESSION_SECRET = process.env.SESSION_SECRET || ('pvpn-admin-secret-' + (process.env.PORT || '3000'));
const cookie = require('cookie');


function getEmbedUrl(url) {
  try {
    if (url.includes('pornhub.com')) {
      const u = new URL(url);
      let videoId = null;
      
      if (u.pathname.includes('view_video.php')) {
        const params = new URLSearchParams(u.search);
        videoId = params.get('viewkey');
      } else if (u.pathname.startsWith('/video/')) {
        videoId = u.pathname.split('/')[2];
      }
      
      if (videoId) {
        return 'https://www.pornhub.com/embed/' + videoId;
      }
    }
    
    if (url.includes('youtube.com/watch')) {
      const u = new URL(url);
      const videoId = u.searchParams.get('v');
      if (videoId) {
        return 'https://www.youtube.com/embed/' + videoId;
      }
    }
    
    if (url.includes('vimeo.com/')) {
      const u = new URL(url);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length >= 1 && !u.pathname.includes('/videos')) {
        return 'https://player.vimeo.com/video/' + parts[0];
      }
    }
    
    return url;
  } catch (e) {
    return url;
  }
}

function sign(val) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(val).digest('base64url');
}
function makeSessionToken(user) {
  return user + '.' + sign(user);
}
function parseSession(req) {
  const raw = req.headers.cookie || '';
  const parsed = cookie.parse(raw);
  const token = parsed['admin_sess'];
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const user = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (sign(user) !== sig) return null;
  return user;
}
function isAdmin(req) {
  return parseSession(req) === ADMIN_USER;
}

app.post('/admin/login', express.json(), (req, res) => {
  const u = String(req.body && req.body.username || '');
  const p = String(req.body && req.body.password || '');
  if (u === ADMIN_USER && p === ADMIN_PASS) {
    res.set('Set-Cookie', cookie.serialize('admin_sess', makeSessionToken(ADMIN_USER), {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24
    }));
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: 'Invalid credentials' });
});

app.get('/admin/logout', (req, res) => {
  res.set('Set-Cookie', cookie.serialize('admin_sess', '', { path: '/', maxAge: 0 }));
  res.redirect('/');
});

// Gate admin panel on session
app.use('/admin/config', (req, res, next) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin login required' });
  next();
});

app.get('/admin', (req, res) => {
  if (!isAdmin(req)) return res.redirect('/admin-login');
  res.sendFile(path.join(__dirname, 'views', 'admin-panel.html'));
});

app.get('/admin-login', (req, res) => {
  res.send(`<!DOCTYPE html><html><head><title>Admin Login</title><style>body{background:#000;color:#ff7a00;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;}input,button{display:block;margin:8px 0;padding:10px;width:240px;border-radius:4px;border:1px solid #ff7a00;background:#111;color:#ff7a00;font-weight:700;}button{background:#ff7a00;color:#000;cursor:pointer;}</style></head><body><form id="f"><h2>ADMIN LOGIN</h2><input name="username" placeholder="Username" autocomplete="username"/><input name="password" type="password" placeholder="Password" autocomplete="current-password"/><button type="submit">Login</button><p id="msg"></p></form><script>document.getElementById('f').addEventListener('submit',async e=>{e.preventDefault();const fd=new FormData(e.target);const r=await fetch('/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:fd.get('username'),password:fd.get('password')})});if(r.ok){location.href='/admin';}else{const j=await r.json().catch(()=>({}));document.getElementById('msg').textContent=j.error||'Login failed';}});</script></body></html>`);
});

// ─── USER ACCOUNTS (real backend auth, no instant premium) ──────────
const USERS_PATH = path.join(__dirname, 'users.json');
let USERS = {}; // username(lowercased) -> { username, email, salt, hash, premium, premiumTier, premiumExpires, createdAt }
function loadUsers() { try { USERS = JSON.parse(fs.readFileSync(USERS_PATH, 'utf8')); } catch (_) { USERS = {}; } }
function saveUsers() { try { fs.writeFileSync(USERS_PATH, JSON.stringify(USERS, null, 2)); } catch (_) {} }
function publicUser(u) { return { username: u.username, email: u.email, premium: !!u.premium, premiumTier: u.premiumTier, premiumExpires: u.premiumExpires }; }
function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 64).toString('hex'); }
function makeUserToken(username) { return username + '.' + sign(username); }
function parseUser(req) {
  const parsed = cookie.parse(req.headers.cookie || '');
  const token = parsed['pvpn_sess'];
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const user = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (sign(user) !== sig) return null;
  return USERS[String(user).toLowerCase()] || null;
}
function setUserCookie(res, username) {
  res.set('Set-Cookie', cookie.serialize('pvpn_sess', makeUserToken(username), {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30
  }));
}
loadUsers();

const ADMIN_GRANTED_PREMIUM_USERS = new Set(['smokeai']);
function applyAdminPremiumGrant(user) {
  if (!user || !ADMIN_GRANTED_PREMIUM_USERS.has(String(user.username || '').toLowerCase())) return false;
  user.premium = true;
  user.premiumTier = 'Admin Grant';
  user.premiumExpires = null;
  return true;
}
let restoredPremiumGrant = false;
for (const user of Object.values(USERS)) {
  if (applyAdminPremiumGrant(user)) restoredPremiumGrant = true;
}
if (restoredPremiumGrant) saveUsers();

// Admin-only user entitlement control.
app.get('/admin/user-access', (req, res) => {
  if (!isAdmin(req)) return res.redirect('/admin-login');
  res.send(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>User Premium Access</title><style>
  body{margin:0;background:#050505;color:#fff;font-family:Arial,sans-serif;min-height:100vh;display:grid;place-items:center}
  .card{width:min(420px,calc(100% - 32px));box-sizing:border-box;padding:28px;border:1px solid #333;border-radius:16px;background:#151515}
  h1{margin:0 0 8px;font-size:24px}p{color:#aaa;margin:0 0 18px}label{display:block;margin-bottom:7px;color:#ff9000;font-weight:800}
  input{box-sizing:border-box;width:100%;height:46px;padding:0 13px;border:1px solid #444;border-radius:10px;background:#090909;color:#fff;font-size:16px}
  button{width:100%;height:46px;margin-top:12px;border:0;border-radius:10px;background:#ff9000;color:#050505;font-weight:900;cursor:pointer}
  a{display:block;margin-top:16px;color:#ff9000;text-align:center}</style></head><body><form class="card" method="post" action="/admin/user-access">
  <h1>Premium Account Access</h1><p>Grant permanent premium access to an existing user.</p>
  <label for="username">Username</label><input id="username" name="username" autocomplete="off" required>
  <button type="submit">Grant Premium</button><a href="/admin">Back to Admin</a></form></body></html>`);
});

app.post('/admin/user-access', express.urlencoded({ extended: false }), (req, res) => {
  if (!isAdmin(req)) return res.status(401).send('Admin login required');
  const key = String(req.body.username || '').trim().toLowerCase();
  const user = USERS[key];
  if (!user) return res.status(404).send(`<!DOCTYPE html><html><body style="background:#050505;color:#fff;font-family:Arial;padding:30px"><h1>User not found</h1><p>No account exists for <b>${key.replace(/[<>&"']/g, '')}</b>.</p><a style="color:#ff9000" href="/admin/user-access">Try again</a></body></html>`);
  user.premium = true;
  user.premiumTier = 'Admin Grant';
  user.premiumExpires = null;
  saveUsers();
  res.send(`<!DOCTYPE html><html><body style="background:#050505;color:#fff;font-family:Arial;padding:30px"><h1 style="color:#ff9000">Premium granted</h1><p><b>${user.username}</b> now has permanent premium access.</p><a style="color:#ff9000" href="/admin/user-access">Manage another user</a></body></html>`);
});

app.post('/api/register', express.json(), (req, res) => {
  const username = String(req.body.username || '').trim();
  const email = String(req.body.email || '').trim();
  const password = String(req.body.password || '');
  if (username.length < 3) return res.status(400).json({ ok: false, error: 'Username must be at least 3 characters' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ ok: false, error: 'Valid email required' });
  if (password.length < 6) return res.status(400).json({ ok: false, error: 'Password must be at least 6 characters' });
  const key = username.toLowerCase();
  if (USERS[key]) return res.status(409).json({ ok: false, error: 'Username already taken' });
  const salt = crypto.randomBytes(16).toString('hex');
  USERS[key] = { username, email, salt, hash: hashPassword(password, salt), premium: ADMIN_GRANTED_PREMIUM_USERS.has(key), premiumTier: ADMIN_GRANTED_PREMIUM_USERS.has(key) ? 'Admin Grant' : null, premiumExpires: null, createdAt: Date.now() };
  saveUsers();
  setUserCookie(res, username);
  res.json({ ok: true, user: publicUser(USERS[key]) });
});

app.post('/api/login', express.json(), (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');

  // Admin credentials also work in the normal website login. The admin
  // session is recognized by /api/me, /api/user-tier and every premium gate.
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    res.set('Set-Cookie', cookie.serialize('admin_sess', makeSessionToken(ADMIN_USER), {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24
    }));
    return res.json({ ok: true, user: {
      username: ADMIN_USER,
      email: '',
      premium: true,
      premiumTier: 'admin',
      premiumExpires: null,
      admin: true
    }});
  }

  const key = username.toLowerCase();
  const u = USERS[key];
  if (!u || u.hash !== hashPassword(password, u.salt)) return res.status(401).json({ ok: false, error: 'Invalid username or password' });
  if (applyAdminPremiumGrant(u)) saveUsers();
  setUserCookie(res, u.username);
  res.json({ ok: true, user: publicUser(u) });
});

app.post('/api/logout', (req, res) => {
  res.set('Set-Cookie', [
    cookie.serialize('pvpn_sess', '', { path: '/', maxAge: 0 }),
    cookie.serialize('admin_sess', '', { path: '/', maxAge: 0 })
  ]);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (isAdmin(req)) {
    return res.json({ ok: true, user: {
      username: ADMIN_USER,
      email: '',
      premium: true,
      premiumTier: 'admin',
      premiumExpires: null,
      admin: true
    }});
  }
  const u = parseUser(req);
  res.json({ ok: true, user: u ? publicUser(u) : null });
});

// Browser-extension helper endpoint. Returns the caller's tier so the
// extension background worker can decide whether to enable frame-bust
// header stripping. Defaults to 'free' (rules enabled) when logged out
// or premium status is unknown — fail-open so free users always work.
app.get('/api/user-tier', (req, res) => {
  const admin = isAdmin(req);
  const u = parseUser(req);
  const premium = admin || !!(u && u.premium);
  res.json({
    ok: true,
    tier: admin ? 'admin' : (premium ? 'premium' : 'free'),
    premium,
    admin,
    premiumTier: admin ? 'admin' : (u && u.premiumTier ? u.premiumTier : null),
    premiumExpires: admin ? null : (u && u.premiumExpires ? u.premiumExpires : null)
  });
});

const COUNTRIES = [
  { code: 'us', name: 'United States', flag: '🇺🇸' },
  { code: 'uk', name: 'United Kingdom', flag: '🇬🇧' },
  { code: 'de', name: 'Germany', flag: '🇩🇪' },
  { code: 'fr', name: 'France', flag: '🇫🇷' },
  { code: 'jp', name: 'Japan', flag: '🇯🇵' },
  { code: 'ca', name: 'Canada', flag: '🇨🇦' },
  { code: 'au', name: 'Australia', flag: '🇦🇺' },
  { code: 'nl', name: 'Netherlands', flag: '🇳🇱' },
  { code: 'ch', name: 'Switzerland', flag: '🇨🇭' },
  { code: 'se', name: 'Sweden', flag: '🇸🇪' },
];

// Pre-spawn per-country Tor exits (premium geo VPN) + the US exit (free tier's permanent America VPN).
try { vpnMgr.warmup(['us', ...COUNTRIES.map(c => c.code)]); } catch (_) {}

const AD_SLOTS = {
  top: '<a href="/donate" rel="noopener"><img class="top-banner" src="/images/bannerpvpn.png" alt="Support PVPN" /></a>',
  left: `<a class="house-ad house-ad-side" href="/premium" aria-label="Advertisement: Upgrade to PVPN Premium"><span class="house-ad-kicker">Advertisement</span><span class="house-ad-icon">👑</span><strong>Premium Palace</strong><span>Unlock every PVPN feature</span><b>Upgrade now →</b></a>`,
  right: `<a class="house-ad house-ad-side" href="/shop" aria-label="Advertisement: Visit the PVPN shop"><span class="house-ad-kicker">Advertisement</span><span class="house-ad-icon">🧦</span><strong>PVPN Shop</strong><span>Plans, passes and gear</span><b>Shop now →</b></a>`,
  bottom: `<a class="house-ad house-ad-bottom" href="/donate" aria-label="Advertisement: Support PVPN"><span class="house-ad-kicker">Advertisement</span><span class="house-ad-icon">🧡</span><span><strong>Keep PVPN running</strong><small>Support hosting, privacy tools and new features.</small></span><b>Support PVPN →</b></a>`,
};

app.get('/', (req, res) => {
  if (APP_CONFIG.maintenanceMode) {
    return res.send(`<!DOCTYPE html><html><head><title>Maintenance</title>` +
      `<style>body{background:#000;color:#ff7a00;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;}</style>` +
      `</head><body><h1>UNDER MAINTENANCE</h1><p>The VPN browser will be back shortly.</p></body></html>`);
  }
  res.render('index', {
    countries: COUNTRIES,
    ads: AD_SLOTS,
    adButtons: APP_CONFIG.adButtons,
    adButtonsJson: JSON.stringify(APP_CONFIG.adButtons),
    theme: APP_CONFIG.theme,
    bannerImage: APP_CONFIG.bannerImage,
    paidAds: (APP_CONFIG.ads || []).filter(a => a && a.paid && a.url && !/^https?:\/\/(?:www\.)?example\.com/i.test(String(a.url))),
    siteTitle: APP_CONFIG.siteTitle,
  });
});

const proxyLog = [];
async function proxyHandler(req, res) {
  const target = req.query.url;
  if (!target) return res.status(400).send('Missing url');
  if (APP_CONFIG.maintenanceMode) return res.status(503).send('Site under maintenance');
  // country + premium are client-reported (local owned-gear trust model)
  const country = (req.query.country || (APP_CONFIG.defaultCountry || 'us')).toLowerCase();
  const isPremium = req.query.premium === '1';
  try {
    const url = target.startsWith('http') ? target : 'https://' + target;
    // Blocklist enforcement (admin-managed forbidden domains)
    if (Array.isArray(APP_CONFIG.blocklist) && APP_CONFIG.blocklist.length) {
      let host = '';
      try { host = new URL(url).hostname; } catch (_) {}
      const blocked = APP_CONFIG.blocklist.some(b => {
        const d = String(b || '').toLowerCase().trim();
        if (!d) return false;
        return host === d || host.endsWith('.' + d);
      });
      if (blocked) return res.status(403).send('Blocked by administrator: ' + host);
    }
    if (APP_CONFIG.proxyLogEnabled) {
      proxyLog.unshift({ t: Date.now(), url, country, premium: isPremium });
      if (proxyLog.length > 200) proxyLog.pop();
    }
    // Track URL clicks for forum hottest/polls
    trackUrlClick(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const useTor = (APP_CONFIG.vpnMode === 'builtin');
    const useCustom = (APP_CONFIG.vpnMode === 'custom') && APP_CONFIG.localProxy;
    let agent;
    if (useCustom) {
      // Custom SOCKS/HTTP proxy (user-supplied egress — paid proxy / real VPN client)
      const lp = APP_CONFIG.localProxy.trim();
      agent = (/^https?:/i.test(lp)) ? new HttpsProxyAgent(lp) : new SocksProxyAgent(lp);
    } else if (useTor) {
      try {
        if (isPremium && country && country !== 'us') {
          agent = vpnMgr.agentForCountry(country);   // premium: chosen geo exit
        } else {
          agent = vpnMgr.getFreeAgent(); // free + premium-US: fast Tailscale lane (or US-pinned Tor)
        }
      } catch (torErr) {
        // Tor binary not available (e.g. Render free container) — degrade gracefully
        // to the server's real egress instead of erroring out.
        console.warn('[proxy] Tor unavailable, falling back to direct egress:', torErr.message);
        agent = undefined;
      }
    } else {
      // vpnMode 'direct' (or unknown): use the server's real egress (no proxy).
      // Sites like Pornhub block Tor/VPN exits but allow residential/ISP IPs.
      agent = undefined;
    }
    // Tor-specific fallback: if a Tor exit gets blocked (403/block page), retry once
    // on the direct egress so sites that ban Tor still load for the visitor.
    const tryDirectFallback = (useTor && !isPremium);

    const response = await fetch(url, {
      method: req.method === 'POST' ? 'POST' : 'GET',
      body: req.method === 'POST' ? new URLSearchParams(req.body || {}).toString() : undefined,
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        ...(req.method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      redirect: 'manual',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // Handle upstream redirects for sub-resource proxy: rewrite to /proxy?url=...
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (loc) {
        try {
          const redirectUrl = new URL(loc, url).href;
          res.redirect(302, '/proxy?url=' + encodeURIComponent(redirectUrl));
          return;
        } catch (_) { /* fall through */ }
      }
    }

    const contentType = response.headers.get('content-type') || 'text/html';
    // Preserve binary assets exactly; decoding images or media as UTF-8 corrupts them.
    const body = contentType.includes('text/html')
      ? await response.text()
      : Buffer.from(await response.arrayBuffer());

    // Forward upstream headers to our response, then strip blocking headers
    // This ensures X-Frame-Options, CSP, and stale content-length are removed
    response.headers.forEach((value, name) => {
      const lower = name.toLowerCase();
      if (lower !== 'content-type' && lower !== 'transfer-encoding'
          && lower !== 'content-security-policy'
          && lower !== 'x-content-security-policy'
          && lower !== 'x-webkit-csp'
          && lower !== 'x-frame-options'
          && lower !== 'x-content-type-options'
          && lower !== 'content-length'
          && lower !== 'content-encoding') {
        res.setHeader(name, value);
      }
    });
    // Strip headers that would block iframe embedding
    res.removeHeader('x-frame-options');
    res.removeHeader('x-content-type-options');
    res.removeHeader('x-webkit-csp');
    res.removeHeader('x-content-security-policy');
    res.removeHeader('content-security-policy');
    res.removeHeader('content-length');
    res.removeHeader('content-encoding');
    if (contentType.includes('text/html')) {
      const base = new URL(url);
      const proxyBase = '/proxy?url=' + encodeURIComponent(base.origin + '/');
      // Protect inline JavaScript while rewriting HTML tags and attributes.
      const protectedScriptBodies = [];
      const scriptSafeBody = body.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (m, open, code, close) => {
        if (code && code.includes('hotlinkerredirects')) return '';
        if (!code) return m;
        const index = protectedScriptBodies.push(code) - 1;
        return open + '/*__PVPN_SCRIPT_BODY_' + index + '__*/' + close;
      });
      let rewritten = scriptSafeBody
        .replace(/<head([^>]*)>/i, `<head$1>`)
        .replace(/\shref=(["'])([^"'>]+)\1/gi, (match, q, urlVal) => {
          if (!urlVal || urlVal.startsWith('#') || urlVal.startsWith('javascript:') || urlVal.startsWith('data:') || urlVal.startsWith('/proxy?url=')) return match;
          const abs = new URL(urlVal, base);
          return ` href=${q}/proxy?url=${encodeURIComponent(abs.href)}${q}`;
        })
        .replace(/\ssrc=(["'])([^"'>]+)\1/gi, (match, q, urlVal) => {
          if (!urlVal || urlVal.startsWith('data:') || urlVal.startsWith('javascript:') || urlVal.startsWith('/proxy?url=')) return match;
          const abs = new URL(urlVal, base);
          return ` src=${q}/proxy?url=${encodeURIComponent(abs.href)}${q}`;
        })
        .replace(/\saction=(["'])([^"'>]+)\1/gi, (match, q, urlVal) => {
          if (!urlVal || urlVal.startsWith('javascript:') || urlVal.startsWith('/proxy?url=')) return match;
          const abs = new URL(urlVal, base);
          return ` action=${q}/proxy?url=${encodeURIComponent(abs.href)}${q}`;
        })
        .replace(/<form([^>]*)>/gi, (match, attrs) => {
          if (attrs.includes('method="post"') || /method\s*=\s*['"]post['"]/i.test(attrs)) {
            return `<form${attrs} onsubmit="event.preventDefault(); var f=this; var x=new XMLHttpRequest(); x.open('POST', f.action || location.href, true); x.setRequestHeader('Content-Type','application/x-www-form-urlencoded'); x.send(new URLSearchParams(new FormData(f)).toString());">`;
          }
          return match;
        })
        // Strip meta-refresh redirects that point at the real (un-proxied) domain so the
        // framed page can't bounce itself out of the iframe via HTML refresh.
        .replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, (m) => {
          if (/https?:\/\//i.test(m) && !m.includes('/proxy?url=')) return ''; // drop external refreshes
          return m;
        })
        // Inject <base> LAST so the href/src rewrites above don't double-process it.
        // Point it at our proxy so relative sub-resources resolve through us (not the real domain).
        .replace(/<head([^>]*)>/i, `<head$1><base href="${proxyBase}" target="_self"><meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-ancestors *; upgrade-insecure-requests; script-src * 'unsafe-inline' 'unsafe-eval' blob: data:; style-src * 'unsafe-inline' blob: data:; img-src * data: blob:; media-src * data: blob:; connect-src * data: blob:; font-src * data: blob:;">`);

      // Strip meta-X-Frame-Options and CSP from HTML (Pornhub injects via <meta> tags)
      rewritten = rewritten.replace(/<meta\s+http-equiv=["']X-Frame-Options["'][^>]*>/gi, '');
      rewritten = rewritten.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

      // Some upstream age-gate labels are populated by scripts that may fail after proxy rewriting.
      // Restore text and accessible names only when those known choice buttons are empty.
      rewritten = rewritten.replace(/<button\b([^>]*\bbuttonOver18\b[^>]*)>\s*<\/button>/gi, (m, attrs) => {
        const aria = /\baria-label\s*=/i.test(attrs) ? '' : ' aria-label="I am 18 or older"';
        return `<button${attrs}${aria}>I am 18 or older</button>`;
      });
      rewritten = rewritten.replace(/<button\b([^>]*\bbuttonUnder18\b[^>]*)>\s*<\/button>/gi, (m, attrs) => {
        const aria = /\baria-label\s*=/i.test(attrs) ? '' : ' aria-label="I am under 18"';
        return `<button${attrs}${aria}>I am under 18</button>`;
      });

      // Strip Pornhub's hotlinker frame-bust script. The hotlinkerredirects
      // code is in a specific <script> block — match only that block, not all
      // content from the first <script> to the hotlinker block (old regex
      // consumed 998KB by greedily crossing script boundaries).
      rewritten = rewritten.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (m, code) => {
        if (code && code.includes('hotlinkerredirects')) return '';
        return m;
      });

      // Inject media-enforcement: cap video resolution to the enforced quality,
      // force playback rate and subtitle mode on every <video>, even ones created later.
      const sessionUser = parseUser(req);
      const premiumAccess = isAdmin(req) || !!(sessionUser && sessionUser.premium) || req.query.premium === '1';
      const settings = { ...getMediaSettings(req) };
      if (!premiumAccess) settings.quality = '480';
      const enforcement = `
<script>
(function(){
  // Disable right-click inside the proxied browser content too
  document.addEventListener('contextmenu', function(e){ e.preventDefault(); return false; });
  var ENF = ${JSON.stringify(settings)};
  var FREE_TIER = ${premiumAccess ? 'false' : 'true'};
  function applyVideo(v){
    if(!v) return;
    try {
      v.playbackRate = parseFloat(ENF.speed) || 1;
    } catch(e){}
    try {
      var tracks = v.textTracks;
      if(tracks){ for(var i=0;i<tracks.length;i++){ tracks[i].mode = (ENF.subtitles==='on')?'showing':'hidden'; } }
    } catch(e){}
    if(ENF.quality && ENF.quality!=='auto'){
      var h = parseInt(ENF.quality,10);
      try {
        // Cap displayed height to the enforced quality (true source res is site-controlled,
        // but visual playback is downscaled to the premium tier).
        v.style.maxHeight = h + 'px';
        v.setAttribute('data-enforced-quality', ENF.quality);
      } catch(e){}
    }
  }
  function enforceSiteQuality(){
    if(!FREE_TIER) return;
    try {
      var style = document.getElementById('pvpn-free-quality-lock');
      if(!style){
        style = document.createElement('style');
        style.id = 'pvpn-free-quality-lock';
        style.textContent = '.mgp_btn-quality,.mgp_quality-btn,.mgp_qualityDiv,.mgp_streamingQuality{display:none!important;visibility:hidden!important;pointer-events:none!important}';
        (document.head || document.documentElement).appendChild(style);
      }
      var options = document.querySelectorAll('.mgp_settings-menu-quality-item');
      var target = null;
      var selected = null;
      for(var q=0;q<options.length;q++){
        if(options[q].classList.contains('mgp_selected-row')) selected = options[q];
        if(/\b480p?\b/i.test(options[q].textContent || '')) target = options[q];
      }
    } catch(e){}
  }
  function applyAll(){ var vs=document.querySelectorAll('video'); for(var i=0;i<vs.length;i++){ applyVideo(vs[i]); } enforceSiteQuality(); }
  // Hook creation so dynamically added videos are also enforced.
  try {
    var orig = document.createElement;
    document.createElement = function(tag){
      var el = orig.apply(document, arguments);
      if(String(tag).toLowerCase()==='video'){
        setTimeout(function(){ applyVideo(el); }, 0);
        el.addEventListener('loadedmetadata', function(){ applyVideo(el); });
        el.addEventListener('canplay', function(){ applyVideo(el); });
      }
      return el;
    };
  } catch(e){}
  document.addEventListener('DOMContentLoaded', applyAll);
  window.addEventListener('load', applyAll);
  var obs = new MutationObserver(function(muts){ muts.forEach(function(m){ m.addedNodes.forEach(function(n){ if(n&&n.tagName==='VIDEO') applyVideo(n); }); }); });
  try { obs.observe(document.documentElement, {childList:true, subtree:true}); } catch(e){}
  applyAll();
})();
</script>
`;
      const proxyWrap = (raw) => {
        let u;
        try { u = new URL(raw); }
        catch (_) {
          try { u = new URL(decodeURIComponent(raw)); }
          catch (e2) {
            // Protocol-relative (//host/...) or still-unparseable: try with https: prepended.
            try { u = new URL('https:' + (raw.startsWith('//') ? raw : '//' + raw)); }
            catch (e3) { return raw; }
          }
        }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return raw;
        if (u.host === req.headers.host) return raw; // already our proxy
        return '/proxy?url=' + encodeURIComponent(u.href);
      };
      // Eagerly load deferred thumbnails so visible cards do not require a hover.
      rewritten = rewritten.replace(/<img\b[^>]*>/gi, (tag) => {
        const deferred = tag.match(/\s(data-src|data-thumb_url|data-original|data-image)=(["'])([^"']+)\2/i);
        if (!deferred) return tag;
        let raw = deferred[3];
        try { raw = new URL(raw, base.href).href; } catch (_) {}
        const eager = proxyWrap(raw.startsWith('//') ? 'https:' + raw : raw);
        tag = tag.replace(deferred[0], ' ' + deferred[1] + '=' + deferred[2] + eager + deferred[2]);
        const current = tag.match(/\ssrc=(["'])([^"']*)\1/i);
        if (!current) {
          tag = tag.replace(/<img\b/i, '<img src="' + eager + '"');
        } else if (!current[2] || current[2].startsWith('data:image/')) {
          tag = tag.replace(current[0], ' src=' + current[1] + eager + current[1]);
        }
        tag = tag.replace(/\sloading=(["'])lazy\1/i, ' loading="eager"');
        return tag;
      });
      // Firefox can indefinitely defer lazy images inside the embedded proxy frame.
      rewritten = rewritten.replace(/(<img\b[^>]*?)\sloading=(["'])lazy\2/gi, '$1 loading="eager"');
      // Second pass: catch escaped-slash AND url-encoded URLs (Pornhub double-encodes
      // host refs as %2F%2Fwww.pornhub.com / https%3A%2F%2F...) that sit anywhere in the
      // document. These still leak the real domain once the browser decodes them.
      // Generic: target the proxied site's OWN host stem (e.g. "pornhub" -> matches
      // pornhub.com, www.pornhub.com, pornhubpremium.com, de.pornhub.com, ...) in literal,
      // escaped (\/), or url-encoded (%2F%2F / https%3A%2F%2F) forms — anywhere in the doc.
      // Stops framed sites from loading their real domain (which serves X-Frame-Options).
      const hostParts = base.host.split('.');
      // stem = first label (e.g. "www" -> "pornhub" from "www.pornhub.com")
      const stem = hostParts.length > 1 ? hostParts[hostParts.length - 2] : hostParts[0];
      const hostRe = ('(?:[a-z0-9-]+\\.)*' + stem + '[a-z0-9-]*\\.com');
      // NOTE: do NOT include the https%3a%2f%2f (percent-encoded) form in the prefix, and
      // use a negative lookbehind so we never match a host ref that is ALREADY inside a
      // /proxy?url= wrapper (e.g. the %2F%2F inside <base href="/proxy?url=https%3A%2F%2F...">).
      // Re-wrapping those double-encodes the URL and breaks every sub-resource load.
      const escRe = new RegExp('(?<!(%3A|\\/proxy\\?url=))(?:https?:\\/\\/|\\\\*\\/+|%2f%2f)' + hostRe + '[^\\s"\'`<>]*', 'gi');
      rewritten = rewritten.replace(escRe, (tok) => {
        const norm = tok.replace(/^\\+/, '').replace(/^%2f%2f/i, '//').replace(/^https?%3a%2f%2f/i, 'https://').replace(/^\/+/, '//');
        const u = norm.startsWith('//') ? 'https:' + norm : norm;
        return proxyWrap(u);
      });
      // Neutralize runtime URL builders that reconstruct the real domain (e.g. the
      // language selector builds 'https://<cc>.' + data-root). Point data-root at our
      // own host so any constructed URL stays same-origin (and gets blocked if foreign).
      rewritten = rewritten.replace(/(data-root=["'])[^"']*(["'])/gi, (mm, p1, p2) => {
        return p1 + (req.headers.host || 'localhost') + p2;
      });
      // Restore the exact original inline scripts after HTML-only rewriting.
      rewritten = rewritten.replace(/\/\*__PVPN_SCRIPT_BODY_(\d+)__\*\//g, (m, index) => {
        return protectedScriptBodies[Number(index)] || '';
      });
      // Free accounts receive only 480p-or-lower streams. This runs after
      // restoring the site's inline player configuration and before it executes.
      if (!premiumAccess) {
        rewritten = rewritten.replace(/var\s+(flashvars_\d+)\s*=\s*(\{[^\r\n]*\});/g, (match, name, json) => {
          try {
            const config = JSON.parse(json);
            if (!Array.isArray(config.mediaDefinitions)) return match;
            const allowed = config.mediaDefinitions.filter((definition) => {
              const height = Number(definition && (definition.height || definition.quality));
              return Number.isFinite(height) && height > 0 && height <= 480;
            });
            if (!allowed.length) return match;
            const preferred = allowed.find((definition) =>
              Number(definition && (definition.height || definition.quality)) === 480
            ) || allowed[allowed.length - 1];
            allowed.forEach((definition) => { definition.defaultQuality = definition === preferred; });
            config.mediaDefinitions = allowed;
            config.defaultQuality = [480, 240].filter((height) =>
              allowed.some((definition) => Number(definition && (definition.height || definition.quality)) === height)
            );
            return 'var ' + name + ' = ' + JSON.stringify(config) + ';';
          } catch (_) {
            return match;
          }
        });
      }
      // CSP: everything flows through our origin so framed sites can't load the real domain
      // (which would serve X-Frame-Options: DENY and break framing). Sandbox already allows
      // scripts/forms/same-origin/popups.
      const csp = [
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:",
        "img-src 'self' data: blob: *",
        "media-src 'self' data: blob: *",
        "connect-src 'self' *",
        "base-uri 'self'",
      ].join('; ');
      res.set('Content-Type', 'text/html');
      // Use permissive CSP — scripts/styles/media load from the proxied domain.
      // The injected <meta> CSP handles frame-busting protection inside the page.
      const permissiveCsp = "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data: blob:; media-src * data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' blob: data:; style-src * 'unsafe-inline' blob: data:; connect-src * data: blob:; font-src * data: blob:; frame-ancestors *;";
      res.set('Content-Security-Policy', permissiveCsp);
      // Strip upstream X-Frame-Options and X-Content-Type-Options that block iframe embedding
      res.removeHeader('x-frame-options');
      res.removeHeader('x-content-type-options');
      // CSP: form-action + frame-src block navigation to foreign origins.
      // frame-ancestors prevents others framing us. Removed navigate-to (IE-only, unsupported).
      res.set('Content-Security-Policy',
        "form-action 'self'; frame-src 'self';");
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.set('Access-Control-Allow-Origin', '*');
      res.send(rewritten + enforcement);
      return;
    }
    res.set('Content-Type', contentType);
    // Strip upstream X-Frame-Options for all proxied responses
    res.removeHeader('x-frame-options');
    res.removeHeader('x-content-type-options');
    // CSP: form-action + frame-src block navigation to foreign origins.
    // removed navigate-to (IE-only, unsupported)
    // Permissive CSP: allow proxied content scripts/styles/media from all origins.
    // Frame-busting is handled by injected anti-bust JS in the HTML body.
    res.set('Content-Security-Policy',
      "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data: blob:; media-src * data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' blob: data:; style-src * 'unsafe-inline' blob: data:; connect-src * data: blob:; font-src * data: blob:; frame-ancestors *; ");
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Access-Control-Allow-Origin', '*');
    res.send(body);
  } catch (e) {
    res.status(502).send(`Proxy error: ${e.message}`);
  }
}

app.get('/proxy', proxyHandler);
app.post('/proxy', express.urlencoded({ extended: true }), express.json(), (req, res) => proxyHandler(req, res));

// ─── FULL-PAGE PROXY (hide.me style) ────────────────────────────────
// Serves the proxied page directly — no iframe, no CSP jail, no anti-bust JS.
// All links/resources are rewritten to /go?url=... so the user browses entirely
// through the proxy, just like hide.me/en/proxy.
// Supports: Tor/VPN egress, quality enforcement (resolution/speed/subtitles),
// premium tier checks, and the same sophisticated URL rewriting as /proxy.
const fullPageProxyHandler = async (req, res) => {
  try {
    let url = (req.query.url || '').trim();
    if (!url) return res.status(400).send('Missing ?url=');
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const targetHost = new URL(url).host;
    const isPremium = !!(req.query.premium && req.query.premium !== '0');
    const country = (req.query.country || '').toLowerCase();

    // Blocklist check
    if (APP_CONFIG.blocklist && APP_CONFIG.blocklist.length) {
      const host = targetHost.toLowerCase();
      const blocked = APP_CONFIG.blocklist.some(b => {
        const d = String(b || '').toLowerCase().trim();
        if (!d) return false;
        return host === d || host.endsWith('.' + d);
      });
      if (blocked) return res.status(403).send('Blocked by administrator: ' + host);
    }

    // ── Egress: Tor / custom proxy / direct ──────────────────────
    const useTor = (APP_CONFIG.vpnMode === 'builtin');
    const useCustom = (APP_CONFIG.vpnMode === 'custom') && APP_CONFIG.localProxy;
    let agent;
    if (useCustom) {
      const lp = APP_CONFIG.localProxy.trim();
      agent = (/^https?:/i.test(lp)) ? new (require('https-proxy-agent').HttpsProxyAgent)(lp) : new SocksProxyAgent(lp);
    } else if (useTor) {
      try {
        if (isPremium && country && country !== 'us') {
          agent = vpnMgr.agentForCountry(country);
        } else {
          agent = vpnMgr.getFreeAgent();
        }
      } catch (torErr) {
        console.warn('[go] Tor unavailable, falling back to direct egress:', torErr.message);
        agent = undefined;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(url, {
      method: req.method === 'POST' ? 'POST' : 'GET',
      body: req.method === 'POST' ? new URLSearchParams(req.body || {}).toString() : undefined,
      agent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        ...(req.method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      redirect: 'manual',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // ── Handle upstream redirects: rewrite Location to /go?url=... ──
    // Pornhub 302s to /upgrade (paywall) or affiliate paths. Intercept and
    // re-route through /go so the iframe never loads the real domain raw.
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (loc) {
        try {
          const redirectUrl = new URL(loc, url).href;
          const qs = new URLSearchParams({
            url: redirectUrl,
            country: country,
            premium: isPremium ? '1' : '0',
          });
          if (req.query.embedded === '1') qs.set('embedded', '1');
          res.redirect(302, '/go?' + qs.toString());
          return;
        } catch (_) { /* fall through */ }
      }
    }

    const contentType = response.headers.get('content-type') || 'text/html';

    // Strip upstream headers that block iframe embedding
    response.headers.delete('x-frame-options');
    response.headers.delete('content-security-policy');
    response.headers.delete('x-content-security-policy');
    response.headers.delete('x-webkit-csp');

    // Forward Set-Cookie from upstream, scoped to our /go path
    // Forward Set-Cookie from upstream — rewrite domain to OUR host so the
    // browser doesn't try to connect to the real domain (which causes
    // "refused to connect" when the iframe can't reach pornhub.com).
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
      const ourHost = req.headers.host || 'pvpn.onrender.com';
      cookies.forEach(c => {
        // Rewrite Path and Domain so cookies stay on our origin
        // Use replaceAll via regex /g flag — node-fetch merges all Set-Cookie
        // headers into one comma-separated string, so multiple Domain= attrs exist.
        let rewritten = c
          .replace(/;\s*Path=[^;,]+/gi, '; Path=/go')
          .replace(/;\s*[Dd]omain=[^;,]+/gi, '; Domain=' + ourHost)
          // Remove Secure flag if we're not on HTTPS (Render is, but just in case)
          .replace(/;\s*[Ss]ecure/gi, '');
        // If no Domain= was present, add one
        if (!/[Dd]omain=/i.test(rewritten)) {
          rewritten += '; Domain=' + ourHost;
        }
        res.append('Set-Cookie', rewritten);
      });
    }

    if (contentType.includes('text/html')) {
      const base = new URL(url);
      const proxyBase = '/go?url=' + encodeURIComponent(base.origin + '/');
      let body = await response.text();

      // ── Captcha/bot-challenge fallback ─────────────────────────
      // If the proxied response looks like a bot-challenge page (captcha,
      // "enable javascript", reCAPTCHA, turnstile) AND we used a custom/Tor
      // agent, retry once with direct egress (no proxy) since sites like
      // Pornhub flag known Tor/proxy exit IPs.
      const looksLikeChallenge = body.length < 50000 && /enable\s*javascript|recaptcha\.|turnstile.*render|just\s*checking|security\s*check|bot.*detected|access.*denied/i.test(body);
      if (looksLikeChallenge && agent && !req.query._retried) {
        try {
          const retryController = new AbortController();
          const retryTimeout = setTimeout(() => retryController.abort(), 20000);
          const retryRes = await fetch(url, {
            method: 'GET',
            agent: undefined,  // direct egress, no Tor/proxy
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
              'Accept-Encoding': 'identity',
              'Cache-Control': 'no-cache',
            },
            redirect: 'manual',
            signal: retryController.signal,
          });
          clearTimeout(retryTimeout);
          if (retryRes.ok) {
            response = retryRes;
            body = await response.text();
            contentType = response.headers.get('content-type') || 'text/html';
            console.log('[go] Captcha fallback: retried with direct egress for', targetHost);
          }
        } catch (retryErr) {
          console.warn('[go] Captcha fallback failed, using original response:', retryErr.message);
          // Original body retained — best-effort
        }
      }

      // Forward upstream headers, strip XFO/CSP blocking headers
      response.headers.forEach((value, name) => {
        const lower = name.toLowerCase();
        // Skip content-type, transfer-encoding, and ALL CSP/XFO variants
        // Also skip content-length — it will be wrong after URL rewriting changes body size
        if (lower !== 'content-type' && lower !== 'transfer-encoding'
            && lower !== 'content-security-policy'
            && lower !== 'x-content-security-policy'
            && lower !== 'x-webkit-csp'
            && lower !== 'x-frame-options'
            && lower !== 'x-content-type-options'
            && lower !== 'content-length'
            && lower !== 'content-encoding') {
          res.setHeader(name, value);
        }
      });
      res.removeHeader('x-frame-options');
      res.removeHeader('x-content-type-options');
      res.removeHeader('x-webkit-csp');
      res.removeHeader('x-content-security-policy');
      res.removeHeader('content-security-policy');
      res.removeHeader('content-length');
      res.removeHeader('content-encoding');
      const proxyWrap = (raw) => {
        let u;
        try { u = new URL(raw); }
        catch (_) {
          try { u = new URL(decodeURIComponent(raw)); }
          catch (e2) {
            try { u = new URL('https:' + (raw.startsWith('//') ? raw : '//' + raw)); }
            catch (e3) { return raw; }
          }
        }
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return raw;
        if (u.host === req.headers.host) return raw;
        return '/go?url=' + encodeURIComponent(u.href);
      };

      // Rewrite href/src/action
      body = body
        .replace(/\shref=([\"'])([^\"'>]+)\1/gi, (match, q, urlVal) => {
          if (!urlVal || urlVal.startsWith('#') || urlVal.startsWith('javascript:') || urlVal.startsWith('data:') || urlVal.startsWith('/go?url=')) return match;
          try { const abs = new URL(urlVal, base); return ` href=${q}/go?url=${encodeURIComponent(abs.href)}${q}`; } catch (_) { return match; }
        })
        .replace(/\ssrc=([\"'])([^\"'>]+)\1/gi, (match, q, urlVal) => {
          if (!urlVal || urlVal.startsWith('data:') || urlVal.startsWith('javascript:') || urlVal.startsWith('/go?url=')) return match;
          try { const abs = new URL(urlVal, base); return ` src=${q}/go?url=${encodeURIComponent(abs.href)}${q}`; } catch (_) { return match; }
        })
        .replace(/\saction=([\"'])([^\"'>]+)\1/gi, (match, q, urlVal) => {
          if (!urlVal || urlVal.startsWith('javascript:') || urlVal.startsWith('/go?url=')) return match;
          try { const abs = new URL(urlVal, base); return ` action=${q}/go?url=${encodeURIComponent(abs.href)}${q}`; } catch (_) { return match; }
        });

      // Rewrite POST forms to submit through the proxy
      body = body.replace(/<form([^>]*)>/gi, (match, attrs) => {
        if (attrs.includes('method="post"') || /method\s*=\s*['"]post['"]/i.test(attrs)) {
          return `<form${attrs} onsubmit="event.preventDefault(); var f=this; var x=new XMLHttpRequest(); x.open('POST', f.action || location.href, true); x.setRequestHeader('Content-Type','application/x-www-form-urlencoded'); x.send(new URLSearchParams(new FormData(f)).toString());">`;
        }
        return match;
      });

      // Strip meta-refresh redirects that point at the real domain
      body = body.replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, (m) => {
        if (/https?:\/\//i.test(m) && !m.includes('/go?url=')) return '';
        return m;
      });

      // Strip Pornhub's hotlinker frame-bust script. The hotlinkerredirects
      // code lives in a small script block near the end of the page. We must
      // NOT use a regex that starts from the first <script> tag (the old regex
      // consumed 998KB by matching across the entire document). Instead, match
      // only the specific hotlinker block: a <script> whose content contains
      // "hotlinkerredirects".
      body = body.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, (m, code) => {
        if (code && code.includes('hotlinkerredirects')) return '';
        return m;
      });

      // Rewrite URLs inside <script> blocks
      body = body.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (m, open, code, close) => {
        const fixed = code.replace(/(?:https?:)?\/\/[^\s\"'`<>]+/g, (tok) => {
          if (tok.startsWith('//')) return proxyWrap('https:' + tok);
          return proxyWrap(tok);
        });
        return open + fixed + close;
      });

      // Second pass: catch escaped-slash and url-encoded URLs
      const hostParts = base.host.split('.');
      const stem = hostParts.length > 1 ? hostParts[hostParts.length - 2] : hostParts[0];
      const hostRe = ('(?:[a-z0-9-]+\\.)*' + stem + '[a-z0-9-]*\\.com');
      const escRe = new RegExp('(?<!(%3A|\\/go\\?url=))(?:https?:\\/\\/|\\\\+\\/+|%2f%2f)' + hostRe + '[^\\s\"\'`<>]*', 'gi');
      body = body.replace(escRe, (tok) => {
        const norm = tok.replace(/^\\+/, '').replace(/^%2f%2f/i, '//').replace(/^https?%3a%2f%2f/i, 'https://').replace(/^\/+/, '//');
        const u = norm.startsWith('//') ? 'https:' + norm : norm;
        return proxyWrap(u);
      });

      // Rewrite data-root attributes to our host
      body = body.replace(/(data-root=["'])[^"']*(["'])/gi, (mm, p1, p2) => {
        return p1 + (req.headers.host || 'localhost') + p2;
      });

      // Strip meta-X-Frame-Options and CSP from HTML (Pornhub injects via <meta> tags)
      body = body.replace(/<meta\s+http-equiv=["']X-Frame-Options["'][^>]*>/gi, '');
      body = body.replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

      // ── Quality enforcement (resolution/speed/subtitles) ───────
      const settings = getMediaSettings(req);
      const enforcement = `
<script>
(function(){
  document.addEventListener('contextmenu', function(e){ e.preventDefault(); return false; });
  var ENF = ${JSON.stringify(settings)};
  function applyVideo(v){
    if(!v) return;
    try { v.playbackRate = parseFloat(ENF.speed) || 1; } catch(e){}
    try {
      var tracks = v.textTracks;
      if(tracks){ for(var i=0;i<tracks.length;i++){ tracks[i].mode = (ENF.subtitles==='on')?'showing':'hidden'; } }
    } catch(e){}
    if(ENF.quality && ENF.quality!=='auto'){
      var h = parseInt(ENF.quality,10);
      try { v.style.maxHeight = h + 'px'; v.setAttribute('data-enforced-quality', ENF.quality); } catch(e){}
    }
  }
  function applyAll(){ var vs=document.querySelectorAll('video'); for(var i=0;i<vs.length;i++){ applyVideo(vs[i]); } }
  try {
    var orig = document.createElement;
    document.createElement = function(tag){
      var el = orig.apply(document, arguments);
      if(String(tag).toLowerCase()==='video'){
        setTimeout(function(){ applyVideo(el); }, 0);
        el.addEventListener('loadedmetadata', function(){ applyVideo(el); });
        el.addEventListener('canplay', function(){ applyVideo(el); });
      }
      return el;
    };
  } catch(e){}
  document.addEventListener('DOMContentLoaded', applyAll);
  window.addEventListener('load', applyAll);
  var obs = new MutationObserver(function(muts){ muts.forEach(function(m){ m.addedNodes.forEach(function(n){ if(n&&n.tagName==='VIDEO') applyVideo(n); }); }); });
  try { obs.observe(document.documentElement, {childList:true, subtree:true}); } catch(e){}
  applyAll();
})();
</script>
`;

      // Inject <base> tag so relative URLs resolve through the proxy
body = body.replace(/<head([^>]*)>/i, `<head$1><base href="${proxyBase}" target="_self"><meta http-equiv="Content-Security-Policy" content="default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data: blob:; media-src * data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' blob: data:; style-src * 'unsafe-inline' blob: data:; connect-src * data: blob:;">`);

      const isEmbedded = req.query.embedded === '1';

      if (isEmbedded && wispEnabled) {
        // ── EMBEDDED MODE (inside our iframe) ──────────────────────
        // No toolbar (parent has one). Inject anti-bust so the framed
        // page can't navigate to the real domain.  All URLs are already
        // rewritten to /go?url=… so navigation stays same-origin.
        const antiBust = `<script src="https://cdn.jsdelivr.net/npm/libcurl.js@latest/libcurl_full.js" defer></script>
<script>
// Initialize libcurl.js with our Wisp server for client-side TLS fetching.
// This lets the browser fetch resources directly, bypassing CORS and
// eliminating the slow server-side fetch pipeline.
window.__wispReady = false;
window.addEventListener('load', function(){
  if(typeof libcurl !== 'undefined' && libcurl.set_websocket){
    var wispUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/wisp/';
    libcurl.set_websocket(wispUrl);
    window.__wispReady = true;
    console.log('[wisp] Connected to', wispUrl);
  }
});
</script>
<script>(function(){
try{
  var _self=window.self;
  Object.defineProperty(window,'top',{get:function(){return _self;},configurable:false});
  Object.defineProperty(window,'parent',{get:function(){return _self;},configurable:false});
  Object.defineProperty(window,'frameElement',{get:function(){return null;},configurable:false});
  try{window.top=_self;}catch(e){}
  try{window.parent=_self;}catch(e){}
  try{window.frameElement=null;}catch(e){}
  function blocked(v){if(!v)return false;var s=String(v);if(s.indexOf('pornhub')!==-1)return true;try{var u=new URL(s,window.location.href);return u.hostname!==window.location.hostname;}catch(_){return false;}}
  var LP=(window.location&&Object.getPrototypeOf(window.location))||(window.Location&&window.Location.prototype);
  if(LP){try{var _h=Object.getOwnPropertyDescriptor(LP,'href');Object.defineProperty(LP,'href',{get:function(){return _h?_h.get.call(this):'';},set:function(v){if(blocked(v))return;try{_h.set.call(this,v);}catch(e){}},configurable:true});}catch(e){}try{var _r=LP.replace;LP.replace=function(v){if(blocked(v))return;return _r.apply(this,arguments);};}catch(e){}try{var _a=LP.assign;LP.assign=function(v){if(blocked(v))return;return _a.apply(this,arguments);};}catch(e){}try{var _rl=LP.reload;LP.reload=function(){/* swallow reloads — Pornhub uses this to frame-bust */};}catch(e){}}
  try{var _dl=document.location;Object.defineProperty(document,'location',{get:function(){return _dl;},set:function(v){if(blocked(v))return;},configurable:true});}catch(e){}
  // Also freeze window.location direct assignment (window.location = url)
  try{var _wlDesc=Object.getOwnPropertyDescriptor(window,'location');if(_wlDesc&&_wlDesc.set){var _wlSet=_wlDesc.set;Object.defineProperty(window,'location',{get:_wlDesc.get,set:function(v){if(blocked(v)){console.log('[anti-bust] Blocked window.location=',v);return;}try{_wlSet.call(window,v);}catch(e){}},configurable:true});}}catch(e){}
  // Override document.domain to prevent domain manipulation
  try{Object.defineProperty(document,'domain',{get:function(){return window.location.hostname;},set:function(v){/* block domain manipulation */},configurable:false});}catch(e){}
  try{var _open=window.open.bind(window);window.open=function(u,t,f){if(t==='_parent'||t==='_top'||(t==='_blank'&&blocked(u)))t='_self';if(blocked(u))return null;return _open(u,t,f);};}catch(e){}
  var _push=history.pushState,_rpl=history.replaceState;function scrub(u){if(u&&String(u).indexOf('pornhub')!==-1)return;return u;}try{history.pushState=function(a,t,u){return _push.call(history,a,t,scrub(u));};}catch(e){}try{history.replaceState=function(a,t,u){return _rpl.call(history,a,t,scrub(u));};}catch(e){}
  var mo=new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){if(n&&n.tagName==='META'&&n.httpEquiv&&/refresh/i.test(n.httpEquiv)){if(n.content&&/https?:\\/\\//i.test(n.content)&&!/\\/go\\?url=/.test(n.content)){n.remove();}}});});});try{mo.observe(document.documentElement,{childList:true,subtree:true});}catch(e){}
  // Block CSP and X-Frame-Options meta tags (Pornhub injects them to frame-bust)
  var cspObserver = new MutationObserver(function(muts){
    muts.forEach(function(m){
      m.addedNodes.forEach(function(n){
        if(n && n.tagName === 'META' && n.httpEquiv){
          var hv = n.httpEquiv.toLowerCase();
          if(hv === 'content-security-policy' || hv === 'x-frame-options' || hv === 'x-content-security-policy' || hv === 'x-webkit-csp'){
            n.remove();
          }
        }
      });
    });
  });
  try { cspObserver.observe(document.documentElement, {childList:true, subtree:true}); } catch(e){}

  // Also remove any existing CSP/XFO meta tags added by page
  document.querySelectorAll('meta[http-equiv="Content-Security-Policy"], meta[http-equiv="X-Frame-Options"], meta[http-equiv="X-Content-Security-Policy"], meta[http-equiv="X-WebKit-CSP"]').forEach(function(m){ m.remove(); });

  document.querySelectorAll('meta[http-equiv="refresh"]').forEach(function(m){if(m.content&&/https?:\\/\\//i.test(m.content)&&!/\\/go\\?url=/.test(m.content)){m.remove();}});

  // ── Intercept ALL dynamic navigation paths ──────────────────────
  // 1. Click handler: catch clicks on <a> elements with raw URLs
  document.addEventListener('click', function(e){
    var el = e.target;
    while(el && el.tagName !== 'A') el = el.parentElement;
    if(el && el.href){
      var h = el.href;
      if(h && h.indexOf('/go?url=') === -1 && h.indexOf('javascript:') === -1 && h.indexOf('#') !== 0){
        try { var u = new URL(h, window.location.href); if(u.hostname !== window.location.hostname){ e.preventDefault(); e.stopPropagation(); window.location.href = '/go?url=' + encodeURIComponent(u.href) + '&embedded=1'; return false; } } catch(_){}
      }
    }
  }, true);

  // 2. Override document.write to rewrite URLs in written content
  var _write = document.write.bind(document);
  document.write = function(html){
    if(typeof html === 'string'){
      html = html.replace(/(href|src|action)=("[^"]*"|'[^']*')/gi, function(m, attr, quoted){
        var q = quoted.charAt(0);
        var url = quoted.slice(1, -1);
        if(/^https?:\/\//i.test(url)){ try{ var u = new URL(url); if(u.hostname !== window.location.hostname) return attr + '=' + q + '/go?url=' + encodeURIComponent(u.href) + q; }catch(_){} }
        return m;
      });
      // Strip meta refresh
      html = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, function(m){ if(/https?:\/\//i.test(m) && !/\/go\?url=/.test(m)) return ''; return m; });
    }
    return _write(html);
  };
  var _writeln = document.writeln.bind(document);
  document.writeln = function(html){ if(typeof html === 'string'){ return document.write(html + String.fromCharCode(10)); } return _writeln(html); };

  // 3. MutationObserver: rewrite href on dynamically added <a> elements
  var linkObserver = new MutationObserver(function(ms){
    ms.forEach(function(m){
      m.addedNodes.forEach(function(n){
        if(!n || n.nodeType !== 1) return;
        // Rewrite <a> hrefs
        if(n.tagName === 'A' && n.href){
          try{ var u = new URL(n.href, window.location.href); if(u.hostname !== window.location.hostname && n.href.indexOf('/go?url=') === -1){ n.href = '/go?url=' + encodeURIComponent(u.href); } }catch(_){}
        }
        // Rewrite child <a> elements
        n.querySelectorAll && n.querySelectorAll('a[href]').forEach(function(a){
          try{ var u2 = new URL(a.href, window.location.href); if(u2.hostname !== window.location.hostname && a.href.indexOf('/go?url=') === -1){ a.href = '/go?url=' + encodeURIComponent(u2.href); } }catch(_){}
        });
        // Rewrite <img> srcs
        if(n.tagName === 'IMG' && n.src){
          try{ var u3 = new URL(n.src, window.location.href); if(u3.hostname !== window.location.hostname && n.src.indexOf('/go?url=') === -1){ n.src = '/go?url=' + encodeURIComponent(u3.href); } }catch(_){}
        }
        n.querySelectorAll && n.querySelectorAll('img[src]').forEach(function(img){
          try{ var u4 = new URL(img.src, window.location.href); if(u4.hostname !== window.location.hostname && img.src.indexOf('/go?url=') === -1){ img.src = '/go?url=' + encodeURIComponent(u4.href); } }catch(_){}
        });
        // Rewrite <iframe> srcs — THIS is the "refused to connect" fix
        if(n.tagName === 'IFRAME' && n.src){
          try{ var uif = new URL(n.src, window.location.href); if(uif.hostname !== window.location.hostname && n.src.indexOf('/go?url=') === -1){ n.src = '/go?url=' + encodeURIComponent(uif.href); } }catch(_){}
        }
        n.querySelectorAll && n.querySelectorAll('iframe[src]').forEach(function(ifr){
          try{ var uif2 = new URL(ifr.src, window.location.href); if(uif2.hostname !== window.location.hostname && ifr.src.indexOf('/go?url=') === -1){ ifr.src = '/go?url=' + encodeURIComponent(uif2.href); } }catch(_){}
        });
        // Rewrite <script> srcs
        if(n.tagName === 'SCRIPT' && n.src){
          try{ var us = new URL(n.src, window.location.href); if(us.hostname !== window.location.hostname && n.src.indexOf('/go?url=') === -1){ n.src = '/go?url=' + encodeURIComponent(us.href); } }catch(_){}
        }
        n.querySelectorAll && n.querySelectorAll('script[src]').forEach(function(sc){
          try{ var us2 = new URL(sc.src, window.location.href); if(us2.hostname !== window.location.hostname && sc.src.indexOf('/go?url=') === -1){ sc.src = '/go?url=' + encodeURIComponent(us2.href); } }catch(_){}
        });
        // Rewrite <link> hrefs
        if(n.tagName === 'LINK' && n.href){
          try{ var ul = new URL(n.href, window.location.href); if(ul.hostname !== window.location.hostname && n.href.indexOf('/go?url=') === -1){ n.href = '/go?url=' + encodeURIComponent(ul.href); } }catch(_){}
        }
        n.querySelectorAll && n.querySelectorAll('link[href]').forEach(function(lk){
          try{ var ul2 = new URL(lk.href, window.location.href); if(ul2.hostname !== window.location.hostname && lk.href.indexOf('/go?url=') === -1){ lk.href = '/go?url=' + encodeURIComponent(ul2.href); } }catch(_){}
        });
        // Rewrite <form> actions
        if(n.tagName === 'FORM' && n.action){
          try{ var u5 = new URL(n.action, window.location.href); if(u5.hostname !== window.location.hostname && n.action.indexOf('/go?url=') === -1){ n.action = '/go?url=' + encodeURIComponent(u5.href); } }catch(_){}
        }
        n.querySelectorAll && n.querySelectorAll('form[action]').forEach(function(f){
          try{ var u6 = new URL(f.action, window.location.href); if(u6.hostname !== window.location.hostname && f.action.indexOf('/go?url=') === -1){ f.action = '/go?url=' + encodeURIComponent(u6.href); } }catch(_){}
        });
        // Rewrite <video>/<source>/<audio> srcs
        n.querySelectorAll && n.querySelectorAll('video[src], source[src], audio[src]').forEach(function(v){
          try{ var uv = new URL(v.src, window.location.href); if(uv.hostname !== window.location.hostname && v.src.indexOf('/go?url=') === -1){ v.src = '/go?url=' + encodeURIComponent(uv.href); } }catch(_){}
        });
        // Kill meta refresh tags
        if(n.tagName === 'META' && n.httpEquiv && /refresh/i.test(n.httpEquiv)){
          if(n.content && /https?:\/\//i.test(n.content) && !/\/go\?url=/.test(n.content)){ n.remove(); }
        }
      });
    });
  });
  try{ linkObserver.observe(document.documentElement, {childList:true, subtree:true}); }catch(e){}

  // 4. Override fetch() and XMLHttpRequest to rewrite URLs
  if(window.fetch){
    var _fetch = window.fetch;
    window.fetch = function(input, opts){
      if(typeof input === 'string'){
        try{ var u = new URL(input, window.location.href); if(u.hostname !== window.location.hostname && input.indexOf('/go?url=') === -1){ input = '/go?url=' + encodeURIComponent(u.href); } }catch(_){}
      } else if(input && input.url){
        try{ var u2 = new URL(input.url, window.location.href); if(u2.hostname !== window.location.hostname && input.url.indexOf('/go?url=') === -1){ var nw = new Request('/go?url=' + encodeURIComponent(u2.href), input); input = nw; } }catch(_){}
      }
      return _fetch(input, opts);
    };
  }
  if(window.XMLHttpRequest){
    var _xhro = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url){
      try{ var u = new URL(url, window.location.href); if(u.hostname !== window.location.hostname && url.indexOf('/go?url=') === -1){ url = '/go?url=' + encodeURIComponent(u.href); } }catch(_){}
      return _xhro.apply(this, arguments);
    };
  }

  // 5. Override innerHTML to rewrite URLs in dynamically set HTML
  var _ihDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if(_ihDesc && _ihDesc.set){
    var _ihSet = _ihDesc.set;
    Object.defineProperty(Element.prototype, 'innerHTML', {
      get: _ihDesc.get,
      set: function(val){
        if(typeof val === 'string'){
          val = val.replace(/(href|src|action)=("[^"]*"|'[^']*')/gi, function(m, attr, quoted){
            var q = quoted.charAt(0);
            var url = quoted.slice(1, -1);
            if(/^https?:\/\//i.test(url)){ try{ var u = new URL(url); if(u.hostname !== window.location.hostname) return attr + '=' + q + '/go?url=' + encodeURIComponent(u.href) + q; }catch(_){} }
            return m;
          });
        }
        return _ihSet.call(this, val);
      },
      configurable: true
    });
  }

  document.addEventListener('contextmenu',function(e){e.preventDefault();return false;});
}catch(e){}\n})();</script>`;
        body = body.replace(/<head([^>]*)>/i, `<head$1>${antiBust}`);
      } else {
        // ── STANDALONE MODE (full page) ────────────────────────────
        // Inject toolbar at top of <body>
        const toolbar = `
<style>
#vp-toolbar{position:fixed;top:0;left:0;right:0;z-index:99999;background:#000;border-bottom:2px solid #ff7a00;padding:6px 10px;display:flex;gap:8px;align-items:center;font-family:Arial,sans-serif;font-size:13px}
#vp-toolbar input{flex:1;background:#111;color:#fff;border:1px solid #333;padding:6px 10px;border-radius:3px;font-size:13px}
#vp-toolbar button{background:#ff7a00;color:#000;border:0;padding:6px 14px;font-weight:900;text-transform:uppercase;border-radius:3px;cursor:pointer;font-size:12px}
#vp-toolbar button.home{background:#333;color:#ff7a00;border:1px solid #ff7a00}
#vp-toolbar .url-display{color:#888;font-size:11px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#vp-toolbar .quality{color:#ff7a00;font-size:10px;margin-left:4px}
body{margin-top:38px!important}
</style>
<div id="vp-toolbar">
  <button class="home" onclick="location.href='/'">🏠 Home</button>
  <span class="url-display">${targetHost}</span>
  <span class="quality">${settings.quality}p ${settings.speed}x</span>
  <input id="vp-url" type="text" placeholder="Enter URL..." value="${url}" onkeydown="if(event.key==='Enter')go()">
  <button onclick="go()">Go</button>
</div>
<script>
function go(){var u=document.getElementById('vp-url').value.trim();if(u)location.href='/go?url='+encodeURIComponent(/^https?:\\\\/\\\\//i.test(u)?u:'https://'+u);}
</script>`;
        body = body.replace(/<body([^>]*)>/i, `<body$1>${toolbar}`);
      }

      res.set('Content-Type', 'text/html');
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.set('Access-Control-Allow-Origin', '*');
      // Strip headers that would block iframe embedding
      res.removeHeader('x-frame-options');
      res.removeHeader('x-content-type-options');
      if (isEmbedded) {
        // Permissive CSP for embedded mode — proxied resources need * for
        // images, scripts, XHR/fetch (video API calls), styles, and fonts.
        // Frame-busting is handled by injected anti-bust JS.
        res.set('Content-Security-Policy',
          "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; img-src * data: blob:; media-src * data: blob:; script-src * 'unsafe-inline' 'unsafe-eval' blob: data:; style-src * 'unsafe-inline' blob: data:; connect-src * data: blob:; font-src * data: blob:; frame-ancestors *;");
      }
      res.send(body + enforcement);
      return;
    }

    // Non-HTML: pass through (with asset cache for speed)
    const cacheKey = url;
    if (ASSET_CACHE_TYPES.test(contentType)) {
      const cached = getCachedAsset(cacheKey);
      if (cached) {
        res.set('Content-Type', cached.contentType);
        res.set('Cache-Control', 'public, max-age=600');
        res.set('X-Proxy-Cache', 'HIT');
        res.send(cached.buf);
        return;
      }
    }
    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('Access-Control-Allow-Origin', '*');
    const buf = await response.arrayBuffer();
    const bufData = Buffer.from(buf);
    if (ASSET_CACHE_TYPES.test(contentType)) {
      setCachedAsset(cacheKey, bufData, contentType);
      res.set('X-Proxy-Cache', 'MISS');
    }
    res.send(bufData);
  } catch (e) {
    res.status(502).send(`Proxy error: ${e.message}`);
  }
};

app.get('/go', fullPageProxyHandler);
app.post('/go', express.urlencoded({ extended: true }), express.json(), (req, res) => fullPageProxyHandler(req, res));

app.get('/browse', (req, res) => {
  const target = (req.query.url || '').trim();
  if (!target) return res.redirect('/');
  res.redirect('/proxy?url=' + encodeURIComponent(target));
});

// Public VPN-mode settings (toolbar). Admin-config stays gated at /admin/config.
app.get('/vpn-settings', (req, res) => {
  res.json({
    vpnMode: APP_CONFIG.vpnMode,
    builtinProxyEnabled: APP_CONFIG.builtinProxyEnabled,
    localProxy: APP_CONFIG.localProxy,
  });
});

app.put('/vpn-settings', express.json(), (req, res) => {
  const b = req.body || {};
  if ('vpnMode' in b) APP_CONFIG.vpnMode = String(b.vpnMode);
  if ('builtinProxyEnabled' in b) APP_CONFIG.builtinProxyEnabled = !!b.builtinProxyEnabled;
  if ('localProxy' in b) APP_CONFIG.localProxy = String(b.localProxy || '');
  saveConfig();
  res.json({ ok: true });
});

// Payment wall — premium plans + socks donation
const paymentWallHtml = fs.readFileSync(path.join(__dirname, 'views', 'payment-wall.html'), 'utf8');
const paymentWallRendered = (bannerImage) => paymentWallHtml.replace('{{bannerImage}}', bannerImage || '/images/bannerpvpn.png');

app.get('/donate', (req, res) => {
  res.set('Content-Type', 'text/html');
  res.send(paymentWallRendered(APP_CONFIG.bannerImage));
});
app.get('/premium', (req, res) => {
  res.set('Content-Type', 'text/html');
  res.send(paymentWallRendered(APP_CONFIG.bannerImage));
});

// ─── STRIPE CHECKOUT ───────────────────────────────────────────────
// Price configuration: tier ID -> { name, amount (cents), mode }
const STRIPE_TIERS = {
  daily:    { name: 'Daily Pass',         amount: 500,   mode: 'payment', interval: null },
  monthly:  { name: 'Monthly Plan',       amount: 1000,  mode: 'subscription', interval: 'month' },
  quarterly:{ name: 'Quarterly Plan',     amount: 2500,  mode: 'subscription', interval: 'month', interval_count: 3 },
  lifetime: { name: 'Lifetime Premium',   amount: 10000, mode: 'payment', interval: null },
  socks:    { name: 'Socks Donation',     amount: 1000,  mode: 'payment', interval: null },
  jessie:   { name: "Jessie's Used Sock", amount: 100000, mode: 'payment', interval: null },
  coles:    { name: "Cole's Dirty Work Socks", amount: 50000, mode: 'payment', interval: null },
  // Crate tiers
  bronze:   { name: 'Bronze Crate',   amount: 2500,   mode: 'payment', interval: null },
  silver:   { name: 'Silver Crate',   amount: 5000,   mode: 'payment', interval: null },
  gold:     { name: 'Gold Crate',     amount: 12500,  mode: 'payment', interval: null },
  platinum: { name: 'Platinum Crate', amount: 25000,  mode: 'payment', interval: null },
  diamond:  { name: 'Diamond Crate',  amount: 50000,  mode: 'payment', interval: null },
  ruby:     { name: 'Ruby Crate',     amount: 100000, mode: 'payment', interval: null },
  obsidian: { name: 'Obsidian Crate', amount: 1000000, mode: 'payment', interval: null },
};

app.post('/api/checkout', express.json(), async (req, res) => {
  try {
    const { tier } = req.body;
    const config = STRIPE_TIERS[tier];
    if (!config) return res.status(400).json({ error: 'Invalid tier' });

    const user = parseUser(req);
    const origin = req.headers.origin || `http://localhost:${PORT}`;
    const params = {
      payment_method_types: undefined,  // omit for dynamic payment methods per Stripe best practices
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: config.name },
          unit_amount: config.amount,
          ...(config.mode === 'subscription' ? {
            recurring: { interval: config.interval, interval_count: config.interval_count || 1 }
          } : {}),
        },
        quantity: 1,
      }],
      mode: config.mode,
      success_url: `${origin}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/premium`,
      metadata: { tier, product: config.name, username: user ? user.username : '' },
      integration_identifier: 'pvpn_premium_xk9vcd6f',
    };
    // Attach the logged-in account so the webhook can grant premium to the right user
    if (user && user.email) params.customer_email = user.email;

    const session = await stripe.checkout.sessions.create(params);
    res.json({ sessionId: session.id, url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Payment success page
app.get('/payment-success', async (req, res) => {
  const sessionId = req.query.session_id;
  let tierName = 'Premium';
  let granted = false;
  if (sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      tierName = session.metadata?.product || 'Premium';
      const tier = session.metadata?.tier;
      const username = session.metadata?.username;
      const email = session.customer_email || session.customer_details?.email;
      // Grant premium to the real account (sandbox-key path — works without webhook secret).
      let target = username ? USERS[String(username).toLowerCase()] : null;
      if (!target && email) target = Object.values(USERS).find(u => u.email === email) || null;
      // Fallback: if the buyer is currently logged in via cookie, use that account.
      if (!target) { const u = parseUser(req); if (u) target = u; }
      if (target) {
        target.premium = true;
        target.premiumTier = STRIPE_TIERS[tier]?.name || tier || 'Premium';
        target.premiumExpires = null;
        saveUsers();
        granted = true;
        console.log(`[Stripe] Payment-success granted premium to ${target.username} (${target.premiumTier})`);
      }
    } catch (_) {}
  }
  res.send(`<!DOCTYPE html><html><head><title>Payment Success</title>
<style>body{background:#000;color:#2ecc71;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;}
.card{background:#0a0a0a;border:2px solid #2ecc71;border-radius:10px;padding:40px;max-width:440px;width:90%;}
h1{margin:0 0 10px;font-size:28px;text-transform:uppercase;letter-spacing:2px;}
p{color:#aaa;margin:0 0 20px;font-size:14px;}
a{display:inline-block;background:#ff7a00;color:#000;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:900;text-transform:uppercase;letter-spacing:1px;}
a:hover{filter:brightness(1.1);}</style></head>
<body><div class="card"><div style="font-size:60px;margin-bottom:10px;">✅</div>
<h1>${tierName} Activated!</h1>
<p>${granted ? 'Your payment was successful. You now have full premium access.' : 'Your payment was received. Log in to your account to activate premium.'}</p>
<a href="/">Back to VPN Browser</a></div></body></html>`);
});

// Stripe webhook — verify signature, handle checkout.session.completed
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const tier = session.metadata?.tier;
    const username = session.metadata?.username;
    const email = session.customer_email || session.customer_details?.email;
    console.log(`[Stripe] Payment completed: ${session.metadata?.tier} — $${(session.amount_total/100).toFixed(2)} — ${email || username}`);
    // Grant premium to the real account tied to this payment.
    let target = username ? USERS[String(username).toLowerCase()] : null;
    if (!target && email) target = Object.values(USERS).find(u => u.email === email) || null;
    if (target) {
      target.premium = true;
      target.premiumTier = STRIPE_TIERS[tier]?.name || tier || 'Premium';
      // Subscriptions stay premium until cancelled; payments are lifetime-equivalent here.
      target.premiumExpires = null;
      saveUsers();
      console.log(`[Stripe] Granted premium to ${target.username} (${target.premiumTier})`);
    } else {
      console.log('[Stripe] No linked account found for this payment — premium not auto-granted');
    }
  }
  res.json({ received: true });
});

// ─── AD NETWORK MANAGER ────────────────────────────────────────────
// Default ad config — all networks disabled until admin enters zone IDs
const DEFAULT_AD_CONFIG = {
  popunderEnabled: true,
  networks: {
    exoclick:       { enabled: false, formats: ['banner', 'popunder'], zones: {} },
    trafficstars:   { enabled: false, formats: ['banner'], zones: {} },
    adsterra:       { enabled: false, formats: ['banner', 'popunder', 'push'], zones: {} },
    juicyads:       { enabled: false, formats: ['banner'], zones: {} },
    clickadu:       { enabled: false, formats: ['popunder'], zones: {} },
    propellerads:   { enabled: false, formats: ['popunder', 'push'], zones: {} },
    hilltopads:     { enabled: false, formats: ['popunder', 'push'], zones: {} },
    adcash:         { enabled: false, formats: ['banner', 'popunder'], zones: {} },
    richads:        { enabled: false, formats: ['popunder'], zones: {} },
    eroadvertising: { enabled: false, formats: ['banner'], zones: {} },
  }
};

// Load/save ad config
const AD_CONFIG_PATH = path.join(__dirname, 'ad-config.json');
let AD_CONFIG = Object.assign({}, DEFAULT_AD_CONFIG);

function loadAdConfig() {
  try {
    AD_CONFIG = Object.assign({}, DEFAULT_AD_CONFIG, JSON.parse(fs.readFileSync(AD_CONFIG_PATH, 'utf8')));
  } catch (_) {}
}
function saveAdConfig() {
  try { fs.writeFileSync(AD_CONFIG_PATH, JSON.stringify(AD_CONFIG, null, 2)); } catch (_) {}
}
loadAdConfig();

// Public endpoint — ad-manager.js fetches this
app.get('/api/ad-config', (req, res) => {
  res.json(AD_CONFIG);
});

// Admin endpoints — require session
app.get('/admin/ad-networks', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin login required' });
  res.json(AD_CONFIG);
});
app.put('/admin/ad-networks', express.json(), (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin login required' });
  const body = req.body || {};
  if (body.networks) AD_CONFIG.networks = body.networks;
  if ('popunderEnabled' in body) AD_CONFIG.popunderEnabled = !!body.popunderEnabled;
  saveAdConfig();
  res.json({ ok: true, config: AD_CONFIG });
});

// Toggle a single network
app.put('/admin/ad-networks/:network', express.json(), (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin login required' });
  const net = req.params.network;
  if (!AD_CONFIG.networks[net]) return res.status(404).json({ error: 'unknown network' });
  const body = req.body || {};
  if ('enabled' in body) AD_CONFIG.networks[net].enabled = !!body.enabled;
  if ('zones' in body) AD_CONFIG.networks[net].zones = body.zones;
  saveAdConfig();
  res.json({ ok: true, network: AD_CONFIG.networks[net] });
});

// ─── LOOT CRATE SYSTEM ────────────────────────────────────────────
const CRATE_TIERS = {
  bronze:   { name: 'Bronze Crate',   price: 2500,  priceLabel: '$25' },
  silver:   { name: 'Silver Crate',   price: 5000,  priceLabel: '$50' },
  gold:     { name: 'Gold Crate',     price: 12500, priceLabel: '$125' },
  platinum: { name: 'Platinum Crate', price: 25000, priceLabel: '$250' },
  diamond:  { name: 'Diamond Crate',  price: 50000, priceLabel: '$500' },
  ruby:     { name: 'Ruby Crate',     price: 100000, priceLabel: '$1,000' },
  obsidian: { name: 'Obsidian Crate', price: 1000000, priceLabel: '$10,000' },
};

// Item database (server-side authoritative)
const CRATE_ITEMS = [
  // Common 50%
  { id: 'tissue_used', name: 'Used Tissue', emoji: '🤧', rarity: 'common', value: 0 },
  { id: 'condom_used', name: 'Used Condom', emoji: '🩲', rarity: 'common', value: 0 },
  { id: 'penny', name: 'One Penny', emoji: '🪙', rarity: 'common', value: 1 },
  { id: 'sticker_basic', name: 'PVPN Sticker', emoji: '🏷️', rarity: 'common', value: 0 },
  { id: 'rubber_band', name: 'Old Rubber Band', emoji: '🔗', rarity: 'common', value: 0 },
  { id: 'crumb_packet', name: 'Chip Crumbs', emoji: '🍟', rarity: 'common', value: 0 },
  // Uncommon 25%
  { id: 'sock_basic', name: 'Plain White Sock', emoji: '🧦', rarity: 'uncommon', value: 0 },
  { id: 'vpn_1day', name: 'VPN 1-Day Pass', emoji: '🔑', rarity: 'uncommon', value: 5 },
  { id: 'sticker_rare', name: 'Holographic PVPN Sticker', emoji: '✨', rarity: 'uncommon', value: 0 },
  { id: 'USB_drive', name: 'Mystery USB Drive', emoji: '💾', rarity: 'uncommon', value: 0 },
  // Rare 15%
  { id: 'sock_pair', name: 'Matched Sock Pair', emoji: '🧦', rarity: 'rare', value: 10 },
  { id: 'vpn_7day', name: 'VPN 7-Day Pass', emoji: '🔑', rarity: 'rare', value: 25 },
  { id: 'orange_socks', name: 'VPN Orange Socks', emoji: '🧦', rarity: 'rare', value: 15 },
  { id: 'coffee_mug', name: 'Chipped Coffee Mug', emoji: '☕', rarity: 'rare', value: 0 },
  // Epic 8%
  { id: 'jessie_sock', name: "Jessie's Sock (One)", emoji: '👃', rarity: 'epic', value: 100 },
  { id: 'vpn_lifetime', name: 'VPN Lifetime Pass', emoji: '👑', rarity: 'epic', value: 100 },
  { id: 'condom_signed', name: 'Signed Condom (by Jessie)', emoji: '✍️', rarity: 'epic', value: 50 },
  { id: 'sock_pack', name: '12-Pack Orange Socks', emoji: '🧦', rarity: 'epic', value: 80 },
  // Legendary 2%
  { id: 'jessie_pair', name: "Jessie's Sock Pair (Sealed)", emoji: '🏆', rarity: 'legendary', value: 500 },
  { id: 'golden_condom', name: '24K Gold Condom', emoji: '✨', rarity: 'legendary', value: 200 },
  { id: 'vpn_forever_plus', name: 'VPN Forever+ Pass', emoji: '💎', rarity: 'legendary', value: 1000 },
  { id: 'jessie_hug', name: "Jessie's Hug (Coupon)", emoji: '🤗', rarity: 'legendary', value: 999 },
];

const RARITY_WEIGHTS = { common: 50, uncommon: 25, rare: 15, epic: 8, legendary: 2 };
const CRATE_BOOST = {
  bronze:   { common: 1.2, uncommon: 1.0, rare: 0.8, epic: 0.5, legendary: 0.2 },
  silver:   { common: 1.0, uncommon: 1.2, rare: 1.0, epic: 0.7, legendary: 0.3 },
  gold:     { common: 0.6, uncommon: 1.0, rare: 1.3, epic: 1.2, legendary: 0.5 },
  platinum: { common: 0.4, uncommon: 0.8, rare: 1.4, epic: 1.5, legendary: 0.7 },
  diamond:  { common: 0.3, uncommon: 0.7, rare: 1.2, epic: 1.5, legendary: 1.0 },
  ruby:     { common: 0.1, uncommon: 0.4, rare: 1.0, epic: 1.8, legendary: 1.5 },
  obsidian: { common: 0.0, uncommon: 0.1, rare: 0.5, epic: 2.0, legendary: 3.0 },
};

function rollCrateItem(crateTier) {
  const boost = CRATE_BOOST[crateTier] || CRATE_BOOST.bronze;
  let total = 0;
  const weights = {};
  for (const [r, w] of Object.entries(RARITY_WEIGHTS)) {
    weights[r] = w * (boost[r] || 1);
    total += weights[r];
  }
  let roll = Math.random() * total;
  let chosen = 'common';
  for (const [r, w] of Object.entries(weights)) {
    roll -= w;
    if (roll <= 0) { chosen = r; break; }
  }
  const pool = CRATE_ITEMS.filter(i => i.rarity === chosen);
  return pool[Math.floor(Math.random() * pool.length)];
}

// Crate checkout — creates Stripe session for crate purchase
app.post('/api/crate/checkout', express.json(), async (req, res) => {
  try {
    const { tier } = req.body;
    const config = CRATE_TIERS[tier];
    if (!config) return res.status(400).json({ error: 'Invalid crate tier' });

    const origin = req.headers.origin || `http://localhost:${PORT}`;
    const session = await stripe.checkout.sessions.create({
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: config.name + ' (Loot Crate)' },
          unit_amount: config.price,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${origin}/crate-result?session_id={CHECKOUT_SESSION_ID}&tier=${tier}`,
      cancel_url: `${origin}/`,
      metadata: { type: 'crate', tier },
      integration_identifier: 'pvpn_crate_xk9vcd6f',
    });
    res.json({ sessionId: session.id, url: session.url });
  } catch (err) {
    console.error('Crate checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Crate result page — roll item + show animation
app.get('/crate-result', async (req, res) => {
  const { session_id, tier } = req.query;
  let item = rollCrateItem(tier || 'bronze');
  let tierName = CRATE_TIERS[tier]?.name || 'Crate';

  // Verify session (optional, for production)
  if (session_id) {
    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if (session.payment_status !== 'paid') {
        return res.redirect('/?error=payment_not_completed');
      }
    } catch(_) {}
  }

  res.send(`<!DOCTYPE html><html><head><title>Crate Result</title>
<style>body{background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;}
.card{background:#0a0a0a;border:2px solid ${item.rarity === 'legendary' ? '#ffd700' : item.rarity === 'epic' ? '#9b59b6' : item.rarity === 'rare' ? '#3498db' : '#ff7a00'};border-radius:12px;padding:40px;max-width:400px;width:90%;animation:popIn 0.5s ease-out;}
@keyframes popIn{0%{transform:scale(0.3);opacity:0}60%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}}
.emoji{font-size:80px;margin-bottom:10px;}
.rarity{font-size:12px;text-transform:uppercase;letter-spacing:3px;margin-bottom:6px;}
.name{font-size:24px;font-weight:900;margin-bottom:8px;}
.desc{color:#aaa;font-size:13px;margin-bottom:16px;}
a{display:inline-block;background:#ff7a00;color:#000;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:900;text-transform:uppercase;}</style></head>
<body><div class="card"><div class="emoji">${item.emoji}</div>
<div class="rarity" style="color:${item.rarity === 'legendary' ? '#ffd700' : item.rarity === 'epic' ? '#9b59b6' : item.rarity === 'rare' ? '#3498db' : '#ff7a00'}">${item.rarity}</div>
<div class="name">${item.name}</div>
<div class="desc">Value: ${item.value > 0 ? '$' + item.value : 'Priceless'}</div>
<a href="/">Back to VPN Browser</a></div></body></html>`);
});

// ─── CHAT API (stub for future WebSocket) ────────────────────────
const chatMessages = [];
app.post('/api/chat', express.json(), (req, res) => {
  const { user, text, tier, hasSocks } = req.body;
  if (!user || !text) return res.status(400).json({ error: 'user and text required' });
  const msg = { user, text: String(text).slice(0, 200), tier: tier || 'free', hasSocks: !!hasSocks, ts: Date.now() };
  chatMessages.unshift(msg);
  if (chatMessages.length > 100) chatMessages.pop();
  res.json({ ok: true, msg });
});
app.get('/api/chat', (req, res) => {
  res.json(chatMessages.slice(0, 50));
});

// ─── MEMBERS FORUM ────────────────────────────────────────────────
const forumHtml = fs.readFileSync(path.join(__dirname, 'views', 'forum.html'), 'utf8');
app.get('/forum', (req, res) => { res.set('Content-Type', 'text/html'); res.send(forumHtml); });

// ─── SHOP ──────────────────────────────────────────────────────
const shopHtml = fs.readFileSync(path.join(__dirname, 'views', 'shop.html'), 'utf8');
app.get('/shop', (req, res) => { res.set('Content-Type', 'text/html'); res.send(shopHtml); });

// In-memory forum data (production: use a database)
const forumThreads = [];
const forumPolls = [];
const forumLists = [];
const urlClicks = {};  // { url: count, last24h: [...] }

// Seed some demo threads
forumThreads.push(
  { id: 't1', title: 'Welcome to the PVPN Members Forum!', user: 'Admin', tier: 'lifetime', hasSocks: true, votes: 42, ts: Date.now() - 86400000, hot: true, replies: [
    { user: 'SocksFan', tier: 'lifetime', hasSocks: true, text: 'Finally! A forum for the real ones.', ts: Date.now() - 72000000 },
    { user: 'Anon_42', tier: 'monthly', hasSocks: false, text: 'This is fire 🔥', ts: Date.now() - 36000000 },
  ]},
  { id: 't2', title: 'Best proxy settings for speed?', user: 'BrowserPro', tier: 'quarterly', hasSocks: false, votes: 15, ts: Date.now() - 43200000, hot: false, replies: [
    { user: 'TechGuy', tier: 'lifetime', hasSocks: true, text: 'Use builtin VPN + US exit. Tor is slow.', ts: Date.now() - 30000000 },
  ]},
  { id: 't3', title: 'Just bought the Jessie sock. No regrets.', user: 'JessieFan', tier: 'jessie', hasSocks: true, votes: 38, ts: Date.now() - 21600000, hot: true, replies: [] },
);

// Seed demo polls (simulating daily URL tracking)
const today = new Date().toISOString().split('T')[0];
forumPolls.push(
  { id: 'p1', question: 'What\'s the #1 site today?', date: today, options: [
    { text: 'pornhub.com', votes: 234 },
    { text: 'xvideos.com', votes: 189 },
    { text: 'xnxx.com', votes: 145 },
    { text: 'redtube.com', votes: 98 },
    { text: 'youporn.com', votes: 67 },
  ]},
  { id: 'p2', question: 'Which country\'s VPN exit is fastest?', date: today, options: [
    { text: '🇺🇸 United States', votes: 312 },
    { text: '🇳🇱 Netherlands', votes: 198 },
    { text: '🇩🇪 Germany', votes: 156 },
    { text: '🇯🇵 Japan', votes: 89 },
    { text: '🇬🇧 United Kingdom', votes: 78 },
  ]},
);

// Seed demo lists
forumLists.push(
  { id: 'l1', name: 'Top Tube Sites 2026', user: 'Admin', items: [
    { url: 'pornhub.com', clicks: 15234 },
    { url: 'xvideos.com', clicks: 12890 },
    { url: 'xnxx.com', clicks: 9876 },
    { url: 'redtube.com', clicks: 7654 },
    { url: 'youporn.com', clicks: 5432 },
  ]},
  { id: 'l2', name: 'Best Free VPN Proxies', user: 'TechGuy', items: [
    { url: 'pvpn.com (this site!)', clicks: 8901 },
    { url: 'proxysite.com', clicks: 3456 },
    { url: 'hide.me/proxy', clicks: 2345 },
  ]},
);

// URL click tracking — called from proxy handler
function trackUrlClick(url) {
  try {
    const host = new URL(url).hostname;
    if (!urlClicks[host]) urlClicks[host] = { clicks: 0, last24h: [] };
    urlClicks[host].clicks++;
    urlClicks[host].last24h.push(Date.now());
    // Prune entries older than 24h
    const cutoff = Date.now() - 86400000;
    urlClicks[host].last24h = urlClicks[host].last24h.filter(t => t > cutoff);
  } catch(_) {}
}

// ─── FORUM API ───
// Threads
app.get('/api/forum/threads', (req, res) => {
  res.json(forumThreads.sort((a, b) => b.votes - a.votes));
});
app.get('/api/forum/threads/:id', (req, res) => {
  const t = forumThreads.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
});
app.post('/api/forum/threads', express.json(), (req, res) => {
  const { title, user, tier, hasSocks } = req.body;
  if (!title || !user) return res.status(400).json({ error: 'title and user required' });
  const thread = { id: 't' + Date.now().toString(36), title, user, tier: tier||'free', hasSocks: !!hasSocks, votes: 0, ts: Date.now(), hot: false, replies: [] };
  forumThreads.unshift(thread);
  res.json({ ok: true, thread });
});
app.post('/api/forum/threads/:id/reply', express.json(), (req, res) => {
  const t = forumThreads.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  const { text, user, tier, hasSocks } = req.body;
  if (!text || !user) return res.status(400).json({ error: 'text and user required' });
  t.replies.push({ user, tier: tier||'free', hasSocks: !!hasSocks, text, ts: Date.now() });
  if (t.replies.length > 10) t.hot = true;
  res.json({ ok: true });
});
app.post('/api/forum/threads/:id/vote', express.json(), (req, res) => {
  const t = forumThreads.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'not found' });
  t.votes = (t.votes || 0) + 1;
  if (t.votes > 20) t.hot = true;
  res.json({ ok: true, votes: t.votes });
});

// Polls
app.get('/api/forum/polls', (req, res) => {
  res.json(forumPolls);
});
app.post('/api/forum/polls/:id/vote', express.json(), (req, res) => {
  const poll = forumPolls.find(p => p.id === req.params.id);
  if (!poll) return res.status(404).json({ error: 'not found' });
  const opt = poll.options.find(o => o.text === req.body.option);
  if (opt) opt.votes++;
  res.json({ ok: true });
});

// Lists (Top 100, Hottest)
app.get('/api/forum/lists', (req, res) => {
  res.json(forumLists);
});
app.post('/api/forum/lists', express.json(), (req, res) => {
  const { name, items, user } = req.body;
  if (!name || !items || !user) return res.status(400).json({ error: 'name, items, user required' });
  const list = { id: 'l' + Date.now().toString(36), name, user, items: items.slice(0, 100) };
  forumLists.unshift(list);
  res.json({ ok: true, list });
});
app.post('/api/forum/lists/:id/upvote', express.json(), (req, res) => {
  const list = forumLists.find(l => l.id === req.params.id);
  if (!list) return res.status(404).json({ error: 'not found' });
  const idx = req.body.idx;
  if (idx >= 0 && idx < list.items.length) {
    list.items[idx].clicks = (list.items[idx].clicks || 0) + 1;
    list.items.sort((a, b) => (b.clicks||0) - (a.clicks||0));
  }
  res.json({ ok: true });
});

// Hottest — most clicked URLs in last 24h
app.get('/api/forum/hottest', (req, res) => {
  const cutoff = Date.now() - 86400000;
  const hottest = Object.entries(urlClicks)
    .map(([url, data]) => ({
      url,
      clicks: data.last24h.filter(t => t > cutoff).length,
    }))
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 100);
  res.json(hottest);
});

// ─── URL CLICK TRACKING (hook into proxy) ──────────────────────────
// This is called from the proxy handler to track every proxied URL
const originalProxyHandler = app._router.stack.find(r => r.route && r.route.path === '/proxy');

const PORT = process.env.PORT || 3000;
let wispEnabled = false;

// Per-IP media settings, posted by the client media bar so the injected
// enforcement script can read enforced quality/speed/subtitles.
const mediaSettingsStore = new Map();
function getMediaSettings(req) {
  const key = req.ip || req.connection.remoteAddress || 'anon';
  return mediaSettingsStore.get(key) || { quality: APP_CONFIG.defaultQuality || '480', speed: APP_CONFIG.defaultSpeed || '1', subtitles: APP_CONFIG.defaultSubtitles || 'off' };
}
app.post('/media-settings', express.json(), (req, res) => {
  const key = req.ip || req.connection.remoteAddress || 'anon';
  const body = req.body || {};
  mediaSettingsStore.set(key, {
    quality: String(body.quality || APP_CONFIG.defaultQuality || '480'),
    speed: String(body.speed || APP_CONFIG.defaultSpeed || '1'),
    subtitles: String(body.subtitles || APP_CONFIG.defaultSubtitles || 'off'),
  });
  res.json({ ok: true });
});

// GET current media settings (for toolbar to display)
app.get('/media-settings', (req, res) => {
  res.json(getMediaSettings(req));
});

// ── Static asset cache for /go (speed optimization) ──────────────────
// Caches non-HTML proxied assets (images, CSS, JS) in-memory for 10 minutes
// so repeat visits to the same page don't re-fetch identical resources.
const assetCache = new Map();
const ASSET_CACHE_TTL = 10 * 60 * 1000; // 10 min
const ASSET_CACHE_MAX = 500;            // max entries
const ASSET_CACHE_TYPES = /^(image\/|text\/css|application\/javascript|text\/javascript|font\/|application\/font|application\/x-font)/i;

function getCachedAsset(key) {
  const entry = assetCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.t > ASSET_CACHE_TTL) {
    assetCache.delete(key);
    return null;
  }
  return entry;
}

function setCachedAsset(key, buf, contentType) {
  if (assetCache.size >= ASSET_CACHE_MAX) {
    // Evict oldest
    const firstKey = assetCache.keys().next().value;
    assetCache.delete(firstKey);
  }
  assetCache.set(key, { buf, contentType, t: Date.now() });
}

const CONFIG_PATH = path.join(__dirname, 'config.json');
let APP_CONFIG = {
  builtinProxyEnabled: true,
  localProxy: '',
  vpnMode: 'direct',
  theme: 'default',
  bannerImage: '/images/bannerpvpn.png',
  adButtons: [
    { label: 'HOT DEALS', url: 'https://example.com' },
    { label: 'FREE', url: 'https://www.pornhub.com', free: true },
    { label: 'GO PREMIUM', url: 'https://example.com' },
  ],
  ads: [],
  // --- New admin-controllable settings ---
  siteTitle: 'PVPN Browser',
  maintenanceMode: false,
  defaultCountry: 'us',
  blocklist: [],
  proxyLogEnabled: true,
  // Default media quality/speed for proxy users (admin-configurable)
  defaultQuality: '480',
  defaultSpeed: '1',
  defaultSubtitles: 'off',
};

function loadConfig() {
  try {
    APP_CONFIG = Object.assign({}, APP_CONFIG, JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  } catch (_) {
    APP_CONFIG = Object.assign({}, APP_CONFIG);
  }
}

function saveConfig() {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(APP_CONFIG, null, 2)); } catch (_) {}
}

loadConfig();

// If Tor is not installed (e.g. Render free container), never select builtin mode —
// silently downgrade to direct egress so the proxy never 500s on a missing binary.
if (APP_CONFIG.vpnMode === 'builtin' && !vpnMgr.checkTorAvailable()) {
  console.warn('[config] Tor binary missing — forcing vpnMode=direct instead of builtin');
  APP_CONFIG.vpnMode = 'direct';
  saveConfig();
}

app.get('/admin/config', (req, res) => res.json(APP_CONFIG));

app.use('/admin/config', express.json());

app.put('/admin/config', (req, res) => {
  const next = Object.assign({}, APP_CONFIG, req.body || {});
  if (!('builtinProxyEnabled' in next)) delete next.builtinProxyEnabled;
  if (!('localProxy' in next)) delete next.localProxy;
  APP_CONFIG = next;
  saveConfig();
  res.json({ ok: true, config: APP_CONFIG });
});

// --- Banner image upload (admin) ---
const multer = require('multer');
const UPLOAD_DIR = path.join(__dirname, 'public', 'images', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const ext = (file.originalname.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
      cb(null, 'banner-' + Date.now() + '.' + ext);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
});

app.post('/admin/banner', upload.single('banner'), (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin login required' });
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const url = '/images/uploads/' + req.file.filename;
  APP_CONFIG.bannerImage = url;
  saveConfig();
  res.json({ ok: true, bannerImage: url });
});

// --- Paid advertising manager (admin) ---
app.get('/admin/ads', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin login required' });
  res.json(APP_CONFIG.ads || []);
});

app.post('/admin/ads', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin login required' });
  const body = req.body || {};
  const ad = {
    id: 'ad_' + Date.now().toString(36),
    label: String(body.label || 'Ad').slice(0, 40),
    url: String(body.url || 'https://example.com'),
    image: String(body.image || ''),
    price: Number(body.price || 0),
    paid: !!body.paid,
    slot: String(body.slot || 'side'),
    createdAt: Date.now(),
  };
  APP_CONFIG.ads = APP_CONFIG.ads || [];
  APP_CONFIG.ads.push(ad);
  saveConfig();
  res.json({ ok: true, ad });
});

app.delete('/admin/ads/:id', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin login required' });
  APP_CONFIG.ads = (APP_CONFIG.ads || []).filter(a => a.id !== req.params.id);
  saveConfig();
  res.json({ ok: true });
});

// --- Site controls: site title, maintenance mode, default country ---
app.put('/admin/site', express.json(), (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin login required' });
  const b = req.body || {};
  if ('siteTitle' in b) APP_CONFIG.siteTitle = String(b.siteTitle).slice(0, 80);
  if ('maintenanceMode' in b) APP_CONFIG.maintenanceMode = !!b.maintenanceMode;
  if ('defaultCountry' in b) APP_CONFIG.defaultCountry = String(b.defaultCountry || 'us').toLowerCase();
  if ('proxyLogEnabled' in b) APP_CONFIG.proxyLogEnabled = !!b.proxyLogEnabled;
  saveConfig();
  res.json({ ok: true, config: APP_CONFIG });
});

// --- Blocklist management ---
app.get('/admin/blocklist', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin login required' });
  res.json(APP_CONFIG.blocklist || []);
});
app.put('/admin/blocklist', express.json(), (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin login required' });
  const list = Array.isArray(req.body) ? req.body : (req.body.list || []);
  APP_CONFIG.blocklist = list.map(d => String(d || '').toLowerCase().trim()).filter(Boolean);
  saveConfig();
  res.json({ ok: true, blocklist: APP_CONFIG.blocklist });
});

// --- Ad-button manager (the 3 bottom buttons: HOT DEALS / FREE / GO PREMIUM) ---
app.get('/admin/ad-buttons', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin login required' });
  res.json(APP_CONFIG.adButtons || []);
});
app.put('/admin/ad-buttons', express.json(), (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin login required' });
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'array required' });
  APP_CONFIG.adButtons = req.body.map(b => ({
    label: String(b.label || 'BUTTON').slice(0, 30),
    url: String(b.url || 'https://example.com'),
    free: !!b.free,
  }));
  saveConfig();
  res.json({ ok: true, adButtons: APP_CONFIG.adButtons });
});

// --- Live proxy activity log (last 200 requests) ---
app.get('/admin/proxy-log', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'admin login required' });
  res.json(proxyLog);
});

// ─── WISP WEBSSOCKET PROXY SERVER ───────────────────────────────────
// Multiplexes TCP sockets over a single WebSocket so libcurl.js (WebAssembly)
// can fetch HTTPS directly from the browser with end-to-end TLS encryption.
// This eliminates the slow server-side fetch+rewrite pipeline.
try {
  const { server: wispServer } = require('@mercuryworkshop/wisp-js/server');
  const http = require('http');
  const wispHttp = http.createServer((req, res) => {
    res.writeHead(404);
    res.end('Wisp endpoint only');
  });
  // Share the same HTTP server upgrade for WebSocket
  const wispInstance = new wispServer({
    log_level: 'warn',
  });
  wispEnabled = true;
  // Attach Wisp to the Express server's upgrade event
  const existingServer = 

// ── Extension Download Routes ──
app.get('/extension/:browser', (req, res) => {
  const browser = req.params.browser;
  if (browser === 'chrome') {
    res.download('public/vpn-browser-extension.xpi', 'vpn-browser-extension.xpi', (err) => {
      if (err) res.status(404).send('Extension not available');
    });
  } else if (browser === 'edge') {
    res.download('public/vpn-browser-extension.zip', 'vpn-browser-extension.zip', (err) => {
      if (err) res.status(404).send('Extension not available');
    });
  } else if (browser === 'firefox') {
    res.download('public/vpn-browser-extension.zip', 'vpn-browser-extension.zip', (err) => {
      if (err) res.status(404).send('Extension not available');
    });
  } else {
    res.status(404).send('Not found');
  }
});

app.listen(PORT, () => {
    console.log(`VPN browser running on http://localhost:${PORT}`);
    console.log(`Wisp proxy attached on ws://localhost:${PORT}/wisp/`);
  });
  existingServer.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/wisp/')) {
      wispInstance.handleUpgrade(req, socket, head);
    }
  });
} catch (e) {
  wispEnabled = false;
  console.warn('[wisp] Failed to start Wisp server, falling back to server-side proxy:', e.message);
  

// ── Extension Download Routes ──
app.get('/extension/:browser', (req, res) => {
  const browser = req.params.browser;
  if (browser === 'chrome') {
    res.download('public/vpn-browser-extension.zip', 'vpn-browser-extension.zip', (err) => {
      if (err) res.status(404).send('Extension not available');
    });
  } else if (browser === 'edge') {
    res.download('public/vpn-browser-extension.zip', 'vpn-browser-extension.zip', (err) => {
      if (err) res.status(404).send('Extension not available');
    });
  } else if (browser === 'firefox') {
    res.download('public/vpn-browser-extension.zip', 'vpn-browser-extension.zip', (err) => {
      if (err) res.status(404).send('Extension not available');
    });
  } else {
    res.status(404).send('Not found');
  }
});

app.listen(PORT, () => console.log(`VPN browser running on http://localhost:${PORT} (no Wisp)`));
}
