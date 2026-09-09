import { getTranslation } from './i18n';

export function formatBytes(
  bytes: number, 
  decimals = 2, 
  unitPreference: 'KiB' | 'KB' | 'Automatic' | 'MiB' | 'GiB' = 'Automatic'
): string {
  if (bytes === null || bytes === undefined || isNaN(Number(bytes)) || !isFinite(Number(bytes)) || Number(bytes) <= 0) {
    if (unitPreference === 'KiB') return '0 KiB';
    if (unitPreference === 'KB') return '0 KB';
    if (unitPreference === 'MiB') return '0.00 MiB';
    if (unitPreference === 'GiB') return '0.00 GiB';
    return '0 B';
  }

  const num = Number(bytes);
  const dm = decimals < 0 ? 0 : decimals;

  if (unitPreference === 'KiB') {
    return (num / 1024).toFixed(dm) + ' KiB';
  }
  if (unitPreference === 'KB') {
    return (num / 1000).toFixed(dm) + ' KB';
  }
  if (unitPreference === 'MiB') {
    return (num / (1024 * 1024)).toFixed(dm) + ' MiB';
  }
  if (unitPreference === 'GiB') {
    return (num / (1024 * 1024 * 1024)).toFixed(dm) + ' GiB';
  }

  // Binary scale (1024-base)
  const k = 1024;
  const sizes = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = Math.min(Math.floor(Math.log(num) / Math.log(k)), sizes.length - 1);
  if (i < 0) return '0 B';

  return parseFloat((num / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function formatSpeed(
  bytesPerSec: number,
  speedUnitPreference: 'KiB/s (1024 Bytes/s)' | 'KB/s (1000 Bytes/s)' | 'Automatic' = 'KiB/s (1024 Bytes/s)'
): string {
  if (bytesPerSec === null || bytesPerSec === undefined || isNaN(Number(bytesPerSec)) || !isFinite(Number(bytesPerSec)) || Number(bytesPerSec) <= 0) {
    if (speedUnitPreference === 'KB/s (1000 Bytes/s)') return '0 KB/s';
    return '0 B/s';
  }

  const num = Number(bytesPerSec);

  if (speedUnitPreference === 'KB/s (1000 Bytes/s)') {
    const k = 1000;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.min(Math.floor(Math.log(num) / Math.log(k)), sizes.length - 1);
    if (i < 0) return '0 B/s';
    return parseFloat((num / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  // Binary speed scale
  const k = 1024;
  const sizes = ['B/s', 'KiB/s', 'MiB/s', 'GiB/s'];
  const i = Math.min(Math.floor(Math.log(num) / Math.log(k)), sizes.length - 1);
  if (i < 0) return '0 B/s';

  return parseFloat((num / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function formatDateAdded(
  dateStrOrTs?: string | number, 
  fallbackId?: string,
  useRelative = true,
  lang = 'en'
): string {
  let timestamp: number;

  if (typeof dateStrOrTs === 'number') {
    timestamp = dateStrOrTs;
  } else if (dateStrOrTs && !isNaN(Number(dateStrOrTs)) && Number(dateStrOrTs) > 1000000000000) {
    timestamp = Number(dateStrOrTs);
  } else if (dateStrOrTs && dateStrOrTs !== 'Just now' && !isNaN(Date.parse(dateStrOrTs))) {
    timestamp = Date.parse(dateStrOrTs);
  } else if (fallbackId && !isNaN(Number(fallbackId)) && Number(fallbackId) > 1000000000000) {
    timestamp = Number(fallbackId);
  } else {
    return dateStrOrTs ? String(dateStrOrTs) : getTranslation('time.justNow', lang);
  }

  const dateObj = new Date(timestamp);

  // Absolute timestamp format
  if (!useRelative) {
    return dateObj.toLocaleString(lang.startsWith('bn') ? 'bn-BD' : undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const now = Date.now();
  const diffSec = Math.floor((now - timestamp) / 1000);

  if (diffSec < 45) {
    return getTranslation('time.justNow', lang);
  }
  if (diffSec < 3600) {
    const mins = Math.max(1, Math.floor(diffSec / 60));
    return `${mins} ${getTranslation(mins === 1 ? 'time.minAgo' : 'time.minsAgo', lang)}`;
  }
  if (diffSec < 86400) {
    const hours = Math.floor(diffSec / 3600);
    return `${hours} ${getTranslation(hours === 1 ? 'time.hourAgo' : 'time.hoursAgo', lang)}`;
  }
  if (diffSec < 86400 * 7) {
    const days = Math.floor(diffSec / 86400);
    return `${days} ${getTranslation(days === 1 ? 'time.dayAgo' : 'time.daysAgo', lang)}`;
  }

  return dateObj.toLocaleDateString(lang.startsWith('bn') ? 'bn-BD' : undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
