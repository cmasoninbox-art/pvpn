// Firefox background script - webRequest-based header stripping
// Uses webRequestBlocking (Firefox supports this in MV3)

const HEADERS_TO_STRIP = [
  'X-Frame-Options',
  'X-Content-Security-Policy',
  'X-WebKit-CSP',
  'Content-Security-Policy',
  'Content-Security-Policy-Report-Only'
];

const TARGET_PATTERNS = [
  /^https:\/\/[^/]*pornhub\.com\//,
  /^https:\/\/[^/]*xvideos\.com\//,
  /^https:\/\/[^/]*xnxx\.com\//,
  /^https:\/\/[^/]*youporn\.com\//,
  /^https:\/\/pvpn\.onrender\.com\//
];

let userTier = 'free';
let rulesEnabled = true;

function shouldStrip(url) {
  if (!rulesEnabled) return false;
  return TARGET_PATTERNS.some(p => p.test(url));
}

// Strip response headers
browser.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (!shouldStrip(details.url)) return {};
    let headers = details.responseHeaders.filter(
      h => !HEADERS_TO_STRIP.includes(h.name)
    );
    return { responseHeaders: headers };
  },
  { urls: ['<all_urls>'] },
  ['blocking', 'responseHeaders']
);

// Check user tier
async function checkUserTier() {
  try {
    const response = await fetch('https://pvpn.onrender.com/api/user-tier', {
      method: 'GET',
      credentials: 'include'
    });
    if (response.ok) {
      const data = await response.json();
      userTier = data.tier || 'free';
      rulesEnabled = (userTier === 'free' || userTier === 'premium');
    }
  } catch (e) {
    userTier = 'free';
    rulesEnabled = true;
  }
}

// Init
browser.runtime.onInstalled.addListener(checkUserTier);
browser.runtime.onStartup.addListener(checkUserTier);

// Messages
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({
      status: 'ACTIVE',
      tier: userTier,
      rulesEnabled: rulesEnabled,
      version: '1.0.0'
    });
  } else if (message.type === 'CHECK_TIER') {
    checkUserTier().then(() => {
      sendResponse({ tier: userTier });
    });
    return true;
  }
  return true;
});

// Poll every 5 min
setInterval(checkUserTier, 5 * 60 * 1000);