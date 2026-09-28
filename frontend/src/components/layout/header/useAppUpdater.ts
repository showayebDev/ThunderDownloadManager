/**
 * Custom hook and state types for application auto-updates and portable media tools (YT-DLP & FFmpeg) checks.
 */
import { useState, useEffect } from 'react';
import { Events } from '@wailsio/runtime';
import { invoke } from '../../../utils/tauriBridge';
import appLicenseData from '../../../data/appLicense.json';

export interface UpdateModalState {
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
}

export interface YtdlpModalState {
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
}

let startupAppUpdatePromise: Promise<any> | null = null;
let startupToolsPromise: Promise<any> | null = null;

export const formatHeaderBytes = (bytes?: number): string => {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const formatUpdateError = (err: any): string => {
  const msg = typeof err === 'string' ? err : err?.message || err?.error || '';
  if (!msg)
    return 'Could not verify updates at this moment. Please check your internet connection.';
  if (
    msg.includes('rate limit exceeded') ||
    msg.includes('api 403') ||
    msg.includes('API rate limit')
  ) {
    return 'GitHub API rate limit exceeded for your network. Please wait a few minutes and try again.';
  }
  if (
    msg.includes('dial tcp') ||
    msg.includes('connection refused') ||
    msg.includes('no internet') ||
    msg.includes('network is unreachable')
  ) {
    return 'Could not connect to update servers. Please check your internet connection and try again.';
  }
  if (msg.includes('all providers failed')) {
    return 'Unable to retrieve release information from GitHub. Please try again shortly.';
  }
  return msg;
};

export const useAppUpdater = () => {
  const [appVersion, setAppVersion] = useState<string>(
    (appLicenseData as any).version || '1.0.6'
  );
  const [updateModal, setUpdateModal] = useState<UpdateModalState | null>(null);
  const [ytdlpModal, setYtdlpModal] = useState<YtdlpModalState | null>(null);

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
        ffmpegInstalled ? `FFmpeg: ${ffmpegVer || 'Installed'}` : 'FFmpeg: Not Found',
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
          message:
            'Neither YT-DLP nor FFmpeg were found in the application location. Would you like to install them now?',
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
        ffmpegVer ? `FFmpeg: ${ffmpegVer}` : 'FFmpeg: Missing',
      ].join(' | ');

      if (!res?.installed && !res?.ffmpegInstalled) {
        setYtdlpModal({
          open: true,
          title: 'Media Tools Not Found',
          message:
            'YT-DLP and FFmpeg are not installed on your PC. Would you like to install them now?',
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
      const friendly = formatUpdateError(err);
      setYtdlpModal({
        open: true,
        title: 'Update Check Error',
        message: friendly,
        loading: false,
        success: false,
      });
    }
  };

  const runStartupToolsCheckSilently = async () => {
    if (!startupToolsPromise) {
      startupToolsPromise = (async () => {
        try {
          const mediaCheck: any = await invoke('check_ytdlp');
          const allInstalled = Boolean(
            mediaCheck?.allInstalled ?? (mediaCheck?.installed && mediaCheck?.ffmpegInstalled)
          );
          if (!allInstalled) {
            console.warn(
              '[ThunderDM Startup] ⚠️ Portable media tools (YT-DLP & FFmpeg) not installed.'
            );
            return { needsSetup: true, mediaCheck };
          }

          // If already installed, silently check for updates in the background
          const res: any = await invoke('check_ytdlp_update');
          const ytdlpVer = res?.currentVersion || res?.ytdlpVersion || '';
          const ffmpegVer = res?.ffmpegVersion || '';
          const details = [
            ytdlpVer ? `YT-DLP: ${ytdlpVer}` : '',
            ffmpegVer ? `FFmpeg: ${ffmpegVer}` : '',
          ]
            .filter(Boolean)
            .join(' | ');

          if (res?.updated) {
            console.log(
              `%c[ThunderDM MediaTools]%c 🛠️ Media tools updated successfully: ${details}`,
              'color: #10b981; font-weight: bold;',
              'color: inherit;'
            );
          } else {
            console.log(
              `%c[ThunderDM MediaTools]%c 🛠️ Media tools ready & verified: ${details || 'OK'}`,
              'color: #10b981; font-weight: bold;',
              'color: inherit;'
            );
          }
          return { needsSetup: false, res };
        } catch (e) {
          console.warn('[ThunderDM MediaTools] Startup media tools check silent warning:', e);
          return { needsSetup: false, error: e };
        }
      })();
    }

    const toolsRes = await startupToolsPromise;
    if (toolsRes?.needsSetup) {
      setYtdlpModal({
        open: true,
        title: 'Welcome to ThunderDM - Initial Setup',
        message:
          'ThunderDM requires portable YT-DLP and FFmpeg binaries to download high-speed streams, merge audio/video, and convert media. Please install them to proceed.',
        loading: false,
        success: false,
        canInstall: true,
        isMandatorySetup: true,
      });
    }
  };

  const handleInstallYTDLP = async () => {
    const wasMandatory = Boolean(ytdlpModal?.isMandatorySetup);
    setYtdlpModal({
      open: true,
      title: 'Installing Media Tools (YT-DLP & FFmpeg)...',
      message:
        'Downloading and setting up portable YT-DLP and FFmpeg binaries for your system...',
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
        ffmpegVer ? `FFmpeg: ${ffmpegVer}` : '',
      ]
        .filter(Boolean)
        .join(' | ');

      if (res?.alreadyInstalled || (res?.allInstalled && res?.alreadyInstalled)) {
        setYtdlpModal({
          open: true,
          title: 'Media Tools Already Installed',
          message: `YT-DLP and FFmpeg are already installed and ready on your PC${
            details ? ` (${details})` : ''
          }.`,
          loading: false,
          success: true,
          isMandatorySetup: false,
        });
      } else if (res?.success) {
        setYtdlpModal({
          open: true,
          title: 'Installation Complete',
          message: `Media tools (YT-DLP & FFmpeg) were successfully installed${
            details ? ` (${details})` : ''
          }! You can now use all features of ThunderDM.`,
          loading: false,
          success: true,
          isMandatorySetup: false,
        });
      } else {
        setYtdlpModal({
          open: true,
          title: 'Installation Notice',
          message: formatUpdateError(res?.error),
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
        message: formatUpdateError(err),
        loading: false,
        success: false,
        canInstall: true,
        isMandatorySetup: wasMandatory,
      });
    }
  };

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
          message: `ThunderDM v${
            res.currentVersion || appVersion
          } is currently the newest version available.`,
          currentVersion: res.currentVersion || appVersion,
        });
      } else {
        const friendlyError = formatUpdateError(res?.error);
        setUpdateModal({
          open: true,
          stage: 'error',
          title: 'Update Check Notice',
          message: friendlyError,
          error: friendlyError,
        });
      }
    } catch (err: any) {
      const friendlyError = formatUpdateError(err);
      setUpdateModal({
        open: true,
        stage: 'error',
        title: 'Update Check Failed',
        message: friendlyError,
        error: friendlyError,
      });
    }
  };

  const handleStartAppUpdate = async () => {
    if (!updateModal) return;
    const total = updateModal.artifactSize || 0;

    setUpdateModal((prev) =>
      prev
        ? {
            ...prev,
            stage: 'downloading',
            title: 'Downloading Update...',
            message: `Downloading ThunderDM v${prev.latestVersion}...`,
            progressPercent: 0,
            downloadedBytes: 0,
            totalBytes: total,
          }
        : null
    );

    try {
      const res: any = await invoke('install_app_update');
      if (res?.success) {
        setUpdateModal((prev) =>
          prev
            ? {
                ...prev,
                stage: 'ready',
                title: 'Update Ready to Install',
                message: `ThunderDM v${prev.latestVersion} has been downloaded successfully. Click "Restart & Apply Update" to install and launch the new version.`,
                progressPercent: 100,
                downloadedBytes: prev.totalBytes || total,
                totalBytes: prev.totalBytes || total,
              }
            : null
        );
      } else {
        const friendly = formatUpdateError(res?.error);
        setUpdateModal((prev) =>
          prev
            ? {
                ...prev,
                stage: 'error',
                title: 'Download Failed',
                message: friendly,
                error: friendly,
              }
            : null
        );
      }
    } catch (err: any) {
      const friendly = formatUpdateError(err);
      setUpdateModal((prev) =>
        prev
          ? {
              ...prev,
              stage: 'error',
              title: 'Download Error',
              message: friendly,
              error: friendly,
            }
          : null
      );
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
    let isMounted = true;
    async function loadVersionAndStartupSequence() {
      let currentLoadedVersion = appVersion;
      try {
        const v = await invoke<string>('get_app_version');
        if (v) {
          currentLoadedVersion = v;
          if (isMounted) setAppVersion(v);
        }
      } catch {}

      if (!startupAppUpdatePromise) {
        console.log(
          '%c[ThunderDM Startup]%c 🚀 App initialized (v' +
            currentLoadedVersion +
            '). Checking updates & media tools in background...',
          'color: #3b82f6; font-weight: bold;',
          'color: inherit;'
        );
        startupAppUpdatePromise = invoke('check_app_update').catch((e) => {
          return { success: false, hasUpdate: false, error: e };
        });
      }

      const appRes: any = await startupAppUpdatePromise;
      if (!isMounted) return;

      if (appRes?.hasUpdate) {
        console.log(
          `%c[ThunderDM Updater]%c 🚀 New update found! Latest: v${
            appRes.latestVersion
          } (Current: v${appRes.currentVersion || currentLoadedVersion})`,
          'color: #3b82f6; font-weight: bold;',
          'color: inherit;'
        );
        setUpdateModal({
          open: true,
          stage: 'available',
          title: 'New Update Available!',
          message: `A newer version (v${appRes.latestVersion}) of ThunderDM is ready to download.`,
          currentVersion: appRes.currentVersion || currentLoadedVersion,
          latestVersion: appRes.latestVersion,
          releaseName: appRes.releaseName,
          releaseNotes: appRes.releaseNotes,
          publishedAt: appRes.publishedAt,
          artifactSize: appRes.artifactSize,
        });
        // Stop here! Defer media tools check until user installs or dismisses the app update
        return;
      } else if (appRes?.success) {
        console.log(
          `%c[ThunderDM Updater]%c ✅ App is up to date (v${
            appRes.currentVersion || currentLoadedVersion
          }).`,
          'color: #10b981; font-weight: bold;',
          'color: inherit;'
        );
      } else {
        console.log(
          `%c[ThunderDM Updater]%c ℹ️ Startup check status: ${formatUpdateError(appRes?.error)}`,
          'color: #64748b;',
          'color: inherit;'
        );
      }

      // 2. Only if NO main app update is found (or check failed silently), check and update media tools (YT-DLP & FFmpeg)
      if (isMounted) {
        runStartupToolsCheckSilently();
      }
    }
    loadVersionAndStartupSequence();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const unsubProgress = Events.On('wails:updater:progress', (e: any) => {
      const p = Math.min(100, Math.max(0, Number(e?.data?.percent || 0)));
      const dl = Number(e?.data?.downloaded || 0);
      const total = Number(e?.data?.total || 0);
      setUpdateModal((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          stage: 'downloading',
          progressPercent: p,
          downloadedBytes: dl > 0 ? dl : prev.downloadedBytes,
          totalBytes: total > 0 ? total : prev.totalBytes,
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
          message: `ThunderDM v${
            prev.latestVersion || ''
          } has been downloaded and verified. Restart the application to apply the update.`,
        };
      });
    });

    const unsubError = Events.On('wails:updater:error', (e: any) => {
      setUpdateModal((prev) => {
        if (!prev) return prev;
        const friendly = formatUpdateError(e?.data?.message);
        return {
          ...prev,
          stage: 'error',
          title: 'Update Failed',
          message: friendly,
          error: friendly,
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

  return {
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
  };
};
