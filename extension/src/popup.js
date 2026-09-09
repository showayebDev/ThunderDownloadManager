// Extension popup UI controller

const API = typeof browser !== 'undefined' ? browser : chrome;

const targetUrlInput = document.getElementById('target-url');
const pageTitleEl = document.getElementById('page-title');
const btnCopyUrl = document.getElementById('btn-copy-url');
const btnYtdlp = document.getElementById('btn-ytdlp');
const btnThunderDM = document.getElementById('btn-thunderdm');
const toggleIntercept = document.getElementById('toggle-intercept-downloads');
const togglePassCookies = document.getElementById('toggle-pass-cookies');
const selectBadgeMode = document.getElementById('select-badge-mode');
const hoverDelayContainer = document.getElementById('hover-delay-container');
const inputHoverDelay = document.getElementById('input-hover-delay');
const labelHoverDelay = document.getElementById('label-hover-delay');
const toastEl = document.getElementById('toast');
const btnDownloadApp = document.getElementById('btn-download-app');

// Advanced config controls
const btnToggleAdvanced = document.getElementById('btn-toggle-advanced');
const accordionArrow = document.getElementById('accordion-arrow');
const advancedPanel = document.getElementById('advanced-panel');
const inputServerPort = document.getElementById('input-server-port');
const btnTestConnection = document.getElementById('btn-test-connection');
const testBtnText = document.getElementById('test-btn-text');
const connectionResult = document.getElementById('connection-result');

let currentTab = null;
let currentServerPort = 37555;

function showToast(msg, duration = 2500) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  setTimeout(() => {
    toastEl.classList.add('hidden');
  }, duration);
}

function isVideoUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('youtube.com') ||
    lower.includes('youtu.be') ||
    lower.includes('facebook.com') ||
    lower.includes('fb.watch') ||
    lower.includes('tiktok.com') ||
    lower.includes('instagram.com') ||
    lower.includes('twitter.com') ||
    lower.includes('x.com') ||
    lower.includes('vimeo.com') ||
    lower.includes('dailymotion.com') ||
    lower.includes('.m3u8')
  );
}

// Load user preferences
API.runtime.sendMessage({ action: 'GET_CONFIG' }, (res) => {
  if (res && res.config) {
    if (toggleIntercept) {
      toggleIntercept.checked = res.config.interceptDownloads !== undefined ? Boolean(res.config.interceptDownloads) : true;
    }

    if (togglePassCookies) {
      togglePassCookies.checked = Boolean(res.config.passCookies);
    }
    
    // Badge display mode ('hover', 'always', or 'never')
    let mode = res.config.badgeMode;
    if (!mode) {
      mode = res.config.showVideoBadge === true ? 'hover' : 'never';
    }

    if (selectBadgeMode) {
      selectBadgeMode.value = mode;
    }

    const delay = res.config.unhoverDelay !== undefined ? Number(res.config.unhoverDelay) : 3;
    if (inputHoverDelay) {
      inputHoverDelay.value = delay;
    }
    if (labelHoverDelay) {
      labelHoverDelay.textContent = `${delay}s`;
    }

    if (hoverDelayContainer) {
      if (mode === 'hover') {
        hoverDelayContainer.classList.remove('hidden');
      } else {
        hoverDelayContainer.classList.add('hidden');
      }
    }

    // Native app port
    currentServerPort = Number(res.config.serverPort) || 37555;
    if (inputServerPort) {
      inputServerPort.value = currentServerPort;
    }

    // Auto-probe active port in background to smoothly handle cases where 37555 is in use
    probeHealth(currentServerPort).then((health) => {
      if (health && health.success && health.fallbackDetected) {
        if (inputServerPort) inputServerPort.value = health.port;
        currentServerPort = health.port;
        broadcastConfig({ serverPort: health.port });
      }
    });
  }
});

// Toggle advanced settings collapsible panel
if (btnToggleAdvanced && advancedPanel && accordionArrow) {
  btnToggleAdvanced.addEventListener('click', () => {
    const isHidden = advancedPanel.classList.contains('hidden');
    if (isHidden) {
      advancedPanel.classList.remove('hidden');
      accordionArrow.classList.add('open');
    } else {
      advancedPanel.classList.add('hidden');
      accordionArrow.classList.remove('open');
    }
  });
}

// Validate and update port
if (inputServerPort) {
  const savePort = () => {
    let port = parseInt(inputServerPort.value, 10);
    if (isNaN(port) || port < 1024 || port > 65535) {
      port = 37555;
      inputServerPort.value = port;
    }
    currentServerPort = port;
    broadcastConfig({ serverPort: port });
  };

  inputServerPort.addEventListener('change', savePort);
  inputServerPort.addEventListener('blur', savePort);
}

// Helper to directly probe health endpoint with fallback ports
async function probeHealth(port) {
  const targetPort = Number(port) || 37555;
  const candidatePorts = [targetPort, 57211, 9988, 37555].filter((v, i, a) => a.indexOf(v) === i);
  const hosts = ['127.0.0.1', 'localhost'];

  for (const p of candidatePorts) {
    for (const host of hosts) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1800);
        const res = await fetch(`http://${host}:${p}/health`, {
          method: 'GET',
          signal: controller.signal,
          cache: 'no-store'
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          const data = await res.json();
          if (data && data.app === 'ThunderDM') {
            return {
              success: true,
              port: p,
              host,
              data,
              fallbackDetected: p !== targetPort,
              originalPort: targetPort
            };
          }
        }
      } catch {}
    }
  }
  return { success: false, port: targetPort };
}

// Test connection to desktop app
if (btnTestConnection) {
  btnTestConnection.addEventListener('click', async () => {
    let port = parseInt(inputServerPort?.value, 10);
    if (isNaN(port) || port < 1024 || port > 65535) {
      port = 37555;
      if (inputServerPort) inputServerPort.value = port;
    }
    currentServerPort = port;
    broadcastConfig({ serverPort: port });

    if (testBtnText) testBtnText.textContent = 'Testing...';
    btnTestConnection.disabled = true;

    if (connectionResult) {
      connectionResult.classList.add('hidden');
      connectionResult.className = 'connection-result';
    }

    try {
      // 1. Try via background service worker
      let testRes = await new Promise((resolve) => {
        try {
          API.runtime.sendMessage({ action: 'TEST_CONNECTION', port: port }, (res) => {
            if (API.runtime.lastError) {
              resolve({ success: false });
            } else {
              resolve(res || { success: false });
            }
          });
        } catch {
          resolve({ success: false });
        }
      });

      // 2. If background failed, fallback to direct probe
      if (!testRes || !testRes.success) {
        testRes = await probeHealth(port);
      }

      btnTestConnection.disabled = false;
      if (testBtnText) testBtnText.textContent = 'Test Connection';

      if (connectionResult) {
        connectionResult.classList.remove('hidden');
        if (testRes && testRes.success) {
          const activePort = testRes.port || port;
          if (testRes.fallbackDetected) {
            if (inputServerPort) inputServerPort.value = activePort;
            currentServerPort = activePort;
            broadcastConfig({ serverPort: activePort });
          }

          if (testRes.data && testRes.data.browser_integration === false) {
            connectionResult.className = 'connection-result warning';
            connectionResult.textContent = `⚠️ Connected on port ${activePort}, but Browser Integration is DISABLED in ThunderDM Settings!`;
          } else if (testRes.fallbackDetected) {
            connectionResult.className = 'connection-result success';
            connectionResult.textContent = `✓ Connected to ThunderDM on fallback port ${activePort} (Port ${port} is occupied).`;
          } else {
            connectionResult.className = 'connection-result success';
            connectionResult.textContent = `✓ Successfully connected to ThunderDM on port ${activePort}!`;
          }
        } else {
          connectionResult.className = 'connection-result error';
          connectionResult.textContent = `✗ Could not connect on port ${port}. Please ensure ThunderDM is running.`;
        }
      }
    } catch {
      btnTestConnection.disabled = false;
      if (testBtnText) testBtnText.textContent = 'Test Connection';
      if (connectionResult) {
        connectionResult.classList.remove('hidden');
        connectionResult.className = 'connection-result error';
        connectionResult.textContent = `✗ Could not connect on port ${port}. Please ensure ThunderDM is running.`;
      }
    }
  });
}

// Settings handlers
if (toggleIntercept) {
  toggleIntercept.addEventListener('change', () => {
    const newConfig = { interceptDownloads: toggleIntercept.checked };
    broadcastConfig(newConfig);
  });
}

if (togglePassCookies) {
  togglePassCookies.addEventListener('change', () => {
    const newConfig = { passCookies: togglePassCookies.checked };
    broadcastConfig(newConfig);
  });
}

if (selectBadgeMode) {
  selectBadgeMode.addEventListener('change', () => {
    const mode = selectBadgeMode.value;
    if (hoverDelayContainer) {
      if (mode === 'hover') {
        hoverDelayContainer.classList.remove('hidden');
      } else {
        hoverDelayContainer.classList.add('hidden');
      }
    }

    const newConfig = {
      badgeMode: mode,
      showVideoBadge: mode !== 'never'
    };
    broadcastConfig(newConfig);
  });
}

if (inputHoverDelay) {
  inputHoverDelay.addEventListener('input', () => {
    const delay = Number(inputHoverDelay.value) || 3;
    if (labelHoverDelay) {
      labelHoverDelay.textContent = `${delay}s`;
    }
    broadcastConfig({ unhoverDelay: delay });
  });
}

function broadcastConfig(newConfig) {
  API.runtime.sendMessage({
    action: 'SET_CONFIG',
    config: newConfig
  });
  if (currentTab?.id) {
    try {
      API.tabs.sendMessage(currentTab.id, { action: 'UPDATE_CONFIG', config: newConfig }, () => {
        if (API.runtime.lastError) {}
      });
    } catch {}
  }
}

// Active tab inspection
API.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs && tabs[0]) {
    currentTab = tabs[0];
    const url = currentTab.url || '';
    const title = currentTab.title || 'Untitled Page';

    if (targetUrlInput) targetUrlInput.value = url;
    if (pageTitleEl) pageTitleEl.textContent = title;

    if (btnYtdlp) {
      if (isVideoUrl(url)) {
        btnYtdlp.classList.remove('hidden');
      } else {
        btnYtdlp.classList.remove('hidden');
      }
    }
  }
});

if (targetUrlInput) {
  targetUrlInput.addEventListener('input', () => {
    const url = targetUrlInput.value.trim();
    if (btnYtdlp && isVideoUrl(url)) {
      btnYtdlp.classList.remove('hidden');
    }
  });
}

if (btnCopyUrl) {
  btnCopyUrl.addEventListener('click', () => {
    if (targetUrlInput && targetUrlInput.value) {
      navigator.clipboard.writeText(targetUrlInput.value);
      showToast('URL Copied to Clipboard!');
    }
  });
}

if (btnDownloadApp) {
  btnDownloadApp.addEventListener('click', (e) => {
    e.preventDefault();
    const releaseUrl = 'https://github.com/showayebDev/ThunderDownloadManager/releases/latest';
    if (API && API.tabs && typeof API.tabs.create === 'function') {
      API.tabs.create({ url: releaseUrl });
    } else {
      window.open(releaseUrl, '_blank');
    }
  });
}

// Download triggers
if (btnYtdlp) {
  btnYtdlp.addEventListener('click', () => {
    triggerDownload(true);
  });
}

if (btnThunderDM) {
  btnThunderDM.addEventListener('click', () => {
    triggerDownload(false);
  });
}

function triggerDownload(isYTDLP) {
  const url = targetUrlInput ? targetUrlInput.value.trim() : '';
  if (!url) {
    showToast('Please enter a valid URL');
    return;
  }

  if (url.startsWith('blob:') || url.startsWith('data:') || url.startsWith('file:')) {
    showToast('Blob / RAM URLs are handled natively by the browser.', 3500);
    return;
  }

  showToast('Opening in ThunderDM...');

  const payload = {
    url: url,
    title: pageTitleEl ? pageTitleEl.textContent || '' : '',
    referrer: currentTab?.url || '',
    is_ytdlp: isYTDLP,
    protocol: isYTDLP ? 'Yt-DLP' : 'Auto'
  };

  API.runtime.sendMessage({ action: 'SEND_DOWNLOAD', payload }, (res) => {
    if (res && res.success) {
      showToast('Opened in ThunderDM! ✓');
      setTimeout(() => {
        window.close();
      }, 1000);
    } else {
      const errMsg = res?.error || 'Thunder Download Manager is not running in background.';
      showToast(errMsg, 4000);
      alert(errMsg + '\nPlease start Thunder Download Manager on your computer.');
    }
  });
}
