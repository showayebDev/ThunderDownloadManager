import React from 'react';
import {
  ExternalLink,
  FolderOpen,
  Copy,
  ShieldCheck,
  Trash2,
  Play,
  Pause,
  Check,
  ChevronRight,
  ListOrdered,
  Settings2,
} from 'lucide-react';
import { DownloadItem, QueueConfig } from '../../types/download';
import { cn } from 'cn';

export interface ContextMenuState {
  x: number;
  y: number;
  item: DownloadItem;
}

interface DownloadContextMenuProps {
  contextMenu: ContextMenuState;
  targetItems: DownloadItem[];
  queues: QueueConfig[];
  onClose: () => void;
  onOpenFile: (filePath: string) => Promise<void>;
  onOpenFolder: (filePath: string) => Promise<void>;
  onPauseItem: (id: string) => void;
  onResumeItem: (id: string) => void;
  onVerifyChecksum: (item: DownloadItem) => void;
  onUpdateQueue: (id: string, queueName: string) => void;
  onManageQueues: () => void;
  onDeleteConfirm: (ids: string[]) => void;
}

/**
 * Floating right-click context menu for single or multiple selected download rows.
 */
export const DownloadContextMenu: React.FC<DownloadContextMenuProps> = ({
  contextMenu,
  targetItems,
  queues,
  onClose,
  onOpenFile,
  onOpenFolder,
  onPauseItem,
  onResumeItem,
  onVerifyChecksum,
  onUpdateQueue,
  onManageQueues,
  onDeleteConfirm,
}) => {
  const isMultiple = targetItems.length > 1;

  const hasActiveDownloads = targetItems.some(
    (item) =>
      item.status === 'Downloading' || item.status === 'Pending' || item.status === 'Merging'
  );

  const hasPausedDownloads = targetItems.some(
    (item) =>
      item.status === 'Paused' ||
      item.status === 'Error' ||
      item.status === 'Canceled' ||
      item.status === 'Queued'
  );

  return (
    <div
      style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
      className="fixed z-50 bg-popover text-popover-foreground border border-border rounded-xl shadow-2xl py-1.5 w-52 text-xs font-sans animate-in fade-in zoom-in-95 duration-100"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={async () => {
          for (const item of targetItems) {
            await onOpenFile(`${item.savePath}\\${item.name}`);
          }
          onClose();
        }}
        className="w-full flex items-center space-x-2.5 px-3 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer text-left"
      >
        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span>{isMultiple ? `Open Files (${targetItems.length})` : 'Open File'}</span>
      </button>

      <button
        onClick={async () => {
          const uniquePaths = Array.from(
            new Set(targetItems.map((item) => `${item.savePath}\\${item.name}`))
          );
          for (const path of uniquePaths) {
            await onOpenFolder(path);
          }
          onClose();
        }}
        className="w-full flex items-center space-x-2.5 px-3 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer text-left"
      >
        <FolderOpen className="w-3.5 h-3.5 text-primary shrink-0" />
        <span>{isMultiple ? 'Open Folders' : 'Open Folder'}</span>
      </button>

      {hasActiveDownloads && (
        <button
          onClick={() => {
            targetItems
              .filter(
                (item) =>
                  item.status === 'Downloading' ||
                  item.status === 'Pending' ||
                  item.status === 'Merging'
              )
              .forEach((item) => onPauseItem(item.id));
            onClose();
          }}
          className="w-full flex items-center space-x-2.5 px-3 py-1.5 hover:bg-accent text-amber-500 hover:text-amber-400 transition-colors cursor-pointer text-left"
        >
          <Pause className="w-3.5 h-3.5 fill-current shrink-0" />
          <span>{isMultiple ? 'Pause Downloads' : 'Pause Download'}</span>
        </button>
      )}

      {hasPausedDownloads && (
        <button
          onClick={() => {
            targetItems
              .filter(
                (item) =>
                  item.status === 'Paused' ||
                  item.status === 'Error' ||
                  item.status === 'Canceled' ||
                  item.status === 'Queued'
              )
              .forEach((item) => onResumeItem(item.id));
            onClose();
          }}
          className="w-full flex items-center space-x-2.5 px-3 py-1.5 hover:bg-accent text-emerald-500 hover:text-emerald-400 transition-colors cursor-pointer text-left"
        >
          <Play className="w-3.5 h-3.5 fill-current shrink-0" />
          <span>{isMultiple ? 'Resume Downloads' : 'Resume Download'}</span>
        </button>
      )}

      <div className="my-1 border-t border-border" />

      <button
        onClick={() => {
          const urls = targetItems
            .map((item) => item.url)
            .filter(Boolean)
            .join('\n');
          navigator.clipboard.writeText(urls);
          onClose();
        }}
        className="w-full flex items-center space-x-2.5 px-3 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer text-left"
      >
        <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span>{isMultiple ? `Copy Links (${targetItems.length})` : 'Copy Link'}</span>
      </button>

      <button
        disabled={isMultiple}
        onClick={() => {
          if (!isMultiple && targetItems[0]) {
            onVerifyChecksum(targetItems[0]);
            onClose();
          }
        }}
        title={isMultiple ? 'Verify Checksum is available for single items only' : undefined}
        className={cn(
          'w-full flex items-center space-x-2.5 px-3 py-1.5 transition-colors text-left',
          isMultiple
            ? 'opacity-40 cursor-not-allowed text-muted-foreground select-none'
            : 'hover:bg-accent hover:text-accent-foreground cursor-pointer'
        )}
      >
        <ShieldCheck
          className={cn(
            'w-3.5 h-3.5 shrink-0',
            isMultiple ? 'text-muted-foreground' : 'text-emerald-500'
          )}
        />
        <span>Verify Checksum</span>
      </button>

      <div className="my-1 border-t border-border" />

      {/* Assign to Queue Cascading Submenu */}
      <div className="relative group/queue">
        <button
          type="button"
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent hover:text-accent-foreground group-hover/queue:bg-accent group-hover/queue:text-accent-foreground transition-colors cursor-pointer text-left"
        >
          <div className="flex items-center space-x-2.5 min-w-0">
            <ListOrdered className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="truncate">Assign to Queue</span>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-150 group-hover/queue:translate-x-0.5 group-hover/queue:text-foreground" />
        </button>

        {/* Submenu flyout panel */}
        <div
          className={cn(
            'hidden group-hover/queue:flex flex-col absolute bg-popover text-popover-foreground border border-border rounded-xl shadow-2xl py-1.5 min-w-[190px] max-w-[260px] z-50 animate-in fade-in zoom-in-95 duration-100',
            contextMenu.x + 208 + 195 > window.innerWidth ? 'right-full -mr-1' : 'left-full -ml-1',
            contextMenu.y + 190 > window.innerHeight ? 'bottom-0 -mb-1' : 'top-0 -mt-1'
          )}
        >
          <button
            type="button"
            onClick={() => {
              targetItems.forEach((item) => onUpdateQueue(item.id, ''));
              onClose();
            }}
            className={cn(
              'w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent text-xs transition-colors cursor-pointer text-left',
              targetItems.every((i) => !i.queue)
                ? 'text-primary font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <span>None (No Queue)</span>
            {targetItems.every((i) => !i.queue) && (
              <Check className="w-3.5 h-3.5 text-primary shrink-0" />
            )}
          </button>

          {queues.length > 0 && <div className="my-1 border-t border-border" />}

          {queues.map((q) => {
            const isAllCurrent =
              targetItems.length > 0 &&
              targetItems.every(
                (item) =>
                  Boolean(item.queue) &&
                  (item.queue!.toLowerCase() === q.name.toLowerCase() ||
                    item.queue!.toLowerCase() === q.id.toLowerCase())
              );
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => {
                  targetItems.forEach((item) => onUpdateQueue(item.id, q.name));
                  onClose();
                }}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent text-xs transition-colors cursor-pointer text-left',
                  isAllCurrent
                    ? 'text-primary font-semibold'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span className="truncate pr-2">{q.name}</span>
                {isAllCurrent && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
              </button>
            );
          })}

          <div className="my-1 border-t border-border" />

          <button
            type="button"
            onClick={() => {
              onManageQueues();
              onClose();
            }}
            className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-accent text-muted-foreground hover:text-foreground text-xs transition-colors cursor-pointer text-left"
          >
            <Settings2 className="w-3.5 h-3.5" />
            <span>Manage Queues...</span>
          </button>
        </div>
      </div>

      <div className="my-1 border-t border-border" />

      <button
        onClick={() => {
          onDeleteConfirm(targetItems.map((item) => item.id));
          onClose();
        }}
        className="w-full flex items-center space-x-2.5 px-3 py-1.5 hover:bg-destructive/20 text-destructive transition-colors cursor-pointer text-left"
      >
        <Trash2 className="w-3.5 h-3.5" />
        <span>
          {isMultiple ? `Delete ${targetItems.length} Files from Disk` : 'Delete File from Disk'}
        </span>
      </button>
    </div>
  );
};
