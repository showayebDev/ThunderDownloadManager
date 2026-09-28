/**
 * ProgressControlsTab: Renders the "Speed" and "On Completion" tabs, as well as
 * the main progress bar and Pause/Resume/Retry/Cancel control bar in RealTimeDownloadProgress.
 */

import React from 'react';
import { Zap, ChevronUp, ChevronDown, Pause, Play, RefreshCw } from 'lucide-react';
import { HelpTooltip } from '../../common/Tooltip';
import { TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ChunkInfo } from './types';

interface SpeedLimiterRowProps {
  speedLimitEnabled: boolean;
  speedLimitVal: number;
  speedLimitUnit: string;
  onSpeedLimitChange: (enabled: boolean, val: number, unit: string) => void;
}

const SpeedLimiterRow: React.FC<SpeedLimiterRowProps> = ({
  speedLimitEnabled,
  speedLimitVal,
  speedLimitUnit,
  onSpeedLimitChange,
}) => (
  <div className="flex items-center justify-between pt-3 border-t border-border min-w-0">
    <div className="min-w-0 mr-2">
      <div className="flex items-center space-x-1 font-semibold text-foreground">
        <span>Speed Limit</span>
        <HelpTooltip description="Cap maximum download transfer speed for this download task." />
      </div>
      <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
        {speedLimitEnabled && speedLimitVal > 0
          ? `Limited to ${speedLimitVal} ${speedLimitUnit}`
          : speedLimitEnabled
          ? 'Limited'
          : 'Unlimited'}
      </div>
    </div>

    <div className="flex items-center space-x-2 shrink-0">
      {speedLimitEnabled && (
        <div className="flex items-center space-x-1.5 animate-in fade-in duration-150">
          <Input
            type="number"
            min={1}
            step={1}
            placeholder="5"
            value={speedLimitVal || ''}
            onChange={(e) => {
              const val =
                e.target.value === '' ? 0 : Math.max(1, parseInt(e.target.value, 10) || 0);
              onSpeedLimitChange(true, val, speedLimitUnit);
            }}
            className="w-16 bg-background text-foreground text-xs font-mono font-semibold h-8 text-center"
          />
          <select
            value={speedLimitUnit}
            onChange={(e) => {
              onSpeedLimitChange(true, speedLimitVal || 5, e.target.value);
            }}
            className="bg-background border border-border text-foreground text-xs rounded-lg px-2 py-1 outline-none cursor-pointer h-8 font-medium"
          >
            <option value="MB/s" className="bg-card">
              MB/s
            </option>
            <option value="KB/s" className="bg-card">
              KB/s
            </option>
          </select>
        </div>
      )}

      <Checkbox
        checked={speedLimitEnabled}
        onCheckedChange={(checked) => {
          const enabled = Boolean(checked);
          const defaultVal =
            enabled && (!speedLimitVal || speedLimitVal <= 0) ? 5 : speedLimitVal;
          onSpeedLimitChange(enabled, defaultVal, speedLimitUnit);
        }}
      />
    </div>
  </div>
);

interface ProgressControlsTabProps {
  isYTDLP: boolean;
  isTorrent: boolean;
  threadCount: number;
  defaultThreadCount: number;
  chunks: ChunkInfo[];
  onThreadCountChange: (newVal: number) => void;
  speedLimitEnabled: boolean;
  speedLimitVal: number;
  speedLimitUnit: string;
  onSpeedLimitChange: (enabled: boolean, val: number, unit: string) => void;
  shutdownOnCompletion: boolean;
  onShutdownOnCompletionChange: (checked: boolean) => void;
}

export const ProgressControlsTab: React.FC<ProgressControlsTabProps> = ({
  isYTDLP,
  isTorrent,
  threadCount,
  defaultThreadCount,
  chunks,
  onThreadCountChange,
  speedLimitEnabled,
  speedLimitVal,
  speedLimitUnit,
  onSpeedLimitChange,
  shutdownOnCompletion,
  onShutdownOnCompletionChange,
}) => {
  return (
    <>
      {/* Speed Tab */}
      <TabsContent
        value="speed"
        className="m-0 space-y-4 text-xs focus-visible:outline-none min-w-0 w-full"
      >
        {isYTDLP ? (
          <div className="p-3 bg-muted/30 border border-primary/30 rounded-xl space-y-1.5 min-w-0 w-full">
            <div className="flex items-center space-x-1.5 font-semibold text-primary">
              <Zap className="w-3.5 h-3.5 shrink-0" />
              <span>YT-DLP Stream Engine</span>
            </div>
            <div className="text-[11px] text-muted-foreground leading-relaxed break-words">
              Threading and bandwidth speed limits are managed internally by the single-process
              YT-DLP and FFmpeg multiplexer engine. Manual thread and speed limit adjustments are
              disabled for this stream.
            </div>
          </div>
        ) : isTorrent ? (
          <div className="space-y-4 min-w-0 w-full">
            <div className="p-3 bg-muted/30 border border-primary/30 rounded-xl space-y-1.5 min-w-0 w-full">
              <div className="flex items-center space-x-1.5 font-semibold text-primary">
                <Zap className="w-3.5 h-3.5 shrink-0" />
                <span>BitTorrent P2P Swarm Engine</span>
              </div>
              <div className="text-[11px] text-muted-foreground leading-relaxed break-words">
                Peer connections and piece multithreading are automatically managed across the
                BitTorrent swarm via DHT and public trackers.
              </div>
            </div>

            <SpeedLimiterRow
              speedLimitEnabled={speedLimitEnabled}
              speedLimitVal={speedLimitVal}
              speedLimitUnit={speedLimitUnit}
              onSpeedLimitChange={onSpeedLimitChange}
            />
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between pt-1 min-w-0">
              <div className="min-w-0 mr-2">
                <div className="flex items-center space-x-1 font-semibold text-foreground">
                  <span>Thread Count</span>
                  <HelpTooltip description="Number of parallel connection threads used to download file segments simultaneously." />
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  {threadCount
                    ? `${threadCount} threads for this download`
                    : `Use Global Settings (${defaultThreadCount})`}
                </div>
              </div>

              <div className="flex items-center space-x-1.5 bg-muted/40 border border-border rounded-xl px-2.5 py-1 shrink-0">
                <input
                  type="number"
                  min={1}
                  max={64}
                  placeholder={String(defaultThreadCount)}
                  value={threadCount || (chunks.length > 0 ? chunks.length : '')}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(64, Number(e.target.value) || 1));
                    onThreadCountChange(val);
                  }}
                  className="w-8 bg-transparent text-foreground text-xs font-mono font-semibold outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <div className="flex flex-col space-y-0.5 border-l border-border pl-1.5">
                  <button
                    type="button"
                    onClick={() => onThreadCountChange((threadCount || chunks.length || 1) + 1)}
                    className="p-0.5 hover:bg-accent text-muted-foreground hover:text-foreground rounded transition-colors cursor-pointer"
                    title="Increase Threading"
                  >
                    <ChevronUp className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onThreadCountChange(Math.max(1, (threadCount || chunks.length || 1) - 1))
                    }
                    className="p-0.5 hover:bg-accent text-muted-foreground hover:text-foreground rounded transition-colors cursor-pointer"
                    title="Decrease Threading"
                  >
                    <ChevronDown className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>

            <SpeedLimiterRow
              speedLimitEnabled={speedLimitEnabled}
              speedLimitVal={speedLimitVal}
              speedLimitUnit={speedLimitUnit}
              onSpeedLimitChange={onSpeedLimitChange}
            />
          </>
        )}
      </TabsContent>

      {/* On Completion Tab */}
      <TabsContent
        value="completion"
        className="m-0 space-y-4 text-xs focus-visible:outline-none min-w-0 w-full"
      >
        <div className="flex items-center justify-between pt-1 min-w-0">
          <div className="min-w-0 mr-2">
            <div className="flex items-center space-x-1 font-semibold text-foreground">
              <Label htmlFor="shutdown-toggle" className="cursor-pointer font-semibold">
                Shutdown System On Completion
              </Label>
              <HelpTooltip description="Automatically shut down your computer when this download finishes completely." />
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
              {shutdownOnCompletion ? 'Enabled' : 'Disabled'}
            </div>
          </div>

          <Switch
            id="shutdown-toggle"
            checked={shutdownOnCompletion}
            onCheckedChange={onShutdownOnCompletionChange}
            className="shrink-0"
          />
        </div>
      </TabsContent>
    </>
  );
};

interface ProgressActionBarProps {
  percentage: number;
  isMerging: boolean;
  isPaused: boolean;
  status: string;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onPauseResume: () => void;
  onCancelDownload: () => void;
}

export const ProgressActionBar: React.FC<ProgressActionBarProps> = ({
  percentage,
  isMerging,
  isPaused,
  status,
  isExpanded,
  onToggleExpanded,
  onPauseResume,
  onCancelDownload,
}) => {
  return (
    <div className="px-4 py-3 bg-muted/20 border-t border-b border-border space-y-3 shrink-0 min-w-0 w-full">
      <div className="w-full h-3 bg-secondary/80 rounded-full overflow-hidden p-0.5 border border-border">
        <div
          className={`h-full rounded-full transition-all duration-300 shadow-md ${
            isMerging
              ? 'bg-gradient-to-r from-primary to-accent animate-pulse'
              : isPaused
              ? 'bg-muted-foreground'
              : 'bg-primary'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className="flex items-center justify-between min-w-0">
        <Button
          variant="outline"
          size="icon-xs"
          type="button"
          onClick={onToggleExpanded}
          className="h-8 w-8 shrink-0"
          title={isExpanded ? 'Collapse Segment Table' : 'Expand Segment Table'}
        >
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </Button>

        {!isMerging && (
          <div className="flex items-center space-x-2.5 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onPauseResume}
              className="rounded-xl px-5 text-xs font-medium space-x-1.5"
            >
              {status === 'Error' ? (
                <RefreshCw className="w-3.5 h-3.5" />
              ) : isPaused ? (
                <Play className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Pause className="w-3.5 h-3.5 fill-current" />
              )}
              <span>{status === 'Error' ? 'Retry' : isPaused ? 'Resume' : 'Pause'}</span>
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onCancelDownload}
              className="rounded-xl px-5 text-xs font-medium"
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};
