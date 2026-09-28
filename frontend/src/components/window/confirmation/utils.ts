/**
 * Utility functions for DownloadStartConfirmation: path joining, credential vault matching,
 * cookie bypass rule evaluation, URL protocol/filename parsing, and queue concurrency checks.
 */

import { CookieBypassRule } from '../../../types/download';
import { detectCategory as utilDetectCategory } from '../../../utils/category';
import { loadFromThunderDB, saveToThunderDB } from '../../../utils/thunderDB';
import { WindowMinimise, WindowSetSize, Quit, invoke } from '../../../utils/tauriBridge';
import { Events, Window } from '@wailsio/runtime';
import { CookieBypassEvaluation, VaultCredentialMatch } from './types';

export const joinPath = (base: string, sub: string): string => {
  if (!base) return sub || '';
  if (!sub) return base;
  const isWin = base.includes('\\') || (!base.includes('/') && /^[a-zA-Z]:/.test(base));
  const sep = isWin ? '\\' : '/';
  const cleanBase = base.endsWith('\\') || base.endsWith('/') ? base.slice(0, -1) : base;
  const cleanSub = sub.startsWith('\\') || sub.startsWith('/') ? sub.slice(1) : sub;
  return `${cleanBase}${sep}${cleanSub}`;
};

export const matchVaultCredentials = (
  targetUrl: string,
  vaultList: any[] = []
): VaultCredentialMatch | null => {
  if (!targetUrl || !vaultList || !vaultList.length) return null;
  try {
    const parsed = new URL(targetUrl);
    const urlHost = parsed.host.toLowerCase();
    const urlHostname = parsed.hostname.toLowerCase();
    const urlSchemeHost = `${parsed.protocol}//${parsed.host}`.toLowerCase();

    for (const item of vaultList) {
      if (!item || !item.host) continue;
      const vHost = item.host.trim().toLowerCase().replace(/\/+$/, '');
      if (!vHost) continue;

      let isMatch = false;

      if (vHost === urlSchemeHost || vHost === urlHost || vHost === urlHostname) {
        isMatch = true;
      } else if (vHost.startsWith('http://') || vHost.startsWith('https://')) {
        try {
          const vParsed = new URL(vHost);
          if (vParsed.hostname.toLowerCase() === urlHostname) {
            if (!vParsed.port || vParsed.port === parsed.port) {
              isMatch = true;
            }
          }
        } catch {}
      } else {
        const cleanWildcard = vHost.replace(/^\*\./, '');
        const hostWithoutPort = cleanWildcard.split(':')[0];
        if (
          vHost === urlHost ||
          urlHostname === hostWithoutPort ||
          urlHostname.endsWith('.' + hostWithoutPort)
        ) {
          isMatch = true;
        }
      }

      if (isMatch) {
        return {
          user: item.user || item.username || '',
          pass: item.pass || item.password || '',
          userAgent: item.userAgent || item.user_agent || '',
          speedLimit: item.speedLimit || item.speed_limit || 0,
          threadCount: item.threadCount || item.thread_count || 0,
        };
      }
    }
  } catch {}
  return null;
};

export const DEFAULT_COOKIE_BYPASS_RULES: CookieBypassRule[] = [
  { domain: 'instagram.com', http: true, ytdlp: true, hls: true },
  { domain: 'tiktok.com', http: true, ytdlp: true, hls: true },
  { domain: 'facebook.com', http: true, ytdlp: true, hls: true },
  { domain: 'threads.net', http: true, ytdlp: true, hls: true },
  { domain: 'fb.watch', http: true, ytdlp: true, hls: true },
  { domain: 'fb.com', http: true, ytdlp: true, hls: true },
  { domain: 'youtube.com', http: false, ytdlp: true, hls: false },
];

export const YT_DLP_HOSTS: string[] = [
  'youtube.com',
  'youtu.be',
  'music.youtube.com',
  'vimeo.com',
  'tiktok.com',
  'douyin.com',
  'kuaishou.com',
  'instagram.com',
  'threads.net',
  'facebook.com',
  'fb.watch',
  'fb.com',
  'twitter.com',
  'x.com',
  'dailymotion.com',
  'dai.ly',
  'bilibili.com',
  'bilibili.tv',
  'bilibili.co',
  'bili.im',
  'bilibili.to',
  'bilibili.global',
  'soundcloud.com',
  'bandcamp.com',
  'mixcloud.com',
  'twitch.tv',
  'reddit.com',
  'streamable.com',
  'loom.com',
  'pinterest.com',
  'pin.it',
  'vk.com',
  'ok.ru',
  'rumble.com',
  'odysee.com',
  'bitchute.com',
  'weibo.com',
  'nicovideo.jp',
  'coub.com',
  'patreon.com',
  'vlive.tv',
  'ted.com',
  'archive.org',
];

export const normalizeProtocolCategory = (
  rawProto: string,
  targetUrl: string
): 'http' | 'ytdlp' | 'hls' => {
  const p = (rawProto || '').trim().toLowerCase();
  const u = (targetUrl || '').trim().toLowerCase();

  if (p.startsWith('yt-dlp') || p.startsWith('ytdlp') || p === 'video') {
    return 'ytdlp';
  }
  if (p === 'hls' || p === 'm3u8' || u.includes('.m3u8')) {
    return 'hls';
  }
  if (p === 'auto') {
    if (
      u.includes('youtube.com') ||
      u.includes('youtu.be') ||
      u.includes('vimeo.com') ||
      u.includes('tiktok.com') ||
      u.includes('instagram.com') ||
      u.includes('threads.net') ||
      u.includes('facebook.com') ||
      u.includes('fb.watch') ||
      u.includes('fb.com') ||
      u.includes('twitter.com') ||
      u.includes('x.com')
    ) {
      return 'ytdlp';
    }
    if (u.includes('.m3u8')) {
      return 'hls';
    }
    return 'http';
  }
  return 'http';
};

export const findMatchedCookieBypassRule = (
  targetUrl: string,
  rules: CookieBypassRule[] = []
): CookieBypassRule | null => {
  if (!targetUrl || !rules || !rules.length) return null;
  const lowerUrl = targetUrl.toLowerCase();
  let hostname = '';
  try {
    if (lowerUrl.includes('://')) {
      hostname = new URL(lowerUrl).hostname;
    }
  } catch {}
  for (const r of rules) {
    const cleanD = (r.domain || '').trim().toLowerCase().replace(/^\*\./, '');
    if (!cleanD) continue;
    if (
      (hostname && (hostname === cleanD || hostname.endsWith('.' + cleanD))) ||
      lowerUrl.includes(cleanD)
    ) {
      return r;
    }
  }
  return null;
};

export const isCookieBypassedByDatabase = (
  targetUrl: string,
  protocol: string,
  rules: CookieBypassRule[] = []
): CookieBypassEvaluation => {
  const effectiveProto = normalizeProtocolCategory(protocol, targetUrl);
  const matchedRule = findMatchedCookieBypassRule(targetUrl, rules);
  if (!matchedRule) {
    return { isBypassed: false, matchedRule: null, effectiveProtocol: effectiveProto };
  }
  let isBypassed = false;
  if (effectiveProto === 'http') isBypassed = Boolean(matchedRule.http);
  else if (effectiveProto === 'ytdlp') isBypassed = Boolean(matchedRule.ytdlp);
  else if (effectiveProto === 'hls') isBypassed = Boolean(matchedRule.hls);

  return { isBypassed, matchedRule, effectiveProtocol: effectiveProto };
};

export const getInitialWindowId = (): string => {
  try {
    const hash = window.location.hash || '';
    const query = hash.includes('?')
      ? hash.split('?')[1]
      : (window.location.search || '').replace(/^\?/, '');
    const params = new URLSearchParams(query);
    const idFromUrl = params.get('id') || params.get('windowId');
    if (idFromUrl) return idFromUrl;
  } catch {}
  return '';
};

export const deriveInitialName = (
  extensionFilename: string | undefined,
  initialUrl: string
): string => {
  if (extensionFilename) return decodeURIComponent(extensionFilename);
  if (initialUrl && initialUrl.toLowerCase().startsWith('magnet:')) {
    const dnMatch = initialUrl.match(/[?&]dn=([^&]+)/i);
    if (dnMatch && dnMatch[1]) {
      try {
        return decodeURIComponent(dnMatch[1].replace(/\+/g, ' '));
      } catch {
        return dnMatch[1];
      }
    }
    const xtMatch = initialUrl.match(/[?&]xt=urn:btih:([^&]+)/i);
    if (xtMatch && xtMatch[1]) {
      return `Torrent_${xtMatch[1].slice(0, 8)}`;
    }
    return 'Torrent_Download';
  }
  return '';
};

export const analyzeUrlProtocolAndFilename = (
  rawUrl: string,
  protocol: string,
  initialName: string,
  currentName: string
): {
  isTorrent: boolean;
  isYTDLP: boolean;
  isHLS: boolean;
  cleanFilename: string;
  nextProtocol?: string;
} => {
  let pathname = rawUrl.trim();
  try {
    pathname = new URL(rawUrl.trim()).pathname;
  } catch {}

  pathname = pathname.replace(/\\/g, '/');
  const segments = pathname.split('/');
  const rawFilename = segments.pop() || '';
  let cleanFilename = decodeURIComponent(rawFilename).replace(/^['"]|['"]$/g, '');

  const lowerUrl = rawUrl.trim().toLowerCase();
  const isTorrent =
    protocol === 'Torrent' ||
    lowerUrl.startsWith('magnet:') ||
    lowerUrl.endsWith('.torrent') ||
    lowerUrl.includes('.torrent?') ||
    lowerUrl.includes('.torrent#') ||
    cleanFilename.toLowerCase().endsWith('.torrent');
  const isYTDLP =
    !isTorrent &&
    (protocol === 'Yt-DLP' ||
      YT_DLP_HOSTS.some((h) => lowerUrl.includes(h)) ||
      lowerUrl.includes('/video/') ||
      lowerUrl.includes('/videos/') ||
      lowerUrl.includes('/shorts/') ||
      lowerUrl.includes('/reel/') ||
      lowerUrl.includes('/reels/') ||
      lowerUrl.includes('/bangumi/') ||
      (lowerUrl.includes('/watch') &&
        (lowerUrl.includes('stream') ||
          lowerUrl.includes('media') ||
          lowerUrl.includes('tv') ||
          lowerUrl.includes('bilibili'))));
  const isHLS =
    !isTorrent &&
    !isYTDLP &&
    (lowerUrl.includes('.m3u8') ||
      cleanFilename.toLowerCase().endsWith('.m3u8') ||
      protocol === 'HLS');

  let nextProtocol: string | undefined;

  if (isTorrent) {
    nextProtocol = 'Torrent';
    if (
      initialName &&
      initialName.trim() &&
      initialName !== 'download' &&
      !initialName.toLowerCase().endsWith('.torrent')
    ) {
      cleanFilename = initialName.trim();
    } else if (
      currentName &&
      currentName.trim() &&
      currentName !== 'download' &&
      !currentName.toLowerCase().endsWith('.torrent') &&
      !currentName.includes('/') &&
      !currentName.includes('\\')
    ) {
      cleanFilename = currentName.trim();
    } else if (
      !cleanFilename ||
      cleanFilename === '/' ||
      cleanFilename === '.' ||
      cleanFilename === 'download' ||
      cleanFilename.toLowerCase().endsWith('.torrent')
    ) {
      try {
        const dnMatch = rawUrl.match(/[?&]dn=([^&]+)/i);
        if (dnMatch && dnMatch[1]) {
          cleanFilename = decodeURIComponent(dnMatch[1].replace(/\+/g, ' '));
        } else {
          const xtMatch = rawUrl.match(/[?&]xt=urn:btih:([^&]+)/i);
          if (xtMatch && xtMatch[1]) {
            cleanFilename = `Torrent_${xtMatch[1].slice(0, 8)}`;
          } else if (currentName && currentName.trim()) {
            cleanFilename = currentName.trim();
          } else if (initialName && initialName.trim()) {
            cleanFilename = initialName.trim();
          } else {
            cleanFilename = 'Torrent_Download';
          }
        }
      } catch {
        cleanFilename = currentName || initialName || 'Torrent_Download';
      }
    }
  } else if (isYTDLP) {
    nextProtocol = 'Yt-DLP';
    if (
      initialName &&
      initialName.trim() &&
      initialName !== 'video.mp4' &&
      initialName !== 'download'
    ) {
      cleanFilename = initialName.trim();
    } else {
      let extractedId = '';
      const pathParts = pathname.split('/').filter(Boolean);
      for (let i = 0; i < pathParts.length; i++) {
        const p = pathParts[i].toLowerCase();
        if (
          ['p', 'reel', 'reels', 'tv', 'shorts', 'video', 'videos', 'status', 'clip'].includes(p) &&
          i + 1 < pathParts.length
        ) {
          extractedId = pathParts[i + 1];
          break;
        }
      }
      if (
        extractedId &&
        extractedId !== 'watch' &&
        extractedId !== 'video' &&
        extractedId !== 'index'
      ) {
        const prefix = lowerUrl.includes('instagram.com')
          ? 'Instagram_'
          : lowerUrl.includes('tiktok.com')
          ? 'TikTok_'
          : '';
        cleanFilename = `${prefix}${extractedId}.mp4`;
      } else if (
        !cleanFilename ||
        cleanFilename === 'watch' ||
        cleanFilename.includes('?') ||
        cleanFilename === 'video' ||
        cleanFilename.toLowerCase().endsWith('.html') ||
        cleanFilename.toLowerCase().endsWith('.htm') ||
        cleanFilename === 'reel' ||
        cleanFilename === 'reels' ||
        cleanFilename === 'p'
      ) {
        cleanFilename = 'video.mp4';
      } else if (!cleanFilename.includes('.')) {
        cleanFilename = `${cleanFilename}.mp4`;
      }
    }
  } else if (isHLS) {
    nextProtocol = 'HLS';
    if (cleanFilename.toLowerCase().endsWith('.m3u8')) {
      const baseName = cleanFilename.replace(/\.m3u8$/i, '');
      cleanFilename =
        baseName === '' ||
        baseName === 'master' ||
        baseName === 'playlist' ||
        baseName === 'index'
          ? 'video.mp4'
          : `${baseName}.mp4`;
    }
  }

  return { isTorrent, isYTDLP, isHLS, cleanFilename, nextProtocol };
};

export const resolveFinalDownloadTarget = async (params: {
  url: string;
  name: string;
  protocol: string;
  category: string;
  savePath: string;
  defaultBasePath: string;
  globalDownloadPath?: string;
  isCustomPath: boolean;
  useCategory: boolean;
  categoryPaths: { [key: string]: string };
  ytdlpQuality: string;
  useCookie: boolean;
  cookies: string;
}): Promise<{
  finalName: string;
  finalSavePath: string;
  resolvedCat: string;
  effectiveProtocol: string;
  effectiveCookies: string | undefined;
  isYTDLP: boolean;
}> => {
  const {
    url,
    name,
    protocol,
    category,
    savePath,
    defaultBasePath,
    globalDownloadPath,
    isCustomPath,
    useCategory,
    categoryPaths,
    ytdlpQuality,
    useCookie,
    cookies,
  } = params;

  let finalName = name.trim() || url.split('/').pop() || 'download';
  const lowerUrl = url.trim().toLowerCase();
  if (protocol === 'Torrent' || lowerUrl.startsWith('magnet:') || lowerUrl.endsWith('.torrent')) {
    if (
      !finalName ||
      finalName === 'download' ||
      finalName.startsWith('magnet:') ||
      finalName === '/' ||
      finalName === '.'
    ) {
      const dnMatch = url.match(/[?&]dn=([^&]+)/i);
      if (dnMatch && dnMatch[1]) {
        try {
          finalName = decodeURIComponent(dnMatch[1].replace(/\+/g, ' '));
        } catch {
          finalName = dnMatch[1];
        }
      } else {
        const xtMatch = url.match(/[?&]xt=urn:btih:([^&]+)/i);
        if (xtMatch && xtMatch[1]) {
          finalName = `Torrent_${xtMatch[1].slice(0, 8)}`;
        } else {
          finalName = 'Torrent_Download';
        }
      }
    }
  }
  if (
    finalName.toLowerCase().endsWith('.m3u8') ||
    protocol === 'HLS' ||
    protocol === 'Yt-DLP'
  ) {
    finalName = finalName.replace(/\.m3u8$/i, '.mp4');
    if (!finalName.includes('.')) finalName += '.mp4';
  }

  const isTorrent =
    protocol === 'Torrent' ||
    lowerUrl.startsWith('magnet:') ||
    lowerUrl.endsWith('.torrent') ||
    lowerUrl.includes('.torrent?') ||
    lowerUrl.includes('.torrent#');
  const isYTDLP = protocol === 'Yt-DLP';
  const isHLS = protocol === 'HLS';

  const resolvedCat = isTorrent
    ? 'Torrents'
    : isYTDLP || isHLS
    ? 'Videos'
    : category && category !== 'All' && category !== 'None'
    ? category
    : utilDetectCategory(finalName || url, protocol);

  let finalSavePath = (savePath || '').trim();
  let currentBase = defaultBasePath || globalDownloadPath || '';
  if (!currentBase) {
    try {
      currentBase = (await invoke<string>('get_default_download_dir')) || '';
    } catch {}
  }
  if (!isCustomPath && useCategory && resolvedCat && resolvedCat !== 'All' && resolvedCat !== 'None') {
    const customCatPath = categoryPaths[resolvedCat];
    finalSavePath = customCatPath || joinPath(currentBase, resolvedCat);
  } else {
    const isRel =
      !finalSavePath ||
      (!finalSavePath.includes(':') &&
        !finalSavePath.startsWith('/') &&
        !finalSavePath.startsWith('\\\\'));
    if (isRel && currentBase) {
      finalSavePath = finalSavePath ? joinPath(currentBase, finalSavePath) : currentBase;
    }
  }

  try {
    const resolved = await invoke<string>('resolve_unique_filename_command', {
      savePath: finalSavePath,
      filename: finalName,
    });
    if (resolved) {
      finalName = resolved;
    }
  } catch {}

  const effectiveCookies = useCookie && cookies && cookies.trim() ? cookies.trim() : undefined;
  let effectiveProtocol =
    protocol === 'Yt-DLP' ? `Yt-DLP:${ytdlpQuality}` : protocol || 'Auto';
  if (effectiveCookies) {
    effectiveProtocol += `::cookie=${encodeURIComponent(effectiveCookies)}`;
  }
  if (useCookie) {
    effectiveProtocol += `::force_cookie=true`;
  }

  return {
    finalName,
    finalSavePath,
    resolvedCat,
    effectiveProtocol,
    effectiveCookies,
    isYTDLP,
  };
};

export const evaluateQueueShouldWait = async (
  queueName: string,
  baseList: any[],
  globalSettings: any
): Promise<boolean> => {
  const cleanQueue = (queueName || '').trim();
  const isQueueAssigned = cleanQueue !== '';

  if (isQueueAssigned) {
    let targetQ: any = null;
    try {
      const storedQueues = await loadFromThunderDB<any[]>('queues', []);
      if (Array.isArray(storedQueues)) {
        targetQ = storedQueues.find(
          (q: any) =>
            q.name?.toLowerCase() === cleanQueue.toLowerCase() ||
            q.id?.toLowerCase() === cleanQueue.toLowerCase()
        );
      }
    } catch {}

    if (!targetQ || !targetQ.isRunning) {
      return true;
    }
    const queueMax = Math.max(1, targetQ.maxConcurrent || 1);
    const activeInQueue = baseList.filter(
      (d: any) =>
        Boolean(d.queue && d.queue.trim() !== '') &&
        (d.queue.toLowerCase() === targetQ.name?.toLowerCase() ||
          d.queue.toLowerCase() === targetQ.id?.toLowerCase()) &&
        (d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging')
    ).length;
    return activeInQueue >= queueMax;
  }

  let maxAllowed = Infinity;
  let isUnlimited = true;
  try {
    const engine = await loadFromThunderDB<any>('download_engine', null);
    const conf = engine || globalSettings;
    if (conf) {
      const mc =
        conf.maxConcurrentDownloads !== undefined
          ? conf.maxConcurrentDownloads
          : conf.maxConcurrent;
      if (mc === 0 || mc === undefined || mc === null || mc >= 999) {
        isUnlimited = true;
        maxAllowed = Infinity;
      } else {
        isUnlimited = false;
        maxAllowed = Math.max(1, Number(mc));
      }
    }
  } catch {}

  const activeGeneralCount = baseList.filter(
    (d: any) =>
      (!d.queue || d.queue.trim() === '') &&
      (d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging')
  ).length;

  return !isUnlimited && activeGeneralCount >= maxAllowed;
};

export const extractCookieBypassRules = (source: any): CookieBypassRule[] | null => {
  if (!source) return null;
  if (Array.isArray(source.cookieBypassRules) && source.cookieBypassRules.length > 0) {
    return source.cookieBypassRules;
  }
  if (Array.isArray(source.cookieBypassDomains) && source.cookieBypassDomains.length > 0) {
    return source.cookieBypassDomains.map((d: string) => ({
      domain: d,
      http: true,
      ytdlp: true,
      hls: true,
    }));
  }
  return null;
};

export const formatProbeErrorMessage = (err: any, effectiveUseCookie: boolean): string => {
  const msg = typeof err === 'string' ? err : err?.message || 'Error fetching info';
  if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
    return 'Authentication Required (401): Please check your credentials in Site Credentials Vault or Extra Config (⚙️).';
  }
  if (
    !effectiveUseCookie &&
    (msg.includes('404') || msg.includes('403') || msg.toLowerCase().includes('not found'))
  ) {
    return `Server Error: ${msg}. Cookies are disabled for this site. Enable "Use Cookie" if this is a private resource.`;
  }
  return `Server Error: ${msg}`;
};

export const loadInitialEngineAndQueues = async (defaultThreadsFallback: number) => {
  let engine = await loadFromThunderDB<any>('download_engine', null);
  if (!engine) {
    try {
      engine = await invoke<any>('get_engine_config_command');
    } catch {}
  }
  if (!engine) {
    try {
      const sysDir = await invoke<string>('get_default_download_dir');
      if (sysDir) engine = { downloadPath: sysDir };
    } catch {}
  }

  let resolvedDefaultThreads = defaultThreadsFallback;
  if (engine) {
    resolvedDefaultThreads =
      engine.defaultThreadCount || engine.threadCount || defaultThreadsFallback;
  } else {
    try {
      const defFromBackend = await invoke<number>('get_default_thread_count_command');
      if (defFromBackend && defFromBackend > 0) {
        resolvedDefaultThreads = defFromBackend;
      }
    } catch {}
  }

  const savedCategoryPaths: { [key: string]: string } =
    engine && engine.categoryPaths && typeof engine.categoryPaths === 'object'
      ? engine.categoryPaths
      : {};

  const loadedRules = extractCookieBypassRules(engine) || [];

  const qList = await loadFromThunderDB<any[]>('queues', [{ id: 'main', name: 'Main' }]);
  const existingDownloadsJson = await loadFromThunderDB<any[]>('downloads', []);
  const counts: { [key: string]: number } = {};
  if (Array.isArray(existingDownloadsJson)) {
    existingDownloadsJson.forEach((d: any) => {
      const q = d.queue;
      if (q && q.trim() !== '') {
        counts[q] = (counts[q] || 0) + 1;
      }
    });
  }

  return {
    engine,
    resolvedDefaultThreads,
    savedCategoryPaths,
    loadedRules,
    queues: Array.isArray(qList) && qList.length > 0 ? qList : null,
    queueCounts: counts,
  };
};

export const resolvePayloadCategoryAndProtocol = (
  payload: any,
  currentProtocol: string
): { payloadCat: string; payloadProtocol: string; ytdlpQuality?: string } => {
  const lowerUrl = (payload.url || '').toLowerCase();
  const isTorrentPayload =
    payload.protocol === 'Torrent' ||
    lowerUrl.startsWith('magnet:') ||
    lowerUrl.endsWith('.torrent') ||
    lowerUrl.includes('.torrent?') ||
    lowerUrl.includes('.torrent#');
  const isYtPayload =
    payload.protocol?.startsWith('Yt-DLP') || payload.protocol?.startsWith('YT-DLP');
  const isHlsPayload = payload.protocol === 'HLS';

  let payloadCat = payload.category || '';
  if (isTorrentPayload) {
    payloadCat = 'Torrents';
  } else if (isYtPayload || isHlsPayload) {
    payloadCat = 'Videos';
  } else if (!payloadCat || payloadCat === 'Documents') {
    if (payload.filename) {
      payloadCat = utilDetectCategory(payload.filename, payload.protocol);
    } else if (payload.url) {
      payloadCat = utilDetectCategory(payload.url, payload.protocol);
    }
  }

  let payloadProtocol = currentProtocol;
  let ytdlpQuality: string | undefined;
  if (payload.protocol) {
    if (payload.protocol.startsWith('Yt-DLP') || payload.protocol.startsWith('YT-DLP')) {
      payloadProtocol = 'Yt-DLP';
      if (payload.protocol.includes(':')) {
        ytdlpQuality = payload.protocol.split(':')[1] || 'best';
      }
    } else {
      payloadProtocol = payload.protocol;
    }
  }

  return { payloadCat, payloadProtocol, ytdlpQuality };
};

export const isTorrentUrl = (rawUrl: string): boolean => {
  const lower = (rawUrl || '').toLowerCase();
  return (
    lower.startsWith('magnet:') ||
    lower.endsWith('.torrent') ||
    lower.includes('.torrent?') ||
    lower.includes('.torrent#')
  );
};

export const deriveInitialCategory = (
  extensionCategory: string | undefined,
  initialUrl: string,
  initialName: string
): string => {
  if (extensionCategory) return extensionCategory;
  if (isTorrentUrl(initialUrl)) return 'Torrents';
  return initialName
    ? utilDetectCategory(initialName)
    : initialUrl
    ? utilDetectCategory(initialUrl)
    : '';
};

export const deriveInitialSavePath = (
  extensionPayload: any,
  base: string,
  initialUrl: string,
  initialName: string
): string => {
  if (extensionPayload?.savePath || extensionPayload?.save_path) {
    return extensionPayload.savePath || extensionPayload.save_path;
  }
  const cat = deriveInitialCategory(extensionPayload?.category, initialUrl, initialName);
  return cat ? joinPath(base, cat) : base;
};

export const minimizeConfirmationWindow = async (): Promise<void> => {
  try {
    await invoke('minimize_window');
  } catch {
    try {
      WindowMinimise();
    } catch {}
  }
};

export const closeConfirmationWindow = async (): Promise<void> => {
  const currentWindowId = getInitialWindowId();
  try {
    if (currentWindowId) {
      await invoke('clear_download_confirmation_payload', currentWindowId);
      await invoke('close_download_confirmation_window_command', currentWindowId);
    } else {
      await invoke('clear_download_confirmation_payload');
      await invoke('close_window');
    }
  } catch {
    try {
      Quit();
    } catch {}
  }
};

export const resizeConfirmationWindow = (hasError: boolean): void => {
  const targetHeight = hasError ? 470 : 400;
  const currentWindowId = getInitialWindowId();

  try {
    Window.SetSize(500, targetHeight);
  } catch {}
  try {
    WindowSetSize(500, targetHeight);
  } catch {}
  try {
    invoke('set_download_confirmation_window_size_command', {
      windowId: currentWindowId,
      width: 500,
      height: targetHeight,
    });
  } catch {}
};

export interface TaskSubmissionContext {
  url: string;
  name: string;
  protocol: string;
  category: string;
  savePath: string;
  defaultBasePath: string;
  globalSettings: any;
  isCustomPath: boolean;
  useCategory: boolean;
  categoryPaths: { [key: string]: string };
  ytdlpQuality: string;
  useCookie: boolean;
  cookies: string;
  checksumEnabled: boolean;
  checksumVal: string;
  calculatedLimit: number | null;
  queue: string;
  vaultList: any[];
  threadCount: number;
  defaultThreadCount: number;
  acceptRanges: boolean | null;
  username: string;
  password: string;
  userAgent: string;
  refererPage: string;
  saveCategoryPath: boolean;
  onSaveCategoryPath: (cat: string, path: string) => Promise<void>;
  addDownload?: (...args: any[]) => Promise<any>;
}

export const executeDownloadNowTask = async (ctx: TaskSubmissionContext): Promise<void> => {
  const {
    url,
    name,
    protocol,
    category,
    savePath,
    defaultBasePath,
    globalSettings,
    isCustomPath,
    useCategory,
    categoryPaths,
    ytdlpQuality,
    useCookie,
    cookies,
    checksumEnabled,
    checksumVal,
    calculatedLimit,
    queue,
    vaultList,
    threadCount,
    defaultThreadCount,
    acceptRanges,
    username,
    password,
    userAgent,
    refererPage,
    saveCategoryPath,
    onSaveCategoryPath,
    addDownload,
  } = ctx;

  const { finalName, finalSavePath, resolvedCat, effectiveProtocol, effectiveCookies, isYTDLP } =
    await resolveFinalDownloadTarget({
      url,
      name,
      protocol,
      category,
      savePath,
      defaultBasePath,
      globalDownloadPath: globalSettings?.downloadPath,
      isCustomPath,
      useCategory,
      categoryPaths,
      ytdlpQuality,
      useCookie,
      cookies,
    });

  const taskId = Date.now().toString();
  const rawChecksum = (checksumVal || '').trim();
  const givenCheckSum =
    (checksumEnabled || rawChecksum !== '') && rawChecksum !== '' ? rawChecksum : '';

  let baseList: any[] = [];
  try {
    const existingDownloadsJson = await loadFromThunderDB<any[]>('downloads', []);
    baseList = Array.isArray(existingDownloadsJson) ? existingDownloadsJson : [];
  } catch {}

  const shouldQueue = await evaluateQueueShouldWait(queue, baseList, globalSettings);
  const matchedVault = matchVaultCredentials(url.trim(), vaultList);
  const resolvedThreadCount =
    matchedVault?.threadCount ||
    (threadCount > 0 ? threadCount : defaultThreadCount || globalSettings?.defaultThreadCount || 8);
  const resolvedSpeedLimit =
    matchedVault?.speedLimit && matchedVault.speedLimit > 0
      ? matchedVault.speedLimit * 1024
      : calculatedLimit;

  const taskItem: any = {
    id: taskId,
    name: finalName,
    category: resolvedCat,
    url,
    size: 0,
    downloaded: 0,
    status: shouldQueue ? 'Queued' : 'Downloading',
    speed: 0,
    timeLeft: shouldQueue ? 'Queued' : 'Calculating...',
    dateAdded: new Date().toISOString(),
    queue: queue || '',
    savePath: finalSavePath,
    resumeSupport: acceptRanges === true ? 'Yes' : acceptRanges === false ? 'No' : 'Unknown',
    threadCount: resolvedThreadCount,
    speedLimit: resolvedSpeedLimit,
    username: username.trim() || matchedVault?.user || undefined,
    password: password.trim() || matchedVault?.pass || undefined,
    userAgent: userAgent.trim() || matchedVault?.userAgent || undefined,
    referer: refererPage.trim() || undefined,
    cookies: effectiveCookies,
    forceCookie: useCookie,
    force_cookie: useCookie,
    protocol: effectiveProtocol,
    chunks: [],
    ...(givenCheckSum ? { givenCheckSum, expectedChecksum: givenCheckSum } : {}),
  };

  try {
    Events.Emit('register-download-item', taskItem);
  } catch {}

  try {
    await saveToThunderDB('downloads', [taskItem, ...baseList.filter((d: any) => d.id !== taskId)]);
  } catch (err) {
    console.error('Failed to save download to json:', err);
  }

  if (saveCategoryPath && resolvedCat && resolvedCat !== 'All' && resolvedCat !== 'None' && finalSavePath) {
    await onSaveCategoryPath(resolvedCat, finalSavePath);
  }

  if (!shouldQueue) {
    try {
      const appData = await loadFromThunderDB<any>('appearance', {});
      const shouldShowProgress =
        appData && typeof appData.showProgressDialog === 'boolean'
          ? appData.showProgressDialog
          : true;

      if (shouldShowProgress) {
        await invoke('remove_hidden_download_command', { id: taskId });
        await invoke('open_realtime_progress_window_command', {
          id: taskId,
          taskId: taskId,
          filename: finalName,
          url: url,
          savePath: finalSavePath,
          resumeSupport:
            acceptRanges === true ? 'Yes' : acceptRanges === false ? 'No' : 'Unknown',
          resumable: acceptRanges === true,
          force: true,
          showRealTimeProgress: true,
          protocol: effectiveProtocol,
          is_ytdlp: isYTDLP,
          isYTDLP: isYTDLP,
        });
      }
    } catch (e) {
      console.error('Failed to open realtime progress window from confirmation:', e);
    }

    try {
      await invoke('start_download', {
        id: taskId,
        url,
        savePath: finalSavePath,
        filename: finalName,
        category: resolvedCat,
        queue: queue || '',
        threadCount: resolvedThreadCount,
        speedLimit: resolvedSpeedLimit,
        speed_limit: resolvedSpeedLimit,
        protocol: effectiveProtocol,
        givenCheckSum: givenCheckSum || undefined,
        expectedChecksum: givenCheckSum || undefined,
        username: username.trim() || matchedVault?.user || undefined,
        password: password.trim() || matchedVault?.pass || undefined,
        userAgent: userAgent.trim() || matchedVault?.userAgent || undefined,
        referer: refererPage.trim() || undefined,
        cookies: effectiveCookies,
        forceCookie: useCookie,
        force_cookie: useCookie,
      });
    } catch {
      if (addDownload) {
        await addDownload(url, finalName, (category || 'Other') as any, finalSavePath, queue, {
          givenCheckSum,
          expectedChecksum: givenCheckSum,
          threadCount:
            threadCount > 0
              ? threadCount
              : defaultThreadCount || globalSettings?.defaultThreadCount || 8,
          speedLimit: calculatedLimit,
          protocol: effectiveProtocol,
          username: username.trim() || undefined,
          password: password.trim() || undefined,
          userAgent: userAgent.trim() || undefined,
          referer: refererPage.trim() || undefined,
          cookies: effectiveCookies,
          forceCookie: useCookie,
          force_cookie: useCookie,
        });
      }
    }
  }
};

export const executeAddOnlyTask = async (
  ctx: TaskSubmissionContext,
  targetQueueName?: string
): Promise<void> => {
  const {
    url,
    name,
    protocol,
    category,
    savePath,
    defaultBasePath,
    globalSettings,
    isCustomPath,
    useCategory,
    categoryPaths,
    ytdlpQuality,
    useCookie,
    cookies,
    checksumEnabled,
    checksumVal,
    calculatedLimit,
    queue,
    vaultList,
    threadCount,
    defaultThreadCount,
    acceptRanges,
    username,
    password,
    userAgent,
    refererPage,
    saveCategoryPath,
    onSaveCategoryPath,
  } = ctx;

  const isWithoutQueue = targetQueueName === '';
  const resolvedQueue =
    targetQueueName === ''
      ? ''
      : typeof targetQueueName === 'string' && targetQueueName.trim() !== ''
      ? targetQueueName.trim()
      : queue || 'Main';

  const { finalName, finalSavePath, resolvedCat, effectiveProtocol, effectiveCookies } =
    await resolveFinalDownloadTarget({
      url,
      name,
      protocol,
      category,
      savePath,
      defaultBasePath,
      globalDownloadPath: globalSettings?.downloadPath,
      isCustomPath,
      useCategory,
      categoryPaths,
      ytdlpQuality,
      useCookie,
      cookies,
    });

  const taskId = Date.now().toString();
  const rawChecksum = (checksumVal || '').trim();
  const givenCheckSum =
    (checksumEnabled || rawChecksum !== '') && rawChecksum !== '' ? rawChecksum : '';
  const matchedVault = matchVaultCredentials(url.trim(), vaultList);

  const taskItem: any = {
    id: taskId,
    name: finalName,
    category: resolvedCat,
    url,
    size: 0,
    downloaded: 0,
    status: isWithoutQueue ? 'Paused' : 'Queued',
    speed: 0,
    timeLeft: isWithoutQueue ? 'Paused' : 'Queued',
    dateAdded: new Date().toISOString(),
    queue: resolvedQueue,
    savePath: finalSavePath,
    resumeSupport: acceptRanges === true ? 'Yes' : acceptRanges === false ? 'No' : 'Unknown',
    threadCount:
      matchedVault?.threadCount ||
      (threadCount > 0
        ? threadCount
        : defaultThreadCount || globalSettings?.defaultThreadCount || 8),
    speedLimit: calculatedLimit,
    protocol: effectiveProtocol,
    username: username.trim() || undefined,
    password: password.trim() || undefined,
    userAgent: userAgent.trim() || undefined,
    referer: refererPage.trim() || undefined,
    cookies: effectiveCookies,
    forceCookie: useCookie,
    force_cookie: useCookie,
    chunks: [],
    ...(givenCheckSum ? { givenCheckSum, expectedChecksum: givenCheckSum } : {}),
  };

  try {
    Events.Emit('register-download-item', taskItem);
  } catch {}

  try {
    const existingDownloadsJson = await loadFromThunderDB<any[]>('downloads', []);
    const baseList = Array.isArray(existingDownloadsJson) ? existingDownloadsJson : [];
    await saveToThunderDB('downloads', [taskItem, ...baseList.filter((d: any) => d.id !== taskId)]);
  } catch (err) {
    console.error('Failed to save download to json:', err);
  }

  if (saveCategoryPath && resolvedCat && resolvedCat !== 'All' && resolvedCat !== 'None' && finalSavePath) {
    await onSaveCategoryPath(resolvedCat, finalSavePath);
  }
};


