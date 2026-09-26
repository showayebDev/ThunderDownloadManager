/**
 * Type definitions for the DownloadStartConfirmation popup window and its sub-components.
 */

import { CookieBypassRule } from '../../../types/download';

export interface YtdlpFormat {
  format_id?: string;
  resolution?: string;
  format_note?: string;
  ext?: string;
  [key: string]: any;
}

export interface QueueItem {
  id: string;
  name: string;
}

export interface VaultCredentialMatch {
  user: string;
  pass: string;
  userAgent: string;
  speedLimit: number;
  threadCount: number;
}

export interface CookieBypassEvaluation {
  isBypassed: boolean;
  matchedRule: CookieBypassRule | null;
  effectiveProtocol: 'http' | 'ytdlp' | 'hls';
}

export interface RefreshInfoOptions {
  protocol?: string;
  username?: string;
  password?: string;
  userAgent?: string;
  referer?: string;
  cookies?: string;
  useCookie?: boolean;
}
