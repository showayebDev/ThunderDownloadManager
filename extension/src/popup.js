// Extension popup UI controller

const API = (typeof chrome !== 'undefined' && chrome && chrome.runtime) ? chrome : (typeof browser !== 'undefined' ? browser : null);

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
const extensionVersionEl = document.getElementById('extension-version');

// Populate runtime manifest version
try {
  const manifest = API.runtime?.getManifest ? API.runtime.getManifest() : null;
  if (manifest?.version && extensionVersionEl) {
    extensionVersionEl.textContent = `v${manifest.version}`;
  }
} catch {}

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

const DEFAULT_CONFIG = {
  interceptDownloads: true,
  interceptVideos: true,
  showVideoBadge: false,
  badgeMode: 'never',
  unhoverDelay: 3,
  serverPort: 37555,
  passCookies: true
};

let currentConfig = { ...DEFAULT_CONFIG };
let hasUserModifiedConfig = false;

function readLocalCacheConfig() {
  try {
    const raw = window.localStorage.getItem('thunderdm_config');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch {}
  return null;
}

function writeLocalCacheConfig(cfg) {
  try {
    window.localStorage.setItem('thunderdm_config', JSON.stringify(cfg));
  } catch {}
}

function storageGetConfig() {
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        chrome.storage.local.get(['config'], (res) => {
          if (chrome.runtime && chrome.runtime.lastError) {}
          resolve(res?.config || null);
        });
        return;
      }
      if (typeof browser !== 'undefined' && browser?.storage?.local) {
        browser.storage.local.get(['config']).then((res) => {
          resolve(res?.config || null);
        }).catch(() => resolve(null));
        return;
      }
    } catch {}
    resolve(null);
  });
}

function storageSetConfig(cfg) {
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        chrome.storage.local.set({ config: cfg }, () => {
          if (chrome.runtime && chrome.runtime.lastError) {}
          resolve(true);
        });
        return;
      }
      if (typeof browser !== 'undefined' && browser?.storage?.local) {
        browser.storage.local.set({ config: cfg }).then(() => resolve(true)).catch(() => resolve(false));
        return;
      }
    } catch {}
    resolve(false);
  });
}

function applyConfigToUI(cfg) {
  if (!cfg || typeof cfg !== 'object') return;
  currentConfig = { ...DEFAULT_CONFIG, ...currentConfig, ...cfg };

  if (toggleIntercept) {
    toggleIntercept.checked = currentConfig.interceptDownloads !== undefined ? Boolean(currentConfig.interceptDownloads) : true;
  }

  if (togglePassCookies) {
    togglePassCookies.checked = currentConfig.passCookies !== undefined ? Boolean(currentConfig.passCookies) : true;
  }

  // Badge display mode ('hover', 'always', or 'never')
  let mode = currentConfig.badgeMode;
  if (!mode || !['hover', 'always', 'never'].includes(mode)) {
    mode = currentConfig.showVideoBadge === true ? 'hover' : 'never';
  }
  currentConfig.badgeMode = mode;
  currentConfig.showVideoBadge = mode !== 'never';

  if (selectBadgeMode) {
    selectBadgeMode.value = mode;
  }

  const delay = currentConfig.unhoverDelay !== undefined ? Number(currentConfig.unhoverDelay) : 3;
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

  currentServerPort = Number(currentConfig.serverPort) || 37555;
  if (inputServerPort) {
    inputServerPort.value = currentServerPort;
  }
}

// 1. Immediately apply cached config synchronously to prevent any UI revert/flicker
const cachedCfg = readLocalCacheConfig();
if (cachedCfg) {
  applyConfigToUI(cachedCfg);
}

// 2. Load from extension storage.local directly (with background fallback)
(async () => {
  const storedCfg = await storageGetConfig();
  if (storedCfg && !hasUserModifiedConfig) {
    applyConfigToUI(storedCfg);
    writeLocalCacheConfig(currentConfig);
  } else if (!storedCfg && !cachedCfg) {
    try {
      API.runtime.sendMessage({ action: 'GET_CONFIG' }, (res) => {
        if (API.runtime && API.runtime.lastError) return;
        if (res && res.config && !hasUserModifiedConfig) {
          applyConfigToUI(res.config);
          writeLocalCacheConfig(currentConfig);
          storageSetConfig(currentConfig);
        }
      });
    } catch {}
  } else if (cachedCfg && !storedCfg) {
    // Restore cached config into storage.local if storage was empty
    storageSetConfig(currentConfig);
  }

  // Auto-probe active port in background to smoothly handle cases where 37555 is in use
  probeHealth(currentServerPort).then((health) => {
    if (health && health.success && health.fallbackDetected) {
      if (inputServerPort) inputServerPort.value = health.port;
      currentServerPort = health.port;
      broadcastConfig({ serverPort: health.port });
    }
  });
})();

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
  hasUserModifiedConfig = true;

  const uiSnapshot = {
    interceptDownloads: toggleIntercept ? Boolean(toggleIntercept.checked) : currentConfig.interceptDownloads,
    passCookies: togglePassCookies ? Boolean(togglePassCookies.checked) : currentConfig.passCookies,
    badgeMode: selectBadgeMode ? selectBadgeMode.value : currentConfig.badgeMode,
    showVideoBadge: (selectBadgeMode ? selectBadgeMode.value : currentConfig.badgeMode) !== 'never',
    unhoverDelay: inputHoverDelay ? (Number(inputHoverDelay.value) || 3) : currentConfig.unhoverDelay,
    serverPort: currentServerPort || currentConfig.serverPort || 37555
  };

  currentConfig = {
    ...DEFAULT_CONFIG,
    ...currentConfig,
    ...uiSnapshot,
    ...newConfig
  };

  // 1. Save synchronously to localStorage (survives instant popup close)
  writeLocalCacheConfig(currentConfig);

  // 2. Save directly to extension storage.local
  storageSetConfig(currentConfig);

  // 3. Notify background service worker and active tab
  try {
    API.runtime.sendMessage({
      action: 'SET_CONFIG',
      config: currentConfig
    }, () => {
      if (API.runtime && API.runtime.lastError) {}
    });
  } catch {}

  if (currentTab?.id) {
    try {
      API.tabs.sendMessage(currentTab.id, { action: 'UPDATE_CONFIG', config: currentConfig }, () => {
        if (API.runtime.lastError) {}
      });
    } catch {}
  }
}

// Active tab inspection
API.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (API.runtime && API.runtime.lastError) return;
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
    if (API.runtime && API.runtime.lastError) {}
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

// Active Browser Downloads -> Transfer to Thunder
const browserDownloadsCard = document.getElementById('browser-downloads-card');
const browserDownloadsCount = document.getElementById('browser-downloads-count');
const browserDownloadsList = document.getElementById('browser-downloads-list');
const transferringDownloadIds = new Set();

function formatBytes(bytes) {
  const num = Number(bytes);
  if (!num || isNaN(num) || num <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.min(Math.floor(Math.log(num) / Math.log(k)), units.length - 1);
  const val = num / Math.pow(k, i);
  return `${val >= 100 || i === 0 ? Math.round(val) : val.toFixed(1).replace(/\.0$/, '')} ${units[i]}`;
}

function formatDownloadProgress(item) {
  const received = Number(item.bytesReceived) || 0;
  const total = Number(item.totalBytes) || 0;
  if (total > 0) {
    const pct = Math.min(100, Math.round((received / total) * 100));
    return `${formatBytes(received)} / ${formatBytes(total)} (${pct}%)`;
  }
  return `${formatBytes(received)}`;
}

function updateDownloadItemElement(itemEl, item) {
  itemEl._downloadData = item;

  const filenameEl = itemEl.querySelector('.browser-dl-filename');
  if (filenameEl) {
    const fname = item.filename || 'Download_File';
    if (filenameEl.textContent !== fname) filenameEl.textContent = fname;
    if (filenameEl.title !== fname) filenameEl.title = fname;
  }

  const statusTagEl = itemEl.querySelector('.browser-dl-status-tag');
  if (statusTagEl) {
    if (item.paused) {
      statusTagEl.textContent = 'Paused';
      statusTagEl.className = 'browser-dl-status-tag paused';
    } else if (item.state === 'interrupted') {
      statusTagEl.textContent = 'Interrupted';
      statusTagEl.className = 'browser-dl-status-tag interrupted';
    } else {
      statusTagEl.textContent = '';
      statusTagEl.className = 'browser-dl-status-tag hidden';
    }
  }

  const progressFillEl = itemEl.querySelector('.browser-dl-progress-fill');
  if (progressFillEl) {
    const total = Number(item.totalBytes) || 0;
    const received = Number(item.bytesReceived) || 0;
    if (total > 0) {
      const pct = Math.min(100, Math.max(2, Math.round((received / total) * 100)));
      progressFillEl.classList.remove('indeterminate');
      progressFillEl.style.width = `${pct}%`;
    } else if (item.state === 'in_progress' && !item.paused) {
      progressFillEl.classList.add('indeterminate');
    } else {
      progressFillEl.classList.remove('indeterminate');
      progressFillEl.style.width = '0%';
    }
  }

  const progressTextEl = itemEl.querySelector('.browser-dl-progress-text');
  if (progressTextEl) {
    const text = formatDownloadProgress(item);
    if (progressTextEl.textContent !== text) {
      progressTextEl.textContent = text;
    }
  }

  const transferBtn = itemEl.querySelector('.btn-transfer-thunder');
  if (transferBtn) {
    const isTransferring = transferringDownloadIds.has(item.id);
    transferBtn.disabled = isTransferring;
    transferBtn.textContent = isTransferring ? '⏳ Transferring...' : '⚡ Transfer to Thunder';
  }
}

function createDownloadItemElement(item) {
  const itemEl = document.createElement('div');
  itemEl.className = 'browser-download-item';
  itemEl.dataset.downloadId = String(item.id);

  const topRow = document.createElement('div');
  topRow.className = 'browser-dl-top-row';

  const filenameEl = document.createElement('div');
  filenameEl.className = 'browser-dl-filename truncate';

  const statusTagEl = document.createElement('span');
  statusTagEl.className = 'browser-dl-status-tag hidden';

  topRow.appendChild(filenameEl);
  topRow.appendChild(statusTagEl);

  const progressBar = document.createElement('div');
  progressBar.className = 'browser-dl-progress-bar';

  const progressFill = document.createElement('div');
  progressFill.className = 'browser-dl-progress-fill';
  progressBar.appendChild(progressFill);

  const footer = document.createElement('div');
  footer.className = 'browser-dl-footer';

  const progressText = document.createElement('div');
  progressText.className = 'browser-dl-progress-text';

  const transferBtn = document.createElement('button');
  transferBtn.type = 'button';
  transferBtn.className = 'btn-transfer-thunder';
  transferBtn.title = 'Cancel browser download and transfer to Thunder Download Manager';
  transferBtn.addEventListener('click', () => {
    const currentItem = itemEl._downloadData || item;
    transferBrowserDownloadToThunder(currentItem, itemEl, transferBtn);
  });

  footer.appendChild(progressText);
  footer.appendChild(transferBtn);

  itemEl.appendChild(topRow);
  itemEl.appendChild(progressBar);
  itemEl.appendChild(footer);

  updateDownloadItemElement(itemEl, item);
  return itemEl;
}

function transferBrowserDownloadToThunder(item, itemEl, btnEl) {
  if (!item || !item.id || transferringDownloadIds.has(item.id)) return;

  transferringDownloadIds.add(item.id);
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = '⏳ Transferring...';
  }
  showToast('Transferring to ThunderDM...');

  try {
    API.runtime.sendMessage({
      action: 'TRANSFER_BROWSER_DOWNLOAD',
      downloadId: item.id,
      item: item
    }, (res) => {
      if (API.runtime && API.runtime.lastError) {}

      if (res && res.success) {
        showToast('⚡ Transferred to ThunderDM! ✓');
        if (itemEl && itemEl.parentNode) {
          itemEl.remove();
        }
        transferringDownloadIds.delete(item.id);
        loadBrowserDownloads();
      } else {
        transferringDownloadIds.delete(item.id);
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.textContent = '⚡ Transfer to Thunder';
        }
        const errMsg = res?.error || 'Thunder Download Manager is not running in background.';
        showToast(errMsg, 4000);
      }
    });
  } catch {
    transferringDownloadIds.delete(item.id);
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = '⚡ Transfer to Thunder';
    }
    showToast('Could not transfer download to ThunderDM.', 3500);
  }
}

function renderBrowserDownloads(downloads) {
  if (!browserDownloadsCard || !browserDownloadsList) return;

  if (!Array.isArray(downloads) || downloads.length === 0) {
    browserDownloadsCard.classList.add('hidden');
    browserDownloadsList.innerHTML = '';
    if (browserDownloadsCount) browserDownloadsCount.textContent = '0';
    return;
  }

  browserDownloadsCard.classList.remove('hidden');
  if (browserDownloadsCount) {
    browserDownloadsCount.textContent = String(downloads.length);
  }

  const validIds = new Set(downloads.map((d) => String(d.id)));

  // Remove stale items
  for (const child of Array.from(browserDownloadsList.children)) {
    if (!validIds.has(child.dataset.downloadId)) {
      child.remove();
    }
  }

  // Update or insert items in order
  downloads.forEach((item, index) => {
    const idStr = String(item.id);
    let existingEl = browserDownloadsList.querySelector(`.browser-download-item[data-download-id="${idStr}"]`);
    if (existingEl) {
      updateDownloadItemElement(existingEl, item);
      const currentAtIndex = browserDownloadsList.children[index];
      if (currentAtIndex !== existingEl) {
        browserDownloadsList.insertBefore(existingEl, currentAtIndex || null);
      }
    } else {
      const newEl = createDownloadItemElement(item);
      const currentAtIndex = browserDownloadsList.children[index];
      browserDownloadsList.insertBefore(newEl, currentAtIndex || null);
    }
  });
}

function loadBrowserDownloads() {
  if (!API.runtime || typeof API.runtime.sendMessage !== 'function') return;
  try {
    API.runtime.sendMessage({ action: 'GET_BROWSER_DOWNLOADS' }, (res) => {
      if (API.runtime && API.runtime.lastError) return;
      renderBrowserDownloads(res?.downloads || []);
    });
  } catch {}
}

loadBrowserDownloads();
setInterval(loadBrowserDownloads, 1000);

