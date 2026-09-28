/**
 * ProgressStatsGrid: Renders the "Info" tab inside RealTimeDownloadProgress,
 * displaying file name, live status, YT-DLP missing engine installer/error alert,
 * total size, downloaded bytes, transfer speed, ETA, resume support, and proxy badge.
 */

import React from 'react';
import { AlertTriangle, Check, Download, Play, RefreshCw } from 'lucide-react';
import { TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface ProgressStatsGridProps {
  name: string;
  status: string;
  isTorrent: boolean;
  totalSize: number;
  downloaded: number;
  percentage: number;
  speed: number;
  timeLeft: string;
  isMerging: boolean;
  resumeSupport: string;
  proxyUsed: string;
  errorMessage: string | null;
  isYtdlpError: boolean;
  isYtdlpInstalled: boolean;
  isInstallingYtdlp: boolean;
  ytdlpInstallError: string;
  ytdlpInstallSuccess: boolean;
  onInstallYtdlp: () => void;
  onRetryDownload: () => void;
  formatBytes: (bytes: number) => string;
  formatSpeed: (bytesPerSec: number | null | undefined, currentStatus: string) => string;
}

export const ProgressStatsGrid: React.FC<ProgressStatsGridProps> = ({
  name,
  status,
  isTorrent,
  totalSize,
  downloaded,
  percentage,
  speed,
  timeLeft,
  isMerging,
  resumeSupport,
  proxyUsed,
  errorMessage,
  isYtdlpError,
  isYtdlpInstalled,
  isInstallingYtdlp,
  ytdlpInstallError,
  ytdlpInstallSuccess,
  onInstallYtdlp,
  onRetryDownload,
  formatBytes,
  formatSpeed,
}) => {
  return (
    <TabsContent
      value="info"
      className="m-0 space-y-2 text-xs focus-visible:outline-none min-w-0 w-full"
    >
      <div className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2 min-w-0">
        <span className="text-muted-foreground font-medium shrink-0">Name:</span>
        <span className="text-foreground truncate font-mono text-[11px] min-w-0" title={name}>
          {name || 'Filename'}
        </span>
      </div>

      <div className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2 min-w-0">
        <span className="text-muted-foreground font-medium shrink-0">Status:</span>
        <span
          className={`font-semibold min-w-0 truncate ${
            status === 'Error'
              ? 'text-destructive'
              : status === 'Finished'
              ? 'text-emerald-500'
              : status === 'Merging'
              ? 'text-primary animate-pulse'
              : isTorrent && totalSize === 0 && status === 'Downloading'
              ? 'text-amber-500 animate-pulse'
              : 'text-foreground'
          }`}
        >
          {isTorrent && totalSize === 0 && status === 'Downloading'
            ? 'Connecting to BitTorrent Swarm...'
            : status}
        </span>
      </div>

      {status === 'Error' && (
        <div className="space-y-2 animate-in fade-in duration-150 min-w-0 w-full">
          {isYtdlpError ? (
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2.5 min-w-0 w-full overflow-hidden">
              <div className="flex items-start space-x-2.5 min-w-0">
                <div className="p-1.5 bg-amber-500/20 rounded-lg text-amber-500 shrink-0 mt-0.5">
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="space-y-0.5 min-w-0 flex-1">
                  <div className="text-amber-600 dark:text-amber-300 font-semibold text-xs truncate">
                    YT-DLP Media Stream Engine Not Found
                  </div>
                  <div className="text-muted-foreground text-[11px] leading-relaxed break-words">
                    YT-DLP is required on your PC to download and merge adaptive video & audio
                    streams.
                  </div>
                  {ytdlpInstallError && (
                    <div className="text-destructive text-[10px] mt-1 font-mono break-all break-words">
                      {ytdlpInstallError}
                    </div>
                  )}
                  {ytdlpInstallSuccess && (
                    <div className="text-emerald-500 text-[10px] mt-1 font-semibold flex items-center space-x-1">
                      <Check className="w-3.5 h-3.5 shrink-0" />
                      <span className="break-words">
                        YT-DLP installed successfully! Click Retry Download below.
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center space-x-2 pt-1 border-t border-amber-500/20">
                {!ytdlpInstallSuccess && !isYtdlpInstalled ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={onInstallYtdlp}
                    disabled={isInstallingYtdlp}
                    className="h-7 text-xs font-semibold flex items-center space-x-1.5"
                  >
                    {isInstallingYtdlp ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Installing...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        <span>Install YT-DLP</span>
                      </>
                    )}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={onRetryDownload}
                    className="h-7 text-xs font-semibold flex items-center space-x-1.5"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Retry Download</span>
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="p-2.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs font-mono break-all [overflow-wrap:anywhere] leading-relaxed max-h-32 overflow-y-auto overflow-x-hidden custom-scrollbar select-text min-w-0 w-full">
              {errorMessage || 'Download Error: Server connection failed.'}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2 min-w-0">
        <span className="text-muted-foreground font-medium shrink-0">Size:</span>
        <span className="text-foreground font-medium min-w-0 truncate">
          {totalSize > 0
            ? formatBytes(totalSize)
            : isTorrent
            ? 'Fetching metadata from swarm...'
            : downloaded > 0
            ? '~' + formatBytes(downloaded)
            : 'Calculating...'}
        </span>
      </div>

      <div className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2 min-w-0">
        <span className="text-muted-foreground font-medium shrink-0">
          {isMerging ? 'Merged:' : 'Downloaded:'}
        </span>
        <span className="text-foreground font-medium min-w-0 truncate">
          {formatBytes(downloaded)} {totalSize > 0 ? `(${percentage}%)` : ''}
        </span>
      </div>

      <div className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2 min-w-0">
        <span className="text-muted-foreground font-medium shrink-0">Speed:</span>
        <span className="text-foreground font-medium min-w-0 truncate">
          {formatSpeed(speed, status)}
        </span>
      </div>

      <div className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2 min-w-0">
        <span className="text-muted-foreground font-medium shrink-0">Time Left:</span>
        <span className="text-foreground font-medium min-w-0 truncate">
          {isMerging ? '-' : timeLeft}
        </span>
      </div>

      <div className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2 min-w-0">
        <span className="text-muted-foreground font-medium shrink-0">Resume Support:</span>
        <span
          className={`font-semibold min-w-0 truncate ${
            resumeSupport === 'Yes'
              ? 'text-emerald-500'
              : resumeSupport === 'No'
              ? 'text-destructive'
              : 'text-amber-500 font-medium'
          }`}
        >
          {resumeSupport}
        </span>
      </div>

      <div className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2 min-w-0">
        <span className="text-muted-foreground font-medium shrink-0">Proxy:</span>
        <span className="flex items-center space-x-1.5 font-medium min-w-0 truncate">
          {proxyUsed ? (
            <Badge
              variant="outline"
              className="text-primary font-semibold text-[10px] truncate max-w-full"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse mr-1 shrink-0" />
              <span className="truncate">{proxyUsed}</span>
            </Badge>
          ) : (
            <span className="text-muted-foreground text-[11px] truncate">
              Direct Connection (No Proxy)
            </span>
          )}
        </span>
      </div>
    </TabsContent>
  );
};
