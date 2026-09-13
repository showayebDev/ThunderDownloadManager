// Background service worker for extension event handling

const API = typeof browser !== 'undefined' ? browser : chrome;

const serviceWorkerStartTime = Date.now();
const STARTUP_GRACE_PERIOD_MS = 3500; // Ignore automatic restored session downloads on startup

const THUNDER_DEFAULT_PORTS = [37555, 57211, 9988];
let isThunderRunning = false;
let lastContextMedia = null;
let config = {
  interceptDownloads: true,
  interceptVideos: true,
  showVideoBadge: false,
  badgeMode: 'never',
  unhoverDelay: 3,
  serverPort: 37555,
  passCookies: false
};

// Load stored settings
API.storage.local.get(['config'], (result) => {
  if (result && result.config) {
    config = { ...config, ...result.config };
  }
});

const bypassedDownloadUrls = new Map();
const bypassedDownloadIds = new Set();
const interceptedDownloadIds = new Set();
const cancelledDownloadIds = new Set();

// Helper to safely consume lastError
function consumeLastError() {
  return (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.lastError) ||
         (typeof browser !== 'undefined' && browser.runtime && browser.runtime.lastError) ||
         (API && API.runtime && API.runtime.lastError);
}

// Immediately discover and mark all pre-existing downloads from earlier sessions as bypassed
if (API.downloads && typeof API.downloads.search === 'function') {
  try {
    API.downloads.search({}, (items) => {
      consumeLastError();
      if (Array.isArray(items)) {
        for (const item of items) {
          if (item && item.id) {
            bypassedDownloadIds.add(item.id);
            interceptedDownloadIds.add(item.id);
            cancelledDownloadIds.add(item.id);
          }
        }
      }
    });
  } catch {}
}

function addBypassedUrl(url) {
  if (!url) return;
  const now = Date.now();
  bypassedDownloadUrls.set(url, now);
  try {
    const parsed = new URL(url);
    const clean = parsed.origin + parsed.pathname;
    bypassedDownloadUrls.set(clean, now);
  } catch {}
}

function isBypassed(downloadItemOrUrl) {
  const now = Date.now();
  for (const [urlKey, ts] of bypassedDownloadUrls.entries()) {
    if (now - ts > 60000) {
      bypassedDownloadUrls.delete(urlKey);
    }
  }

  if (typeof downloadItemOrUrl === 'number') {
    return bypassedDownloadIds.has(downloadItemOrUrl) || interceptedDownloadIds.has(downloadItemOrUrl) || cancelledDownloadIds.has(downloadItemOrUrl);
  }

  if (typeof downloadItemOrUrl === 'string') {
    if (bypassedDownloadUrls.has(downloadItemOrUrl)) return true;
    try {
      const parsed = new URL(downloadItemOrUrl);
      const clean = parsed.origin + parsed.pathname;
      if (bypassedDownloadUrls.has(clean)) return true;
    } catch {}
    return false;
  }

  if (downloadItemOrUrl && typeof downloadItemOrUrl === 'object') {
    const id = downloadItemOrUrl.id;
    if (id && (bypassedDownloadIds.has(id) || interceptedDownloadIds.has(id) || cancelledDownloadIds.has(id))) return true;

    const url = downloadItemOrUrl.url;
    const finalUrl = downloadItemOrUrl.finalUrl;

    if (url && isBypassed(url)) return true;
    if (finalUrl && isBypassed(finalUrl)) return true;
  }

  return false;
}

function shouldInterceptDownload(downloadItem) {
  if (!config.interceptDownloads) return false;
  if (!downloadItem) return false;

  const id = downloadItem.id;
  if (id && (bypassedDownloadIds.has(id) || interceptedDownloadIds.has(id) || cancelledDownloadIds.has(id))) {
    return false;
  }

  // 1. Only in-progress downloads should ever be intercepted
  if (downloadItem.state && downloadItem.state !== 'in_progress') {
    if (id) bypassedDownloadIds.add(id);
    return false;
  }

  // 2. Filter out historical or restored downloads from previous browser sessions
  if (downloadItem.startTime) {
    const itemStartTime = new Date(downloadItem.startTime).getTime();
    if (!isNaN(itemStartTime) && itemStartTime < serviceWorkerStartTime - 1000) {
      if (id) bypassedDownloadIds.add(id);
      return false;
    }
  }

  // 3. Ignore downloads during browser startup grace period (when tabs/sessions are restoring)
  if (Date.now() - serviceWorkerStartTime < STARTUP_GRACE_PERIOD_MS) {
    if (id) bypassedDownloadIds.add(id);
    return false;
  }

  // 4. Ignore downloads that are errored, cancelled, or paused
  if (downloadItem.error || downloadItem.paused) {
    if (id) bypassedDownloadIds.add(id);
    return false;
  }

  // 5. Ignore non-HTTP/HTTPS and internal browser protocols
  const url = downloadItem.url || downloadItem.finalUrl;
  if (!url) return false;

  const lowerUrl = url.toLowerCase();
  if (
    lowerUrl.startsWith('blob:') ||
    lowerUrl.startsWith('data:') ||
    lowerUrl.startsWith('file:') ||
    lowerUrl.startsWith('chrome:') ||
    lowerUrl.startsWith('chrome-extension:') ||
    lowerUrl.startsWith('moz-extension:') ||
    lowerUrl.startsWith('edge:') ||
    lowerUrl.startsWith('about:') ||
    lowerUrl.startsWith('devtools:') ||
    lowerUrl.startsWith('javascript:') ||
    lowerUrl.startsWith('view-source:')
  ) {
    if (id) bypassedDownloadIds.add(id);
    return false;
  }

  // 6. Check if URL/id is marked as bypassed
  if (isBypassed(downloadItem)) {
    if (id) bypassedDownloadIds.add(id);
    return false;
  }

  // 7. Ignore downloads initiated by extensions (including this extension or others)
  if (downloadItem.byExtensionId) {
    if (id) bypassedDownloadIds.add(id);
    return false;
  }

  return true;
}

// Post download task to local app server
async function sendToThunderDM(payload, tabId) {
  const customPort = Number(config.serverPort) || 37555;
  const ports = [customPort, ...THUNDER_DEFAULT_PORTS].filter((v, i, a) => a.indexOf(v) === i);
  const hosts = ['127.0.0.1', 'localhost'];

  for (const port of ports) {
    for (const host of hosts) {
      try {
        const res = await fetch(`http://${host}:${port}/add`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        if (res.status === 403) {
          let errData = null;
          try { errData = await res.json(); } catch {}
          isThunderRunning = true;
          const msg = errData?.error || 'Browser integration is disabled in ThunderDM Settings.';
          showAppNotRunningAlert(tabId, msg, payload?.url, payload?.filename);
          return { success: false, error: msg };
        }
        if (res.ok) {
          const data = await res.json();
          if (data && data.status === 'success') {
            isThunderRunning = true;
            if (port !== customPort) {
              config.serverPort = port;
              API.storage.local.set({ config });
            }
            return { success: true, data };
          }
        }
      } catch (err) { }
    }
  }

  isThunderRunning = false;
  showAppNotRunningAlert(tabId, 'Thunder Download Manager is not running in background. Please start the app.', payload?.url, payload?.filename);
  return { success: false, error: 'Thunder Download Manager is not running in background.' };
}

function showAppNotRunningAlert(tabId, customMessage, targetUrl, targetFilename) {
  const alertText = customMessage || 'Thunder Download Manager is not running in background. Please start the app.';
  const dlUrl = targetUrl || '';
  const dlFilename = targetFilename || '';

  const triggerTabAlert = (targetId) => {
    if (!targetId) return;

    if (API.scripting && API.scripting.executeScript) {
      try {
        const iconUrl = API.runtime.getURL('icons/icon32.png');
        API.scripting.executeScript({
          target: { tabId: targetId },
          args: [iconUrl, alertText, dlUrl, dlFilename],
          func: (appIconUrl, messageText, downloadUrl, downloadFilename) => {
            const existing = document.getElementById('thunderdm-native-modal-backdrop');
            if (existing) existing.remove();

            const backdrop = document.createElement('div');
            backdrop.id = 'thunderdm-native-modal-backdrop';
            backdrop.style.cssText = `
              position: fixed !important;
              top: 0 !important;
              left: 0 !important;
              width: 100vw !important;
              height: 100vh !important;
              background: rgba(0, 0, 0, 0.65) !important;
              backdrop-filter: blur(3px) !important;
              z-index: 2147483647 !important;
              display: flex !important;
              align-items: center !important;
              justify-content: center !important;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            `;

            const card = document.createElement('div');
            card.style.cssText = 'background: #181822; color: #f1f5f9; border: 1.5px solid #8b5cf6; border-radius: 16px; padding: 24px 28px; max-width: 440px; width: 90%; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 25px rgba(139, 92, 246, 0.25); box-sizing: border-box;';

            const header = document.createElement('div');
            header.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 14px;';

            const iconContainer = document.createElement('div');
            iconContainer.style.cssText = 'width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, #7c3aed, #4f46e5); display: flex; align-items: center; justify-content: center; overflow: hidden; box-shadow: 0 4px 10px rgba(124, 58, 237, 0.4);';

            const iconImg = document.createElement('img');
            iconImg.src = appIconUrl;
            iconImg.style.cssText = 'width: 22px; height: 22px; object-fit: contain;';
            iconImg.alt = 'ThunderDM';
            iconContainer.appendChild(iconImg);

            const titleEl = document.createElement('div');
            titleEl.style.cssText = 'font-weight: 700; font-size: 17px; color: #ffffff; letter-spacing: -0.2px;';
            titleEl.textContent = 'Thunder Download Manager';

            header.appendChild(iconContainer);
            header.appendChild(titleEl);

            const msgEl = document.createElement('div');
            msgEl.style.cssText = 'font-size: 13.5px; color: #cbd5e1; line-height: 1.55; margin-bottom: 22px;';
            msgEl.textContent = messageText;

            const btnContainer = document.createElement('div');
            btnContainer.style.cssText = 'display: flex; justify-content: flex-end; gap: 10px; align-items: center;';

            const closeBtn = document.createElement('button');
            closeBtn.id = 'thunderdm-modal-close-btn';
            closeBtn.style.cssText = 'background: #27273a; color: #cbd5e1; border: 1px solid #36364e; border-radius: 10px; padding: 9px 20px; font-weight: 600; font-size: 13px; cursor: pointer; transition: all 0.2s; outline: none;';
            closeBtn.textContent = 'Close';

            const browserBtn = document.createElement('button');
            browserBtn.id = 'thunderdm-modal-browser-btn';
            browserBtn.style.cssText = 'background: linear-gradient(135deg, #8b5cf6, #6366f1); color: #ffffff; border: none; border-radius: 10px; padding: 9px 22px; font-weight: 600; font-size: 13px; cursor: pointer; box-shadow: 0 4px 12px rgba(139, 92, 246, 0.35); transition: all 0.2s; outline: none;';
            browserBtn.textContent = 'Download with browser';

            btnContainer.appendChild(closeBtn);
            btnContainer.appendChild(browserBtn);

            card.appendChild(header);
            card.appendChild(msgEl);
            card.appendChild(btnContainer);
            backdrop.appendChild(card);
            document.body.appendChild(backdrop);

            if (closeBtn) {
              closeBtn.onmouseenter = () => { closeBtn.style.background = '#36364e'; closeBtn.style.color = '#ffffff'; };
              closeBtn.onmouseleave = () => { closeBtn.style.background = '#27273a'; closeBtn.style.color = '#cbd5e1'; };
              closeBtn.onclick = () => backdrop.remove();
            }

            if (browserBtn) {
              browserBtn.focus();
              browserBtn.onmouseenter = () => { browserBtn.style.transform = 'translateY(-1px)'; };
              browserBtn.onmouseleave = () => { browserBtn.style.transform = 'translateY(0)'; };
              browserBtn.onclick = () => {
                backdrop.remove();
                if (downloadUrl) {
                  try {
                    const api = typeof browser !== 'undefined' ? browser : chrome;
                    if (api && api.runtime && api.runtime.sendMessage) {
                      api.runtime.sendMessage({
                        action: 'TRIGGER_BROWSER_DOWNLOAD',
                        url: downloadUrl,
                        filename: downloadFilename
                      }, () => {
                        if (api.runtime && api.runtime.lastError) {}
                      });
                    }
                  } catch {}
                }
              };
            }

            const keyHandler = (e) => {
              if (e.key === 'Escape') {
                backdrop.remove();
                window.removeEventListener('keydown', keyHandler);
              }
            };
            window.addEventListener('keydown', keyHandler);
          }
        }).catch(() => {});
      } catch {}
    } else {
      try {
        API.tabs.sendMessage(targetId, {
          action: 'SHOW_ALERT',
          title: 'Thunder Download Manager',
          message: alertText,
          url: dlUrl,
          filename: dlFilename
        }, () => {
          if (API.runtime.lastError) {}
        });
      } catch {}
    }
  };

  if (tabId) {
    triggerTabAlert(tabId);
  } else {
    try {
      API.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0]?.id) {
          triggerTabAlert(tabs[0].id);
        }
      });
    } catch { }
  }
}

// Extract domain / hostname from URL
function getDomainHostname(urlStr) {
  if (!urlStr) return '';
  try {
    const url = new URL(urlStr);
    return url.hostname.toLowerCase();
  } catch {
    return '';
  }
}

// Extract base/root domain (handles subdomains and common multipart TLDs)
function getBaseDomain(hostname) {
  if (!hostname) return '';
  // Handle IP addresses or localhost
  if (/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(hostname) || hostname === 'localhost') {
    return hostname;
  }
  const parts = hostname.split('.');
  if (parts.length <= 2) {
    return hostname;
  }
  const secondLevelTlds = new Set(['co.uk', 'gov.uk', 'ac.uk', 'org.uk', 'com.bd', 'edu.bd', 'gov.bd', 'com.au', 'net.au', 'org.au', 'co.jp', 'com.br', 'com.tr', 'co.nz']);
  const lastTwo = parts.slice(-2).join('.');
  if (secondLevelTlds.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

// Check if page/referrer and file download URL share the same host or base domain
function isSameDomainOrHost(pageUrl, fileUrl) {
  if (!pageUrl || !fileUrl) return true;
  const pageHost = getDomainHostname(pageUrl);
  const fileHost = getDomainHostname(fileUrl);
  if (!pageHost || !fileHost) return false;
  if (pageHost === fileHost) return true;

  const pageBase = getBaseDomain(pageHost);
  const fileBase = getBaseDomain(fileHost);
  return pageBase === fileBase;
}

// Get active server-side and client-side cookies for domain (strictly matching domain)
async function getCookiesForUrl(url, tabId, pageUrl) {
  if (!config.passCookies || !url) return '';

  // Cross-host verification: if pageUrl/referrer is present, ensure it matches the file's host/domain
  if (pageUrl && !isSameDomainOrHost(pageUrl, url)) {
    return '';
  }

  try {
    const cookieMap = new Map();

    // 1. Server-side & HttpOnly cookies via browser API
    if (API.cookies && API.cookies.getAll) {
      try {
        const cookies = await API.cookies.getAll({ url });
        if (Array.isArray(cookies)) {
          for (const c of cookies) {
            if (c && c.name) {
              cookieMap.set(c.name, c.value || '');
            }
          }
        }
      } catch {}
    }

    // 2. Client-side cookies from the target tab if accessible and domain matches
    if (tabId && API.scripting && API.scripting.executeScript) {
      try {
        const results = await API.scripting.executeScript({
          target: { tabId: tabId },
          func: () => document.cookie || ''
        });
        if (results && results[0] && results[0].result) {
          const clientCookieStr = String(results[0].result);
          const pairs = clientCookieStr.split(';');
          for (const p of pairs) {
            const eqIdx = p.indexOf('=');
            if (eqIdx !== -1) {
              const k = p.slice(0, eqIdx).trim();
              const v = p.slice(eqIdx + 1).trim();
              if (k && !cookieMap.has(k)) {
                cookieMap.set(k, v);
              }
            }
          }
        }
      } catch {}
    }

    if (cookieMap.size === 0) return '';
    return Array.from(cookieMap.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  } catch {
    return '';
  }
}

function isVideoSite(url) {
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

// Setup context menu items
function setupContextMenus() {
  const createMenus = () => {
    try {
      API.contextMenus.create({
        id: 'thunderdm-download-image',
        title: 'Download image with ThunderDM',
        contexts: ['image']
      }, () => { if (API.runtime && API.runtime.lastError) {} });

      API.contextMenus.create({
        id: 'thunderdm-download-video',
        title: 'Download video with ThunderDM',
        contexts: ['video']
      }, () => { if (API.runtime && API.runtime.lastError) {} });

      API.contextMenus.create({
        id: 'thunderdm-download-audio',
        title: 'Download audio with ThunderDM',
        contexts: ['audio']
      }, () => { if (API.runtime && API.runtime.lastError) {} });

      API.contextMenus.create({
        id: 'thunderdm-download-link',
        title: 'Download link with ThunderDM',
        contexts: ['link']
      }, () => { if (API.runtime && API.runtime.lastError) {} });

      API.contextMenus.create({
        id: 'thunderdm-download-page',
        title: 'Download with ThunderDM',
        contexts: ['page', 'selection']
      }, () => { if (API.runtime && API.runtime.lastError) {} });
    } catch {}
  };

  try {
    const res = API.contextMenus.removeAll(() => {
      createMenus();
    });
    if (res && typeof res.then === 'function') {
      res.then(createMenus).catch(createMenus);
    }
  } catch {
    createMenus();
  }
}

API.runtime.onInstalled.addListener(setupContextMenus);
API.runtime.onStartup.addListener(setupContextMenus);

API.contextMenus.onClicked.addListener(async (info, tab) => {
  let targetUrl = info.srcUrl || info.linkUrl || info.pageUrl || tab?.url;

  if (lastContextMedia && (Date.now() - lastContextMedia.timestamp < 6000)) {
    if (lastContextMedia.url && lastContextMedia.url !== 'https://www.facebook.com/' && lastContextMedia.url !== 'https://www.facebook.com') {
      targetUrl = lastContextMedia.url;
    }
  }

  if (targetUrl === 'https://www.facebook.com/' || targetUrl === 'https://www.facebook.com') {
    if (lastContextMedia?.url && lastContextMedia.url !== 'https://www.facebook.com/' && lastContextMedia.url !== 'https://www.facebook.com') {
      targetUrl = lastContextMedia.url;
    } else {
      return;
    }
  }

  if (!targetUrl) return;

  // Fallback to browser for local/blob URLs
  if (targetUrl.startsWith('data:') || targetUrl.startsWith('blob:') || targetUrl.startsWith('file:')) {
    if (API.downloads && API.downloads.download) {
      try {
        API.downloads.download({
          url: targetUrl,
          saveAs: true
        }, (downloadId) => {
          consumeLastError();
          if (downloadId) bypassedDownloadIds.add(downloadId);
        });
      } catch {}
    }
    return;
  }

  const isVideo = info.mediaType === 'video' || info.menuItemId === 'thunderdm-download-video' || isVideoSite(targetUrl) || Boolean(lastContextMedia?.isVideo);
  const isVideoStreamingSite = isVideoSite(targetUrl);

  const pageUrl = tab?.url || info.pageUrl || '';
  const cookies = await getCookiesForUrl(targetUrl, tab?.id, pageUrl);

  const payload = {
    url: targetUrl,
    referrer: pageUrl,
    cookies: cookies,
    user_agent: navigator.userAgent,
    is_ytdlp: isVideoStreamingSite,
    protocol: isVideoStreamingSite ? 'Yt-DLP' : 'Auto',
    title: lastContextMedia?.title || tab?.title || ''
  };

  const res = await sendToThunderDM(payload, tab?.id);
});

function cancelBrowserDownload(id) {
  if (!id || cancelledDownloadIds.has(id)) return;
  cancelledDownloadIds.add(id);

  try {
    if (API.downloads && typeof API.downloads.cancel === 'function') {
      API.downloads.cancel(id, () => {
        consumeLastError();
        try {
          if (typeof API.downloads.erase === 'function') {
            API.downloads.erase({ id }, () => {
              consumeLastError();
            });
          }
        } catch {}
      });
    }
  } catch {}
}

// Intercept browser downloads
if (API.downloads && API.downloads.onCreated) {
  API.downloads.onCreated.addListener((downloadItem) => {
    if (!downloadItem || !shouldInterceptDownload(downloadItem)) {
      return;
    }

    const id = downloadItem.id;
    if (id) {
      interceptedDownloadIds.add(id);
      cancelBrowserDownload(id);
    }

    const url = downloadItem.url || downloadItem.finalUrl;
    if (!url) return;

    // Forward download details to app
    (async () => {
      const pageUrl = downloadItem.referrer || '';
      const cookies = await getCookiesForUrl(url, undefined, pageUrl);
      const filename = downloadItem.filename ? downloadItem.filename.split(/[/\\\\]/).pop() : '';

      const payload = {
        url: url,
        filename: filename,
        referrer: pageUrl,
        cookies: cookies,
        user_agent: navigator.userAgent,
        is_ytdlp: isVideoSite(url),
        protocol: isVideoSite(url) ? 'Yt-DLP' : 'Auto'
      };

      await sendToThunderDM(payload);
    })();
  });
}

if (API.downloads && API.downloads.onDeterminingFilename) {
  API.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    if (!downloadItem) return;
    const id = downloadItem.id;
    if (id && (bypassedDownloadIds.has(id) || cancelledDownloadIds.has(id))) {
      return;
    }
    if (!shouldInterceptDownload(downloadItem)) {
      return;
    }

    if (id) {
      interceptedDownloadIds.add(id);
      cancelBrowserDownload(id);
    }
  });
}

// Runtime message handler
API.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'SET_ACTIVE_CONTEXT_MEDIA') {
    lastContextMedia = {
      ...request.payload,
      timestamp: Date.now(),
      tabId: sender?.tab?.id
    };
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'SEND_DOWNLOAD') {
    (async () => {
      let cookies = '';
      const pageUrl = sender?.tab?.url || request.payload?.referrer || '';
      const targetUrl = request.payload?.url || '';

      if (config.passCookies && targetUrl) {
        if (isSameDomainOrHost(pageUrl, targetUrl)) {
          if (request.payload.cookies) {
            cookies = request.payload.cookies;
          } else {
            cookies = await getCookiesForUrl(targetUrl, sender?.tab?.id, pageUrl);
          }
        }
      }

      const payload = {
        ...request.payload,
        cookies: cookies || '',
        user_agent: request.payload.user_agent || navigator.userAgent
      };
      const result = await sendToThunderDM(payload, sender?.tab?.id);
      sendResponse(result);
    })();
    return true;
  }

  if (request.action === 'GET_CONFIG') {
    API.storage.local.get(['config'], (result) => {
      if (result && result.config) {
        config = { ...config, ...result.config };
      }
      sendResponse({ config });
    });
    return true;
  }

  if (request.action === 'SET_CONFIG') {
    config = { ...config, ...request.config };
    API.storage.local.set({ config }, () => {
      // Broadcast updated config to open tabs
      try {
        API.tabs.query({}, (tabs) => {
          if (tabs && tabs.length) {
            for (const tab of tabs) {
              try {
                API.tabs.sendMessage(tab.id, { action: 'UPDATE_CONFIG', config }, () => {
                  if (API.runtime.lastError) { /* tab not listening */ }
                });
              } catch { }
            }
          }
        });
      } catch { }

      sendResponse({ success: true, config });
    });
    return true;
  }

  if (request.action === 'TEST_CONNECTION' || request.action === 'CHECK_CONNECTION') {
    (async () => {
      const targetPort = Number(request.port) || Number(config.serverPort) || 37555;
      const candidatePorts = [targetPort, ...THUNDER_DEFAULT_PORTS].filter((v, i, a) => a.indexOf(v) === i);
      const hosts = ['127.0.0.1', 'localhost'];
      
      // 1. First probe requested port
      for (const host of hosts) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 1800);
          const res = await fetch(`http://${host}:${targetPort}/health`, {
            method: 'GET',
            signal: controller.signal,
            cache: 'no-store'
          });
          clearTimeout(timeoutId);
          if (res.ok) {
            const data = await res.json();
            if (data && data.app === 'ThunderDM') {
              isThunderRunning = true;
              sendResponse({ success: true, port: targetPort, host, data, exactPort: true });
              return;
            }
          }
        } catch (err) { }
      }

      // 2. If requested port failed, probe fallback ports
      for (const p of candidatePorts) {
        if (p === targetPort) continue;
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
                isThunderRunning = true;
                config.serverPort = p;
                API.storage.local.set({ config });
                sendResponse({ success: true, port: p, host, data, fallbackDetected: true, originalPort: targetPort });
                return;
              }
            }
          } catch (err) { }
        }
      }

      sendResponse({ success: false, port: targetPort, error: `Cannot connect to ThunderDM on port ${targetPort}` });
    })();
    return true;
  }

  if (request.action === 'TRIGGER_BROWSER_DOWNLOAD') {
    const url = request.url;
    const filename = request.filename;
    if (url) {
      addBypassedUrl(url);
      if (API.downloads && typeof API.downloads.download === 'function') {
        try {
          const downloadOptions = {
            url: url
          };
          if (filename && typeof filename === 'string' && filename.trim().length > 0) {
            downloadOptions.filename = filename.trim();
          }
          API.downloads.download(downloadOptions, (downloadId) => {
            const err = consumeLastError();
            if (err) {
              try { API.tabs.create({ url: url }); } catch {}
            } else if (downloadId) {
              bypassedDownloadIds.add(downloadId);
            }
          });
        } catch (err) {
          try { API.tabs.create({ url: url }); } catch {}
        }
      } else {
        try { API.tabs.create({ url: url }); } catch {}
      }
    }
    sendResponse({ success: true });
    return true;
  }
});
