/**
 * Top menu bar dropdowns (File, Tasks, Tools, Help) and application logo for Header.tsx.
 */
import React from 'react';
import {
  Plus,
  Clipboard,
  Layers,
  LogOut,
  Settings,
  Globe,
  CloudDownload,
  CheckCircle2,
  RefreshCw,
  Scale,
  Info,
  Trash2,
  ListStart,
  PauseCircle,
  Square as SquareIcon,
} from 'lucide-react';
import { QueueConfig } from '../../../types/download';
import { ActiveModalType } from '../../../context/DownloadContext';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '../../ui/dropdown-menu';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';

interface HeaderMenusProps {
  t: (key: string) => string;
  modLabel: string;
  appVersion: string;
  stoppedQueues: QueueConfig[];
  runningQueues: QueueConfig[];
  onNewDownload: () => void;
  onImportFromClipboard: () => void;
  onOpenModal: (modal: Exclude<ActiveModalType, null>, downloadId?: string) => void;
  onExit: () => void;
  onStartQueue: (queueId?: string) => void;
  onStopQueue: (queueId?: string) => void;
  onStopAll: () => void;
  onDeleteAllMissing: () => void;
  onDeleteAllFinished: () => void;
  onDeleteAllUnfinished: () => void;
  onDeleteEntireList: () => void;
  onOpenBrowserIntegration: (browser: 'chrome' | 'firefox' | 'edge') => void;
  onOpenSettings: () => void;
  onCheckMediaToolsPresence: () => void;
  onInstallYTDLP: () => void;
  onOpenGitHubSupport: () => void;
  onCheckAppUpdate: () => void;
  onCheckMediaToolsUpdate: () => void;
}

export const HeaderMenus: React.FC<HeaderMenusProps> = ({
  t,
  modLabel,
  appVersion,
  stoppedQueues,
  runningQueues,
  onNewDownload,
  onImportFromClipboard,
  onOpenModal,
  onExit,
  onStartQueue,
  onStopQueue,
  onStopAll,
  onDeleteAllMissing,
  onDeleteAllFinished,
  onDeleteAllUnfinished,
  onDeleteEntireList,
  onOpenBrowserIntegration,
  onOpenSettings,
  onCheckMediaToolsPresence,
  onInstallYTDLP,
  onOpenGitHubSupport,
  onCheckAppUpdate,
  onCheckMediaToolsUpdate,
}) => {
  return (
    <div
      className="flex items-center space-x-3 relative z-10"
      style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
    >
      {/* Application icon */}
      <div
        className="flex items-center space-x-2"
        style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
      >
        <img
          src="/icon.svg"
          alt="ThunderDM Logo"
          className="w-5 h-5 rounded-md shadow-xs object-cover pointer-events-none"
        />
      </div>

      {/* Top menu bar using shadcn DropdownMenu */}
      <nav
        className="flex items-center space-x-0.5 text-xs text-foreground font-medium"
        style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
      >
        {/* File menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {t('menu.file')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={onNewDownload}>
              <Plus className="w-4 h-4 mr-2 text-primary" />
              <span>{t('menu.newDownload')}</span>
              <DropdownMenuShortcut>{modLabel}N</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onImportFromClipboard}>
              <Clipboard className="w-4 h-4 mr-2 text-primary" />
              <span>{t('menu.importClipboard')}</span>
              <DropdownMenuShortcut>{modLabel}V</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onOpenModal('batchDownload')}>
              <Layers className="w-4 h-4 mr-2 text-primary" />
              <span>{t('menu.batchDownload') || 'Batch Download'}</span>
              <DropdownMenuShortcut>{modLabel}B</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onExit}
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
            >
              <LogOut className="w-4 h-4 mr-2" />
              <span>{t('menu.exit')}</span>
              <DropdownMenuShortcut>{modLabel}Q</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Tasks menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {t('menu.tasks')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            {/* Start Queue submenu */}
            {stoppedQueues.length > 0 ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <ListStart className="w-4 h-4 mr-2 text-muted-foreground" />
                  <span>{t('menu.startQueue')}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44">
                  {stoppedQueues.map((q) => (
                    <DropdownMenuItem key={q.id} onClick={() => onStartQueue(q.id)}>
                      <span className="truncate">{q.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : (
              <DropdownMenuItem disabled className="opacity-40">
                <ListStart className="w-4 h-4 mr-2" />
                <span>{t('menu.startQueue')}</span>
              </DropdownMenuItem>
            )}

            {/* Stop Queue submenu */}
            {runningQueues.length > 0 ? (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <PauseCircle className="w-4 h-4 mr-2 text-muted-foreground" />
                  <span>{t('menu.stopQueue')}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44">
                  {runningQueues.map((q) => (
                    <DropdownMenuItem key={q.id} onClick={() => onStopQueue(q.id)}>
                      <span className="truncate">{q.name}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ) : (
              <DropdownMenuItem disabled className="opacity-40">
                <PauseCircle className="w-4 h-4 mr-2" />
                <span>{t('menu.stopQueue')}</span>
              </DropdownMenuItem>
            )}

            <DropdownMenuItem onClick={onStopAll}>
              <SquareIcon className="w-4 h-4 mr-2 text-muted-foreground" />
              <span>{t('menu.stopAll')}</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            {/* Delete submenu */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="text-destructive focus:text-destructive">
                <Trash2 className="w-4 h-4 mr-2" />
                <span>{t('menu.delete')}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-48">
                <DropdownMenuItem onClick={onDeleteAllMissing}>
                  <span>{t('menu.deleteMissing')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDeleteAllFinished}>
                  <span>{t('menu.deleteFinished')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onDeleteAllUnfinished}>
                  <span>{t('menu.deleteUnfinished')}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={onDeleteEntireList}
                  className="text-destructive focus:text-destructive"
                >
                  <span>{t('menu.deleteEntireList')}</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Tools menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {t('menu.tools')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {/* Browser extension submenu */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <CloudDownload className="w-4 h-4 mr-2 text-primary" />
                <span>{t('menu.browserIntegration')}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-44">
                <DropdownMenuItem onClick={() => onOpenBrowserIntegration('chrome')}>
                  <img
                    src="/browsers/chrome.svg"
                    alt="Chrome"
                    className="w-4 h-4 mr-2 shrink-0"
                  />
                  <span>Google Chrome</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onOpenBrowserIntegration('firefox')}>
                  <img
                    src="/browsers/firefox.svg"
                    alt="Firefox"
                    className="w-4 h-4 mr-2 shrink-0"
                  />
                  <span>Mozilla Firefox</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onOpenBrowserIntegration('edge')}>
                  <img src="/browsers/edge.svg" alt="Edge" className="w-4 h-4 mr-2 shrink-0" />
                  <span>Microsoft Edge</span>
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>

            <DropdownMenuItem onClick={() => onOpenModal('perHostSettings')}>
              <Globe className="w-4 h-4 mr-2 text-primary" />
              <span>{t('menu.perHostSettings')}</span>
            </DropdownMenuItem>

            <DropdownMenuItem onClick={onOpenSettings}>
              <Settings className="w-4 h-4 mr-2 text-primary" />
              <span>{t('menu.settings')}</span>
              <DropdownMenuShortcut>
                {modLabel === '⌘' ? '⌘⌥S' : 'Ctrl+Alt+S'}
              </DropdownMenuShortcut>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <DropdownMenuItem onClick={onCheckMediaToolsPresence}>
              <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-500" />
              <span>{t('menu.checkYtdlp')}</span>
            </DropdownMenuItem>

            <DropdownMenuItem onClick={onInstallYTDLP}>
              <CloudDownload className="w-4 h-4 mr-2 text-primary" />
              <span>{t('menu.installYtdlp')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Help menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {t('menu.help')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onClick={onOpenGitHubSupport}>
              <svg className="w-4 h-4 mr-2 fill-current" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              <span>{t('menu.supportCommunity')}</span>
            </DropdownMenuItem>

            <DropdownMenuItem onClick={() => onOpenModal('openSourceLicenses')}>
              <Scale className="w-4 h-4 mr-2 text-primary" />
              <span>{t('menu.openSourceLicenses')}</span>
            </DropdownMenuItem>

            <DropdownMenuItem onClick={onCheckAppUpdate}>
              <RefreshCw className="w-4 h-4 mr-2 text-primary" />
              <span>{t('menu.checkForUpdate')}</span>
            </DropdownMenuItem>

            <DropdownMenuItem onClick={onCheckMediaToolsUpdate}>
              <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-500" />
              <span>{t('menu.checkYtdlpUpdate')}</span>
            </DropdownMenuItem>

            <DropdownMenuItem onClick={() => onOpenModal('about')}>
              <Info className="w-4 h-4 mr-2 text-primary" />
              <span>{t('menu.about') || 'About'}</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator />

            <div className="px-2 py-1 flex items-center justify-between text-[11px] text-muted-foreground select-none">
              <span>ThunderDM</span>
              <Badge variant="secondary" className="font-mono text-[10px] px-1.5 py-0">
                v{appVersion}
              </Badge>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>
    </div>
  );
};
