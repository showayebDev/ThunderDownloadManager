/**
 * RealTimeDownloadProgress Popup Window Orchestrator.
 * Coordinates live progress updates, automatic retry logic, window/tray controls,
 * and delegates rendering to ProgressStatsGrid, ProgressControlsTab, and ChunkVisualization.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Info, Zap, Flag, ChevronDown, Minus, X } from 'lucide-react';
import { WindowMinimise, Quit, invoke, listen } from '../../utils/tauriBridge';
import { useAppearance } from '../../context/AppearanceContext';
import { formatBytes as utilsFormatBytes, formatSpeed as utilsFormatSpeed } from '../../utils/formatters';
import { loadFromThunderDB } from '../../utils/thunderDB';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ChunkInfo } from './progress/types';
import {
  getInitialTaskId,
  formatEtaFromSeconds,
  parseSpeedLimitBytes,
  toSpeedLimitBytes,
  detectYtdlpPayload,
  detectTorrentPayload,
  resolveResumeSupportFromPayload,
  isYtdlpMissingOrError,
  loadInitialProgressEngineConfig,
  hideProgressWindowToTray,
  closeProgressWindow,
  invokeResumeDownload,
} from './progress/utils';
import { ProgressStatsGrid } from './progress/ProgressStatsGrid';
import { ProgressControlsTab, ProgressActionBar } from './progress/ProgressControlsTab';
import { ChunkVisualization } from './progress/ChunkVisualization';

export const RealTimeDownloadProgress: React.FC = () => {
  const { appearance } = useAppearance();
  const formatBytes = (bytes: number) =>
    utilsFormatBytes(bytes, 2, appearance?.downloadSizeUnit || 'Automatic');
  const formatSpeed = (bytesPerSec: number | null | undefined, currentStatus: string) => {
    if (currentStatus === 'Finished' || currentStatus === 'Completed') return '-';
    if (currentStatus === 'Paused') return '0 B/s';
    if (currentStatus === 'Merging') return '-';
    if (
      bytesPerSec === null ||
      bytesPerSec === undefined ||
      isNaN(Number(bytesPerSec)) ||
      Number(bytesPerSec) <= 0
    ) {
      return 'Calculating...';
    }
    return utilsFormatSpeed(bytesPerSec, appearance?.downloadSpeedUnit || 'Automatic');
  };

  const [activeTab, setActiveTab] = useState<string>('info');
  const [isExpanded, setIsExpanded] = useState<boolean>(true);

  const [taskId, setTaskId] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [url, setUrl] = useState<string>('');
  const [savePath, setSavePath] = useState<string>('');
  const [status, setStatus] = useState<string>('Downloading');
  const [downloaded, setDownloaded] = useState<number>(0);
  const [totalSize, setTotalSize] = useState<number>(0);
  const [speed, setSpeed] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState<string>('Calculating...');
  const [chunks, setChunks] = useState<ChunkInfo[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isYTDLP, setIsYTDLP] = useState<boolean>(false);
  const [isTorrent, setIsTorrent] = useState<boolean>(false);
  const [isYtdlpInstalled, setIsYtdlpInstalled] = useState<boolean>(true);
  const [isInstallingYtdlp, setIsInstallingYtdlp] = useState<boolean>(false);
  const [ytdlpInstallError, setYtdlpInstallError] = useState<string>('');
  const [ytdlpInstallSuccess, setYtdlpInstallSuccess] = useState<boolean>(false);
  const [resumeSupport, setResumeSupport] = useState<string>('Checking...');
  const [proxyUsed, setProxyUsed] = useState<string>('');

  const [threadCount, setThreadCount] = useState<number>(0);
  const [defaultThreadCount, setDefaultThreadCount] = useState<number>(8);
  const [speedLimitEnabled, setSpeedLimitEnabled] = useState<boolean>(false);
  const [speedLimitVal, setSpeedLimitVal] = useState<number>(0);
  const [speedLimitUnit, setSpeedLimitUnit] = useState<string>('MB/s');

  const [shutdownOnCompletion, setShutdownOnCompletion] = useState<boolean>(false);

  const taskIdRef = useRef<string>('');
  const statusRef = useRef<string>('Downloading');
  const urlRef = useRef<string>('');
  const nameRef = useRef<string>('');
  const downloadedRef = useRef<number>(0);
  const totalSizeRef = useRef<number>(0);
  const retryAttemptsRef = useRef<number>(0);
  const autoRetryTimerRef = useRef<any>(null);

  const handleMinimize = async () => {
    try {
      WindowMinimise();
    } catch {}
  };

  const handleHideToTray = () =>
    hideProgressWindowToTray(
      taskIdRef.current || getInitialTaskId(),
      name || nameRef.current || 'download',
      downloadedRef.current,
      totalSizeRef.current
    );

  const handleClose = () =>
    closeProgressWindow(taskIdRef.current || getInitialTaskId(), statusRef.current);

  const applyProgressUpdate = (p: any) => {
    if (!p) return;
    if (p.filename) setName(p.filename);
    if (p.url) {
      setUrl(p.url);
      urlRef.current = p.url;
    }
    if (p.save_path || p.savePath) setSavePath(p.save_path || p.savePath);

    if (detectYtdlpPayload(p)) setIsYTDLP(true);
    if (detectTorrentPayload(p)) setIsTorrent(true);

    const dl = p.downloaded !== undefined ? p.downloaded : p.downloaded_bytes ?? null;
    if (dl !== null && dl !== undefined && (dl > 0 || downloadedRef.current === 0)) {
      setDownloaded(dl);
      downloadedRef.current = dl;
    }

    const tot = p.total_size !== undefined ? p.total_size : p.total_bytes ?? null;
    if (tot !== null && tot !== undefined && (tot > 0 || totalSizeRef.current === 0)) {
      setTotalSize(tot);
      totalSizeRef.current = tot;
    }

    if (p.speed !== undefined && p.speed !== null) {
      setSpeed(p.speed);
      if (p.speed > 0 && p.status === 'Downloading') retryAttemptsRef.current = 0;
    }
    if (p.status) {
      if (p.status === 'Canceled' || p.status === 'Cancelled') {
        Quit();
        return;
      }
      setStatus(p.status);
      statusRef.current = p.status;
    }
    if (p.error_message !== undefined && p.error_message !== null && p.error_message !== '') {
      setErrorMessage(p.error_message);
    } else if (p.error !== undefined && p.error !== null && p.error !== '') {
      setErrorMessage(p.error);
    }

    if (p.time_left !== undefined && p.time_left !== null) {
      setTimeLeft(p.time_left);
    } else if (p.eta !== undefined && p.eta !== null) {
      setTimeLeft(formatEtaFromSeconds(p.eta));
    }

    const resolvedResume = resolveResumeSupportFromPayload(p);
    if (resolvedResume) setResumeSupport(resolvedResume);

    if (p.proxy_used !== undefined) setProxyUsed(p.proxy_used);
    else if (p.proxyUsed !== undefined) setProxyUsed(p.proxyUsed);

    if (Array.isArray(p.chunks)) setChunks(p.chunks);

    if (p.default_thread_count !== undefined && p.default_thread_count > 0) {
      setDefaultThreadCount(p.default_thread_count);
    } else if (p.defaultThreadCount !== undefined && p.defaultThreadCount > 0) {
      setDefaultThreadCount(p.defaultThreadCount);
    }

    if (p.thread_count !== undefined && p.thread_count > 0) {
      setThreadCount(p.thread_count);
    } else if (p.threadCount !== undefined && p.threadCount > 0) {
      setThreadCount(p.threadCount);
    }

    const spLimit =
      p.speed_limit !== undefined
        ? p.speed_limit
        : p.speedLimit !== undefined
        ? p.speedLimit
        : undefined;
    if (spLimit !== undefined) {
      if (spLimit !== null && spLimit > 0) {
        const parsed = parseSpeedLimitBytes(spLimit);
        setSpeedLimitEnabled(parsed.enabled);
        setSpeedLimitUnit(parsed.unit);
        setSpeedLimitVal(parsed.val);
      } else if (spLimit === 0 || spLimit === null) {
        setSpeedLimitEnabled(false);
      }
    }
  };

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenOpen: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    let unlistenClose: (() => void) | undefined;
    let unlistenCloseSpecific: (() => void) | undefined;

    async function init() {
      const cfg = await loadInitialProgressEngineConfig();
      setDefaultThreadCount(cfg.defaultThreads);
      setIsYtdlpInstalled(cfg.isYtdlpInstalled);
      if (cfg.speedLimit) {
        setSpeedLimitEnabled(cfg.speedLimit.enabled);
        setSpeedLimitUnit(cfg.speedLimit.unit);
        setSpeedLimitVal(cfg.speedLimit.val);
      }

      const urlTaskId = getInitialTaskId();
      try {
        const initPayload = await invoke<any>('get_latest_realtime_progress_payload');
        if (initPayload) {
          const tid = initPayload.id || initPayload.task_id || initPayload.taskId || '';
          if (!urlTaskId || tid === urlTaskId) {
            if (tid) {
              setTaskId(tid);
              taskIdRef.current = tid;
            }
            applyProgressUpdate(initPayload);
          }
        }
      } catch {}

      const targetId = urlTaskId || taskIdRef.current;
      if (targetId) {
        setTaskId(targetId);
        taskIdRef.current = targetId;
        try {
          const st = await invoke<any>('get_task_status', { id: targetId });
          if (st) applyProgressUpdate(st);
        } catch {}
      }

      unlistenOpen = await listen('open-realtime-progress-payload', async (event: any) => {
        const p = event.payload;
        if (!p) return;
        const incomingId = p.id || p.task_id || p.taskId || '';
        const currentId = taskIdRef.current;
        if (urlTaskId && incomingId && incomingId !== urlTaskId) return;
        if (!currentId || incomingId === currentId || !urlTaskId) {
          setTaskId(incomingId);
          taskIdRef.current = incomingId;
          applyProgressUpdate(p);
        }
      });

      unlistenProgress = await listen('download-progress', (event: any) => {
        const p = event.payload || {};
        const tid = p.id || p.task_id;
        if (!tid) return;
        const activeId = taskIdRef.current;
        if (activeId && tid !== activeId) return;
        if (!activeId) {
          taskIdRef.current = tid;
          setTaskId(tid);
        }
        applyProgressUpdate(p);
      });

      unlistenClose = await listen('close-realtime-progress', (event: any) => {
        const payload = event?.payload;
        const currentId = taskIdRef.current || urlTaskId;
        if (
          payload &&
          currentId &&
          (payload === currentId ||
            (typeof payload === 'object' &&
              (payload.id === currentId || payload.taskId === currentId || payload.task_id === currentId)))
        ) {
          Quit();
        }
      });

      if (urlTaskId) {
        unlistenCloseSpecific = await listen(`close-realtime-progress-${urlTaskId}`, (event: any) => {
          const payload = event?.payload;
          if (
            !payload ||
            payload === urlTaskId ||
            (typeof payload === 'object' && (payload.id === urlTaskId || payload.taskId === urlTaskId))
          ) {
            Quit();
          }
        });
      }

      unlistenError = await listen('download-error', async (event: any) => {
        const p = event.payload || {};
        const tid = p.id || p.task_id;
        if (tid && tid === taskIdRef.current) {
          let maxRetries = 3;
          try {
            const dbEngine = await loadFromThunderDB<any>('download_engine', null);
            if (dbEngine && dbEngine.maxRetries !== undefined) {
              maxRetries = Number(dbEngine.maxRetries) || 3;
            }
          } catch {}

          if (retryAttemptsRef.current < maxRetries) {
            retryAttemptsRef.current += 1;
            const attempt = retryAttemptsRef.current;
            setStatus('Downloading');
            statusRef.current = 'Downloading';
            setErrorMessage(`Reconnecting (attempt ${attempt}/${maxRetries})...`);
            if (autoRetryTimerRef.current) clearTimeout(autoRetryTimerRef.current);
            autoRetryTimerRef.current = setTimeout(async () => {
              await handleRetryDownload();
            }, 1500);
            return;
          }

          setStatus('Error');
          statusRef.current = 'Error';
          setErrorMessage(p.error || `Download failed after ${maxRetries} retry attempts`);
        }
      });
    }

    init();

    return () => {
      if (autoRetryTimerRef.current) clearTimeout(autoRetryTimerRef.current);
      if (unlistenProgress) unlistenProgress();
      if (unlistenOpen) unlistenOpen();
      if (unlistenError) unlistenError();
      if (unlistenClose) unlistenClose();
      if (unlistenCloseSpecific) unlistenCloseSpecific();
    };
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      const currentId = taskIdRef.current;
      if (
        currentId &&
        statusRef.current !== 'Finished' &&
        statusRef.current !== 'Error' &&
        statusRef.current !== 'Canceled'
      ) {
        try {
          const st = await invoke<any>('get_task_status', { id: currentId });
          if (st) applyProgressUpdate(st);
        } catch {}
      }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const percentage =
    totalSize > 0 ? Math.min(100, Math.floor((downloaded / totalSize) * 100)) : 0;
  const isPaused = status === 'Paused';
  const isMerging = status === 'Merging';
  const isCompleted = status === 'Finished' || status === 'Completed';
  const isYtdlpError = isYtdlpMissingOrError(isYTDLP, isYtdlpInstalled, errorMessage);

  useEffect(() => {
    if (isCompleted) {
      closeProgressWindow(taskIdRef.current || getInitialTaskId(), 'Completed');
    }
  }, [isCompleted]);

  const handleThreadCountChange = async (newVal: number) => {
    const val = Math.max(1, Math.min(64, newVal));
    setThreadCount(val);
    const currentId = taskIdRef.current || taskId;
    if (currentId) {
      try {
        await invoke('update_task_thread_count_command', { id: currentId, threadCount: val });
        const updated = await invoke<any>('get_task_status', { id: currentId });
        if (updated) applyProgressUpdate(updated);
      } catch {}
    }
  };

  const handleSpeedLimitChange = async (enabled: boolean, val: number, unit: string) => {
    setSpeedLimitEnabled(enabled);
    setSpeedLimitVal(val);
    setSpeedLimitUnit(unit);

    const currentId = taskIdRef.current || taskId;
    const limitBytes = toSpeedLimitBytes(enabled, val, unit);
    if (currentId) {
      try {
        await invoke('update_task_speed_limit_command', {
          id: currentId,
          speedLimit: limitBytes,
          speed_limit: limitBytes,
        });
      } catch {}
    }
  };

  const handleInstallYtdlp = async () => {
    setIsInstallingYtdlp(true);
    setYtdlpInstallError('');
    setYtdlpInstallSuccess(false);
    try {
      const res = await invoke<any>('install_ytdlp');
      const allInstalled = Boolean(res?.allInstalled ?? (res?.success || res?.alreadyInstalled));
      if (allInstalled) {
        setIsYtdlpInstalled(true);
        setYtdlpInstallSuccess(true);
        setYtdlpInstallError('');
      } else {
        setYtdlpInstallError(
          res?.error || 'Installation failed. Please verify your internet connection.'
        );
      }
    } catch (err: any) {
      setYtdlpInstallError(
        typeof err === 'string' ? err : err?.message || 'Error installing Media Tools.'
      );
    } finally {
      setIsInstallingYtdlp(false);
    }
  };

  const handleRetryDownload = async () => {
    const currentId = taskIdRef.current || taskId;
    if (!currentId) return;
    if (autoRetryTimerRef.current) {
      clearTimeout(autoRetryTimerRef.current);
      autoRetryTimerRef.current = null;
    }
    retryAttemptsRef.current = 0;
    setStatus('Downloading');
    statusRef.current = 'Downloading';
    setErrorMessage(null);
    setYtdlpInstallSuccess(false);
    setChunks((prev) =>
      prev.map((c) => (c.status === 'Error' ? { ...c, status: 'Pending' } : c))
    );
    try {
      await invokeResumeDownload({
        id: currentId,
        url: url || urlRef.current,
        savePath,
        filename: name,
        threadCount: threadCount || defaultThreadCount || 8,
        speedLimitBytes: toSpeedLimitBytes(speedLimitEnabled, speedLimitVal, speedLimitUnit),
        isYTDLP,
        isTorrent,
      });
    } catch (err) {
      console.error('Failed to retry download:', err);
    }
  };

  const handlePauseResume = async () => {
    const currentId = taskIdRef.current || taskId;
    if (!currentId) return;
    try {
      if (status === 'Error') {
        await handleRetryDownload();
        return;
      }
      if (isPaused) {
        setStatus('Downloading');
        statusRef.current = 'Downloading';
        await invokeResumeDownload({
          id: currentId,
          url: url || urlRef.current,
          savePath,
          filename: name,
          threadCount: threadCount || defaultThreadCount || 8,
          speedLimitBytes: toSpeedLimitBytes(speedLimitEnabled, speedLimitVal, speedLimitUnit),
          isYTDLP,
          isTorrent,
        });
      } else {
        setStatus('Paused');
        statusRef.current = 'Paused';
        await invoke('pause_download', { id: currentId });
      }
    } catch {}
  };

  const handleCancelDownload = async () => {
    const currentId = taskIdRef.current || taskId;
    if (currentId) {
      try {
        await invoke('cancel_download', { id: currentId });
      } catch {}
    }
    handleClose();
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-card text-foreground font-sans text-xs select-none border border-border overflow-hidden min-w-0">
      {/* Title Bar */}
      <div
        style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
        className="flex items-center justify-between px-3 py-2.5 bg-muted/40 border-b border-border shrink-0 cursor-move min-w-0"
      >
        <div className="flex items-center space-x-2 min-w-0 pr-4 pointer-events-none flex-1 overflow-hidden">
          <div className="w-5 h-5 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center shrink-0">
            <img src="/icon.svg" alt="Logo" className="w-3.5 h-3.5 object-contain" />
          </div>
          <span className="text-[13px] font-semibold text-foreground truncate tracking-tight min-w-0">
            {percentage}% {name || 'Download Progress'}
          </span>
          {proxyUsed && (
            <Badge variant="outline" className="text-[10px] text-primary px-1.5 py-0 shrink-0">
              Proxy
            </Badge>
          )}
        </div>

        {/* Window controls */}
        <div
          className="flex items-center space-x-1 shrink-0"
          style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
        >
          <button
            type="button"
            onClick={handleMinimize}
            className="p-1 hover:bg-accent text-muted-foreground hover:text-foreground rounded transition-colors cursor-pointer"
            title="Minimize"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleHideToTray}
            className="p-1 hover:bg-accent text-muted-foreground hover:text-foreground rounded transition-colors cursor-pointer"
            title="Move to System Tray"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="p-1 hover:bg-red-500 hover:text-white dark:hover:bg-red-600 text-muted-foreground rounded transition-colors cursor-pointer"
            title="Cancel Download & Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tabs Navigation Header & Content */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col overflow-hidden min-w-0 w-full"
      >
        <div className="px-3 border-b border-border bg-muted/30 shrink-0 min-w-0 w-full overflow-hidden">
          <TabsList className="bg-transparent h-9 p-0 gap-3">
            <TabsTrigger
              value="info"
              className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none rounded-none text-xs font-medium px-2 py-1.5 flex items-center space-x-1.5"
            >
              <Info className="w-3.5 h-3.5" />
              <span>Info</span>
            </TabsTrigger>
            <TabsTrigger
              value="speed"
              className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none rounded-none text-xs font-medium px-2 py-1.5 flex items-center space-x-1.5"
            >
              <Zap className="w-3.5 h-3.5" />
              <span>Speed</span>
            </TabsTrigger>
            <TabsTrigger
              value="completion"
              className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-foreground data-[state=active]:shadow-none rounded-none text-xs font-medium px-2 py-1.5 flex items-center space-x-1.5"
            >
              <Flag className="w-3.5 h-3.5" />
              <span>On Completion</span>
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab Body Contents */}
        <div className="p-4 bg-card min-h-[160px] shrink-0 overflow-y-auto overflow-x-hidden custom-scrollbar min-w-0 w-full">
          <ProgressStatsGrid
            name={name}
            status={status}
            isTorrent={isTorrent}
            totalSize={totalSize}
            downloaded={downloaded}
            percentage={percentage}
            speed={speed}
            timeLeft={timeLeft}
            isMerging={isMerging}
            resumeSupport={resumeSupport}
            proxyUsed={proxyUsed}
            errorMessage={errorMessage}
            isYtdlpError={isYtdlpError}
            isYtdlpInstalled={isYtdlpInstalled}
            isInstallingYtdlp={isInstallingYtdlp}
            ytdlpInstallError={ytdlpInstallError}
            ytdlpInstallSuccess={ytdlpInstallSuccess}
            onInstallYtdlp={handleInstallYtdlp}
            onRetryDownload={handleRetryDownload}
            formatBytes={formatBytes}
            formatSpeed={formatSpeed}
          />

          <ProgressControlsTab
            isYTDLP={isYTDLP}
            isTorrent={isTorrent}
            threadCount={threadCount}
            defaultThreadCount={defaultThreadCount}
            chunks={chunks}
            onThreadCountChange={handleThreadCountChange}
            speedLimitEnabled={speedLimitEnabled}
            speedLimitVal={speedLimitVal}
            speedLimitUnit={speedLimitUnit}
            onSpeedLimitChange={handleSpeedLimitChange}
            shutdownOnCompletion={shutdownOnCompletion}
            onShutdownOnCompletionChange={setShutdownOnCompletion}
          />
        </div>

        {/* Main Progress Bar & Control Buttons */}
        <ProgressActionBar
          percentage={percentage}
          isMerging={isMerging}
          isPaused={isPaused}
          status={status}
          isExpanded={isExpanded}
          onToggleExpanded={() => setIsExpanded(!isExpanded)}
          onPauseResume={handlePauseResume}
          onCancelDownload={handleCancelDownload}
        />

        {/* Expandable Chunk Breakdown Table */}
        <ChunkVisualization
          isExpanded={isExpanded}
          isYTDLP={isYTDLP}
          isTorrent={isTorrent}
          totalSize={totalSize}
          status={status}
          isPaused={isPaused}
          isMerging={isMerging}
          isYtdlpError={isYtdlpError}
          isYtdlpInstalled={isYtdlpInstalled}
          ytdlpInstallSuccess={ytdlpInstallSuccess}
          isInstallingYtdlp={isInstallingYtdlp}
          onInstallYtdlp={handleInstallYtdlp}
          onRetryDownload={handleRetryDownload}
          chunks={chunks}
          formatBytes={formatBytes}
        />
      </Tabs>
    </div>
  );
};

export default RealTimeDownloadProgress;
