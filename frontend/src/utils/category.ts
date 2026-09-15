import { Category } from '../types/download';

export const detectCategory = (filenameOrUrl: string, protocol?: string): Category => {
  if (!filenameOrUrl) return 'Documents';
  const lower = filenameOrUrl.toLowerCase();

  // Check BitTorrent / Magnet links
  if (
    lower.startsWith('magnet:') ||
    lower.endsWith('.torrent') ||
    lower.includes('.torrent?') ||
    lower.includes('.torrent#') ||
    protocol === 'Torrent' ||
    (typeof protocol === 'string' && protocol.toLowerCase().startsWith('torrent'))
  ) {
    return 'Torrents';
  }

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
    try {
      const u = new URL(toCheck);
      const dn = u.searchParams.get('dn') || u.searchParams.get('filename') || u.searchParams.get('file') || u.searchParams.get('name') || u.searchParams.get('title');
      if (dn) {
        toCheck = dn;
      } else {
        toCheck = u.pathname;
      }
    } catch {
      toCheck = toCheck.split('?')[0].split('#')[0];
    }
  }
  const clean = toCheck.replace(/[/\\]+$/, '');
  const filename = clean.split('/').pop()?.split('\\').pop() || '';
  const lastDotIndex = filename.lastIndexOf('.');
  const ext = lastDotIndex !== -1 ? filename.substring(lastDotIndex + 1).trim().toLowerCase() : '';

  if (['mp4', 'mkv', 'avi', 'mov', 'webm', 'ts', 'm4v', 'flv', '3gp', 'wmv', 'mpg', 'mpeg', 'm3u8', 'vob', 'ogv'].includes(ext)) return 'Videos';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'iso', 'bz2', 'xz', 'tgz', 'zipx', '7zip', 'zst', 'lzma', 'cab', 'arj', 'lzh', 'ace', 'uue', 'bz', 'tbz', 'tbz2', 'txz', 'wim', 'r00', 'r01', 'r02', 'part1'].includes(ext)) return 'Compressed';
  if (['exe', 'msi', 'dmg', 'deb', 'rpm', 'apk', 'app', 'bat', 'cmd', 'sh', 'bin', 'jar', 'run', 'appimage', 'pkg'].includes(ext)) return 'Programs';
  if (['mp3', 'flac', 'wav', 'aac', 'ogg', 'm4a', 'opus', 'wma', 'alac', 'aiff', 'mid', 'midi', 'mka', 'ape'].includes(ext)) return 'Music';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico', 'tiff', 'avif', 'heic', 'psd', 'ai', 'raw', 'cr2', 'nef'].includes(ext)) return 'Pictures';
  if (['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt', 'csv', 'md', 'epub', 'rtf', 'odt', 'ods', 'odp', 'pages', 'numbers', 'key', 'srt', 'sub', 'vtt', 'nfo', 'log'].includes(ext)) return 'Documents';

  // Check multi-part or nested extension regex (e.g. filename.rar, filename.v2024.11.26b.rar, filename.part1.rar, filename.tar.gz)
  const fnLower = filename.toLowerCase();
  if (/\.(rar|zip|7z|tar\.gz|tar\.bz2|tar\.xz|zst)(\.[\w\d]+)?$/i.test(fnLower) || fnLower.includes('.rar') || fnLower.includes('.zip') || fnLower.includes('.7z')) {
    return 'Compressed';
  }

  // If protocol is Torrent, return Torrents
  if (protocol === 'Torrent' || (typeof protocol === 'string' && protocol.toLowerCase().startsWith('torrent'))) {
    return 'Torrents';
  }

  return 'Documents';
};

