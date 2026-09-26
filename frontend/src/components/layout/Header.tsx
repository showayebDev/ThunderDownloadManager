/**
 * Application Header component composing top menus, search bar, window titlebar controls,
 * keyboard shortcuts, and update/media-tools dialogs.
 */
import React, { useEffect } from 'react';
import {
  WindowMinimise,
  WindowToggleMaximise,
  WindowHide,
  ExitApp,
  invoke,
  BrowserOpenURL,
} from '../../utils/tauriBridge';
import { useDownloadContext } from '../../context/DownloadContext';
import { useAppearance } from '../../context/AppearanceContext';
import { useAppUpdater } from './header/useAppUpdater';
import { HeaderMenus } from './header/HeaderMenus';
import { WindowControls } from './header/WindowControls';
import { UpdateBannerModal } from './header/UpdateBannerModal';

export const Header: React.FC = () => {
  const {
    searchQuery,
    setSearchQuery,
    openModal,
    stopAll,
    queues,
    startQueue,
    stopQueue,
    deleteAllMissing,
    deleteAllFinished,
    deleteAllUnfinished,
    deleteEntireList,
    selectedIds,
    activeModal,
  } = useDownloadContext();
  const { appearance, t } = useAppearance();

  const stoppedQueues = queues.filter((q) => !q.isRunning);
  const runningQueues = queues.filter((q) => q.isRunning);

  const {
    appVersion,
    updateModal,
    setUpdateModal,
    ytdlpModal,
    setYtdlpModal,
    handleCheckMediaToolsPresence,
    handleCheckMediaToolsUpdate,
    runStartupToolsCheckSilently,
    handleInstallYTDLP,
    handleCheckAppUpdate,
    handleStartAppUpdate,
    handleRestartAppForUpdate,
  } = useAppUpdater();

  const isMac =
    typeof navigator !== 'undefined' &&
    (/Mac|iPod|iPhone|iPad/.test(navigator.userAgent) ||
      (navigator as any).platform?.toUpperCase().indexOf('MAC') >= 0);
  const modLabel = isMac ? '⌘' : 'Ctrl+';

  const handleMinimize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      WindowMinimise();
    } catch (err) {
      console.error('Failed to minimize window', err);
    }
  };

  const handleMaximize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      WindowToggleMaximise();
    } catch (err) {
      console.error('Failed to maximize window', err);
    }
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (appearance.useSystemTray === false) {
        ExitApp();
      } else {
        WindowHide();
      }
    } catch (err) {
      console.error('Failed to close window', err);
    }
  };

  const handleImportFromClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = (await navigator.clipboard.readText()) || '';
        const trimmed = text.trim();
        if (
          trimmed.startsWith('http://') ||
          trimmed.startsWith('https://') ||
          trimmed.startsWith('ftp://') ||
          trimmed.startsWith('magnet:')
        ) {
          await invoke('process_new_download', trimmed);
          return;
        }
      }
    } catch (err) {
      console.warn('Could not read clipboard directly:', err);
    }
    openModal('newDownload');
  };

  const handleNewDownload = () => {
    openModal('newDownload');
  };

  const handleExit = () => {
    ExitApp();
  };

  const handleOpenSettings = () => {
    openModal('settings');
  };

  const handleOpenBrowserIntegration = (_browser: 'chrome' | 'firefox' | 'edge') => {
    if (_browser === 'firefox') {
      BrowserOpenURL('https://addons.mozilla.org/en-US/firefox/addon/thunder-download-manager/');
      return;
    }
    if (_browser === 'chrome' || _browser === 'edge') {
      BrowserOpenURL(
        'https://chromewebstore.google.com/detail/thunder-download-manager/inhdofocnelidaaldldkpoljakofkbpe'
      );
      return;
    }
    openModal('settings');
  };

  const handleOpenGitHubSupport = () => {
    BrowserOpenURL('https://github.com/showayebDev/ThunderDownloadManager');
  };

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (e.key === 'Escape') {
        if (
          ytdlpModal?.open &&
          !ytdlpModal.loading &&
          (!ytdlpModal.isMandatorySetup || ytdlpModal.success)
        ) {
          setYtdlpModal(null);
        }
        if (
          updateModal?.open &&
          updateModal.stage !== 'checking' &&
          updateModal.stage !== 'downloading'
        ) {
          setUpdateModal(null);
          runStartupToolsCheckSilently();
        }
        return;
      }

      if (modKey && e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        openModal('settings');
        return;
      }

      if (modKey && (e.key === 'q' || e.key === 'Q')) {
        e.preventDefault();
        ExitApp();
        return;
      }

      if (modKey && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault();
        openModal('newDownload');
        return;
      }

      if (modKey && (e.key === 'b' || e.key === 'B')) {
        e.preventDefault();
        openModal('batchDownload');
        return;
      }

      const target = e.target as HTMLElement;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (!isTyping && modKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        handleImportFromClipboard();
        return;
      }

      if (!isTyping && (e.key === 'Delete' || e.key === 'Del') && !activeModal) {
        if (selectedIds && selectedIds.size > 0) {
          e.preventDefault();
          openModal('deleteConfirm');
          return;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMac, ytdlpModal, updateModal, selectedIds, activeModal]);

  return (
    <header
      className={`${
        appearance.compactTopBar ? 'h-9' : 'h-11'
      } bg-card border-b border-border pl-2.5 pr-2 flex items-center justify-between select-none text-muted-foreground text-xs shrink-0 cursor-default transition-all duration-150 z-40 relative`}
    >
      {/* Top 6px non-draggable resize zone to allow native OS top window resizing */}
      <div
        className="absolute top-0 left-0 right-0 h-1.5 z-50 pointer-events-auto cursor-ns-resize"
        style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
      />

      {/* Main draggable background region for moving window (below the 6px top resize zone) */}
      <div
        className="absolute inset-x-0 top-1.5 bottom-0 z-0"
        style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
      />

      {/* Logo and menus */}
      <HeaderMenus
        t={t}
        modLabel={modLabel}
        appVersion={appVersion}
        stoppedQueues={stoppedQueues}
        runningQueues={runningQueues}
        onNewDownload={handleNewDownload}
        onImportFromClipboard={handleImportFromClipboard}
        onOpenModal={openModal}
        onExit={handleExit}
        onStartQueue={startQueue}
        onStopQueue={stopQueue}
        onStopAll={stopAll}
        onDeleteAllMissing={deleteAllMissing}
        onDeleteAllFinished={deleteAllFinished}
        onDeleteAllUnfinished={deleteAllUnfinished}
        onDeleteEntireList={deleteEntireList}
        onOpenBrowserIntegration={handleOpenBrowserIntegration}
        onOpenSettings={handleOpenSettings}
        onCheckMediaToolsPresence={handleCheckMediaToolsPresence}
        onInstallYTDLP={handleInstallYTDLP}
        onOpenGitHubSupport={handleOpenGitHubSupport}
        onCheckAppUpdate={handleCheckAppUpdate}
        onCheckMediaToolsUpdate={handleCheckMediaToolsUpdate}
      />

      {/* Center title bar */}
      <div
        style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
        className="text-[11.5px] font-semibold tracking-wide text-muted-foreground pointer-events-none hidden sm:block relative z-10"
      >
        Thunder Download Manager
      </div>

      {/* Right controls */}
      <WindowControls
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchPlaceholder={t('header.searchPlaceholder')}
        onMinimize={handleMinimize}
        onMaximize={handleMaximize}
        onClose={handleClose}
      />

      {/* Media tools & app update dialogs */}
      <UpdateBannerModal
        ytdlpModal={ytdlpModal}
        setYtdlpModal={setYtdlpModal}
        updateModal={updateModal}
        setUpdateModal={setUpdateModal}
        onInstallYTDLP={handleInstallYTDLP}
        onStartAppUpdate={handleStartAppUpdate}
        onRestartAppForUpdate={handleRestartAppForUpdate}
        onDismissAppUpdate={runStartupToolsCheckSilently}
      />
    </header>
  );
};
