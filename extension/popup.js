// popup.js
const API_BASE = 'https://b663-2409-40c4-4e-736b-fded-7253-27e-e157.ngrok-free.app'; // replace after deploy

const setupSection = document.getElementById('setup-section');
const connectedSection = document.getElementById('connected-section');
const linkCodeInput = document.getElementById('link-code');
const activateBtn = document.getElementById('activate-btn');
const statusMsg = document.getElementById('status-msg');
const disconnectBtn = document.getElementById('disconnect-btn');

// On load — check if already connected
chrome.storage.sync.get(['linkCode', 'connected'], (result) => {
  if (result.connected && result.linkCode) {
    showConnected();
  }
});

// Auto-uppercase input
linkCodeInput.addEventListener('input', () => {
  linkCodeInput.value = linkCodeInput.value.toUpperCase();
});

// Connect button
activateBtn.addEventListener('click', async () => {
  const code = linkCodeInput.value.trim();

  if (!code || code.length < 6) {
    showStatus('Enter a valid code like DSA-1234', 'error');
    return;
  }

  activateBtn.textContent = 'Connecting...';
  activateBtn.disabled = true;

  try {
    const res = await fetch(`${API_BASE}/api/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ link_code: code }),
    });

    const data = await res.json();

    if (data.success) {
      await chrome.storage.sync.set({ linkCode: code, connected: true });
      showConnected();
    } else {
      showStatus(data.error || 'Invalid code. Try again.', 'error');
      activateBtn.textContent = 'Connect Extension';
      activateBtn.disabled = false;
    }
  } catch (err) {
    showStatus('Could not reach server. Check your connection.', 'error');
    activateBtn.textContent = 'Connect Extension';
    activateBtn.disabled = false;
  }
});

// Disconnect
disconnectBtn.addEventListener('click', async () => {
  await chrome.storage.sync.remove(['linkCode', 'connected']);
  connectedSection.style.display = 'none';
  setupSection.style.display = 'block';
  linkCodeInput.value = '';
  activateBtn.textContent = 'Connect Extension';
  activateBtn.disabled = false;
});

function showConnected() {
  setupSection.style.display = 'none';
  connectedSection.style.display = 'block';
}

function showStatus(msg, type) {
  statusMsg.textContent = msg;
  statusMsg.className = `status ${type}`;
}