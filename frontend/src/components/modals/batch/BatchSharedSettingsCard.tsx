/**
 * Shared Download Settings card and Ingestion Progress Overlay for BatchDownloadModal.
 */
import React from 'react';
import {
  FolderOpen,
  ListPlus,
  Cpu,
  Gauge,
  Sliders,
  Filter,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { Category, QueueConfig, VaultItem } from '../../../types/download';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { BatchSubmitProgress } from './types';

interface BatchSharedSettingsCardProps {
  savePath: string;
  setSavePath: (path: string) => void;
  onPickFolder: () => void;
  selectedQueue: string;
  setSelectedQueue: (queue: string) => void;
  queues: QueueConfig[];
  selectedCategory: Category;
  setSelectedCategory: (cat: Category) => void;
  useCategory: boolean;
  setUseCategory: (val: boolean) => void;
  threadCount: number;
  setThreadCount: (threads: number) => void;
  defaultEngineThreads: number;
  speedLimitKB: string;
  setSpeedLimitKB: (limit: string) => void;
  showRealTimeProgress: boolean;
  setShowRealTimeProgress: (val: boolean) => void;
  showCompletionWindow: boolean;
  setShowCompletionWindow: (val: boolean) => void;
  matchedVaultItem: VaultItem | null;
}

export const BatchSharedSettingsCard: React.FC<BatchSharedSettingsCardProps> = ({
  savePath,
  setSavePath,
  onPickFolder,
  selectedQueue,
  setSelectedQueue,
  queues,
  selectedCategory,
  setSelectedCategory,
  useCategory,
  setUseCategory,
  threadCount,
  setThreadCount,
  defaultEngineThreads,
  speedLimitKB,
  setSpeedLimitKB,
  showRealTimeProgress,
  setShowRealTimeProgress,
  showCompletionWindow,
  setShowCompletionWindow,
  matchedVaultItem,
}) => {
  return (
    <Card className="bg-muted/30 border-border rounded-xl p-4 space-y-3 mt-4">
      <div className="flex items-center justify-between border-b border-border pb-2">
        <div className="flex items-center space-x-1.5 text-foreground text-[11px] font-semibold">
          <Sliders className="w-3.5 h-3.5 text-primary" />
          <span>Shared Download Settings</span>
        </div>
        {matchedVaultItem && (
          <Badge variant="outline" className="text-primary space-x-1 text-[10px]">
            <ShieldCheck className="w-3 h-3" />
            <span>
              Site Vault: <strong>{matchedVaultItem.host}</strong>
            </span>
          </Badge>
        )}
      </div>

      {/* Row 1: Save Location + Assign to Queue */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-[10.5px] font-medium text-muted-foreground flex items-center space-x-1">
            <FolderOpen className="w-3 h-3" />
            <span>Save Location:</span>
          </Label>
          <div className="flex space-x-1.5">
            <Input
              type="text"
              value={savePath}
              onChange={(e) => setSavePath(e.target.value)}
              className="flex-1 bg-background border-border text-foreground text-xs font-mono h-8"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onPickFolder}
              className="h-8 text-xs px-3"
            >
              Browse
            </Button>
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-[10.5px] font-medium text-muted-foreground flex items-center space-x-1">
            <ListPlus className="w-3 h-3" />
            <span>Assign to Queue:</span>
          </Label>
          <select
            value={selectedQueue}
            onChange={(e) => setSelectedQueue(e.target.value)}
            className="w-full bg-background border border-border text-foreground text-xs rounded-lg px-2.5 py-1.5 outline-none cursor-pointer h-8"
          >
            <option value="">None (General)</option>
            {queues.map((q) => (
              <option key={q.id} value={q.name}>
                {q.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 2: Category + Threads + Speed Limit */}
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
        <div className="sm:col-span-6 space-y-1">
          <Label className="text-[10.5px] font-medium text-muted-foreground flex items-center space-x-1">
            <Filter className="w-3 h-3" />
            <span>Category:</span>
          </Label>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as Category)}
            disabled={!useCategory}
            className={`w-full bg-background border border-border text-foreground text-xs rounded-lg px-2.5 py-1.5 outline-none cursor-pointer h-8 transition-opacity ${
              !useCategory ? 'opacity-40 cursor-not-allowed' : ''
            }`}
          >
            <option value="All">All (Auto-detect from file extension)</option>
            <option value="Videos">Videos</option>
            <option value="Compressed">Compressed</option>
            <option value="Programs">Programs</option>
            <option value="Music">Music</option>
            <option value="Pictures">Pictures</option>
            <option value="Documents">Documents</option>
          </select>
        </div>

        <div className="sm:col-span-3 space-y-1">
          <Label className="text-[10.5px] font-medium text-muted-foreground flex items-center space-x-1">
            <Cpu className="w-3 h-3" />
            <span>Threads:</span>
          </Label>
          <select
            value={threadCount}
            onChange={(e) => setThreadCount(Number(e.target.value))}
            className="w-full bg-background border border-border text-foreground text-xs rounded-lg px-2.5 py-1.5 outline-none cursor-pointer font-mono h-8"
          >
            {[1, 2, 4, 6, 8, 10, 12, 16, 24, 32, 64]
              .concat(defaultEngineThreads ? [defaultEngineThreads] : [])
              .filter((v, i, a) => a.indexOf(v) === i)
              .sort((a, b) => a - b)
              .map((val) => (
                <option key={val} value={val}>
                  {val} {val === 1 ? 'Part' : 'Parts'}{' '}
                  {val === defaultEngineThreads ? '(Default)' : ''}
                </option>
              ))}
          </select>
        </div>

        <div className="sm:col-span-3 space-y-1">
          <Label className="text-[10.5px] font-medium text-muted-foreground flex items-center space-x-1">
            <Gauge className="w-3 h-3" />
            <span>Speed Limit (KB/s):</span>
          </Label>
          <Input
            type="number"
            min={0}
            value={speedLimitKB}
            onChange={(e) => setSpeedLimitKB(e.target.value)}
            placeholder="Unlimited"
            className="w-full bg-background border-border text-foreground text-xs font-mono h-8"
          />
        </div>
      </div>

      {/* Row 3: Option Toggles */}
      <div className="pt-2 border-t border-border/40 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {/* Category Toggle */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-background/50 border border-border/40">
          <div className="space-y-0.5 pr-2">
            <Label
              htmlFor="batch-use-category"
              className="text-[11px] font-medium text-foreground cursor-pointer block"
            >
              Category
            </Label>
            <p className="text-[9.5px] text-muted-foreground">Save by file category</p>
          </div>
          <Switch
            id="batch-use-category"
            checked={useCategory}
            onCheckedChange={setUseCategory}
            size="sm"
          />
        </div>

        {/* Show Real Time Progress Window Toggle */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-background/50 border border-border/40">
          <div className="space-y-0.5 pr-2">
            <Label
              htmlFor="batch-show-progress"
              className="text-[11px] font-medium text-foreground cursor-pointer block"
            >
              Show real time progress window
            </Label>
            <p className="text-[9.5px] text-muted-foreground">Popup live progress window</p>
          </div>
          <Switch
            id="batch-show-progress"
            checked={showRealTimeProgress}
            onCheckedChange={setShowRealTimeProgress}
            size="sm"
          />
        </div>

        {/* Show Completion Window Toggle */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-background/50 border border-border/40">
          <div className="space-y-0.5 pr-2">
            <Label
              htmlFor="batch-show-completion"
              className="text-[11px] font-medium text-foreground cursor-pointer block"
            >
              Show completion window
            </Label>
            <p className="text-[9.5px] text-muted-foreground">Popup dialog on complete</p>
          </div>
          <Switch
            id="batch-show-completion"
            checked={showCompletionWindow}
            onCheckedChange={setShowCompletionWindow}
            size="sm"
          />
        </div>
      </div>
    </Card>
  );
};

interface BatchIngestionOverlayProps {
  submitProgress: BatchSubmitProgress;
  fallbackTotal: number;
}

export const BatchIngestionOverlay: React.FC<BatchIngestionOverlayProps> = ({
  submitProgress,
  fallbackTotal,
}) => {
  return (
    <div className="absolute inset-0 z-50 bg-background/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-200 select-none">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center mb-4 shadow-lg relative">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
      <h3 className="text-base font-semibold text-foreground mb-1">
        {submitProgress.percent >= 100
          ? 'Downloads Registered Successfully!'
          : `Adding ${submitProgress.total || fallbackTotal} Downloads to Database...`}
      </h3>
      <p className="text-xs text-muted-foreground max-w-sm mb-4 truncate">
        {submitProgress.percent >= 100
          ? 'Synchronized with SQLite. Opening main downloads view...'
          : submitProgress.currentName
          ? `Registering: ${submitProgress.currentName}`
          : 'Configuring download settings and initializing database...'}
      </p>

      {/* Progress Bar Container */}
      <div className="w-full max-w-xs space-y-1.5">
        <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden border border-border/60">
          <div
            className="h-full bg-primary transition-all duration-150 rounded-full"
            style={{ width: `${Math.max(2, submitProgress.percent)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono">
          <span>
            {submitProgress.current} / {submitProgress.total || fallbackTotal} files
          </span>
          <span className="font-semibold text-primary">{submitProgress.percent}%</span>
        </div>
      </div>
    </div>
  );
};
