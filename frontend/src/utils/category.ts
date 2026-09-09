import { Category } from '../types/download';

export const detectCategory = (filenameOrUrl: string, protocol?: string): Category => {
  if (!filenameOrUrl) return 'Documents';
  const lower = filenameOrUrl.toLowerCase();

  // Check media streaming hosts and protocols
  const videoHosts = [
    'youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com', 
    'instagram.com', 'facebook.com', 'fb.watch', 'twitter.com', 
    'x.com', 'dailymotion.com', 'bilibili.com', 'twitch.tv'
  ];
  if (
    videoHosts.some((h) => lower.includes(h)) ||
    lower.includes('.m3u8') ||
    lower.includes('/reel/') ||
    lower.includes('/reels/') ||
    lower.includes('/video/') ||
    lower.includes('/videos/') ||
    lower.includes('/watch') ||
    protocol === 'Yt-DLP' ||
    (typeof protocol === 'string' && protocol.startsWith('Yt-DLP')) ||
    protocol === 'HLS'
  ) {
    return 'Videos';
  }

  // Fallback to file extension mapping
  let toCheck = filenameOrUrl;
  if (toCheck.startsWith('http://') || toCheck.startsWith('https://')) {
    toCheck = toCheck.split('?')[0].split('#')[0];
  }
  const clean = toCheck.replace(/[/\\]+$/, '');
  const filename = clean.split('/').pop()?.split('\\').pop() || '';
  const lastDotIndex = filename.lastIndexOf('.');
  const ext = lastDotIndex !== -1 ? filename.substring(lastDotIndex + 1).trim().toLowerCase() : '';

  if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'ts', 'm4v', 'flv', '3gp', 'wmv', 'mpg', 'mpeg', 'm3u8', 'vob', 'ogv'].includes(ext)) return 'Videos';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'iso', 'bz2', 'xz', 'tgz', 'zipx', '7zip'].includes(ext)) return 'Compressed';
  if (['exe', 'msi', 'dmg', 'deb', 'rpm', 'apk', 'app', 'bat', 'cmd', 'sh', 'bin', 'jar', 'iso'].includes(ext)) return 'Programs';
  if (['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'opus', 'wma', 'alac', 'aiff', 'mid', 'midi'].includes(ext)) return 'Music';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico', 'tiff', 'avif', 'heic'].includes(ext)) return 'Pictures';
  if (['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt', 'csv', 'md', 'epub', 'rtf', 'odt', 'ods', 'odp'].includes(ext)) return 'Documents';

  return 'Documents';
};
