/**
 * Category selection bar, file size/status indicator, save path input with folder picker,
 * and filename input controls for DownloadStartConfirmation.
 */

import React from 'react';
import {
  Folder,
  RefreshCw,
  Settings,
  Plus,
  Check,
  Video,
  FileText,
  Archive,
  Music,
  Image as ImageIcon,
  ChevronDown,
  HelpCircle,
  AlertTriangle,
  Magnet,
} from 'lucide-react';
import { Tooltip } from '../../common/Tooltip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

export const renderCategoryIcon = (category: string, protocol: string): React.ReactNode => {
  if (category === 'Torrents' || protocol === 'Torrent')
    return <Magnet className="w-4 h-4 text-amber-400" />;
  if (category === 'Videos') return <Video className="w-4 h-4 text-primary" />;
  if (category === 'Compressed') return <Archive className="w-4 h-4 text-amber-500" />;
  if (category === 'Music') return <Music className="w-4 h-4 text-emerald-500" />;
  if (category === 'Pictures') return <ImageIcon className="w-4 h-4 text-blue-500" />;
  if (category === 'Documents') return <FileText className="w-4 h-4 text-sky-500" />;
  return <Folder className="w-4 h-4 text-muted-foreground" />;
};

interface CategorySelectorRowProps {
  useCategory: boolean;
  onUseCategoryToggle: () => void;
  category: string;
  onCategoryChange: (category: string) => void;
  protocol: string;
  isYtdlpInstalled: boolean;
  fileSizeText: string;
  fileFetched: boolean;
}

export const CategorySelectorRow: React.FC<CategorySelectorRowProps> = ({
  useCategory,
  onUseCategoryToggle,
  category,
  onCategoryChange,
  protocol,
  isYtdlpInstalled,
  fileSizeText,
  fileFetched,
}) => {
  const icon = renderCategoryIcon(category, protocol);

  return (
    <div className="flex items-center justify-between gap-2 min-w-0">
      <div className="flex items-center space-x-2 shrink-0">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="use-category"
            checked={useCategory}
            onCheckedChange={onUseCategoryToggle}
          />
          <Label
            htmlFor="use-category"
            className="text-foreground font-medium text-[12px] whitespace-nowrap cursor-pointer"
          >
            Use Category
          </Label>
        </div>

        <div className="relative">
          <div className="flex items-center space-x-2 bg-muted/40 border border-border rounded-xl px-2.5 py-1.5">
            {icon}
            <select
              value={category}
              onChange={(e) => onCategoryChange(e.target.value)}
              className="bg-transparent text-foreground text-xs outline-none cursor-pointer pr-4 appearance-none"
            >
              <option value="" className="bg-card text-muted-foreground">
                None
              </option>
              <option value="Torrents" className="bg-card text-amber-400">
                Torrents
              </option>
              <option value="Videos" className="bg-card">
                Videos
              </option>
              <option value="Compressed" className="bg-card">
                Compressed
              </option>
              <option value="Programs" className="bg-card">
                Programs
              </option>
              <option value="Music" className="bg-card">
                Music
              </option>
              <option value="Pictures" className="bg-card">
                Pictures
              </option>
              <option value="Documents" className="bg-card">
                Documents
              </option>
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground pointer-events-none absolute right-2" />
          </div>
        </div>

        <Tooltip description="Create a new custom download category" position="top-right">
          <Button variant="outline" size="icon-xs" type="button" className="h-8 w-8">
            <Plus className="w-4 h-4" />
          </Button>
        </Tooltip>
      </div>

      <div className="flex items-center space-x-1.5 text-xs font-medium shrink-0 pr-1">
        {icon}
        <span
          className={
            protocol === 'Yt-DLP' && !isYtdlpInstalled
              ? 'text-amber-500 font-semibold text-[11px]'
              : 'text-foreground text-[11px]'
          }
        >
          {protocol === 'Yt-DLP' && !isYtdlpInstalled
            ? 'Media Tools Missing'
            : fileSizeText}
        </span>
        {protocol === 'Yt-DLP' && !isYtdlpInstalled ? (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        ) : fileFetched ? (
          <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
        ) : null}
      </div>
    </div>
  );
};

interface SavePathAndFilenameSectionProps {
  savePath: string;
  onSavePathChange: (val: string) => void;
  onSavePathBlur: () => void;
  onPickSavePath: () => void;
  onRefreshInfo: () => void;
  isFetchingInfo: boolean;
  showExtraConfig: boolean;
  onToggleExtraConfig: () => void;
  isCustomPath: boolean;
  category: string;
  saveCategoryPath: boolean;
  onSaveCategoryPathToggle: (checked: boolean) => void;
  name: string;
  onNameChange: (val: string) => void;
}

export const SavePathAndFilenameSection: React.FC<SavePathAndFilenameSectionProps> = ({
  savePath,
  onSavePathChange,
  onSavePathBlur,
  onPickSavePath,
  onRefreshInfo,
  isFetchingInfo,
  showExtraConfig,
  onToggleExtraConfig,
  isCustomPath,
  category,
  saveCategoryPath,
  onSaveCategoryPathToggle,
  name,
  onNameChange,
}) => {
  return (
    <>
      {/* Row 3: Save Path & Actions */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex-1 relative flex items-center min-w-0">
          <Input
            type="text"
            value={savePath}
            onChange={(e) => onSavePathChange(e.target.value)}
            onBlur={onSavePathBlur}
            className="w-full bg-background border-border text-foreground font-mono text-[11px] pr-9 h-8 truncate"
          />
          <div className="absolute right-2 flex items-center">
            <Tooltip description="Choose folder location on disk" position="top-right">
              <button
                type="button"
                onClick={onPickSavePath}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <Folder className="w-4 h-4" />
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="flex items-center space-x-1.5 shrink-0">
          <Tooltip description="Re-query remote server for file details" position="top-right">
            <Button
              variant="outline"
              size="icon-xs"
              type="button"
              onClick={onRefreshInfo}
              disabled={isFetchingInfo}
              className="h-8 w-8"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetchingInfo ? 'animate-spin' : ''}`} />
            </Button>
          </Tooltip>
          <Tooltip description="Toggle extra configuration options" position="top-right">
            <Button
              variant={showExtraConfig ? 'default' : 'outline'}
              size="icon-xs"
              type="button"
              onClick={onToggleExtraConfig}
              className="h-8 w-8"
            >
              <Settings className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>
          <Tooltip description="View download manager help" position="top-right">
            <Button variant="outline" size="icon-xs" type="button" className="h-8 w-8 text-primary">
              <HelpCircle className="w-3.5 h-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Save path for category checkbox */}
      {isCustomPath && category && category !== 'None' && category !== 'All' && (
        <div className="flex items-center space-x-2 px-1 -mt-1 min-w-0 animate-in fade-in duration-150">
          <Checkbox
            id="save-cat-path"
            checked={saveCategoryPath}
            onCheckedChange={(c) => onSaveCategoryPathToggle(Boolean(c))}
          />
          <Label
            htmlFor="save-cat-path"
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            Save path for {category} category
          </Label>
        </div>
      )}

      {/* Row 4: Filename Input */}
      <div className="min-w-0">
        <Input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Filename"
          className="w-full bg-background border-border text-foreground font-mono text-[11px] h-8"
        />
      </div>
    </>
  );
};
