import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Plus,
  CloudDownload,
} from 'lucide-react';
import { useDownloadContext } from '../../context/DownloadContext';
import { useAppearance } from '../../context/AppearanceContext';
import { DownloadItem } from '../../types/download';
import { invoke } from '../../utils/tauriBridge';
import { ChecksumModal } from '../modals/ChecksumModal';
import { DownloadContextMenu, ContextMenuState } from './DownloadContextMenu';
import { DownloadTableRow } from './DownloadTableRow';

import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '../ui/table';
import { Checkbox } from '../ui/checkbox';
import { Button } from '../ui/button';
import { cn } from 'cn';

type ColumnKey = 'name' | 'size' | 'status' | 'speed' | 'timeLeft' | 'dateAdded';

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
    resumeItem,
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
          const remA =
            a.status === 'Downloading' && a.speed > 0 ? (a.size - a.downloaded) / a.speed : Infinity;
          const remB =
            b.status === 'Downloading' && b.speed > 0 ? (b.size - b.downloaded) / b.speed : Infinity;
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
          'inline-flex items-center gap-1.5 h-7 px-2 -ml-2 rounded-md text-xs font-semibold tracking-tight transition-colors cursor-pointer select-none text-left',
          isSorted
            ? 'text-primary font-bold bg-primary/10'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
        )}
        title={`Sort by ${label} (${
          isSorted ? (sortDirection === 'asc' ? 'Ascending' : 'Descending') : 'Click to sort'
        })`}
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

  const handleRowDoubleClick = (item: DownloadItem) => {
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
  };

  const tableContainerRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="flex-1 h-full bg-background flex flex-col overflow-hidden select-none relative text-xs">
      <div
        ref={tableContainerRef}
        className="flex-1 h-full w-full overflow-y-auto overflow-x-auto custom-scrollbar relative"
      >
        <Table
          containerClassName={sortedDownloads.length === 0 ? 'min-h-full flex flex-col' : 'w-full'}
          className={cn(
            'w-full text-left border-collapse table-fixed select-none',
            sortedDownloads.length === 0 && 'flex-1'
          )}
        >
          <colgroup>
            <col style={{ width: '40px' }} />
            <col style={{ width: `${colWidths.name}px` }} />
            <col style={{ width: `${colWidths.size}px` }} />
            <col style={{ width: `${colWidths.status}px` }} />
            <col style={{ width: `${colWidths.speed}px` }} />
            <col style={{ width: `${colWidths.timeLeft}px` }} />
            <col style={{ width: `${colWidths.dateAdded}px` }} />
          </colgroup>

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

              {(['name', 'size', 'status', 'speed', 'timeLeft', 'dateAdded'] as ColumnKey[]).map(
                (colKey) => (
                  <TableHead
                    key={colKey}
                    className="relative px-3 text-left align-middle text-xs font-semibold text-muted-foreground group"
                  >
                    {renderHeader(colKey, t(`table.${colKey}`))}
                    <div
                      onMouseDown={(e) => handleMouseDown(e, colKey)}
                      className="absolute right-0 top-1.5 bottom-1.5 w-1 cursor-col-resize rounded-full hover:bg-primary/60 transition-colors opacity-0 group-hover:opacity-100 z-30"
                    />
                  </TableHead>
                )
              )}
            </TableRow>
          </TableHeader>

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

                return (
                  <DownloadTableRow
                    key={item.id}
                    item={item}
                    virtualIndex={virtualRow.index}
                    measureElement={rowVirtualizer.measureElement}
                    isSelected={selectedIds.has(item.id)}
                    appearance={appearance}
                    langCode={langCode}
                    t={t}
                    onToggleSelect={toggleSelectId}
                    onDoubleClick={handleRowDoubleClick}
                    onContextMenu={handleContextMenu}
                  />
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

      {contextMenu && (
        <DownloadContextMenu
          contextMenu={contextMenu}
          targetItems={targetItems}
          queues={queues}
          onClose={() => setContextMenu(null)}
          onOpenFile={handleOpenFile}
          onOpenFolder={handleOpenFolder}
          onPauseItem={pauseItem}
          onResumeItem={resumeItem}
          onVerifyChecksum={(item) => setChecksumItem(item)}
          onUpdateQueue={(id, queueName) => updateDownloadItem(id, { queue: queueName })}
          onManageQueues={() => openModal('queues')}
          onDeleteConfirm={(ids) => {
            setSelectedIds(new Set(ids));
            openModal('deleteConfirm');
          }}
        />
      )}

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
