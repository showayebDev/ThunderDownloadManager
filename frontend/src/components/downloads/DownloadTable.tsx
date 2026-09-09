import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Video,
  Binary,
  Archive,
  Music,
  Image as ImageIcon,
  FileText,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  FolderOpen,
  Copy,
  ShieldCheck,
  Trash2,
  Play,
  Pause,
  AlertTriangle,
  Check,
  Plus,
  CloudDownload,
  ChevronRight,
  ListOrdered,
  Settings2,
} from 'lucide-react';
import { useDownloadContext } from '../../context/DownloadContext';
import { useAppearance } from '../../context/AppearanceContext';
import { Category, DownloadItem } from '../../types/download';
import { formatBytes, formatSpeed, formatDateAdded } from '../../utils/formatters';
import { invoke } from '../../utils/tauriBridge';
import { ChecksumModal } from '../modals/ChecksumModal';
import { detectCategory } from '../../utils/category';

import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '../ui/table';
import { Checkbox } from '../ui/checkbox';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { Button } from '../ui/button';
import { cn } from 'cn';

const getCategoryIcon = (category: Category) => {
  switch (category) {
    case 'Videos':
      return Video;
    case 'Programs':
      return Binary;
    case 'Compressed':
      return Archive;
    case 'Music':
      return Music;
    case 'Pictures':
      return ImageIcon;
    case 'Documents':
      return FileText;
    default:
      return FileText;
  }
};

type ColumnKey = 'name' | 'size' | 'status' | 'speed' | 'timeLeft' | 'dateAdded';

interface ContextMenuState {
  x: number;
  y: number;
  item: DownloadItem;
}

export const DownloadTable: React.FC = () => {
  const {
    filteredDownloads,
    selectedIds,
    setSelectedIds,
    toggleSelectId,
    toggleSelectAll,
    openModal,
    queues,
    updateDownloadItem,
    pauseItem,
    resumeItem
  } = useDownloadContext();
  const { appearance, t, langCode } = useAppearance();

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [checksumItem, setChecksumItem] = useState<DownloadItem | null>(null);

  const [sortColumn, setSortColumn] = useState<ColumnKey | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  const handleSort = (colKey: ColumnKey) => {
    if (sortColumn === colKey) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortColumn(colKey);
      if (colKey === 'size' || colKey === 'speed' || colKey === 'dateAdded') {
        setSortDirection('desc');
      } else {
        setSortDirection('asc');
      }
    }
  };

  const sortedDownloads = useMemo(() => {
    if (!sortColumn) return filteredDownloads;

    return [...filteredDownloads].sort((a, b) => {
      let comparison = 0;
      switch (sortColumn) {
        case 'name':
          comparison = (a.name || '').localeCompare(b.name || '', undefined, {
            numeric: true,
            sensitivity: 'base',
          });
          break;
        case 'size':
          comparison = (a.size || 0) - (b.size || 0);
          break;
        case 'status':
          comparison = (a.status || '').localeCompare(b.status || '');
          break;
        case 'speed':
          comparison = (a.speed || 0) - (b.speed || 0);
          break;
        case 'timeLeft': {
          const remA = a.status === 'Downloading' && a.speed > 0 ? (a.size - a.downloaded) / a.speed : Infinity;
          const remB = b.status === 'Downloading' && b.speed > 0 ? (b.size - b.downloaded) / b.speed : Infinity;
          if (remA !== remB) {
            comparison = remA - remB;
          } else {
            comparison = (a.timeLeft || '').localeCompare(b.timeLeft || '');
          }
          break;
        }
        case 'dateAdded': {
          const timeA = new Date(a.dateAdded || 0).getTime() || 0;
          const timeB = new Date(b.dateAdded || 0).getTime() || 0;
          comparison = timeA - timeB;
          break;
        }
        default:
          comparison = 0;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredDownloads, sortColumn, sortDirection]);

  const renderHeader = (colKey: ColumnKey, label: string) => {
    const isSorted = sortColumn === colKey;
    return (
      <button
        type="button"
        onClick={() => handleSort(colKey)}
        className={cn(
          "inline-flex items-center gap-1.5 h-7 px-2 -ml-2 rounded-md text-xs font-semibold tracking-tight transition-colors cursor-pointer select-none text-left",
          isSorted
            ? "text-primary font-bold bg-primary/10"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
        )}
        title={`Sort by ${label} (${isSorted ? (sortDirection === 'asc' ? 'Ascending' : 'Descending') : 'Click to sort'})`}
      >
        <span>{label}</span>
        {isSorted ? (
          sortDirection === 'asc' ? (
            <ArrowUp className="w-3.5 h-3.5 text-primary shrink-0" />
          ) : (
            <ArrowDown className="w-3.5 h-3.5 text-primary shrink-0" />
          )
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-40 group-hover:opacity-100 text-muted-foreground transition-opacity shrink-0" />
        )}
      </button>
    );
  };

  const [colWidths, setColWidths] = useState<Record<ColumnKey, number>>({
    name: 260,
    size: 90,
    status: 135,
    speed: 95,
    timeLeft: 95,
    dateAdded: 115,
  });

  const resizingCol = useRef<ColumnKey | null>(null);
  const startX = useRef<number>(0);
  const startWidth = useRef<number>(0);

  const handleMouseDown = (e: React.MouseEvent, colKey: ColumnKey) => {
    e.preventDefault();
    e.stopPropagation();
    resizingCol.current = colKey;
    startX.current = e.clientX;
    startWidth.current = colWidths[colKey];

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!resizingCol.current) return;
    const diff = e.clientX - startX.current;
    const newWidth = Math.max(60, startWidth.current + diff);
    setColWidths((prev) => ({
      ...prev,
      [resizingCol.current!]: newWidth,
    }));
  };

  const handleMouseUp = () => {
    resizingCol.current = null;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };

  useEffect(() => {
    const handleClick = () => {
      setContextMenu(null);
    };
    window.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('click', handleClick);
    };
  }, []);

  const handleContextMenu = (e: React.MouseEvent, item: DownloadItem) => {
    e.preventDefault();
    const menuWidth = 208;
    const menuHeight = 280;
    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > window.innerWidth) {
      x = Math.max(10, window.innerWidth - menuWidth - 10);
    }
    if (y + menuHeight > window.innerHeight) {
      y = Math.max(10, window.innerHeight - menuHeight - 10);
    }

    // If the right-clicked row is not part of existing multiple selection, select only this row
    if (!selectedIds.has(item.id)) {
      setSelectedIds(new Set([item.id]));
    }

    setContextMenu({
      x,
      y,
      item,
    });
  };

  const handleOpenFile = async (filePath: string) => {
    try {
      await invoke('open_file_command', { filePath });
    } catch {}
  };

  const handleOpenFolder = async (filePath: string) => {
    try {
      await invoke('open_folder_command', { filePath });
    } catch {}
  };

  // Scroll parent container for virtualizer
  const tableContainerRef = useRef<HTMLDivElement>(null);

  // Virtualizer for smooth, non-laggy 60fps rendering with large download lists
  const rowVirtualizer = useVirtualizer({
    count: sortedDownloads.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 48,
    overscan: 12,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalVirtualSize = rowVirtualizer.getTotalSize();

  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom =
    virtualItems.length > 0
      ? totalVirtualSize - virtualItems[virtualItems.length - 1].end
      : 0;

  const targetItems = useMemo(() => {
    if (!contextMenu) return [];
    if (selectedIds.has(contextMenu.item.id) && selectedIds.size > 1) {
      return sortedDownloads.filter((d) => selectedIds.has(d.id));
    }
    return [contextMenu.item];
  }, [contextMenu, selectedIds, sortedDownloads]);

  const isMultiple = targetItems.length > 1;

  const hasActiveDownloads = targetItems.some(
    (item) =>
      item.status === 'Downloading' || item.status === 'Pending' || item.status === 'Merging'
  );

  const hasPausedDownloads = targetItems.some(
    (item) =>
      item.status === 'Paused' || item.status === 'Error' || item.status === 'Canceled' || item.status === 'Queued'
  );

  return (
    <div className="flex-1 h-full bg-background flex flex-col overflow-hidden select-none relative text-xs">
      {/* Scrollable Table Area expanding to full container height */}
      <div
        ref={tableContainerRef}
        className="flex-1 h-full w-full overflow-y-auto overflow-x-auto custom-scrollbar relative"
      >
        <Table
          containerClassName={sortedDownloads.length === 0 ? "min-h-full flex flex-col" : "w-full"}
          className={cn("w-full text-left border-collapse table-fixed select-none", sortedDownloads.length === 0 && "flex-1")}
        >
          {/* Column definitions */}
          <colgroup>
            <col style={{ width: '40px' }} />
            <col style={{ width: `${colWidths.name}px` }} />
            <col style={{ width: `${colWidths.size}px` }} />
            <col style={{ width: `${colWidths.status}px` }} />
            <col style={{ width: `${colWidths.speed}px` }} />
            <col style={{ width: `${colWidths.timeLeft}px` }} />
            <col style={{ width: `${colWidths.dateAdded}px` }} />
          </colgroup>

          {/* Sticky Table Header */}
          <TableHeader className="bg-card/75 backdrop-blur-xs sticky top-0 border-b border-border z-20 text-xs select-none">
            <TableRow className="h-9 hover:bg-transparent border-b border-border">
              <TableHead className="w-10 px-3 text-center align-middle">
                <Checkbox
                  checked={sortedDownloads.length > 0 && selectedIds.size === sortedDownloads.length}
                  indeterminate={selectedIds.size > 0 && selectedIds.size < sortedDownloads.length}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </TableHead>

              {/* Name column */}
              <TableHead className="relative px-3 text-left align-middle text-xs font-semibold text-muted-foreground group">
                {renderHeader('name', t('table.name'))}
                <div
                  onMouseDown={(e) => handleMouseDown(e, 'name')}
                  className="absolute right-0 top-1.5 bottom-1.5 w-1 cursor-col-resize rounded-full hover:bg-primary/60 transition-colors opacity-0 group-hover:opacity-100 z-30"
                />
              </TableHead>

              {/* Size column */}
              <TableHead className="relative px-3 text-left align-middle text-xs font-semibold text-muted-foreground group">
                {renderHeader('size', t('table.size'))}
                <div
                  onMouseDown={(e) => handleMouseDown(e, 'size')}
                  className="absolute right-0 top-1.5 bottom-1.5 w-1 cursor-col-resize rounded-full hover:bg-primary/60 transition-colors opacity-0 group-hover:opacity-100 z-30"
                />
              </TableHead>

              {/* Status column */}
              <TableHead className="relative px-3 text-left align-middle text-xs font-semibold text-muted-foreground group">
                {renderHeader('status', t('table.status'))}
                <div
                  onMouseDown={(e) => handleMouseDown(e, 'status')}
                  className="absolute right-0 top-1.5 bottom-1.5 w-1 cursor-col-resize rounded-full hover:bg-primary/60 transition-colors opacity-0 group-hover:opacity-100 z-30"
                />
              </TableHead>

              {/* Speed column */}
              <TableHead className="relative px-3 text-left align-middle text-xs font-semibold text-muted-foreground group">
                {renderHeader('speed', t('table.speed'))}
                <div
                  onMouseDown={(e) => handleMouseDown(e, 'speed')}
                  className="absolute right-0 top-1.5 bottom-1.5 w-1 cursor-col-resize rounded-full hover:bg-primary/60 transition-colors opacity-0 group-hover:opacity-100 z-30"
                />
              </TableHead>

              {/* Time left column */}
              <TableHead className="relative px-3 text-left align-middle text-xs font-semibold text-muted-foreground group">
                {renderHeader('timeLeft', t('table.timeLeft'))}
                <div
                  onMouseDown={(e) => handleMouseDown(e, 'timeLeft')}
                  className="absolute right-0 top-1.5 bottom-1.5 w-1 cursor-col-resize rounded-full hover:bg-primary/60 transition-colors opacity-0 group-hover:opacity-100 z-30"
                />
              </TableHead>

              {/* Date added column */}
              <TableHead className="relative px-3 text-left align-middle text-xs font-semibold text-muted-foreground group">
                {renderHeader('dateAdded', t('table.dateAdded'))}
                <div
                  onMouseDown={(e) => handleMouseDown(e, 'dateAdded')}
                  className="absolute right-0 top-1.5 bottom-1.5 w-1 cursor-col-resize rounded-full hover:bg-primary/60 transition-colors opacity-0 group-hover:opacity-100 z-30"
                />
              </TableHead>
            </TableRow>
          </TableHeader>

          {/* Empty State Body (fills remaining height down to status bar) */}
          {sortedDownloads.length === 0 ? (
            <TableBody className="flex-1">
              <TableRow className="hover:bg-transparent border-0">
                <TableCell colSpan={7} className="p-0 border-0">
                  <div className="flex flex-col items-center justify-center py-16 px-4 text-center select-none h-full min-h-[280px]">
                    <div className="w-14 h-14 rounded-2xl bg-muted/60 border border-border/80 flex items-center justify-center text-muted-foreground mb-3 shadow-xs">
                      <CloudDownload className="w-7 h-7 stroke-[1.5] text-primary/80" />
                    </div>
                    <h3 className="text-sm font-semibold text-foreground tracking-tight">
                      {t('table.noDownloads') || 'No downloads found in this view'}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1 max-w-sm leading-relaxed">
                      Downloads you start or capture from your browser will appear here in real-time.
                    </p>
                    <Button
                      size="sm"
                      onClick={() => openModal('newDownload')}
                      className="mt-4 h-8 px-4 text-xs font-semibold gap-1.5 shadow-xs cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{t('toolbar.newDownload') || 'Add New Download'}</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          ) : (
            <TableBody className="text-xs text-foreground divide-y divide-border/40">
              {paddingTop > 0 && (
                <tr>
                  <td colSpan={7} style={{ height: `${paddingTop}px`, padding: 0, border: 0 }} />
                </tr>
              )}

              {virtualItems.map((virtualRow) => {
                const item = sortedDownloads[virtualRow.index];
                if (!item) return null;

                const isSelected = selectedIds.has(item.id);
                const detected = detectCategory(item.name || item.url);
                const effectiveCategory =
                  item.category &&
                  item.category !== 'All' &&
                  !((item.category === 'Programs' || item.category === 'Documents') && detected === 'Videos')
                    ? item.category
                    : detected;
                const CategoryIcon = getCategoryIcon(effectiveCategory);

                return (
                  <TableRow
                    key={item.id}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    onClick={() => toggleSelectId(item.id)}
                    onDoubleClick={() => {
                      if (item.status === 'Downloading' || item.status === 'Pending' || item.status === 'Merging') {
                        invoke('open_realtime_progress_window_command', {
                          id: item.id,
                          taskId: item.id,
                          filename: item.name,
                          url: item.url,
                          savePath: item.savePath,
                          resumeSupport: item.resumeSupport,
                          resumable: item.resumeSupport === 'Yes',
                          force: true,
                        });
                        invoke('remove_hidden_download_command', { id: item.id });
                      } else {
                        openModal('downloadDetail', item.id);
                      }
                    }}
                    onContextMenu={(e) => handleContextMenu(e, item)}
                    className={cn(
                      "h-12 border-b border-border/50 transition-colors duration-150 cursor-pointer",
                      isSelected
                        ? "bg-primary/10 hover:bg-primary/15 text-foreground font-medium"
                        : "hover:bg-muted/30"
                    )}
                  >
                    {/* Checkbox */}
                    <TableCell className="px-3 py-2 text-center align-middle" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelectId(item.id)}
                        aria-label={`Select ${item.name}`}
                      />
                    </TableCell>

                    {/* Name and category */}
                    <TableCell className="px-3 py-2 overflow-hidden align-middle">
                      <div className="flex items-center space-x-2.5 min-w-0">
                        <div className="p-1.5 rounded-lg bg-muted/80 text-muted-foreground group-hover:text-primary shrink-0 border border-border/50">
                          <CategoryIcon className="w-3.5 h-3.5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div
                            className={cn(
                              "font-medium truncate transition-colors flex items-center space-x-1.5",
                              item.fileMissing ? "text-muted-foreground" : "text-foreground hover:text-primary"
                            )}
                            title={item.fileMissing ? `${item.name} (File missing from disk)` : item.name}
                          >
                            <span className={item.fileMissing ? "line-through decoration-amber-500/70" : ""}>
                              {item.name}
                            </span>
                            {item.fileMissing && (
                              <Badge
                                variant="outline"
                                className="px-1.5 py-0 text-[9px] font-semibold border-amber-500/40 text-amber-500 bg-amber-500/10 no-underline shrink-0"
                              >
                                Missing
                              </Badge>
                            )}
                          </div>
                          <div className="text-[10.5px] text-muted-foreground capitalize truncate mt-0.5">
                            {effectiveCategory}
                          </div>
                        </div>
                      </div>
                    </TableCell>

                    {/* Size */}
                    <TableCell className="px-3 py-2 font-mono text-[11px] text-muted-foreground truncate align-middle">
                      {formatBytes(item.size, 2, appearance.downloadSizeUnit)}
                    </TableCell>

                    {/* Status & progress */}
                    <TableCell className="px-3 py-2 overflow-hidden align-middle">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[10.5px]">
                          <div className="flex items-center space-x-1.5">
                            <span
                              className={
                                item.status === 'Downloading'
                                  ? 'text-primary font-semibold'
                                  : item.status === 'Finished'
                                  ? item.fileMissing
                                    ? 'text-amber-500 font-semibold'
                                    : 'text-emerald-500 font-semibold'
                                  : item.status === 'Error'
                                  ? 'text-destructive font-semibold'
                                  : item.status === 'Canceled'
                                  ? 'text-amber-600 font-semibold'
                                  : 'text-muted-foreground'
                              }
                            >
                              {item.status === 'Downloading'
                                ? t('status.downloading')
                                : item.status === 'Finished'
                                ? item.fileMissing
                                  ? 'Missing'
                                  : t('status.finished')
                                : item.status === 'Paused'
                                ? t('status.paused')
                                : item.status === 'Canceled'
                                ? t('status.canceled')
                                : item.status === 'Error'
                                ? t('status.error')
                                : item.status === 'Queued'
                                ? t('status.queued')
                                : item.status === 'Merging'
                                ? t('status.merging')
                                : item.status}
                            </span>
                            {item.proxyUsed && (
                              <Badge
                                variant="outline"
                                className="px-1 py-0 text-[8.5px] font-bold border-primary/30 text-primary bg-primary/10"
                              >
                                PROXY
                              </Badge>
                            )}
                            {item.fileMissing && (
                              <Badge
                                variant="outline"
                                className="flex items-center gap-0.5 px-1 py-0 text-[8.5px] font-bold border-amber-500/40 text-amber-500 bg-amber-500/10"
                              >
                                <AlertTriangle className="w-2.5 h-2.5" />
                                <span>MISSING</span>
                              </Badge>
                            )}
                          </div>
                          {(item.status === 'Downloading' ||
                            item.status === 'Paused' ||
                            item.status === 'Canceled' ||
                            item.status === 'Error') &&
                            item.size > 0 && (
                              <span className="text-muted-foreground font-mono text-[10px]">
                                {Math.min(100, Math.round((item.downloaded / item.size) * 100))}%
                              </span>
                            )}
                        </div>

                        {(item.status === 'Downloading' ||
                          item.status === 'Paused' ||
                          item.status === 'Canceled' ||
                          item.status === 'Error' ||
                          item.status === 'Merging') && (
                          <Progress
                            value={item.size > 0 ? Math.min(100, (item.downloaded / item.size) * 100) : 0}
                            className="h-1.5"
                          />
                        )}
                      </div>
                    </TableCell>

                    {/* Speed */}
                    <TableCell className="px-3 py-2 font-mono text-[11px] text-muted-foreground truncate align-middle">
                      {item.status === 'Downloading' && item.speed > 0
                        ? formatSpeed(item.speed, appearance.downloadSpeedUnit)
                        : '-'}
                    </TableCell>

                    {/* Time Left */}
                    <TableCell className="px-3 py-2 text-[11px] text-muted-foreground truncate align-middle">
                      {item.status === 'Downloading' ? item.timeLeft || '-' : '-'}
                    </TableCell>

                    {/* Date Added */}
                    <TableCell className="px-3 py-2 text-[11px] text-muted-foreground truncate align-middle">
                      {appearance.showEndTime && item.status === 'Finished' && (item.endTime || item.dateCompleted)
                        ? `${t('table.ended')}: ${formatDateAdded(
                            item.endTime || item.dateCompleted,
                            item.id,
                            appearance.useRelativeDateTime,
                            langCode
                          )}`
                        : formatDateAdded(item.dateAdded, item.id, appearance.useRelativeDateTime, langCode)}
                    </TableCell>
                  </TableRow>
                );
              })}

              {paddingBottom > 0 && (
                <tr>
                  <td colSpan={7} style={{ height: `${paddingBottom}px`, padding: 0, border: 0 }} />
                </tr>
              )}
            </TableBody>
          )}
        </Table>
      </div>

      {/* Row Context Menu using styled overlay */}
      {contextMenu && (
        <div
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          className="fixed z-50 bg-popover text-popover-foreground border border-border rounded-xl shadow-2xl py-1.5 w-52 text-xs font-sans animate-in fade-in zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={async () => {
              for (const item of targetItems) {
                await handleOpenFile(`${item.savePath}\\${item.name}`);
              }
              setContextMenu(null);
            }}
            className="w-full flex items-center space-x-2.5 px-3 py-1.5 hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer text-left"
          >
            <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span>{isMultiple ? `Open Files (${targetItems.length})` : 'Open File'}</span>
          </button>

          <button
            onClick={async () => {
              const uniquePaths = Array.from(new Set(targetItems.map((item) => `${item.savePath}\\${item.name}`)));
              for (const path of uniquePaths) {
                await handleOpenFolder(path);
              }
              setContextMenu(null);
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
                      item.status === 'Downloading' || item.status === 'Pending' || item.status === 'Merging'
                  )
                  .forEach((item) => pauseItem(item.id));
                setContextMenu(null);
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
                      item.status === 'Paused' || item.status === 'Error' || item.status === 'Canceled' || item.status === 'Queued'
                  )
                  .forEach((item) => resumeItem(item.id));
                setContextMenu(null);
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
              const urls = targetItems.map((item) => item.url).filter(Boolean).join('\n');
              navigator.clipboard.writeText(urls);
              setContextMenu(null);
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
                setChecksumItem(targetItems[0]);
                setContextMenu(null);
              }
            }}
            title={isMultiple ? 'Verify Checksum is available for single items only' : undefined}
            className={cn(
              "w-full flex items-center space-x-2.5 px-3 py-1.5 transition-colors text-left",
              isMultiple
                ? "opacity-40 cursor-not-allowed text-muted-foreground select-none"
                : "hover:bg-accent hover:text-accent-foreground cursor-pointer"
            )}
          >
            <ShieldCheck className={cn("w-3.5 h-3.5 shrink-0", isMultiple ? "text-muted-foreground" : "text-emerald-500")} />
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
                "hidden group-hover/queue:flex flex-col absolute bg-popover text-popover-foreground border border-border rounded-xl shadow-2xl py-1.5 min-w-[190px] max-w-[260px] z-50 animate-in fade-in zoom-in-95 duration-100",
                contextMenu.x + 208 + 195 > window.innerWidth ? "right-full -mr-1" : "left-full -ml-1",
                contextMenu.y + 190 > window.innerHeight ? "bottom-0 -mb-1" : "top-0 -mt-1"
              )}
            >
              <button
                type="button"
                onClick={() => {
                  targetItems.forEach((item) => updateDownloadItem(item.id, { queue: '' }));
                  setContextMenu(null);
                }}
                className={cn(
                  "w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent text-xs transition-colors cursor-pointer text-left",
                  targetItems.every((i) => !i.queue) ? "text-primary font-semibold" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <span>None (No Queue)</span>
                {targetItems.every((i) => !i.queue) && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
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
                      targetItems.forEach((item) => updateDownloadItem(item.id, { queue: q.name }));
                      setContextMenu(null);
                    }}
                    className={cn(
                      "w-full flex items-center justify-between px-3 py-1.5 hover:bg-accent text-xs transition-colors cursor-pointer text-left",
                      isAllCurrent ? "text-primary font-semibold" : "text-muted-foreground hover:text-foreground"
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
                  openModal('queues');
                  setContextMenu(null);
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
              setSelectedIds(new Set(targetItems.map((item) => item.id)));
              openModal('deleteConfirm');
              setContextMenu(null);
            }}
            className="w-full flex items-center space-x-2.5 px-3 py-1.5 hover:bg-destructive/20 text-destructive transition-colors cursor-pointer text-left"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{isMultiple ? `Delete ${targetItems.length} Files from Disk` : 'Delete File from Disk'}</span>
          </button>
        </div>
      )}

      {/* Checksum modal */}
      {checksumItem && (
        <ChecksumModal
          filePath={
            checksumItem.savePath
              ? `${checksumItem.savePath.replace(/[/\\]+$/, '')}\\${checksumItem.name}`
              : checksumItem.name
          }
          fileName={checksumItem.name}
          taskId={checksumItem.id}
          givenCheckSum={checksumItem.givenCheckSum || checksumItem.expectedChecksum || ''}
          onClose={() => setChecksumItem(null)}
        />
      )}
    </div>
  );
};
