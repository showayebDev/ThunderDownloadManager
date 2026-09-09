// Content script for video detection and download link interception

function getExtensionAPI() {
  if (typeof chrome !== 'undefined' && chrome && chrome.runtime) return chrome;
  if (typeof browser !== 'undefined' && browser && browser.runtime) return browser;
  return null;
}

function safeSendMessage(message, callback) {
  try {
    const api = getExtensionAPI();
    if (api && api.runtime && typeof api.runtime.sendMessage === 'function') {
      api.runtime.sendMessage(message, (res) => {
        if (api.runtime.lastError) {
          return;
        }
        if (typeof callback === 'function') callback(res);
      });
    }
  } catch {}
}

const DOWNLOAD_EXTENSIONS = new Set([
  // Media formats
  'mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', '3gp', 'ts', 'vob', 'ogv',
  'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus',
  // Archives
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'img', 'tgz', 'zst',
  // Executables
  'exe', 'msi', 'dmg', 'pkg', 'deb', 'rpm', 'apk', 'appimage', 'jar',
  // Documents & torrents
  'pdf', 'epub', 'mobi', 'azw3', 'torrent'
]);

let config = {
  interceptDownloads: true,
  interceptVideos: true,
  showVideoBadge: false,
  badgeMode: 'never',
  unhoverDelay: 3
};

function getEffectiveBadgeMode() {
  if (config.badgeMode === 'never' || config.showVideoBadge === false) {
    return 'never';
  }
  return config.badgeMode || 'never';
}

function getUnhoverDelayMs() {
  const sec = Number(config.unhoverDelay);
  return (isNaN(sec) || sec < 1 ? 3 : sec) * 1000;
}

// Sync extension settings
function syncConfig() {
  const api = getExtensionAPI();
  if (api && api.storage && api.storage.local) {
    try {
      api.storage.local.get(['config'], (result) => {
        if (result && result.config) {
          config = { ...config, ...result.config };
          onConfigUpdated();
        }
      });
    } catch {}
  }

  safeSendMessage({ action: 'GET_CONFIG' }, (res) => {
    if (res && res.config) {
      config = { ...config, ...res.config };
      onConfigUpdated();
    }
  });
}

syncConfig();

// Listen for settings changes
try {
  const api = getExtensionAPI();
  if (api && api.storage && api.storage.onChanged) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.config) {
        config = { ...config, ...changes.config.newValue };
        onConfigUpdated();
      }
    });
  }
  if (api && api.runtime && api.runtime.onMessage) {
    api.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request && request.action === 'UPDATE_CONFIG' && request.config) {
        config = { ...config, ...request.config };
        onConfigUpdated();
        sendResponse({ success: true });
      }
      if (request && request.action === 'SHOW_ALERT') {
        showInPageAlert(request.title, request.message, request.url, request.filename);
        sendResponse({ success: true });
      }
    });
  }
} catch {}

function showInPageAlert(title, message, targetUrl, targetFilename) {
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
  iconContainer.style.cssText = 'width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, #7c3aed, #4f46e5); display: flex; align-items: center; justify-content: center; color: #fff; font-weight: bold; font-size: 16px; box-shadow: 0 4px 10px rgba(124, 58, 237, 0.4);';
  iconContainer.textContent = '⚡';

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-weight: 700; font-size: 17px; color: #ffffff; letter-spacing: -0.2px;';
  titleEl.textContent = title || 'Thunder Download Manager';

  header.appendChild(iconContainer);
  header.appendChild(titleEl);

  const msgEl = document.createElement('div');
  msgEl.style.cssText = 'font-size: 13.5px; color: #cbd5e1; line-height: 1.55; margin-bottom: 22px;';
  msgEl.textContent = message || 'Thunder Download Manager is not running in background. Please start the app.';

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
      if (targetUrl) {
        safeSendMessage({
          action: 'TRIGGER_BROWSER_DOWNLOAD',
          url: targetUrl,
          filename: targetFilename
        });
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

function isVideoSite(url) {
  try {
    const host = (url ? new URL(url, window.location.href).hostname : window.location.hostname).toLowerCase();
    return (
      host.includes('facebook.com') ||
      host.includes('fb.watch') ||
      host.includes('youtube.com') ||
      host.includes('youtu.be') ||
      host.includes('tiktok.com') ||
      host.includes('instagram.com') ||
      host.includes('twitter.com') ||
      host.includes('x.com') ||
      host.includes('vimeo.com') ||
      host.includes('dailymotion.com') ||
      host.includes('.m3u8')
    );
  } catch {
    return false;
  }
}

let badgeEl = null;
let currentActiveVideo = null;
let unhoverTimer = null;
let isMouseOverBadge = false;

function cleanFacebookUrl(rawUrl) {
  try {
    const u = new URL(rawUrl, window.location.origin);
    if (u.pathname.includes('/reel/')) {
      const match = u.pathname.match(/\/reel\/(\d+)/);
      if (match) return `https://www.facebook.com/reel/${match[1]}/`;
    }
    if (u.searchParams.has('v')) {
      return `https://www.facebook.com/watch/?v=${u.searchParams.get('v')}`;
    }
    u.searchParams.delete('fbclid');
    u.searchParams.delete('__cft__');
    u.searchParams.delete('__tn__');
    return u.toString();
  } catch {
    return rawUrl;
  }
}

// Resolve post or permalink URL for video elements
function resolveMediaUrl(videoEl) {
  if (!videoEl) return window.location.href;
  const host = window.location.hostname.toLowerCase();

  // Facebook feeds and reels
  if (host.includes('facebook.com') || host.includes('fb.watch')) {
    if (window.location.pathname.includes('/reel/') || 
        window.location.pathname.includes('/watch') || 
        window.location.pathname.includes('/videos/')) {
      return window.location.href;
    }

    let container = videoEl;
    let foundLink = null;

    for (let i = 0; i < 25 && container && container !== document.body; i++) {
      const link = container.querySelector(
        'a[href*="/reel/"], a[href*="/videos/"], a[href*="/watch"], a[href*="watch?v="], a[href*="/posts/"], a[href*="permalink.php"], a[href*="story.php"], a[href*="/photo"], a[aria-label*="ago"], a[aria-label*="yesterday"], a[aria-label*="hrs"], a[aria-label*="mins"], a[aria-label*="Just now"]'
      );
      if (link && link.href && !link.href.includes('/comment/') && !link.href.includes('/hashtag/')) {
        foundLink = link.href;
        break;
      }
      container = container.parentElement;
    }

    if (foundLink) {
      return cleanFacebookUrl(foundLink);
    }

    const feedUnit = videoEl.closest('div[role="article"], div[data-pagelet*="FeedUnit"], div[role="feed"] > div, div[data-pagelet*="Reel"], div[data-pagelet*="Tahoe"]');
    if (feedUnit) {
      const links = feedUnit.querySelectorAll('a[href*="/watch"], a[href*="/reel/"], a[href*="/videos/"], a[href*="/posts/"], a[href*="permalink.php"], a[href*="story.php"]');
      for (const link of links) {
        if (link && link.href && !link.href.includes('/comment/') && !link.href.includes('/hashtag/')) {
          return cleanFacebookUrl(link.href);
        }
      }
    }

    if (videoEl.currentSrc && videoEl.currentSrc.startsWith('http') && !videoEl.currentSrc.startsWith('blob:') && !videoEl.currentSrc.startsWith('data:')) {
      return videoEl.currentSrc;
    }
    if (videoEl.src && videoEl.src.startsWith('http') && !videoEl.src.startsWith('blob:') && !videoEl.src.startsWith('data:')) {
      return videoEl.src;
    }
  }

  // Instagram posts/reels
  if (host.includes('instagram.com')) {
    if (window.location.pathname.includes('/p/') || window.location.pathname.includes('/reel/')) {
      return window.location.href;
    }
    const postContainer = videoEl.closest('article, div[role="dialog"]');
    if (postContainer) {
      const link = postContainer.querySelector('a[href*="/p/"], a[href*="/reel/"]');
      if (link && link.href) return link.href;
    }
    if (videoEl.currentSrc && videoEl.currentSrc.startsWith('http') && !videoEl.currentSrc.startsWith('blob:') && !videoEl.currentSrc.startsWith('data:')) return videoEl.currentSrc;
  }

  // Twitter / X
  if (host.includes('twitter.com') || host.includes('x.com')) {
    const tweet = videoEl.closest('article[data-testid="tweet"]');
    if (tweet) {
      const link = tweet.querySelector('a[href*="/status/"]');
      if (link && link.href) return link.href;
    }
  }

  // YouTube watch / shorts
  if (host.includes('youtube.com') || host.includes('youtu.be')) {
    if (window.location.pathname.includes('/watch') || window.location.pathname.includes('/shorts')) {
      return window.location.href;
    }
    const ytdRenderer = videoEl.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer');
    if (ytdRenderer) {
      const link = ytdRenderer.querySelector('a#thumbnail[href], a[href*="/watch?v="], a[href*="/shorts/"]');
      if (link && link.href) return link.href;
    }
  }

  // TikTok video cards
  if (host.includes('tiktok.com')) {
    if (window.location.pathname.includes('/video/')) {
      return window.location.href;
    }
    const tiktokContainer = videoEl.closest('div[data-e2e="feed-item"], div[class*="DivItemContainer"]');
    if (tiktokContainer) {
      const link = tiktokContainer.querySelector('a[href*="/video/"]');
      if (link && link.href) return link.href;
    }
  }

  // Standard video source fallback
  if (videoEl.currentSrc && videoEl.currentSrc.startsWith('http') && !videoEl.currentSrc.startsWith('blob:') && !videoEl.currentSrc.startsWith('data:')) {
    return videoEl.currentSrc;
  }
  if (videoEl.src && videoEl.src.startsWith('http') && !videoEl.src.startsWith('blob:') && !videoEl.src.startsWith('data:')) {
    return videoEl.src;
  }

  return window.location.href;
}

const alwaysActiveBadges = new Map();
const dismissedVideos = new WeakSet();
let rafAlwaysScheduled = false;

function onConfigUpdated() {
  const mode = getEffectiveBadgeMode();
  if (mode === 'never') {
    hideBadgeImmediately();
    hideAllAlwaysBadges();
  } else if (mode === 'always') {
    hideBadgeImmediately();
    scheduleAlwaysUpdate();
  } else {
    // Hover mode
    hideAllAlwaysBadges();
    hideBadgeImmediately();
  }
}

function hideAllAlwaysBadges() {
  for (const { badgeEl } of alwaysActiveBadges.values()) {
    badgeEl.classList.add('thunderdm-hidden');
  }
}

function getAppIconUrl() {
  const api = getExtensionAPI();
  if (api && api.runtime && typeof api.runtime.getURL === 'function') {
    return api.runtime.getURL('icons/icon32.png');
  }
  return '';
}

// Hover badge management
function getOrCreateHoverBadge() {
  if (badgeEl && document.contains(badgeEl)) return badgeEl;

  if (badgeEl) {
    try { badgeEl.remove(); } catch {}
  }

  badgeEl = document.createElement('div');
  badgeEl.id = 'thunderdm-video-hover-badge';
  badgeEl.className = 'thunderdm-video-badge thunderdm-hidden';

  const innerBtn = document.createElement('div');
  innerBtn.className = 'thunderdm-badge-inner';
  innerBtn.title = 'Download with ThunderDM';

  const logoImg = document.createElement('img');
  logoImg.className = 'thunderdm-badge-logo';
  logoImg.src = getAppIconUrl();
  logoImg.alt = 'ThunderDM';

  const textSpan = document.createElement('span');
  textSpan.className = 'thunderdm-badge-text';
  textSpan.textContent = 'Download';

  innerBtn.appendChild(logoImg);
  innerBtn.appendChild(textSpan);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'thunderdm-badge-close';
  closeBtn.title = 'Dismiss';
  closeBtn.textContent = '✕';

  badgeEl.appendChild(innerBtn);
  badgeEl.appendChild(closeBtn);

  const container = document.body || document.documentElement;
  if (container) {
    container.appendChild(badgeEl);
  }

  // Trigger download on badge click
  innerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    if (!currentActiveVideo) return;

    const resolvedUrl = resolveMediaUrl(currentActiveVideo);
    const isYTDLP = isVideoSite(resolvedUrl);

    safeSendMessage({
      action: 'SEND_DOWNLOAD',
      payload: {
        url: resolvedUrl,
        title: document.title || 'Video Download',
        referrer: window.location.href,
        is_ytdlp: isYTDLP,
        protocol: isYTDLP ? 'Yt-DLP' : 'Auto'
      }
    }, (res) => {
      if (res && !res.success) {
        showInPageAlert('ThunderDM is Not Running', res.error || 'Thunder Download Manager is not running in background. Please start the app.', resolvedUrl);
      }
    });

    const textEl = innerBtn.querySelector('.thunderdm-badge-text');
    if (textEl) {
      const orig = textEl.textContent;
      textEl.textContent = 'Opening... ✓';
      setTimeout(() => {
        textEl.textContent = orig;
      }, 2000);
    }
  });

  // Close button handler
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    hideBadgeImmediately();
  });

  // Keep badge visible while mouse is directly over it
  badgeEl.addEventListener('mouseenter', () => {
    isMouseOverBadge = true;
    clearTimeout(unhoverTimer);
    unhoverTimer = null;
  });

  badgeEl.addEventListener('mouseleave', () => {
    isMouseOverBadge = false;
    scheduleHide(getUnhoverDelayMs());
  });

  return badgeEl;
}

function showHoverBadgeForVideo(video) {
  const mode = getEffectiveBadgeMode();
  if (mode !== 'hover' || !video || !document.contains(video)) {
    return;
  }

  const rect = video.getBoundingClientRect();

  // Skip if element is hidden or outside visible bounds
  if (
    rect.width < 100 ||
    rect.height < 60 ||
    rect.top < 24 ||
    rect.top > window.innerHeight - 40 ||
    rect.right < 50 ||
    rect.left > window.innerWidth - 50
  ) {
    hideBadgeImmediately();
    return;
  }

  currentActiveVideo = video;
  const badge = getOrCreateHoverBadge();

  // Cancel pending hide timeout
  clearTimeout(unhoverTimer);
  unhoverTimer = null;

  // Position badge near the top-left corner of the video
  let topPos = rect.top - 24;
  let leftPos = rect.left + 2;

  if (topPos < 4) topPos = 4;
  if (leftPos < 2) leftPos = 2;

  const maxTop = window.innerHeight - 28;
  const maxLeft = window.innerWidth - 130;

  if (topPos > maxTop) topPos = maxTop;
  if (leftPos > maxLeft) leftPos = maxLeft;

  badge.style.setProperty('top', `${Math.round(topPos)}px`, 'important');
  badge.style.setProperty('left', `${Math.round(leftPos)}px`, 'important');
  badge.classList.remove('thunderdm-hidden');
}

function scheduleHide(delayMs) {
  clearTimeout(unhoverTimer);
  const timeoutMs = delayMs !== undefined ? delayMs : getUnhoverDelayMs();
  unhoverTimer = setTimeout(() => {
    if (!isMouseOverBadge) {
      hideBadgeImmediately();
    }
  }, timeoutMs);
}

function hideBadgeImmediately() {
  clearTimeout(unhoverTimer);
  unhoverTimer = null;
  if (badgeEl) {
    badgeEl.classList.add('thunderdm-hidden');
  }
}

// Persistent badge system ('always' mode)
function createAlwaysBadgeForVideo(video) {
  const badge = document.createElement('div');
  badge.className = 'thunderdm-video-badge thunderdm-hidden';

  const innerBtn = document.createElement('div');
  innerBtn.className = 'thunderdm-badge-inner';
  innerBtn.title = 'Download with ThunderDM';

  const logoImg = document.createElement('img');
  logoImg.className = 'thunderdm-badge-logo';
  logoImg.src = getAppIconUrl();
  logoImg.alt = 'ThunderDM';

  const textSpan = document.createElement('span');
  textSpan.className = 'thunderdm-badge-text';
  textSpan.textContent = 'Download';

  innerBtn.appendChild(logoImg);
  innerBtn.appendChild(textSpan);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'thunderdm-badge-close';
  closeBtn.title = 'Dismiss';
  closeBtn.textContent = '✕';

  badge.appendChild(innerBtn);
  badge.appendChild(closeBtn);

  const container = document.body || document.documentElement;
  if (container) {
    container.appendChild(badge);
  }

  // Trigger download on badge click
  innerBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    const resolvedUrl = resolveMediaUrl(video);
    const isYTDLP = isVideoSite(resolvedUrl);

    safeSendMessage({
      action: 'SEND_DOWNLOAD',
      payload: {
        url: resolvedUrl,
        title: document.title || 'Video Download',
        referrer: window.location.href,
        is_ytdlp: isYTDLP,
        protocol: isYTDLP ? 'Yt-DLP' : 'Auto'
      }
    }, (res) => {
      if (res && !res.success) {
        showInPageAlert('ThunderDM is Not Running', res.error || 'Thunder Download Manager is not running in background. Please start the app.', resolvedUrl);
      }
    });

    const textEl = innerBtn.querySelector('.thunderdm-badge-text');
    if (textEl) {
      const orig = textEl.textContent;
      textEl.textContent = 'Opening... ✓';
      setTimeout(() => {
        textEl.textContent = orig;
      }, 2000);
    }
  });

  // Close button handler
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    dismissedVideos.add(video);
    badge.classList.add('thunderdm-hidden');
  });

  return badge;
}

let scrollSettleTimer = null;

function isReelOrFullscreenFeed(video, rect) {
  const host = window.location.hostname.toLowerCase();
  const path = window.location.pathname.toLowerCase();
  
  const isReelUrl = (
    path.includes('/reel') ||
    path.includes('/shorts') ||
    host.includes('tiktok.com') ||
    (host.includes('facebook.com') && (path.includes('/watch') || path.includes('/videos')))
  );

  const isTallVideo = rect.height > window.innerHeight * 0.55;
  return isReelUrl || isTallVideo;
}

function updateAlwaysBadges() {
  if (getEffectiveBadgeMode() !== 'always') {
    hideAllAlwaysBadges();
    return;
  }

  const currentVideos = findAllVideos();
  const currentVideoSet = new Set(currentVideos);

  for (const [video, { badgeEl }] of alwaysActiveBadges.entries()) {
    if (!currentVideoSet.has(video) || !document.contains(video)) {
      try { badgeEl.remove(); } catch {}
      alwaysActiveBadges.delete(video);
    }
  }

  const candidates = [];
  for (const video of currentVideos) {
    if (dismissedVideos.has(video)) continue;
    if (!isElementVisible(video)) continue;

    const rect = video.getBoundingClientRect();
    if (rect.width < 100 || rect.height < 60) continue;
    
    // Check if this is a short-form vertical feed
    if (isReelOrFullscreenFeed(video, rect)) {
      // Only consider videos centered in viewport
      const centerDist = Math.abs((rect.top + rect.height / 2) - window.innerHeight / 2);
      if (centerDist > 180) continue;
      if (rect.top < 24 || rect.top > window.innerHeight - 80) continue;
    } else {
      if (rect.top < 24 || rect.top > window.innerHeight - 50) continue;
    }

    if (rect.right < 50 || rect.left > window.innerWidth - 50) continue;

    candidates.push({ video, rect });
  }

  const finalVisibleVideos = new Set();
  const sorted = candidates.sort((a, b) => {
    // Prioritize active video over paused ones
    if (!a.video.paused && b.video.paused) return -1;
    if (a.video.paused && !b.video.paused) return 1;
    
    // Choose reel nearest to viewport center
    const centerDistA = Math.abs((a.rect.top + a.rect.height / 2) - window.innerHeight / 2);
    const centerDistB = Math.abs((b.rect.top + b.rect.height / 2) - window.innerHeight / 2);
    if (Math.abs(centerDistA - centerDistB) > 30) {
      return centerDistA - centerDistB;
    }

    const areaA = a.rect.width * a.rect.height;
    const areaB = b.rect.width * b.rect.height;
    return areaB - areaA;
  });

  const acceptedRects = [];
  for (const cand of sorted) {
    let overlaps = false;
    for (const acc of acceptedRects) {
      const topDiff = Math.abs(cand.rect.top - acc.top);
      const leftDiff = Math.abs(cand.rect.left - acc.left);
      if (topDiff < 80 && leftDiff < 80) {
        overlaps = true;
        break;
      }
    }
    if (!overlaps) {
      acceptedRects.push(cand.rect);
      finalVisibleVideos.add(cand.video);
      // Allow only one badge in reels feed
      if (isReelOrFullscreenFeed(cand.video, cand.rect)) {
        break;
      }
    }
  }

  for (const video of currentVideos) {
    let entry = alwaysActiveBadges.get(video);

    if (!finalVisibleVideos.has(video)) {
      if (entry) {
        entry.badgeEl.classList.add('thunderdm-hidden');
      }
      continue;
    }

    if (!entry || !document.contains(entry.badgeEl)) {
      const badgeEl = createAlwaysBadgeForVideo(video);
      entry = { badgeEl, video };
      alwaysActiveBadges.set(video, entry);
    }

    const rect = video.getBoundingClientRect();
    let topPos = rect.top - 24;
    let leftPos = rect.left + 2;

    if (topPos < 4) topPos = 4;
    if (leftPos < 2) leftPos = 2;

    const maxTop = window.innerHeight - 28;
    const maxLeft = window.innerWidth - 130;

    if (topPos > maxTop) topPos = maxTop;
    if (leftPos > maxLeft) leftPos = maxLeft;

    entry.badgeEl.style.setProperty('top', `${Math.round(topPos)}px`, 'important');
    entry.badgeEl.style.setProperty('left', `${Math.round(leftPos)}px`, 'important');
    entry.badgeEl.classList.remove('thunderdm-hidden');
  }
}

function scheduleAlwaysUpdate() {
  if (rafAlwaysScheduled) return;
  rafAlwaysScheduled = true;
  requestAnimationFrame(() => {
    rafAlwaysScheduled = false;
    updateAlwaysBadges();
  });
}

// DOM scanner and event listeners
function findAllVideos() {
  const list = [];
  const vids = document.querySelectorAll('video');
  vids.forEach(v => list.push(v));

  const allElements = document.querySelectorAll('*');
  for (const el of allElements) {
    if (el.shadowRoot) {
      try {
        const shadowVideos = el.shadowRoot.querySelectorAll('video');
        shadowVideos.forEach(v => list.push(v));
      } catch {}
    }
  }

  return list;
}

function isElementVisible(el) {
  if (!el || !document.contains(el)) return false;
  if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
  try {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) < 0.05) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

// Track mouse movement to reveal badge on hovered video
document.addEventListener('mousemove', (e) => {
  const mode = getEffectiveBadgeMode();
  if (mode !== 'hover') return;

  if (isMouseOverBadge) return;

  const videos = findAllVideos();
  let hoveredVideo = null;

  for (const video of videos) {
    if (!isElementVisible(video)) continue;
    const rect = video.getBoundingClientRect();
    if (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    ) {
      hoveredVideo = video;
      break;
    }
  }

  if (hoveredVideo) {
    showHoverBadgeForVideo(hoveredVideo);
  } else {
    // Left video element, start dismiss delay
    if (badgeEl && !badgeEl.classList.contains('thunderdm-hidden')) {
      if (!unhoverTimer) {
        scheduleHide(getUnhoverDelayMs());
      }
    }
  }
}, { passive: true });

// Update badge positioning on scroll and resize
window.addEventListener('scroll', () => {
  const mode = getEffectiveBadgeMode();
  if (mode === 'always') {
    // Hide immediately while scrolling to prevent visual jumpiness
    hideAllAlwaysBadges();
    clearTimeout(scrollSettleTimer);
    scrollSettleTimer = setTimeout(() => {
      updateAlwaysBadges();
    }, 150);
  } else if (mode === 'hover') {
    if (currentActiveVideo && badgeEl && !badgeEl.classList.contains('thunderdm-hidden')) {
      const rect = currentActiveVideo.getBoundingClientRect();
      if (rect.top < 24 || rect.bottom < 50 || rect.top > window.innerHeight - 40) {
        hideBadgeImmediately();
      } else {
        let topPos = rect.top - 24;
        let leftPos = rect.left + 2;
        badgeEl.style.setProperty('top', `${Math.round(topPos)}px`, 'important');
        badgeEl.style.setProperty('left', `${Math.round(leftPos)}px`, 'important');
      }
    }
  }
}, { passive: true });

window.addEventListener('resize', () => {
  const mode = getEffectiveBadgeMode();
  if (mode === 'always') {
    hideAllAlwaysBadges();
    clearTimeout(scrollSettleTimer);
    scrollSettleTimer = setTimeout(() => {
      updateAlwaysBadges();
    }, 150);
  } else if (mode === 'hover') {
    if (currentActiveVideo && badgeEl && !badgeEl.classList.contains('thunderdm-hidden')) {
      const rect = currentActiveVideo.getBoundingClientRect();
      if (rect.top < 24 || rect.bottom < 50 || rect.top > window.innerHeight - 40) {
        hideBadgeImmediately();
      } else {
        let topPos = rect.top - 24;
        let leftPos = rect.left + 2;
        badgeEl.style.setProperty('top', `${Math.round(topPos)}px`, 'important');
        badgeEl.style.setProperty('left', `${Math.round(leftPos)}px`, 'important');
      }
    }
  }
}, { passive: true });

// Watch for dynamically inserted video elements
try {
  const observer = new MutationObserver(() => {
    if (getEffectiveBadgeMode() === 'always') {
      scheduleAlwaysUpdate();
    }
  });
  observer.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });
} catch {}

// Track right-clicked video for context menu
document.addEventListener('contextmenu', (e) => {
  const videos = findAllVideos();
  let targetVideo = null;

  for (const video of videos) {
    const rect = video.getBoundingClientRect();
    if (e.clientX >= rect.left - 15 && e.clientX <= rect.right + 15 &&
        e.clientY >= rect.top - 35 && e.clientY <= rect.bottom + 15) {
      targetVideo = video;
      break;
    }
  }

  if (targetVideo) {
    const resolvedUrl = resolveMediaUrl(targetVideo);
    safeSendMessage({
      action: 'SET_ACTIVE_CONTEXT_MEDIA',
      payload: {
        url: resolvedUrl,
        title: document.title || 'Video Download',
        isVideo: true
      }
    });
  }
}, { passive: true });

// Intercept clicks on direct downloadable file links
document.addEventListener('click', (e) => {
  if (!config.interceptDownloads) return;

  const anchor = e.target.closest('a');
  if (!anchor || !anchor.href) return;

  // Do not intercept if inside extension modal or badge
  if (anchor.closest('#thunderdm-native-modal-backdrop') || anchor.closest('.thunderdm-video-badge')) {
    return;
  }
  if (anchor.dataset && anchor.dataset.thunderdmBypass) {
    return;
  }
  if (anchor.classList && anchor.classList.contains('thunderdm-bypass')) {
    return;
  }

  const urlStr = anchor.href;
  if (
    urlStr.startsWith('blob:') ||
    urlStr.startsWith('data:') ||
    urlStr.startsWith('file:') ||
    urlStr.startsWith('javascript:') ||
    urlStr.startsWith('#')
  ) {
    return;
  }

  try {
    const url = new URL(urlStr, window.location.href);
    const pathname = url.pathname.toLowerCase();
    const ext = pathname.split('.').pop()?.split('?')[0];

    const hasDownloadAttr = anchor.hasAttribute('download');
    const isDownloadExt = ext && DOWNLOAD_EXTENSIONS.has(ext);

    if (hasDownloadAttr || isDownloadExt) {
      e.preventDefault();
      e.stopPropagation();

      safeSendMessage({
        action: 'SEND_DOWNLOAD',
        payload: {
          url: url.href,
          referrer: window.location.href,
          is_ytdlp: isVideoSite(url.href),
          protocol: isVideoSite(url.href) ? 'Yt-DLP' : 'Auto',
          title: anchor.textContent?.trim() || document.title || ''
        }
      }, (res) => {
        if (res && !res.success) {
          showInPageAlert('ThunderDM is Not Running', res.error || 'Thunder Download Manager is not running in background. Please start the app.', url.href);
        }
      });
    }
  } catch {}
}, true);

