import { VaultItem } from '../types/download';

export interface MatchedVaultResult {
  host: string;
  user: string;
  pass: string;
  username: string;
  password: string;
  userAgent: string;
  speedLimit: number; // in bytes/sec
  threadCount: number;
}

export const matchVaultCredentials = (
  targetUrl: string,
  vaultList: VaultItem[] = []
): MatchedVaultResult | null => {
  if (!targetUrl || !vaultList || !vaultList.length) return null;
  try {
    const parsed = new URL(targetUrl);
    const urlHost = parsed.host.toLowerCase(); // e.g. "localhost:3000"
    const urlHostname = parsed.hostname.toLowerCase(); // e.g. "localhost"
    const urlSchemeHost = `${parsed.protocol}//${parsed.host}`.toLowerCase(); // e.g. "http://localhost:3000"

    for (const item of vaultList) {
      if (!item || !item.host) continue;
      let vHost = item.host.trim().toLowerCase().replace(/\/+$/, '');
      if (!vHost) continue;

      let isMatch = false;

      // 1. Exact string match against scheme+host, host, or hostname
      if (vHost === urlSchemeHost || vHost === urlHost || vHost === urlHostname) {
        isMatch = true;
      }
      // 2. If vHost contains protocol (e.g. "http://localhost:3000" or "https://example.com")
      else if (vHost.startsWith('http://') || vHost.startsWith('https://')) {
        try {
          const vParsed = new URL(vHost);
          if (vParsed.hostname.toLowerCase() === urlHostname) {
            if (!vParsed.port || vParsed.port === parsed.port) {
              isMatch = true;
            }
          }
        } catch {}
      }
      // 3. Domain or wildcard match
      else {
        const cleanWildcard = vHost.replace(/^\*\./, '');
        const hostWithoutPort = cleanWildcard.split(':')[0];
        if (vHost === urlHost || urlHostname === hostWithoutPort || urlHostname.endsWith('.' + hostWithoutPort)) {
          isMatch = true;
        }
      }

      if (isMatch) {
        const u = item.user || (item as any).username || '';
        const p = item.pass || (item as any).password || '';
        return {
          host: item.host,
          user: u,
          pass: p,
          username: u,
          password: p,
          userAgent: item.userAgent || (item as any).user_agent || '',
          speedLimit: item.speedLimit || (item as any).speed_limit || 0,
          threadCount: item.threadCount || (item as any).thread_count || 0,
        };
      }
    }
  } catch {}
  return null;
};
