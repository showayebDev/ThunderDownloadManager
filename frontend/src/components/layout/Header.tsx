import React, { useState, useEffect } from 'react';
import { 
  Search, 
  Minus, 
  Square, 
  X, 
  Plus, 
  Clipboard, 
  Layers,
  LogOut, 
  Settings, 
  Globe, 
  CloudDownload, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  RefreshCw,
  Scale,
  Info,
  Trash2,
  ListStart,
  PauseCircle,
  Square as SquareIcon
} from 'lucide-react';
import { Events } from '@wailsio/runtime';
import { WindowMinimise, WindowToggleMaximise, WindowHide, ExitApp, invoke, BrowserOpenURL } from '../../utils/tauriBridge';
import { useDownloadContext } from '../../context/DownloadContext';
import { useAppearance } from '../../context/AppearanceContext';
import { MarkdownRenderer } from '../common/MarkdownRenderer';
import appLicenseData from '../../data/appLicense.json';

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
} from '../ui/dropdown-menu';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../ui/dialog';
import { Progress } from '../ui/progress';
import { Badge } from '../ui/badge';

let hasCheckedStartupAppUpdate = false;

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
  const [appVersion, setAppVersion] = useState<string>((appLicenseData as any).version || '1.0.6');

  const stoppedQueues = queues.filter((q) => !q.isRunning);
  const runningQueues = queues.filter((q) => q.isRunning);

  const [updateModal, setUpdateModal] = useState<{
    open: boolean;
    stage: 'checking' | 'uptodate' | 'available' | 'downloading' | 'ready' | 'error';
    title: string;
    message: string;
    latestVersion?: string;
    currentVersion?: string;
    releaseNotes?: string;
    releaseName?: string;
    publishedAt?: string;
    artifactSize?: number;
    progressPercent?: number;
    downloadedBytes?: number;
    totalBytes?: number;
    error?: string;
  } | null>(null);

  const [ytdlpModal, setYtdlpModal] = useState<{
    open: boolean;
    title: string;
    message: string;
    loading: boolean;
    success?: boolean;
    canInstall?: boolean;
    isMandatorySetup?: boolean;
    progressPercent?: number;
    downloadedBytes?: number;
    totalBytes?: number;
    stage?: string;
  } | null>(null);

  const isMac = typeof navigator !== 'undefined' && (/Mac|iPod|iPhone|iPad/.test(navigator.userAgent) || (navigator as any).platform?.toUpperCase().indexOf('MAC') >= 0);
  const modLabel = isMac ? '⌘' : 'Ctrl+';

  const handleMinimize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      WindowMinimise();
    } catch (err) {
      console.error("Failed to minimize window", err);
    }
  };

  const handleMaximize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      WindowToggleMaximise();
    } catch (err) {
      console.error("Failed to maximize window", err);
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
      console.error("Failed to close window", err);
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
    openModal('settings');
  };

  const handleOpenGitHubSupport = () => {
    BrowserOpenURL('https://github.com/showayebDev/ThunderDownloadManager');
  };

  const handleCheckMediaToolsPresence = async () => {
    setYtdlpModal({
      open: true,
      title: 'Checking Media Tools...',
      message: 'Checking for installed YT-DLP and FFmpeg binaries on your PC...',
      loading: true,
    });

    try {
      const res: any = await invoke('check_ytdlp');
      const ytdlpInstalled = Boolean(res?.ytdlpInstalled ?? res?.installed);
      const ffmpegInstalled = Boolean(res?.ffmpegInstalled);
      const ytdlpVer = res?.ytdlpVersion || res?.version || '';
      const ffmpegVer = res?.ffmpegVersion || '';

      const details = [
        ytdlpInstalled ? `YT-DLP: ${ytdlpVer || 'Installed'}` : 'YT-DLP: Not Found',
        ffmpegInstalled ? `FFmpeg: ${ffmpegVer || 'Installed'}` : 'FFmpeg: Not Found'
      ].join(' | ');

      if (ytdlpInstalled && ffmpegInstalled) {
        setYtdlpModal({
          open: true,
          title: 'Media Tools are Installed',
          message: `All required media tools are installed and ready on your PC (${details}).`,
          loading: false,
          success: true,
        });
      } else if (!ytdlpInstalled && !ffmpegInstalled) {
        setYtdlpModal({
          open: true,
          title: 'Media Tools Not Found',
          message: 'Neither YT-DLP nor FFmpeg were found in the application location. Would you like to install them now?',
          loading: false,
          success: false,
          canInstall: true,
        });
      } else {
        setYtdlpModal({
          open: true,
          title: 'Media Tools Incomplete',
          message: `Some media tools are missing (${details}). Would you like to install the missing tools now?`,
          loading: false,
          success: false,
          canInstall: true,
        });
      }
    } catch (err: any) {
      setYtdlpModal({
        open: true,
        title: 'Check Error',
        message: err?.message || 'Could not verify media tools on your system.',
        loading: false,
        success: false,
      });
    }
  };

  const handleCheckMediaToolsUpdate = async () => {
    setYtdlpModal({
      open: true,
      title: 'Checking Media Tools Update...',
      message: 'Connecting to server and checking for YT-DLP and FFmpeg updates...',
      loading: true,
    });

    try {
      const res: any = await invoke('check_ytdlp_update');
      const ytdlpVer = res?.currentVersion || res?.ytdlpVersion || '';
      const ffmpegVer = res?.ffmpegVersion || '';
      const details = [
        ytdlpVer ? `YT-DLP: ${ytdlpVer}` : 'YT-DLP: Missing',
        ffmpegVer ? `FFmpeg: ${ffmpegVer}` : 'FFmpeg: Missing'
      ].join(' | ');

      if (!res?.installed && !res?.ffmpegInstalled) {
        setYtdlpModal({
          open: true,
          title: 'Media Tools Not Found',
          message: 'YT-DLP and FFmpeg are not installed on your PC. Would you like to install them now?',
          loading: false,
          success: false,
          canInstall: true,
        });
      } else if (!res?.installed || !res?.ffmpegInstalled) {
        setYtdlpModal({
          open: true,
          title: 'Media Tools Incomplete',
          message: `Current Status (${details}). Would you like to complete the installation now?`,
          loading: false,
          success: false,
          canInstall: true,
        });
      } else if (res?.alreadyUpdated) {
        setYtdlpModal({
          open: true,
          title: 'Media Tools are Up to Date',
          message: `Media tools are already on the latest versions (${details}). No update needed.`,
          loading: false,
          success: true,
        });
      } else if (res?.updated) {
        setYtdlpModal({
          open: true,
          title: 'Media Tools Updated Successfully',
          message: `Media engines have been updated to the latest versions (${details})!`,
          loading: false,
          success: true,
        });
      } else {
        setYtdlpModal({
          open: true,
          title: 'Media Tools Status',
          message: res?.message || `Current status: ${details}`,
          loading: false,
          success: true,
        });
      }
    } catch (err: any) {
      setYtdlpModal({
        open: true,
        title: 'Update Check Error',
        message: err?.message || 'Could not verify or update media tools.',
        loading: false,
        success: false,
      });
    }
  };

  const runBackgroundMediaToolsUpdate = async () => {
    try {
      const res: any = await invoke('check_ytdlp_update');
      if (res?.updated) {
        const ytdlpVer = res?.currentVersion || res?.ytdlpVersion || '';
        const ffmpegVer = res?.ffmpegVersion || '';
        const details = [
          ytdlpVer ? `YT-DLP: ${ytdlpVer}` : '',
          ffmpegVer ? `FFmpeg: ${ffmpegVer}` : ''
        ].filter(Boolean).join(' | ');

        setYtdlpModal({
          open: true,
          title: 'Media Tools Updated',
          message: `YT-DLP and FFmpeg have been updated to the latest versions in the background${details ? ` (${details})` : ''}.`,
          loading: false,
          success: true,
        });
      }
    } catch (e) {
      console.warn('Background media tools update check silent error:', e);
    }
  };

  const runAppUpdateCheckSilently = async () => {
    if (hasCheckedStartupAppUpdate) return;
    hasCheckedStartupAppUpdate = true;
    try {
      const appRes: any = await invoke('check_app_update');
      if (appRes?.hasUpdate) {
        setUpdateModal({
          open: true,
          stage: 'available',
          title: 'New Update Available!',
          message: `A newer version (v${appRes.latestVersion}) of ThunderDM is ready to download.`,
          currentVersion: appRes.currentVersion || appVersion,
          latestVersion: appRes.latestVersion,
          releaseName: appRes.releaseName,
          releaseNotes: appRes.releaseNotes,
          publishedAt: appRes.publishedAt,
          artifactSize: appRes.artifactSize,
        });
      }
    } catch {
      // Completely silent on startup check error
    }
  };

  const handleInstallYTDLP = async () => {
    const wasMandatory = Boolean(ytdlpModal?.isMandatorySetup);
    setYtdlpModal({
      open: true,
      title: 'Installing Media Tools (YT-DLP & FFmpeg)...',
      message: 'Downloading and setting up portable YT-DLP and FFmpeg binaries for your system...',
      loading: true,
      isMandatorySetup: wasMandatory,
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      stage: 'Initializing download...',
    });

    try {
      const res: any = await invoke('install_ytdlp');
      const ytdlpVer = res?.ytdlpVersion || res?.version || '';
      const ffmpegVer = res?.ffmpegVersion || '';
      const details = [
        ytdlpVer ? `YT-DLP: ${ytdlpVer}` : '',
        ffmpegVer ? `FFmpeg: ${ffmpegVer}` : ''
      ].filter(Boolean).join(' | ');

      if (res?.alreadyInstalled || (res?.allInstalled && res?.alreadyInstalled)) {
        setYtdlpModal({
          open: true,
          title: 'Media Tools Already Installed',
          message: `YT-DLP and FFmpeg are already installed and ready on your PC${details ? ` (${details})` : ''}.`,
          loading: false,
          success: true,
          isMandatorySetup: false,
        });
        if (wasMandatory) {
          runAppUpdateCheckSilently();
        }
      } else if (res?.success) {
        setYtdlpModal({
          open: true,
          title: 'Installation Complete',
          message: `Media tools (YT-DLP & FFmpeg) were successfully installed${details ? ` (${details})` : ''}! You can now use all features of ThunderDM.`,
          loading: false,
          success: true,
          isMandatorySetup: false,
        });
        if (wasMandatory) {
          runAppUpdateCheckSilently();
        }
      } else {
        setYtdlpModal({
          open: true,
          title: 'Installation Notice',
          message: res?.error || 'Could not complete installation. Please check your internet connection.',
          loading: false,
          success: false,
          canInstall: true,
          isMandatorySetup: wasMandatory,
        });
      }
    } catch (err: any) {
      setYtdlpModal({
        open: true,
        title: 'Installation Error',
        message: err?.message || 'Failed to install media tools.',
        loading: false,
        success: false,
        canInstall: true,
        isMandatorySetup: wasMandatory,
      });
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  useEffect(() => {
    let isMounted = true;
    async function loadVersionAndStartupSequence() {
      try {
        const v = await invoke<string>('get_app_version');
        if (v && isMounted) setAppVersion(v);
      } catch {}

      try {
        const mediaCheck: any = await invoke('check_ytdlp');
        const allInstalled = Boolean(mediaCheck?.allInstalled ?? (mediaCheck?.installed && mediaCheck?.ffmpegInstalled));
        if (!allInstalled) {
          if (isMounted) {
            setYtdlpModal({
              open: true,
              title: 'Welcome to ThunderDM - Initial Setup',
              message: 'ThunderDM requires portable YT-DLP and FFmpeg binaries to download high-speed streams, merge audio/video, and convert media. Please install them to proceed.',
              loading: false,
              success: false,
              canInstall: true,
              isMandatorySetup: true,
            });
          }
          return;
        }

        if (!hasCheckedStartupAppUpdate) {
          hasCheckedStartupAppUpdate = true;
          const appRes: any = await invoke('check_app_update');
          if (appRes?.hasUpdate && isMounted) {
            setUpdateModal({
              open: true,
              stage: 'available',
              title: 'New Update Available!',
              message: `A newer version (v${appRes.latestVersion}) of ThunderDM is ready to download.`,
              currentVersion: appRes.currentVersion || '1.0.0-beta',
              latestVersion: appRes.latestVersion,
              releaseName: appRes.releaseName,
              releaseNotes: appRes.releaseNotes,
              publishedAt: appRes.publishedAt,
              artifactSize: appRes.artifactSize,
            });
          }
        }
      } catch {
        // Completely silent on startup check error
      }
    }
    loadVersionAndStartupSequence();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const unsubProgress = Events.On('wails:updater:progress', (e: any) => {
      const p = e?.data?.percent || 0;
      const dl = e?.data?.downloaded || 0;
      const total = e?.data?.total || 0;
      setUpdateModal((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          stage: 'downloading',
          progressPercent: p,
          downloadedBytes: dl,
          totalBytes: total,
          message: `Downloading ThunderDM update (${p}%)...`,
        };
      });
    });

    const unsubReady = Events.On('wails:updater:ready', () => {
      setUpdateModal((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          stage: 'ready',
          title: 'Update Ready to Install',
          message: `ThunderDM v${prev.latestVersion || ''} has been downloaded and verified. Restart the application to apply the update.`,
        };
      });
    });

    const unsubError = Events.On('wails:updater:error', (e: any) => {
      setUpdateModal((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          stage: 'error',
          title: 'Update Failed',
          message: e?.data?.message || 'An error occurred during update.',
          error: e?.data?.message,
        };
      });
    });

    const unsubMediaToolsProgress = Events.On('media-tools:progress', (e: any) => {
      const p = e?.data?.percent !== undefined ? Number(e?.data?.percent) : 0;
      const dl = e?.data?.downloaded !== undefined ? Number(e?.data?.downloaded) : 0;
      const total = e?.data?.total !== undefined ? Number(e?.data?.total) : 0;
      const stage = e?.data?.stage || '';
      setYtdlpModal((prev) => {
        if (!prev || !prev.open || !prev.loading) return prev;
        return {
          ...prev,
          progressPercent: p,
          downloadedBytes: dl,
          totalBytes: total,
          stage: stage,
          message: stage ? `${stage}${total > 0 ? ` (${p}%)` : ''}` : prev.message,
        };
      });
    });

    const unsubTray = Events.On('trigger-check-update', () => {
      handleCheckAppUpdate();
    });

    return () => {
      unsubProgress();
      unsubReady();
      unsubError();
      unsubMediaToolsProgress();
      unsubTray();
    };
  }, [appVersion]);

  const handleCheckAppUpdate = async () => {
    setUpdateModal({
      open: true,
      stage: 'checking',
      title: 'Checking for Updates...',
      message: 'Connecting to GitHub Releases...',
    });

    try {
      const res: any = await invoke('check_app_update');
      if (res?.hasUpdate) {
        setUpdateModal({
          open: true,
          stage: 'available',
          title: 'New Update Available!',
          message: `A newer version (v${res.latestVersion}) of ThunderDM is ready to download.`,
          currentVersion: res.currentVersion || appVersion,
          latestVersion: res.latestVersion,
          releaseName: res.releaseName,
          releaseNotes: res.releaseNotes,
          publishedAt: res.publishedAt,
          artifactSize: res.artifactSize,
        });
      } else if (res?.success) {
        setUpdateModal({
          open: true,
          stage: 'uptodate',
          title: "You're Up to Date",
          message: `ThunderDM v${res.currentVersion || appVersion} is currently the newest version available.`,
          currentVersion: res.currentVersion || appVersion,
        });
      } else {
        setUpdateModal({
          open: true,
          stage: 'error',
          title: 'Update Check Notice',
          message: res?.error || 'Could not verify updates at this moment.',
          error: res?.error,
        });
      }
    } catch (err: any) {
      setUpdateModal({
        open: true,
        stage: 'error',
        title: 'Update Check Failed',
        message: err?.message || 'Failed to communicate with update server.',
        error: err?.message,
      });
    }
  };

  const handleStartAppUpdate = async () => {
    if (!updateModal) return;
    const total = updateModal.artifactSize || 0;

    setUpdateModal((prev) => prev ? {
      ...prev,
      stage: 'downloading',
      title: 'Downloading Update...',
      message: `Downloading ThunderDM v${prev.latestVersion}...`,
      progressPercent: 5,
      downloadedBytes: total ? Math.floor(total * 0.05) : 0,
      totalBytes: total,
    } : null);

    let currentPct = 5;
    const interval = setInterval(() => {
      currentPct += Math.floor(Math.random() * 8) + 4;
      if (currentPct > 92) currentPct = 92;
      setUpdateModal((prev) => (prev && prev.stage === 'downloading' ? {
        ...prev,
        progressPercent: currentPct,
        downloadedBytes: total ? Math.floor((total * currentPct) / 100) : 0,
        totalBytes: total,
      } : prev));
    }, 250);

    try {
      const res: any = await invoke('install_app_update');
      clearInterval(interval);

      if (res?.success) {
        setUpdateModal((prev) => prev ? {
          ...prev,
          stage: 'ready',
          title: 'Update Ready to Install',
          message: `ThunderDM v${prev.latestVersion} has been downloaded successfully. Click "Restart & Apply Update" to install and launch the new version.`,
          progressPercent: 100,
          downloadedBytes: total,
          totalBytes: total,
        } : null);
      } else {
        setUpdateModal((prev) => prev ? {
          ...prev,
          stage: 'error',
          title: 'Download Failed',
          message: res?.error || 'Failed to download update package. Please try again.',
        } : null);
      }
    } catch (err: any) {
      clearInterval(interval);
      setUpdateModal((prev) => prev ? {
        ...prev,
        stage: 'error',
        title: 'Download Error',
        message: err?.message || 'Failed to download update package.',
      } : null);
    }
  };

  const handleRestartAppForUpdate = async () => {
    try {
      await invoke('restart_app_for_update');
    } catch (err) {
      console.error('Failed to restart for update:', err);
    }
  };

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (e.key === 'Escape') {
        if (ytdlpModal?.open && !ytdlpModal.loading && (!ytdlpModal.isMandatorySetup || ytdlpModal.success)) {
          setYtdlpModal(null);
        }
        if (updateModal?.open && updateModal.stage !== 'checking' && updateModal.stage !== 'downloading') {
          setUpdateModal(null);
          runBackgroundMediaToolsUpdate();
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
      const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
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
      className={`${appearance.compactTopBar ? 'h-9' : 'h-11'} bg-card border-b border-border pl-2.5 pr-2 flex items-center justify-between select-none text-muted-foreground text-xs shrink-0 cursor-default transition-all duration-150 z-40 relative`}
    >
      {/* Top 5px non-draggable resize zone to allow native OS top window resizing */}
      <div 
        className="absolute top-0 left-0 right-0 h-1.5 z-50 pointer-events-auto cursor-ns-resize"
        style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
      />

      {/* Main draggable background region for moving window (below the 5px top resize zone) */}
      <div 
        className="absolute inset-x-0 top-1.5 bottom-0 z-0"
        style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
      />

      {/* Logo and menus */}
      <div className="flex items-center space-x-3 relative z-10" style={{ '--wails-draggable': 'drag' } as React.CSSProperties}>
        {/* Application icon */}
        <div className="flex items-center space-x-2" style={{ '--wails-draggable': 'drag' } as React.CSSProperties}>
          <img 
            src="/icon.svg" 
            alt="ThunderDM Logo" 
            className="w-5 h-5 rounded-md shadow-xs object-cover pointer-events-none" 
          />
        </div>

        {/* Top menu bar using shadcn DropdownMenu */}
        <nav className="flex items-center space-x-0.5 text-xs text-foreground font-medium" style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}>
          {/* File menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground">
                {t('menu.file')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={handleNewDownload}>
                <Plus className="w-4 h-4 mr-2 text-primary" />
                <span>{t('menu.newDownload')}</span>
                <DropdownMenuShortcut>{modLabel}N</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleImportFromClipboard}>
                <Clipboard className="w-4 h-4 mr-2 text-primary" />
                <span>{t('menu.importClipboard')}</span>
                <DropdownMenuShortcut>{modLabel}V</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openModal('batchDownload')}>
                <Layers className="w-4 h-4 mr-2 text-primary" />
                <span>{t('menu.batchDownload') || 'Batch Download'}</span>
                <DropdownMenuShortcut>{modLabel}B</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleExit} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                <LogOut className="w-4 h-4 mr-2" />
                <span>{t('menu.exit')}</span>
                <DropdownMenuShortcut>{modLabel}Q</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Tasks menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground">
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
                      <DropdownMenuItem key={q.id} onClick={() => startQueue(q.id)}>
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
                      <DropdownMenuItem key={q.id} onClick={() => stopQueue(q.id)}>
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

              <DropdownMenuItem onClick={stopAll}>
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
                  <DropdownMenuItem onClick={deleteAllMissing}>
                    <span>{t('menu.deleteMissing')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={deleteAllFinished}>
                    <span>{t('menu.deleteFinished')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={deleteAllUnfinished}>
                    <span>{t('menu.deleteUnfinished')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={deleteEntireList} className="text-destructive focus:text-destructive">
                    <span>{t('menu.deleteEntireList')}</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Tools menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground">
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
                  <DropdownMenuItem onClick={() => handleOpenBrowserIntegration('chrome')}>
                    <img src="/browsers/chrome.svg" alt="Chrome" className="w-4 h-4 mr-2 shrink-0" />
                    <span>Google Chrome</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleOpenBrowserIntegration('firefox')}>
                    <img src="/browsers/firefox.svg" alt="Firefox" className="w-4 h-4 mr-2 shrink-0" />
                    <span>Mozilla Firefox</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleOpenBrowserIntegration('edge')}>
                    <img src="/browsers/edge.svg" alt="Edge" className="w-4 h-4 mr-2 shrink-0" />
                    <span>Microsoft Edge</span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuItem onClick={() => openModal('perHostSettings')}>
                <Globe className="w-4 h-4 mr-2 text-primary" />
                <span>{t('menu.perHostSettings')}</span>
              </DropdownMenuItem>

              <DropdownMenuItem onClick={handleOpenSettings}>
                <Settings className="w-4 h-4 mr-2 text-primary" />
                <span>{t('menu.settings')}</span>
                <DropdownMenuShortcut>{modLabel === '⌘' ? '⌘⌥S' : 'Ctrl+Alt+S'}</DropdownMenuShortcut>
              </DropdownMenuItem>

              <DropdownMenuSeparator />

              <DropdownMenuItem onClick={handleCheckMediaToolsPresence}>
                <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-500" />
                <span>{t('menu.checkYtdlp')}</span>
              </DropdownMenuItem>

              <DropdownMenuItem onClick={handleInstallYTDLP}>
                <CloudDownload className="w-4 h-4 mr-2 text-primary" />
                <span>{t('menu.installYtdlp')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Help menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground">
                {t('menu.help')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={handleOpenGitHubSupport}>
                <svg className="w-4 h-4 mr-2 fill-current" viewBox="0 0 24 24">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                </svg>
                <span>{t('menu.supportCommunity')}</span>
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => openModal('openSourceLicenses')}>
                <Scale className="w-4 h-4 mr-2 text-primary" />
                <span>{t('menu.openSourceLicenses')}</span>
              </DropdownMenuItem>

              <DropdownMenuItem onClick={handleCheckAppUpdate}>
                <RefreshCw className="w-4 h-4 mr-2 text-primary" />
                <span>{t('menu.checkForUpdate')}</span>
              </DropdownMenuItem>

              <DropdownMenuItem onClick={handleCheckMediaToolsUpdate}>
                <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-500" />
                <span>{t('menu.checkYtdlpUpdate')}</span>
              </DropdownMenuItem>

              <DropdownMenuItem onClick={() => openModal('about')}>
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

      {/* Center title bar */}
      <div 
        style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
        className="text-[11.5px] font-semibold tracking-wide text-muted-foreground pointer-events-none hidden sm:block relative z-10"
      >
        Thunder Download Manager
      </div>

      {/* Right controls */}
      <div className="flex items-center space-x-2 relative z-10" style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}>
        {/* Search input */}
        <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('header.searchPlaceholder')}
            className="w-44 h-7 pl-8 pr-2.5 py-0 text-xs bg-muted/60 border-border focus-visible:ring-primary"
          />
        </div>

        {/* Window controls */}
        <div className="flex items-center space-x-0.5 pl-1" onMouseDown={(e) => e.stopPropagation()}>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleMinimize}
            className="w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted"
            title="Minimize"
          >
            <Minus className="w-3.5 h-3.5" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleMaximize}
            className="w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted"
            title="Maximize"
          >
            <Square className="w-3 h-3" />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleClose}
            className="w-7 h-7 text-muted-foreground hover:bg-red-500 hover:text-white dark:hover:bg-red-600 transition-colors"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Media tools setup modal using shadcn Dialog */}
      {ytdlpModal?.open && (
        <Dialog open={ytdlpModal.open} onOpenChange={(open) => {
          if (!open && !ytdlpModal.loading && (!ytdlpModal.isMandatorySetup || ytdlpModal.success)) {
            setYtdlpModal(null);
          }
        }}>
          <DialogContent className="max-w-[420px] p-6 text-center space-y-4">
            <div className="flex flex-col items-center text-center space-y-3">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                ytdlpModal.loading 
                  ? 'bg-primary/20 text-primary border border-primary/30' 
                  : ytdlpModal.success 
                  ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30' 
                  : 'bg-amber-500/20 text-amber-500 border border-amber-500/30'
              }`}>
                {ytdlpModal.loading ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : ytdlpModal.success ? (
                  <CheckCircle2 className="w-6 h-6" />
                ) : (
                  <AlertCircle className="w-6 h-6" />
                )}
              </div>

              <DialogHeader>
                <DialogTitle className="text-center text-base">{ytdlpModal.title}</DialogTitle>
                <DialogDescription className="text-center text-xs leading-relaxed">
                  {ytdlpModal.message}
                </DialogDescription>
              </DialogHeader>
            </div>

            {ytdlpModal.loading && (
              <div className="space-y-2 pt-1">
                <Progress value={Math.min(100, Math.max(ytdlpModal.progressPercent || 0, 5))} className="h-2" />
                <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
                  <span>{ytdlpModal.progressPercent !== undefined && ytdlpModal.progressPercent > 0 ? `${ytdlpModal.progressPercent}%` : 'Please wait...'}</span>
                  <span>
                    {ytdlpModal.downloadedBytes && ytdlpModal.totalBytes && ytdlpModal.totalBytes > 0
                      ? `${formatBytes(ytdlpModal.downloadedBytes)} / ${formatBytes(ytdlpModal.totalBytes)}`
                      : ytdlpModal.downloadedBytes && ytdlpModal.downloadedBytes > 0
                      ? formatBytes(ytdlpModal.downloadedBytes)
                      : ytdlpModal.stage || 'Downloading package...'}
                  </span>
                </div>
              </div>
            )}

            <DialogFooter className="sm:justify-center gap-2 pt-2">
              {ytdlpModal.canInstall && (
                <Button
                  disabled={ytdlpModal.loading}
                  onClick={handleInstallYTDLP}
                  className="w-full"
                >
                  {ytdlpModal.loading ? 'Installing...' : 'Install Media Tools Now'}
                </Button>
              )}
              {(!ytdlpModal.isMandatorySetup || ytdlpModal.success) && (
                <Button
                  disabled={ytdlpModal.loading}
                  variant={ytdlpModal.canInstall ? 'outline' : 'default'}
                  onClick={() => setYtdlpModal(null)}
                  className="w-full"
                >
                  {ytdlpModal.loading ? 'Working...' : ytdlpModal.success ? 'Get Started' : 'OK'}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* App update dialog using shadcn Dialog */}
      {updateModal?.open && (
        <Dialog open={updateModal.open} onOpenChange={(open) => {
          if (!open && updateModal.stage !== 'checking' && updateModal.stage !== 'downloading') {
            setUpdateModal(null);
            runBackgroundMediaToolsUpdate();
          }
        }}>
          <DialogContent className="max-w-[440px] p-6 space-y-4">
            <div className="flex flex-col items-center text-center space-y-3">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
                updateModal.stage === 'checking' || updateModal.stage === 'downloading'
                  ? 'bg-primary/20 text-primary border border-primary/30' 
                  : updateModal.stage === 'uptodate' || updateModal.stage === 'ready'
                  ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30'
                  : updateModal.stage === 'available'
                  ? 'bg-primary/20 p-2 border border-primary/30 shadow-md'
                  : 'bg-destructive/20 text-destructive border border-destructive/30'
              }`}>
                {updateModal.stage === 'checking' || updateModal.stage === 'downloading' ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : updateModal.stage === 'uptodate' || updateModal.stage === 'ready' ? (
                  <CheckCircle2 className="w-6 h-6" />
                ) : updateModal.stage === 'available' ? (
                  <img src="/icon.svg" alt="Logo" className="w-8 h-8 rounded-lg object-contain" />
                ) : (
                  <AlertCircle className="w-6 h-6" />
                )}
              </div>

              <DialogHeader>
                <DialogTitle className="text-center text-base">{updateModal.title}</DialogTitle>
                <DialogDescription className="text-center text-xs leading-relaxed">
                  {updateModal.message}
                </DialogDescription>
              </DialogHeader>
            </div>

            {updateModal.stage === 'available' && (
              <div className="bg-muted/50 border border-border rounded-xl p-3.5 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-[11px]">Current Version:</span>
                  <span className="font-mono font-medium">v{updateModal.currentVersion}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-[11px]">Latest Version:</span>
                  <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 bg-emerald-500/10 font-mono">
                    v{updateModal.latestVersion}
                  </Badge>
                </div>
                {updateModal.artifactSize && updateModal.artifactSize > 0 ? (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-[11px]">Download Size:</span>
                    <span className="font-mono">{formatBytes(updateModal.artifactSize)}</span>
                  </div>
                ) : null}
                {updateModal.releaseNotes && (
                  <div className="pt-2 border-t border-border space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold">Release Notes:</span>
                      {updateModal.publishedAt && (
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {new Date(updateModal.publishedAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <div className="max-h-36 overflow-y-auto bg-background/80 p-2.5 rounded-lg border border-border text-foreground font-sans text-xs">
                      <MarkdownRenderer content={updateModal.releaseNotes} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {updateModal.stage === 'downloading' && (
              <div className="space-y-2 pt-1">
                <Progress value={updateModal.progressPercent || 0} className="h-2" />
                <div className="flex justify-between text-[11px] text-muted-foreground font-mono">
                  <span>{updateModal.progressPercent || 0}%</span>
                  <span>
                    {updateModal.downloadedBytes && updateModal.totalBytes 
                      ? `${formatBytes(updateModal.downloadedBytes)} / ${formatBytes(updateModal.totalBytes)}`
                      : 'Downloading...'}
                  </span>
                </div>
              </div>
            )}

            <DialogFooter className="gap-2 sm:justify-center pt-2">
              {updateModal.stage === 'available' && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setUpdateModal(null);
                      runBackgroundMediaToolsUpdate();
                    }}
                    className="flex-1"
                  >
                    Later
                  </Button>
                  <Button onClick={handleStartAppUpdate} className="flex-1">
                    Update Now
                  </Button>
                </>
              )}

              {updateModal.stage === 'ready' && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setUpdateModal(null);
                      runBackgroundMediaToolsUpdate();
                    }}
                    className="flex-1"
                  >
                    Later
                  </Button>
                  <Button onClick={handleRestartAppForUpdate} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white">
                    Restart & Apply Update
                  </Button>
                </>
              )}

              {(updateModal.stage === 'uptodate' || updateModal.stage === 'error') && (
                <Button
                  onClick={() => {
                    setUpdateModal(null);
                    runBackgroundMediaToolsUpdate();
                  }}
                  className="w-full"
                >
                  OK
                </Button>
              )}

              {(updateModal.stage === 'checking' || updateModal.stage === 'downloading') && (
                <Button disabled className="w-full opacity-80">
                  Please wait...
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </header>
  );
};
