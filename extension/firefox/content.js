// Content script - runs in page context
// Allows bidirectional communication with the main page

let isActive = true;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING') {
    sendResponse({ status: 'ACTIVE', version: '1.0.0' });
  } else if (message.type === 'PING_RESPONSE') {
    // Direct response handling
    if (typeof sendResponse === 'function') {
      sendResponse({ status: 'ACTIVE' });
    }
  }
  return true; // Keep message channel open
});

// Notify page that extension is ready
window.addEventListener('load', () => {
  chrome.runtime.sendMessage({ type: 'EXTENSION_READY' }, (response) => {
    // Extension initialized
    isActive = true;
  });
});