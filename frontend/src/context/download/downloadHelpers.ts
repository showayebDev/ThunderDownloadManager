/**
 * Pure helper utilities for sanitizing download items, formatting ETA strings,
 * and resolving file paths/categories.
 */
import { DownloadItem } from '../../types/download';
import { detectCategory } from '../../utils/category';

/**
 * Normalizes a persisted or incoming DownloadItem, resetting transient active states
 * to 'Paused' on startup and repairing timestamps/checksums.
 */
export const sanitizeDownloadItem = (item: DownloadItem): DownloadItem => {
  const detected = detectCategory(item.name || item.url, item.protocol);
  let cat = item.category;
  if (
    !cat ||
    cat === 'All' ||
    ((cat === 'Programs' || cat === 'Documents') &&
      (detected === 'Videos' || detected === 'Torrents' || detected === 'Compressed'))
  ) {
    cat = detected;
  }

  // Reset active states to paused on startup
  let resolvedStatus = item.status;
  let resolvedSpeed = item.speed;
  let resolvedTimeLeft = item.timeLeft;
  if (resolvedStatus === 'Downloading' || resolvedStatus === 'Pending' || resolvedStatus === 'Merging') {
    resolvedStatus = 'Paused';
    resolvedSpeed = 0;
    resolvedTimeLeft = 'Paused';
  } else if (
    (resolvedStatus === 'Canceled' || (resolvedStatus as string) === 'Cancelled') &&
    item.downloaded > 0 &&
    item.size > 0 &&
    item.downloaded >= item.size
  ) {
    // Mark complete downloads as finished
    resolvedStatus = 'Finished';
    resolvedSpeed = 0;
    resolvedTimeLeft = '-';
  } else if (resolvedStatus === 'Finished' && item.size > 0 && item.downloaded < item.size) {
    // Incomplete file was prematurely marked finished - restore to Paused
    resolvedStatus = 'Paused';
    resolvedSpeed = 0;
    resolvedTimeLeft = 'Paused';
  }

  let resolvedDateAdded = item.dateAdded;
  if (!resolvedDateAdded || resolvedDateAdded === 'Just now' || isNaN(Date.parse(resolvedDateAdded))) {
    const tsFromId =
      !isNaN(Number(item.id)) && Number(item.id) > 1000000000000 ? Number(item.id) : Date.now();
    resolvedDateAdded = new Date(tsFromId).toISOString();
  }

  let resolvedEndTime = item.endTime || item.dateCompleted;
  if (
    resolvedStatus === 'Finished' &&
    (!resolvedEndTime || resolvedEndTime === 'Just now' || isNaN(Date.parse(resolvedEndTime)))
  ) {
    resolvedEndTime = new Date().toISOString();
  }

  const rawChecksum =
    (item as any).givenCheckSum ||
    (item as any).given_checksum ||
    (item as any).expectedChecksum ||
    (item as any).expected_checksum ||
    '';

  const sanitized: DownloadItem = {
    ...item,
    category: cat,
    status: resolvedStatus,
    speed: resolvedSpeed,
    timeLeft: resolvedTimeLeft,
    dateAdded: resolvedDateAdded,
    dateCompleted: resolvedEndTime,
    endTime: resolvedEndTime,
  };

  if (rawChecksum && typeof rawChecksum === 'string' && rawChecksum.trim() !== '') {
    sanitized.givenCheckSum = rawChecksum.trim();
    sanitized.expectedChecksum = rawChecksum.trim();
  } else {
    delete sanitized.givenCheckSum;
    delete sanitized.expectedChecksum;
  }

  return sanitized;
};

/**
 * Formats an ETA duration in seconds into a human-readable string (e.g. "1h 5m 12s").
 */
export const formatEtaSeconds = (etaSeconds: number): string => {
  if (etaSeconds <= 0) return '0s';
  const h = Math.floor(etaSeconds / 3600);
  const m = Math.floor((etaSeconds % 3600) / 60);
  const s = Math.floor(etaSeconds % 60);
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0) parts.push(`${s}s`);
  return parts.join(' ') || '0s';
};

/**
 * Resolves a potentially relative save path against a base download directory.
 */
export const resolveRelativeSavePath = (targetSave: string, baseDir: string): string => {
  const isRel =
    !targetSave ||
    (!targetSave.includes(':') && !targetSave.startsWith('/') && !targetSave.startsWith('\\\\'));
  if (!isRel || !baseDir) return targetSave;

  const isWin = baseDir.includes('\\') || (!baseDir.includes('/') && /^[a-zA-Z]:/.test(baseDir));
  const sep = isWin ? '\\' : '/';
  const cleanBase = baseDir.replace(/[\/\\]+$/, '');
  return targetSave ? `${cleanBase}${sep}${targetSave}` : cleanBase;
};

/**
 * Disambiguates a filename against a set of lowercased existing filenames in the same directory.
 */
export const disambiguateFilename = (filename: string, existingLowerNames: Set<string>): string => {
  if (!existingLowerNames.has(filename.toLowerCase())) {
    return filename;
  }
  const lastDot = filename.lastIndexOf('.');
  const baseName = lastDot > 0 ? filename.slice(0, lastDot) : filename;
  const ext = lastDot > 0 ? filename.slice(lastDot) : '';
  let counter = 1;
  while (existingLowerNames.has(`${baseName}_${counter}${ext}`.toLowerCase())) {
    counter++;
  }
  return `${baseName}_${counter}${ext}`;
};
