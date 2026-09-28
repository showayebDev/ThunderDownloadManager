import React from 'react';
import { 
  Play, 
  Pause, 
  Trash2, 
  Settings as SettingsIcon, 
  Square, 
  ListStart, 
  PauseCircle, 
  Layers,
  Plus,
  CloudDownload,
  CheckCircle2,
  X,
  Folder
} from 'lucide-react';
import { useDownloadContext } from '../../context/DownloadContext';
import { useAppearance } from '../../context/AppearanceContext';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '../ui/dropdown-menu';

export const Toolbar: React.FC = () => {
  const { 
    downloads,
    openModal, 
    resumeSelected, 
    pauseSelected, 
    startQueue, 
    stopQueue, 
    stopAll,
    selectedIds,
    clearSelection,
    queues
  } = useDownloadContext();
  const { appearance, t } = useAppearance();

  const selectedCount = selectedIds.size;
  const hasSelection = selectedCount > 0;

  const selectedItems = downloads.filter((d) => selectedIds.has(d.id));
  const resumableCount = selectedItems.filter((d) => d.status === 'Paused' || d.status === 'Error' || d.status === 'Canceled' || d.status === 'Queued').length;
  const pausableCount = selectedItems.filter((d) => d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging').length;

  const canResume = resumableCount > 0;
  const canPause = pausableCount > 0;
  const canDelete = hasSelection;
  const hasActiveDownloads = downloads.some((d) => 
    d.status === 'Downloading' || 
    d.status === 'Pending' || 
    d.status === 'Merging'
  ) || queues.some((q) => q.isRunning);

  const stoppedQueues = queues.filter((q) => !q.isRunning);
  const runningQueues = queues.filter((q) => q.isRunning);

  return (
    <div className="h-11 bg-card border-b border-border px-3 flex items-center justify-between select-none shrink-0 relative z-30 gap-2 text-xs">
      {/* Action buttons */}
      <div className="flex items-center space-x-1.5 min-w-max">
        {/* New download button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              onClick={() => openModal('newDownload')}
              size="sm"
              className="h-8 gap-1.5 font-semibold text-xs shadow-xs"
            >
              <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
              <CloudDownload className="w-3.5 h-3.5" />
              {appearance.showIconLabels && <span>{t('toolbar.newDownload')}</span>}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Create and configure a new download task</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* Batch actions: resume, pause, delete */}
        <div className="flex items-center space-x-1">
          {/* Resume */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={resumeSelected}
                  disabled={!canResume}
                  className={`h-8 gap-1.5 text-xs ${
                    canResume 
                      ? 'text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-400' 
                      : 'opacity-40'
                  }`}
                >
                  <Play className={`w-3.5 h-3.5 ${canResume ? 'fill-emerald-500 text-emerald-500' : ''}`} />
                  {appearance.showIconLabels && <span>{t('toolbar.resume')}</span>}
                </Button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {canResume
                ? `Resume selected download(s) (${resumableCount})`
                : hasSelection
                ? 'Selected download is already finished or active'
                : 'Select download(s) to resume'}
            </TooltipContent>
          </Tooltip>

          {/* Pause */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={pauseSelected}
                  disabled={!canPause}
                  className={`h-8 gap-1.5 text-xs ${
                    canPause 
                      ? 'text-amber-500 border-amber-500/30 hover:bg-amber-500/10 hover:text-amber-400' 
                      : 'opacity-40'
                  }`}
                >
                  <Pause className={`w-3.5 h-3.5 ${canPause ? 'fill-amber-500 text-amber-500' : ''}`} />
                  {appearance.showIconLabels && <span>{t('toolbar.pause')}</span>}
                </Button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {canPause
                ? `Pause active download(s) (${pausableCount})`
                : hasSelection
                ? 'Selected download is not actively downloading'
                : 'Select download(s) to pause'}
            </TooltipContent>
          </Tooltip>

          {/* Delete */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => canDelete && openModal('deleteConfirm')}
                  disabled={!canDelete}
                  className={`h-8 gap-1.5 text-xs ${
                    canDelete 
                      ? 'text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive' 
                      : 'opacity-40'
                  }`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {appearance.showIconLabels && <span>{t('toolbar.delete')}</span>}
                </Button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {canDelete ? `Delete selected download(s) (${selectedCount})` : 'Select download(s) to delete'}
            </TooltipContent>
          </Tooltip>
        </div>

        <Separator orientation="vertical" className="h-5 mx-1" />

        {/* Queue controls */}
        <div className="flex items-center space-x-1">
          {/* Start queue dropdown */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild disabled={stoppedQueues.length === 0}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={stoppedQueues.length === 0}
                    className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    <ListStart className="w-3.5 h-3.5" />
                    {appearance.showIconLabels && <span className="hidden lg:inline">{t('toolbar.startQueue')}</span>}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {stoppedQueues.length === 0 ? 'All queues are already running' : 'Start downloading scheduled queues'}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="w-48">
              {stoppedQueues.map((q) => (
                <DropdownMenuItem key={q.id} onClick={() => startQueue(q.id)}>
                  <Folder className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
                  <span className="truncate">{q.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Stop queue dropdown */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild disabled={runningQueues.length === 0}>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={runningQueues.length === 0}
                    className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    <PauseCircle className="w-3.5 h-3.5" />
                    {appearance.showIconLabels && <span className="hidden lg:inline">{t('toolbar.stopQueue')}</span>}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {runningQueues.length === 0 ? 'No queues are currently running' : 'Stop and pause running queues'}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" className="w-48">
              {runningQueues.map((q) => (
                <DropdownMenuItem key={q.id} onClick={() => stopQueue(q.id)}>
                  <Folder className="w-3.5 h-3.5 mr-2 text-primary" />
                  <span className="truncate">{q.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Manage Queues */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openModal('queues')}
                className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <Layers className="w-3.5 h-3.5" />
                {appearance.showIconLabels && <span className="hidden lg:inline">{t('toolbar.queues')}</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Manage and configure download queues and schedules</TooltipContent>
          </Tooltip>

          <Separator orientation="vertical" className="h-4 mx-1" />

          {/* Stop all */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={hasActiveDownloads ? "destructive" : "ghost"}
                size="sm"
                onClick={stopAll}
                className={`h-8 gap-1.5 text-xs ${!hasActiveDownloads ? 'text-muted-foreground hover:text-foreground' : ''}`}
              >
                <Square className={`w-3.5 h-3.5 ${hasActiveDownloads ? 'fill-current' : ''}`} />
                {appearance.showIconLabels && <span className="hidden md:inline">{t('toolbar.stopAll')}</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {hasActiveDownloads ? "Immediately stop all active and queued downloads" : "Stop all active downloads"}
            </TooltipContent>
          </Tooltip>

          {/* Settings */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openModal('settings')}
                className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <SettingsIcon className="w-3.5 h-3.5" />
                {appearance.showIconLabels && <span className="hidden md:inline">{t('toolbar.settings')}</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open application settings and engine preferences</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Selection counter badge */}
      {hasSelection && (
        <div className="flex items-center space-x-2 animate-in fade-in zoom-in-95 duration-150 shrink-0">
          <Badge variant="secondary" className="px-2.5 py-1 gap-1.5 text-xs font-normal border border-primary/30 bg-primary/10 text-primary">
            <CheckCircle2 className="w-3 h-3 text-primary" />
            <span className="font-semibold">{selectedCount}</span>
            <span>{t('toolbar.selected')}</span>
            <button
              type="button"
              onClick={clearSelection}
              className="ml-1 p-0.5 hover:bg-primary/20 rounded-full transition-colors cursor-pointer"
              title="Clear selection"
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        </div>
      )}
    </div>
  );
};
