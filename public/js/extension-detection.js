// Extension Detection and Smart Loading with Tier Check
(function() {
  // Get user tier from URL or default to free
  async function getUserTier() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('tier') || 'free';
  }
  
  // Check if extension is installed
  async function checkExtension() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        return new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(false), 3000);
          
          chrome.runtime.sendMessage({type: 'PING'}, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              resolve(false);
            } else {
              resolve(response?.status === 'ACTIVE');
            }
          });
        });
      }
    } catch (e) {}
    return false;
  }
  
  // Load content with smart fallback
  async function loadContent() {
    const urlParams = new URLSearchParams(window.location.search);
    const targetUrl = urlParams.get('url');
    const embedded = urlParams.get('embedded') === '1';
    const tier = await getUserTier();
    
    if (!targetUrl) {
      document.getElementById('fallbackMsg')?.style?.setProperty('display', 'block');
      return;
    }
    
    // Try extension check if embedded
    if (embedded) {
      const hasExtension = await checkExtension();
      
      if (hasExtension) {
        const directUrl = targetUrl + (targetUrl.includes('?') ? '&' : '?') + 'tier=' + encodeURIComponent(tier);
        window.location.href = directUrl;
        return;
      } else {
        const prompt = document.getElementById('extensionInstallPrompt');
        if (prompt) {
          prompt.style.display = 'flex';
        }
        return;
      }
    }
  }
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadContent);
  } else {
    loadContent();
  }
})();