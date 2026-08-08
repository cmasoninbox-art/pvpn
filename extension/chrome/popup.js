// Popup script for VPN Browser Proxy extension

document.getElementById('closeBtn').addEventListener('click', () => {
  window.close();
});

document.getElementById('refreshBtn').addEventListener('click', refreshStatus);
document.getElementById('checkTierBtn').addEventListener('click', checkTier);

async function refreshStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'PING' });
    updateUI(response);
  } catch (e) {
    document.getElementById('statusVal').textContent = 'Error';
    document.getElementById('statusVal').className = 'value inactive';
  }
}

async function checkTier() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_TIER' });
    updateUI(response);
  } catch (e) {
    document.getElementById('tierVal').textContent = 'Error';
  }
}

function updateUI(data) {
  const statusVal = document.getElementById('statusVal');
  const tierVal = document.getElementById('tierVal');
  const rulesVal = document.getElementById('rulesVal');
  
  if (data.status === 'ACTIVE') {
    statusVal.textContent = 'ACTIVE';
    statusVal.className = 'value active';
  } else {
    statusVal.textContent = 'INACTIVE';
    statusVal.className = 'value inactive';
  }
  
  if (data.tier) {
    tierVal.textContent = data.tier.toUpperCase();
  }
  
  if (data.rulesEnabled !== undefined) {
    rulesVal.textContent = data.rulesEnabled ? 'Enabled' : 'Disabled';
    rulesVal.className = data.rulesEnabled ? 'value active' : 'value inactive';
  }
}

// Initial load
refreshStatus();