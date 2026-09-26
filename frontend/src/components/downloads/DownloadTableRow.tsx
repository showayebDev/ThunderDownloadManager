import React from 'react';
import {
  Video,
  Binary,
  Archive,
  Music,
  Image as ImageIcon,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { Category, DownloadItem } from '../../types/download';
import { AppearanceSettings } from '../../context/AppearanceContext';
import { formatBytes, formatSpeed, formatDateAdded } from '../../utils/formatters';
import { detectCategory } from '../../utils/category';
import { TableRow, TableCell } from '../ui/table';
import { Checkbox } from '../ui/checkbox';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { cn } from 'cn';

export const getCategoryIcon = (category: Category) => {
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

interface DownloadTableRowProps {
  item: DownloadItem;
  virtualIndex: number;
  measureElement: (node: Element | null) => void;
  isSelected: boolean;
  appearance: AppearanceSettings;
  langCode: string;
  t: (key: string) => string;
  onToggleSelect: (id: string) => void;
  onDoubleClick: (item: DownloadItem) => void;
  onContextMenu: (e: React.MouseEvent, item: DownloadItem) => void;
}

/**
 * Single virtualized row inside DownloadTable displaying file metadata, status badge, progress bar, speed, and ETA.
 */
export const DownloadTableRow: React.FC<DownloadTableRowProps> = ({
  item,
  virtualIndex,
  measureElement,
  isSelected,
  appearance,
  langCode,
  t,
  onToggleSelect,
  onDoubleClick,
  onContextMenu,
}) => {
  const detected = detectCategory(item.name || item.url);
  const effectiveCategory =
    item.category &&
    item.category !== 'All' &&
    !((item.category === 'Programs' || item.category === 'Documents') && detected === 'Videos')
      ? item.category
      : detected;
  const CategoryIcon = getCategoryIcon(effectiveCategory);

  const statusColorClass =
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
      : 'text-muted-foreground';

  const statusLabel =
    item.status === 'Downloading'
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
      : item.status;

  const showPercentage =
    (item.status === 'Downloading' ||
      item.status === 'Paused' ||
      item.status === 'Canceled' ||
      item.status === 'Error') &&
    item.size > 0;

  const showProgressBar =
    item.status === 'Downloading' ||
    item.status === 'Paused' ||
    item.status === 'Canceled' ||
    item.status === 'Error' ||
    item.status === 'Merging';

  return (
    <TableRow
      data-index={virtualIndex}
      ref={measureElement}
      onClick={() => onToggleSelect(item.id)}
      onDoubleClick={() => onDoubleClick(item)}
      onContextMenu={(e) => onContextMenu(e, item)}
      className={cn(
        'h-12 border-b border-border/50 transition-colors duration-150 cursor-pointer',
        isSelected
          ? 'bg-primary/10 hover:bg-primary/15 text-foreground font-medium'
          : 'hover:bg-muted/30'
      )}
    >
      {/* Checkbox */}
      <TableCell
        className="px-3 py-2 text-center align-middle"
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelect(item.id)}
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
                'font-medium truncate transition-colors flex items-center space-x-1.5',
                item.fileMissing ? 'text-muted-foreground' : 'text-foreground hover:text-primary'
              )}
              title={item.fileMissing ? `${item.name} (File missing from disk)` : item.name}
            >
              <span className={item.fileMissing ? 'line-through decoration-amber-500/70' : ''}>
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
        {formatBytes(
          item.size > 0 ? item.size : item.downloaded > 0 ? item.downloaded : 0,
          2,
          appearance.downloadSizeUnit
        )}
      </TableCell>

      {/* Status & progress */}
      <TableCell className="px-3 py-2 overflow-hidden align-middle">
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10.5px]">
            <div className="flex items-center space-x-1.5">
              <span className={statusColorClass}>{statusLabel}</span>
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
            {showPercentage && (
              <span className="text-muted-foreground font-mono text-[10px]">
                {Math.min(100, Math.round((item.downloaded / item.size) * 100))}%
              </span>
            )}
          </div>

          {showProgressBar && (
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
        {appearance.showEndTime &&
        item.status === 'Finished' &&
        (item.endTime || item.dateCompleted)
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
};
