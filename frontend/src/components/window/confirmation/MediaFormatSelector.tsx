/**
 * Media format, protocol, YT-DLP quality selector, cookie bypass toggle,
 * and missing media tools notice for DownloadStartConfirmation.
 */

import React from 'react';
import { ChevronDown, Cookie, AlertTriangle } from 'lucide-react';
import { CookieBypassRule } from '../../../types/download';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { YtdlpFormat } from './types';

interface MediaFormatSelectorProps {
  protocol: string;
  onProtocolChange: (newProtocol: string) => void;
  ytdlpQuality: string;
  onYtdlpQualityChange: (newQuality: string) => void;
  availableFormats: YtdlpFormat[];
  useCookie: boolean;
  onToggleUseCookie: (checked: boolean) => void;
  matchedCookieRule: CookieBypassRule | null;
  isBypassedByRule: boolean;
}

export const MediaFormatSelector: React.FC<MediaFormatSelectorProps> = ({
  protocol,
  onProtocolChange,
  ytdlpQuality,
  onYtdlpQualityChange,
  availableFormats,
  useCookie,
  onToggleUseCookie,
  matchedCookieRule,
  isBypassedByRule,
}) => {
  return (
    <>
      {/* Protocol & Quality Selection Row */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center space-x-2 bg-muted/40 border border-border rounded-xl px-3 py-1.5 shrink-0">
          <span className="text-muted-foreground font-medium text-[11px]">Protocol:</span>
          <select
            value={protocol}
            onChange={(e) => onProtocolChange(e.target.value)}
            className="bg-transparent text-foreground text-xs font-semibold outline-none cursor-pointer pr-2 appearance-none"
          >
            <option value="Auto" className="bg-card">
              Auto
            </option>
            <option value="HTTP" className="bg-card">
              HTTP
            </option>
            <option value="Torrent" className="bg-card text-amber-400">
              Torrent
            </option>
            <option value="HLS" className="bg-card">
              HLS
            </option>
            <option value="Yt-DLP" className="bg-card text-primary">
              Yt-DLP
            </option>
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        </div>

        {protocol === 'Yt-DLP' && (
          <div className="flex-1 flex items-center space-x-2 bg-muted/40 border border-primary/40 rounded-xl px-3 py-1.5 min-w-0">
            <span className="text-primary font-semibold text-[11px] shrink-0">Quality:</span>
            <select
              value={ytdlpQuality}
              onChange={(e) => onYtdlpQualityChange(e.target.value)}
              className="bg-transparent text-foreground text-xs font-medium outline-none cursor-pointer w-full truncate"
            >
              <option value="best" className="bg-card text-primary font-semibold">
                ★ Best Quality (Auto-Merged MP4)
              </option>
              <option value="1080p" className="bg-card">
                1080p (Full HD)
              </option>
              <option value="720p" className="bg-card">
                720p (HD)
              </option>
              <option value="480p" className="bg-card">
                480p (SD)
              </option>
              <option value="360p" className="bg-card">
                360p (Low)
              </option>
              <option value="audio" className="bg-card text-emerald-500">
                🎵 Audio Only (MP3)
              </option>
              {availableFormats.map((f, idx) => (
                <option key={f.format_id || idx} value={f.format_id} className="bg-card">
                  {f.resolution || f.format_note} ({f.ext || 'mp4'})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Cookie Filter Option Row */}
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-muted/30 border border-border/70 min-w-0">
        <div className="flex items-center space-x-2 shrink-0">
          <Checkbox
            id="use-cookie-confirmation"
            checked={useCookie}
            onCheckedChange={(c) => onToggleUseCookie(Boolean(c))}
          />
          <Label
            htmlFor="use-cookie-confirmation"
            className="text-foreground font-medium text-[11.5px] whitespace-nowrap cursor-pointer flex items-center space-x-1.5"
          >
            <Cookie className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span>Use Cookie</span>
          </Label>
        </div>

        {/* Database cookie rule indicator / website details */}
        <div className="flex items-center min-w-0 justify-end overflow-hidden">
          {matchedCookieRule ? (
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium truncate max-w-full ${
                isBypassedByRule
                  ? useCookie
                    ? 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                    : 'bg-muted/80 text-muted-foreground border-border'
                  : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
              }`}
              title={`Rule for ${matchedCookieRule.domain} (HTTP: ${matchedCookieRule.http ? 'Bypassed' : 'Active'}, Yt-DLP: ${matchedCookieRule.ytdlp ? 'Bypassed' : 'Active'}, HLS: ${matchedCookieRule.hls ? 'Bypassed' : 'Active'})`}
            >
              <span className="font-semibold text-foreground/80">{matchedCookieRule.domain}:</span>
              {isBypassedByRule ? (
                useCookie ? (
                  <span className="text-amber-500 font-medium">Bypassed in DB (Overridden)</span>
                ) : (
                  <span>Bypassed by DB Rule</span>
                )
              ) : (
                <span>Allowed in DB</span>
              )}
            </span>
          ) : (
            <span className="text-muted-foreground text-[10px] px-1.5 py-0.5 rounded bg-muted/20 border border-border/40 truncate">
              No bypass rule (Allowed)
            </span>
          )}
        </div>
      </div>
    </>
  );
};

interface MissingMediaToolsBannerProps {
  protocol: string;
  isYtdlpInstalled: boolean;
}

export const MissingMediaToolsBanner: React.FC<MissingMediaToolsBannerProps> = ({
  protocol,
  isYtdlpInstalled,
}) => {
  if (protocol !== 'Yt-DLP' || isYtdlpInstalled) return null;

  return (
    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-start gap-3 text-xs animate-in fade-in duration-200 min-w-0">
      <div className="p-2 bg-amber-500/20 rounded-xl text-amber-500 shrink-0 mt-0.5">
        <AlertTriangle className="w-4 h-4" />
      </div>
      <div className="space-y-1 min-w-0 flex-1">
        <div className="text-amber-500 font-semibold text-[12px]">
          Media Tools (YT-DLP & FFmpeg) Required
        </div>
        <div className="text-muted-foreground text-[11px] leading-relaxed">
          To download video & audio streams with YT-DLP, open the main window, click{' '}
          <strong className="text-foreground">Tools</strong>, and select{' '}
          <strong className="text-foreground">Install Media Tools</strong>.
        </div>
      </div>
    </div>
  );
};
