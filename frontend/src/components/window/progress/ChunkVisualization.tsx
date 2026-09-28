/**
 * ChunkVisualization: Renders the expandable bottom section of RealTimeDownloadProgress,
 * showing either the YT-DLP stream multiplexer card or the multi-thread chunk segment
 * visualization bar and piece/chunk progress breakdown table.
 */

import React from 'react';
import { AlertTriangle, Zap, RefreshCw, Download, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChunkInfo } from './types';

interface ChunkVisualizationProps {
  isExpanded: boolean;
  isYTDLP: boolean;
  isTorrent: boolean;
  totalSize: number;
  status: string;
  isPaused: boolean;
  isMerging: boolean;
  isYtdlpError: boolean;
  isYtdlpInstalled: boolean;
  ytdlpInstallSuccess: boolean;
  isInstallingYtdlp: boolean;
  onInstallYtdlp: () => void;
  onRetryDownload: () => void;
  chunks: ChunkInfo[];
  formatBytes: (bytes: number) => string;
}

export const ChunkVisualization: React.FC<ChunkVisualizationProps> = ({
  isExpanded,
  isYTDLP,
  isTorrent,
  totalSize,
  status,
  isPaused,
  isMerging,
  isYtdlpError,
  isYtdlpInstalled,
  ytdlpInstallSuccess,
  isInstallingYtdlp,
  onInstallYtdlp,
  onRetryDownload,
  chunks,
  formatBytes,
}) => {
  if (!isExpanded) return null;

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-card overflow-hidden min-w-0 w-full">
      {isYTDLP ? (
        <div className="flex-1 p-5 flex flex-col justify-center items-center text-center space-y-3 font-sans min-w-0 w-full overflow-y-auto custom-scrollbar">
          <div
            className={`w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg shrink-0 ${
              status === 'Error'
                ? 'bg-amber-500/20 text-amber-500'
                : 'bg-primary/15 text-primary'
            }`}
          >
            {status === 'Error' ? (
              <AlertTriangle className="w-5 h-5" />
            ) : (
              <Zap className="w-5 h-5" />
            )}
          </div>
          <div className="space-y-1 max-w-xs min-w-0">
            <div className="text-foreground font-semibold text-xs truncate">
              {status === 'Error' && isYtdlpError
                ? 'YT-DLP Not Found'
                : 'YT-DLP Media Stream Engine'}
            </div>
            <div className="text-muted-foreground text-[11px] leading-relaxed break-words">
              {status === 'Error' && isYtdlpError
                ? 'YT-DLP is required on your system to download and multiplex adaptive media streams.'
                : 'Direct stream download with adaptive video & audio multiplexing. Chunk segmentation is not applicable for YT-DLP tasks.'}
            </div>
          </div>
          {status === 'Error' && isYtdlpError && !isYtdlpInstalled && !ytdlpInstallSuccess && (
            <Button
              type="button"
              size="sm"
              onClick={onInstallYtdlp}
              disabled={isInstallingYtdlp}
              className="text-xs shrink-0"
            >
              {isInstallingYtdlp ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  <span>Installing YT-DLP...</span>
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  <span>Install YT-DLP</span>
                </>
              )}
            </Button>
          )}
          {status === 'Error' && (isYtdlpInstalled || ytdlpInstallSuccess) && (
            <Button
              type="button"
              size="sm"
              onClick={onRetryDownload}
              className="text-xs flex items-center space-x-1.5 shrink-0"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Retry Download</span>
            </Button>
          )}
          <div className="flex items-center space-x-2 text-[11px] bg-muted/40 px-3.5 py-1.5 rounded-xl border border-border shrink-0 max-w-full truncate">
            <span className="text-muted-foreground font-medium shrink-0">Status:</span>
            <span
              className={`font-semibold truncate ${
                status === 'Error'
                  ? 'text-destructive'
                  : status === 'Finished'
                  ? 'text-emerald-500'
                  : status === 'Merging'
                  ? 'text-primary animate-pulse'
                  : 'text-primary'
              }`}
            >
              {status === 'Merging' ? 'Merging Video + Audio' : status}
            </span>
          </div>
        </div>
      ) : (
        <>
          <div className="w-full px-3 py-1.5 bg-muted/30 border-b border-border min-w-0 shrink-0">
            <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden border border-border flex relative shadow-inner">
              {chunks.length > 0 ? (
                chunks.map((c, i) => {
                  const isFinished = c.status === 'Finished';
                  const isError = c.status === 'Error';
                  const isDownloading = !isPaused && c.status === 'Downloading';
                  const segPercent =
                    c.total > 0
                      ? Math.min(100, Math.max(0, (c.downloaded / c.total) * 100))
                      : isFinished
                      ? 100
                      : 0;

                  const isLast = i === chunks.length - 1;

                  return (
                    <div
                      key={c.id !== undefined ? c.id : i}
                      title={`Segment #${i + 1}: ${segPercent.toFixed(1)}% (${formatBytes(c.downloaded)} / ${formatBytes(c.total)}) - ${isPaused ? 'Paused' : c.status || status}`}
                      className={`flex-1 h-full relative bg-transparent overflow-hidden ${
                        !isLast ? 'border-r border-border' : ''
                      }`}
                    >
                      <div
                        className={`h-full transition-all duration-200 ${
                          isPaused
                            ? 'bg-muted-foreground'
                            : isError
                            ? 'bg-destructive'
                            : isFinished
                            ? 'bg-emerald-500'
                            : isMerging
                            ? 'bg-primary animate-pulse'
                            : isDownloading
                            ? 'bg-emerald-500'
                            : segPercent > 0
                            ? 'bg-muted-foreground'
                            : 'bg-transparent'
                        }`}
                        style={{
                          width: `${
                            isFinished
                              ? 100
                              : isPaused
                              ? segPercent
                              : isDownloading && segPercent === 0
                              ? 5
                              : segPercent
                          }%`,
                        }}
                      />
                    </div>
                  );
                })
              ) : (
                <div className="w-full h-full bg-secondary" />
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar px-3 pb-2 text-[11px] min-w-0 w-full">
            <table className="w-full text-left border-collapse table-fixed">
              <thead>
                <tr className="border-b border-border text-muted-foreground font-medium">
                  <th className="py-2 px-2 w-10 text-left">#</th>
                  <th className="py-2 px-2 w-28 text-left">
                    {isTorrent && totalSize === 0 ? 'Peer / Swarm' : 'Status'}
                  </th>
                  <th className="py-2 px-2 text-left">
                    {isTorrent && totalSize === 0
                      ? 'State'
                      : isTorrent
                      ? 'Pieces Done'
                      : 'Downloaded'}
                  </th>
                  <th className="py-2 px-2 text-left">
                    {isTorrent && totalSize === 0
                      ? 'Protocol'
                      : isTorrent
                      ? 'Pieces Total'
                      : 'Total'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-foreground/80 font-mono">
                {chunks.length > 0 ? (
                  chunks.map((chunk, index) => (
                    <tr
                      key={chunk.id !== undefined ? chunk.id : index}
                      className="hover:bg-accent/40 transition-colors"
                    >
                      <td className="py-1.5 px-2 text-muted-foreground truncate">{index + 1}</td>
                      <td className="py-1.5 px-2 truncate">
                        <span
                          className={`truncate block ${
                            chunk.status === 'Finished'
                              ? 'text-emerald-500 font-medium'
                              : isPaused
                              ? 'text-muted-foreground font-medium'
                              : chunk.status === 'Downloading'
                              ? 'text-emerald-500 font-medium'
                              : chunk.status === 'Pending'
                              ? 'text-amber-500 font-medium'
                              : chunk.status === 'Error'
                              ? 'text-destructive font-medium'
                              : 'text-foreground'
                          }`}
                        >
                          {isTorrent && totalSize === 0
                            ? chunk.status === 'Downloading'
                              ? 'Peer Connected'
                              : 'Searching...'
                            : chunk.status === 'Finished'
                            ? 'Finished'
                            : isPaused
                            ? 'Paused'
                            : chunk.status}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 truncate">
                        {isTorrent && totalSize === 0
                          ? 'Resolving Swarm'
                          : isTorrent
                          ? `${chunk.downloaded} pieces`
                          : formatBytes(chunk.downloaded)}
                      </td>
                      <td className="py-1.5 px-2 truncate">
                        {isTorrent && totalSize === 0
                          ? 'BitTorrent DHT'
                          : isTorrent
                          ? `${chunk.total} pieces`
                          : formatBytes(chunk.total)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-4 text-center text-muted-foreground font-sans italic"
                    >
                      {isTorrent
                        ? 'Connecting to BitTorrent swarm & discovering peers...'
                        : 'No chunk segments active...'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
