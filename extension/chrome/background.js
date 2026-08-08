// Background service worker - runs independently
// Tier-aware header stripping for VPN Browser proxy

const DEFAULT_RULES = [
  {
    id: 1,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'X-Frame-Options', operation: 'remove' },
        { header: 'X-Content-Security-Policy', operation: 'remove' },
        { header: 'X-WebKit-CSP', operation: 'remove' },
        { header: 'Content-Security-Policy', operation: 'remove' }
      ]
    },
    condition: {
      urlFilter: '||(pornhub|xvideos|xnxx|youporn).com/*',
      resourceTypes: ['main_frame', 'sub_frame', 'xmlhttprequest', 'image', 'stylesheet', 'script', 'font', 'media']
    }
  }
];

// Store user tier (will be synced from main site)
let userTier = 'free';
let rulesEnabled = false;

// Check user tier from the proxy server
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
      updateRules(rulesEnabled);
    }
  } catch (e) {
    // Default to enabled for free tier
    userTier = 'free';
    rulesEnabled = true;
    updateRules(true);
  }
}

// Update rules based on tier
async function updateRules(enable) {
  try {
    if (enable) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        addRules: DEFAULT_RULES,
        removeRules: [1]
      });
    } else {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRules: [1]
      });
    }
  } catch (e) {
    // Silently handle errors
  }
}

// Initialize on install
chrome.runtime.onInstalled.addListener(async () => {
  await checkUserTier();
});

// Initialize on startup
chrome.runtime.onStartup.addListener(async () => {
  await checkUserTier();
});

// Listen for messages from content script or popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    return true; // Keep channel open
  }
  return true;
});

// Poll for tier changes (every 5 minutes)
setInterval(checkUserTier, 5 * 60 * 1000);