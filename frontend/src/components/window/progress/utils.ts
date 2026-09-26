/**
 * Utility functions for RealTimeDownloadProgress: task ID parsing, ETA formatting,
 * speed limit unit conversions, protocol detection, resume support resolution,
 * and window/task IPC commands.
 */

import { WindowHide, Quit, invoke } from '../../../utils/tauriBridge';
import { loadFromThunderDB } from '../../../utils/thunderDB';
import { ParsedSpeedLimit } from './types';

export const YT_DLP_DOMAINS: string[] = [
  'youtube.com',
  'youtu.be',
  'music.youtube.com',
  'vimeo.com',
  'dailymotion.com',
  'dai.ly',
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
  'twitch.tv',
  'soundcloud.com',
  'bandcamp.com',
  'mixcloud.com',
  'bilibili.com',
  'bilibili.tv',
  'bilibili.co',
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
];

export const getInitialTaskId = (): string => {
  try {
    const hash = window.location.hash || '';
    const query = hash.includes('?')
      ? hash.split('?')[1]
      : (window.location.search || '').replace(/^\?/, '');
    const params = new URLSearchParams(query);
    const idFromUrl = params.get('id');
    if (idFromUrl) return idFromUrl;
  } catch {}
  return '';
};

export const formatEtaFromSeconds = (eta: number): string => {
  if (eta <= 0 || !isFinite(eta)) {
    return 'Calculating...';
  }
  const h = Math.floor(eta / 3600);
  const m = Math.floor((eta % 3600) / 60);
  const s = Math.floor(eta % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

export const parseSpeedLimitBytes = (spLimit: number): ParsedSpeedLimit => {
  if (spLimit >= 1024 * 1024 && spLimit % (1024 * 1024) === 0) {
    return {
      enabled: true,
      unit: 'MB/s',
      val: Math.round(spLimit / (1024 * 1024)),
    };
  }
  if (spLimit >= 1024 * 1024) {
    return {
      enabled: true,
      unit: 'MB/s',
      val: parseFloat((spLimit / (1024 * 1024)).toFixed(1)),
    };
  }
  return {
    enabled: true,
    unit: 'KB/s',
    val: Math.round(spLimit / 1024),
  };
};

export const toSpeedLimitBytes = (enabled: boolean, val: number, unit: string): number => {
  if (!enabled || val <= 0) return 0;
  return unit === 'KB/s' ? Math.round(val * 1024) : Math.round(val * 1024 * 1024);
};

export const detectYtdlpPayload = (p: any): boolean => {
  if (!p) return false;
  return Boolean(
    p.is_ytdlp ||
      p.isYTDLP ||
      p.protocol === 'Yt-DLP' ||
      (typeof p.protocol === 'string' && p.protocol.startsWith('Yt-DLP')) ||
      (p.url && YT_DLP_DOMAINS.some((d) => p.url.toLowerCase().includes(d)))
  );
};

export const detectTorrentPayload = (p: any): boolean => {
  if (!p) return false;
  return Boolean(
    p.protocol === 'Torrent' ||
      (typeof p.protocol === 'string' && p.protocol.startsWith('Torrent')) ||
      (p.url && (p.url.startsWith('magnet:') || p.url.endsWith('.torrent')))
  );
};

export const resolveResumeSupportFromPayload = (p: any): string | null => {
  if (!p) return null;
  if (p.resume_support !== undefined && p.resume_support !== null) {
    return p.resume_support === true || p.resume_support === 'Yes'
      ? 'Yes'
      : p.resume_support === false || p.resume_support === 'No'
      ? 'No'
      : p.resume_support;
  }
  if (p.resumeSupport !== undefined && p.resumeSupport !== null) {
    return p.resumeSupport === true || p.resumeSupport === 'Yes'
      ? 'Yes'
      : p.resumeSupport === false || p.resumeSupport === 'No'
      ? 'No'
      : p.resumeSupport;
  }
  if (p.resumable !== undefined && p.resumable !== null) {
    return p.resumable ? 'Yes' : 'No';
  }
  if (p.accept_ranges !== undefined && p.accept_ranges !== null) {
    return p.accept_ranges ? 'Yes' : 'No';
  }
  if (
    p.is_ytdlp ||
    p.is_hls ||
    p.protocol === 'HLS' ||
    (typeof p.protocol === 'string' && p.protocol.startsWith('Yt-DLP')) ||
    (p.url && (p.url.includes('youtube.com') || p.url.includes('youtu.be')))
  ) {
    return 'Yes';
  }
  if (Array.isArray(p.chunks) && p.chunks.length > 1) {
    return 'Yes';
  }
  return null;
};

export const isYtdlpMissingOrError = (
  isYTDLP: boolean,
  isYtdlpInstalled: boolean,
  errorMessage: string | null
): boolean => {
  return (
    isYTDLP &&
    (!isYtdlpInstalled ||
      (Boolean(errorMessage) &&
        (errorMessage!.toLowerCase().includes('yt-dlp is not installed') ||
          errorMessage!.toLowerCase().includes('executable file not found') ||
          errorMessage!.toLowerCase().includes('not found on your system'))))
  );
};

export const loadInitialProgressEngineConfig = async (): Promise<{
  defaultThreads: number;
  speedLimit: ParsedSpeedLimit | null;
  isYtdlpInstalled: boolean;
}> => {
  let defaultThreads = 8;
  let speedLimit: ParsedSpeedLimit | null = null;
  let isYtdlpInstalled = true;

  try {
    let dbEngine = await loadFromThunderDB<any>('download_engine', null);
    if (!dbEngine) {
      try {
        dbEngine = await invoke<any>('get_engine_config_command');
      } catch {}
    }
    if (dbEngine) {
      defaultThreads = dbEngine.defaultThreadCount || dbEngine.threadCount || 8;
    } else {
      try {
        const defFromBackend = await invoke<number>('get_default_thread_count_command');
        if (defFromBackend && defFromBackend > 0) defaultThreads = defFromBackend;
      } catch {}
    }
    if (dbEngine?.globalSpeedLimiter && Number(dbEngine?.globalSpeedLimit) > 0) {
      speedLimit = parseSpeedLimitBytes(Number(dbEngine.globalSpeedLimit));
    }
    try {
      const ytRes = await invoke<any>('check_ytdlp');
      isYtdlpInstalled = Boolean(
        ytRes?.allInstalled ?? (ytRes?.installed && ytRes?.ffmpegInstalled)
      );
    } catch {}
  } catch {}

  return { defaultThreads, speedLimit, isYtdlpInstalled };
};

export const hideProgressWindowToTray = async (
  currentId: string,
  currentName: string,
  downloaded: number,
  totalSize: number
): Promise<void> => {
  try {
    const pct = totalSize > 0 ? Math.min(100, Math.floor((downloaded / totalSize) * 100)) : 0;
    await invoke('hide_realtime_download_to_tray_command', {
      id: currentId,
      filename: currentName,
      progress: pct,
    });
  } catch {
    WindowHide();
  }
};

export const closeProgressWindow = async (
  currentId: string,
  currentStatus: string
): Promise<void> => {
  try {
    if (currentId) {
      if (currentStatus !== 'Finished' && currentStatus !== 'Completed') {
        await invoke('pause_download', { id: currentId });
      }
      await invoke('remove_hidden_download_command', { id: currentId });
    }
    await invoke('clear_realtime_progress_payload');
    Quit();
  } catch {}
};

export const invokeResumeDownload = async (params: {
  id: string;
  url: string;
  savePath: string;
  filename: string;
  threadCount: number;
  speedLimitBytes: number;
  isYTDLP: boolean;
  isTorrent: boolean;
}): Promise<void> => {
  await invoke('resume_download', {
    id: params.id,
    url: params.url,
    savePath: params.savePath || '',
    filename: params.filename,
    threadCount: params.threadCount,
    speedLimit: params.speedLimitBytes,
    speed_limit: params.speedLimitBytes,
    protocol: params.isYTDLP ? 'Yt-DLP' : params.isTorrent ? 'Torrent' : null,
  });
};
