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
vpnMgr.warmup(['us', ...COUNTRIES.map(c => c.code)]);

const AD_SLOTS = {
  top: '<a href="/donate" target="_blank" rel="noopener"><img class="top-banner" src="/images/bannerpvpn.png" alt="DONATE TO" /></a>',
  bottom: '<a href="https://example.com" target="_blank" rel="noopener" style="color:#ff7a00;text-decoration:none;">Sponsored Link — Click Here</a>',
  left: `<div class="ad-slot-inner"><img class="side-ad-img" src="/images/sidead-temp.png" alt="ad" /></div>`,
  right: `<div class="ad-slot-inner"><img class="side-ad-img" src="/images/sidead-temp.png" alt="ad" /></div>`,
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
    paidAds: APP_CONFIG.ads || [],
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
      if (isPremium && country && country !== 'us') {
        agent = vpnMgr.agentForCountry(country);   // premium: chosen geo exit
      } else {
        agent = vpnMgr.getFreeUs(); // free + premium-US: free VPN permanently pinned to America
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
      redirect: 'follow',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const contentType = response.headers.get('content-type') || 'text/html';
    const body = await response.text();
    if (contentType.includes('text/html')) {
      const base = new URL(url);
      const proxyBase = '/proxy?url=' + encodeURIComponent(base.origin + '/');
      let rewritten = body
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
        // Inject <base> LAST so the href/src rewrites above don't double-process it.
        // Point it at our proxy so relative sub-resources resolve through us (not the real domain).
        .replace(/<head([^>]*)>/i, `<head$1><base href="${proxyBase}" target="_self">`);

      // Inject media-enforcement: cap video resolution to the enforced quality,
      // force playback rate and subtitle mode on every <video>, even ones created later.
      const settings = getMediaSettings(req);
      const enforcement = `
<script>
(function(){
  // Disable right-click inside the proxied browser content too
  document.addEventListener('contextmenu', function(e){ e.preventDefault(); return false; });
  var ENF = ${JSON.stringify(settings)};
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
  function applyAll(){ var vs=document.querySelectorAll('video'); for(var i=0;i<vs.length;i++){ applyVideo(vs[i]); } }
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
      // Rewrite absolute URLs INSIDE <script> content (JSON-LD, JSON config, string literals,
      // window.open() targets) so sites like Pornhub don't escape the proxy and trip their
      // own X-Frame-Options. Keep relative + data: + the proxy itself intact.
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
      rewritten = rewritten.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (m, open, code, close) => {
        // Catch http(s)://, //, and the backslash-escaped \/\/ forms Pornhub emits in JSON.
        const fixed = code.replace(/(?:https?:)?\/\/[^\s"'`>]+/g, (tok) => {
          if (tok.startsWith('//')) {
            return proxyWrap('https:' + tok); // protocol-relative -> https absolute
          }
          return proxyWrap(tok);
        });
        return open + fixed + close;
      });
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
      // CSP: everything flows through our origin so framed sites can't load the real domain
      // (which would serve X-Frame-Options: DENY and break framing). Sandbox already allows
      // scripts/forms/same-origin/popups.
      const csp = [
        "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:",
        "img-src 'self' data: blob: *",
        "media-src 'self' data: blob: *",
        "connect-src 'self' *",
        "frame-ancestors 'self'",
        "base-uri 'self'",
      ].join('; ');
      res.set('Content-Type', 'text/html');
      res.set('Content-Security-Policy', csp);
      // Strip upstream X-Frame-Options and X-Content-Type-Options that block iframe embedding
      res.removeHeader('x-frame-options');
      res.removeHeader('x-content-type-options');
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      res.send(rewritten + enforcement);
      return;
    }
    res.set('Content-Type', contentType);
    // Strip upstream X-Frame-Options for all proxied responses
    res.removeHeader('x-frame-options');
    res.removeHeader('x-content-type-options');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.send(body);
  } catch (e) {
    res.status(502).send(`Proxy error: ${e.message}`);
  }
}

app.get('/proxy', proxyHandler);
app.post('/proxy', express.urlencoded({ extended: true }), express.json(), (req, res) => proxyHandler(req, res));

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
      metadata: { tier, product: config.name },
      integration_identifier: 'pvpn_premium_xk9vcd6f',
    };

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
  if (sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      tierName = session.metadata?.product || 'Premium';
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
<p>Your payment was successful. You now have full premium access.</p>
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
    console.log(`[Stripe] Payment completed: ${session.metadata?.tier} — $${(session.amount_total/100).toFixed(2)} — ${session.customer_email || session.customer_details?.email}`);
    // TODO: activate premium in your user DB, send confirmation email, etc.
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

// Per-IP media settings, posted by the client media bar so the injected
// enforcement script can read enforced quality/speed/subtitles.
const mediaSettingsStore = new Map();
function getMediaSettings(req) {
  const key = req.ip || req.connection.remoteAddress || 'anon';
  return mediaSettingsStore.get(key) || { quality: '480', speed: '1', subtitles: 'off' };
}
app.post('/media-settings', express.json(), (req, res) => {
  const key = req.ip || req.connection.remoteAddress || 'anon';
  const body = req.body || {};
  mediaSettingsStore.set(key, {
    quality: String(body.quality || '480'),
    speed: String(body.speed || '1'),
    subtitles: String(body.subtitles || 'off'),
  });
  res.json({ ok: true });
});

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

app.listen(PORT, () => console.log(`VPN browser running on http://localhost:${PORT}`));
