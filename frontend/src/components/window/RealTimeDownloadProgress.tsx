import React, { useState, useEffect, useRef } from 'react';
import {
  Info,
  Zap,
  Flag,
  ChevronUp,
  ChevronDown,
  Pause,
  Play,
  Minus,
  X,
  Check,
  AlertTriangle,
  Download,
  RefreshCw,
} from 'lucide-react';
import { WindowMinimise, WindowHide, Quit } from '../../utils/tauriBridge';
import { invoke, listen } from '../../utils/tauriBridge';
import { HelpTooltip } from '../common/Tooltip';
import { useAppearance } from '../../context/AppearanceContext';
import { formatBytes as utilsFormatBytes, formatSpeed as utilsFormatSpeed } from '../../utils/formatters';
import { loadFromThunderDB } from '../../utils/thunderDB';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';

interface ChunkInfo {
  id?: number;
  status?: string;
  downloaded: number;
  total: number;
}

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

  // Download Task Data
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
  const [isYtdlpInstalled, setIsYtdlpInstalled] = useState<boolean>(true);
  const [isInstallingYtdlp, setIsInstallingYtdlp] = useState<boolean>(false);
  const [ytdlpInstallError, setYtdlpInstallError] = useState<string>('');
  const [ytdlpInstallSuccess, setYtdlpInstallSuccess] = useState<boolean>(false);
  const [resumeSupport, setResumeSupport] = useState<string>('Checking...');
  const [proxyUsed, setProxyUsed] = useState<string>('');

  // Speed tab state
  const [threadCount, setThreadCount] = useState<number>(0);
  const [defaultThreadCount, setDefaultThreadCount] = useState<number>(8);
  const [speedLimitEnabled, setSpeedLimitEnabled] = useState<boolean>(false);
  const [speedLimitVal, setSpeedLimitVal] = useState<number>(0);
  const [speedLimitUnit, setSpeedLimitUnit] = useState<string>('MB/s');

  // On Completion tab state
  const [shutdownOnCompletion, setShutdownOnCompletion] = useState<boolean>(false);

  const taskIdRef = useRef<string>('');
  const statusRef = useRef<string>('Downloading');
  const urlRef = useRef<string>('');
  const nameRef = useRef<string>('');
  const downloadedRef = useRef<number>(0);
  const totalSizeRef = useRef<number>(0);

  const handleMinimize = async () => {
    try {
      WindowMinimise();
    } catch {}
  };

  const getInitialTaskId = (): string => {
    try {
      const hash = window.location.hash || '';
      const query = hash.includes('?')
        ? hash.split('?')[1]
        : (window.location.search || '').replace(/^\?/, '');
      const params = new URLSearchParams(query);
      const idFromUrl = params.get('id');
      if (idFromUrl) return idFromUrl;
    } catch {}
    return '';
  };

  const handleHideToTray = async () => {
    try {
      const currentId = taskIdRef.current || getInitialTaskId();
      const currentName = name || nameRef.current || 'download';
      const pct =
        totalSizeRef.current > 0
          ? Math.min(100, Math.floor((downloadedRef.current / totalSizeRef.current) * 100))
          : 0;
      await invoke('hide_realtime_download_to_tray_command', {
        id: currentId,
        filename: currentName,
        progress: pct,
      });
    } catch {
      WindowHide();
    }
  };

  const handleClose = async () => {
    try {
      const currentId = taskIdRef.current || getInitialTaskId();
      if (currentId) {
        if (statusRef.current !== 'Finished' && statusRef.current !== 'Completed') {
          await invoke('pause_download', { id: currentId });
        }
        await invoke('remove_hidden_download_command', { id: currentId });
      }
      await invoke('clear_realtime_progress_payload');
      Quit();
    } catch {}
  };

  const applyProgressUpdate = (p: any) => {
    if (!p) return;
    if (p.filename) setName(p.filename);
    if (p.url) {
      setUrl(p.url);
      urlRef.current = p.url;
    }
    if (p.save_path || p.savePath) setSavePath(p.save_path || p.savePath);

    if (
      p.is_ytdlp ||
      p.protocol === 'Yt-DLP' ||
      (typeof p.protocol === 'string' && p.protocol.startsWith('Yt-DLP')) ||
      (p.url &&
        (p.url.includes('youtube.com') ||
          p.url.includes('youtu.be') ||
          p.url.includes('vimeo.com') ||
          p.url.includes('tiktok.com')))
    ) {
      setIsYTDLP(true);
    }

    const dl = p.downloaded !== undefined ? p.downloaded : p.downloaded_bytes ?? null;
    if (dl !== null && dl !== undefined) {
      if (dl > 0 || downloadedRef.current === 0) {
        setDownloaded(dl);
        downloadedRef.current = dl;
      }
    }

    const tot = p.total_size !== undefined ? p.total_size : p.total_bytes ?? null;
    if (tot !== null && tot !== undefined) {
      if (tot > 0 || totalSizeRef.current === 0) {
        setTotalSize(tot);
        totalSizeRef.current = tot;
      }
    }

    if (p.speed !== undefined && p.speed !== null) setSpeed(p.speed);
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
      if (p.eta <= 0 || !isFinite(p.eta)) {
        setTimeLeft('Calculating...');
      } else {
        const h = Math.floor(p.eta / 3600);
        const m = Math.floor((p.eta % 3600) / 60);
        const s = Math.floor(p.eta % 60);
        if (h > 0) setTimeLeft(`${h}h ${m}m ${s}s`);
        else if (m > 0) setTimeLeft(`${m}m ${s}s`);
        else setTimeLeft(`${s}s`);
      }
    }
    if (p.resume_support !== undefined && p.resume_support !== null) {
      const val =
        p.resume_support === true || p.resume_support === 'Yes'
          ? 'Yes'
          : p.resume_support === false || p.resume_support === 'No'
          ? 'No'
          : p.resume_support;
      setResumeSupport(val);
    } else if (p.resumeSupport !== undefined && p.resumeSupport !== null) {
      const val =
        p.resumeSupport === true || p.resumeSupport === 'Yes'
          ? 'Yes'
          : p.resumeSupport === false || p.resumeSupport === 'No'
          ? 'No'
          : p.resumeSupport;
      setResumeSupport(val);
    } else if (p.resumable !== undefined && p.resumable !== null) {
      setResumeSupport(p.resumable ? 'Yes' : 'No');
    } else if (p.accept_ranges !== undefined && p.accept_ranges !== null) {
      setResumeSupport(p.accept_ranges ? 'Yes' : 'No');
    } else if (
      p.is_ytdlp ||
      p.is_hls ||
      p.protocol === 'HLS' ||
      (typeof p.protocol === 'string' && p.protocol.startsWith('Yt-DLP')) ||
      (p.url && (p.url.includes('youtube.com') || p.url.includes('youtu.be')))
    ) {
      setResumeSupport('Yes');
    } else if (Array.isArray(p.chunks) && p.chunks.length > 1) {
      setResumeSupport('Yes');
    }

    if (p.proxy_used !== undefined) {
      setProxyUsed(p.proxy_used);
    } else if (p.proxyUsed !== undefined) {
      setProxyUsed(p.proxyUsed);
    }

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
        setSpeedLimitEnabled(true);
        if (spLimit >= 1024 * 1024 && spLimit % (1024 * 1024) === 0) {
          setSpeedLimitUnit('MB/s');
          setSpeedLimitVal(Math.round(spLimit / (1024 * 1024)));
        } else if (spLimit >= 1024 * 1024) {
          setSpeedLimitUnit('MB/s');
          setSpeedLimitVal(parseFloat((spLimit / (1024 * 1024)).toFixed(1)));
        } else {
          setSpeedLimitUnit('KB/s');
          setSpeedLimitVal(Math.round(spLimit / 1024));
        }
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
      try {
        let dbEngine = await loadFromThunderDB<any>('download_engine', null);
        if (!dbEngine) {
          try {
            dbEngine = await invoke<any>('get_engine_config_command');
          } catch {}
        }
        if (dbEngine) {
          const defTC = dbEngine.defaultThreadCount || dbEngine.threadCount || 8;
          setDefaultThreadCount(defTC);
        } else {
          try {
            const defFromBackend = await invoke<number>('get_default_thread_count_command');
            if (defFromBackend && defFromBackend > 0) {
              setDefaultThreadCount(defFromBackend);
            }
          } catch {}
        }
        if (dbEngine?.globalSpeedLimiter && Number(dbEngine?.globalSpeedLimit) > 0) {
          const gLimit = Number(dbEngine.globalSpeedLimit);
          setSpeedLimitEnabled(true);
          if (gLimit >= 1024 * 1024 && gLimit % (1024 * 1024) === 0) {
            setSpeedLimitUnit('MB/s');
            setSpeedLimitVal(Math.round(gLimit / (1024 * 1024)));
          } else if (gLimit >= 1024 * 1024) {
            setSpeedLimitUnit('MB/s');
            setSpeedLimitVal(parseFloat((gLimit / (1024 * 1024)).toFixed(1)));
          } else {
            setSpeedLimitUnit('KB/s');
            setSpeedLimitVal(Math.round(gLimit / 1024));
          }
        }
      } catch {}

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
          if (st) {
            applyProgressUpdate(st);
          }
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
        if (activeId && tid !== activeId) {
          return;
        }

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
          if (!payload || payload === urlTaskId || (typeof payload === 'object' && (payload.id === urlTaskId || payload.taskId === urlTaskId))) {
            Quit();
          }
        });
      }

      unlistenError = await listen('download-error', (event: any) => {
        const p = event.payload || {};
        const tid = p.id || p.task_id;
        if (tid && tid === taskIdRef.current) {
          setStatus('Error');
          statusRef.current = 'Error';
          setErrorMessage(p.error || 'Unknown error occurred.');
        }
      });
    }

    init();

    return () => {
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
          if (st) {
            applyProgressUpdate(st);
          }
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
  const isYtdlpError =
    isYTDLP &&
    ((errorMessage &&
      (errorMessage.includes('yt-dlp') ||
        errorMessage.includes('YT-DLP') ||
        errorMessage.includes('not found') ||
        errorMessage.includes('executable file not found'))) ||
      !isYtdlpInstalled);

  useEffect(() => {
    if (isCompleted) {
      (async () => {
        try {
          const currentId = taskIdRef.current || getInitialTaskId();
          if (currentId) {
            await invoke('remove_hidden_download_command', { id: currentId });
          }
          await invoke('clear_realtime_progress_payload');
          Quit();
        } catch {}
      })();
    }
  }, [isCompleted]);

  const handleThreadCountChange = async (newVal: number) => {
    const val = Math.max(1, Math.min(64, newVal));
    setThreadCount(val);
    const currentId = taskIdRef.current || taskId;
    if (currentId) {
      try {
        await invoke('update_task_thread_count_command', {
          id: currentId,
          threadCount: val,
        });
        const updated = await invoke<any>('get_task_status', { id: currentId });
        if (updated) {
          applyProgressUpdate(updated);
        }
      } catch {}
    }
  };

  const handleSpeedLimitChange = async (enabled: boolean, val: number, unit: string) => {
    setSpeedLimitEnabled(enabled);
    setSpeedLimitVal(val);
    setSpeedLimitUnit(unit);

    const currentId = taskIdRef.current || taskId;
    const limitBytes =
      enabled && val > 0
        ? unit === 'KB/s'
          ? Math.round(val * 1024)
          : Math.round(val * 1024 * 1024)
        : 0;

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
      const allInstalled = Boolean(
        res?.allInstalled ?? (res?.success || res?.alreadyInstalled)
      );
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
    setStatus('Downloading');
    statusRef.current = 'Downloading';
    setErrorMessage(null);
    setYtdlpInstallSuccess(false);
    setChunks((prev) =>
      prev.map((c) => (c.status === 'Error' ? { ...c, status: 'Pending' } : c))
    );
    try {
      const targetUrl = url || urlRef.current;
      const currentLimitBytes =
        speedLimitEnabled && speedLimitVal > 0
          ? speedLimitUnit === 'KB/s'
            ? Math.round(speedLimitVal * 1024)
            : Math.round(speedLimitVal * 1024 * 1024)
          : 0;
      await invoke('resume_download', {
        id: currentId,
        url: targetUrl,
        savePath: savePath || '',
        filename: name,
        threadCount: threadCount || defaultThreadCount || 8,
        speedLimit: currentLimitBytes,
        speed_limit: currentLimitBytes,
        protocol: isYTDLP ? 'Yt-DLP' : null,
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
        const targetUrl = url || urlRef.current;
        const currentLimitBytes =
          speedLimitEnabled && speedLimitVal > 0
            ? speedLimitUnit === 'KB/s'
              ? Math.round(speedLimitVal * 1024)
              : Math.round(speedLimitVal * 1024 * 1024)
            : 0;
        await invoke('resume_download', {
          id: currentId,
          url: targetUrl,
          savePath: savePath || '',
          filename: name,
          threadCount: threadCount || defaultThreadCount || 8,
          speedLimit: currentLimitBytes,
          speed_limit: currentLimitBytes,
          protocol: isYTDLP ? 'Yt-DLP' : null,
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
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden min-w-0 w-full">
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
          {/* Info Tab */}
          <TabsContent value="info" className="m-0 space-y-2 text-xs focus-visible:outline-none min-w-0 w-full">
            <div className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2 min-w-0">
              <span className="text-muted-foreground font-medium shrink-0">Name:</span>
              <span className="text-foreground truncate font-mono text-[11px] min-w-0" title={name}>
                {name || 'Filename'}
              </span>
            </div>

            <div className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2 min-w-0">
              <span className="text-muted-foreground font-medium shrink-0">Status:</span>
              <span
                className={`font-semibold min-w-0 truncate ${
                  status === 'Error'
                    ? 'text-destructive'
                    : status === 'Finished'
                    ? 'text-emerald-500'
                    : status === 'Merging'
                    ? 'text-primary animate-pulse'
                    : 'text-foreground'
                }`}
              >
                {status}
              </span>
            </div>

            {status === 'Error' && (
              <div className="space-y-2 animate-in fade-in duration-150 min-w-0 w-full">
                {isYtdlpError ? (
                  <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2.5 min-w-0 w-full overflow-hidden">
                    <div className="flex items-start space-x-2.5 min-w-0">
                      <div className="p-1.5 bg-amber-500/20 rounded-lg text-amber-500 shrink-0 mt-0.5">
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                      <div className="space-y-0.5 min-w-0 flex-1">
                        <div className="text-amber-600 dark:text-amber-300 font-semibold text-xs truncate">
                          YT-DLP Media Stream Engine Not Found
                        </div>
                        <div className="text-muted-foreground text-[11px] leading-relaxed break-words">
                          YT-DLP is required on your PC to download and merge adaptive video &
                          audio streams.
                        </div>
                        {ytdlpInstallError && (
                          <div className="text-destructive text-[10px] mt-1 font-mono break-all break-words">
                            {ytdlpInstallError}
                          </div>
                        )}
                        {ytdlpInstallSuccess && (
                          <div className="text-emerald-500 text-[10px] mt-1 font-semibold flex items-center space-x-1">
                            <Check className="w-3.5 h-3.5 shrink-0" />
                            <span className="break-words">YT-DLP installed successfully! Click Retry Download below.</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2 pt-1 border-t border-amber-500/20">
                      {!ytdlpInstallSuccess && !isYtdlpInstalled ? (
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleInstallYtdlp}
                          disabled={isInstallingYtdlp}
                          className="h-7 text-xs font-semibold flex items-center space-x-1.5"
                        >
                          {isInstallingYtdlp ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>Installing...</span>
                            </>
                          ) : (
                            <>
                              <Download className="w-3.5 h-3.5" />
                              <span>Install YT-DLP</span>
                            </>
                          )}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleRetryDownload}
                          className="h-7 text-xs font-semibold flex items-center space-x-1.5"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Retry Download</span>
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="p-2.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs font-mono break-all [overflow-wrap:anywhere] leading-relaxed max-h-32 overflow-y-auto overflow-x-hidden custom-scrollbar select-text min-w-0 w-full">
                    {errorMessage || 'Download Error: Server connection failed.'}
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2 min-w-0">
              <span className="text-muted-foreground font-medium shrink-0">Size:</span>
              <span className="text-foreground font-medium min-w-0 truncate">
                {totalSize > 0
                  ? formatBytes(totalSize)
                  : downloaded > 0
                  ? '~' + formatBytes(downloaded)
                  : 'Calculating...'}
              </span>
            </div>

            <div className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2 min-w-0">
              <span className="text-muted-foreground font-medium shrink-0">
                {isMerging ? 'Merged:' : 'Downloaded:'}
              </span>
              <span className="text-foreground font-medium min-w-0 truncate">
                {formatBytes(downloaded)} {totalSize > 0 ? `(${percentage}%)` : ''}
              </span>
            </div>

            <div className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2 min-w-0">
              <span className="text-muted-foreground font-medium shrink-0">Speed:</span>
              <span className="text-foreground font-medium min-w-0 truncate">{formatSpeed(speed, status)}</span>
            </div>

            <div className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2 min-w-0">
              <span className="text-muted-foreground font-medium shrink-0">Time Left:</span>
              <span className="text-foreground font-medium min-w-0 truncate">{isMerging ? '-' : timeLeft}</span>
            </div>

            <div className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2 min-w-0">
              <span className="text-muted-foreground font-medium shrink-0">Resume Support:</span>
              <span
                className={`font-semibold min-w-0 truncate ${
                  resumeSupport === 'Yes'
                    ? 'text-emerald-500'
                    : resumeSupport === 'No'
                    ? 'text-destructive'
                    : 'text-amber-500 font-medium'
                }`}
              >
                {resumeSupport}
              </span>
            </div>

            <div className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-2 min-w-0">
              <span className="text-muted-foreground font-medium shrink-0">Proxy:</span>
              <span className="flex items-center space-x-1.5 font-medium min-w-0 truncate">
                {proxyUsed ? (
                  <Badge variant="outline" className="text-primary font-semibold text-[10px] truncate max-w-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse mr-1 shrink-0" />
                    <span className="truncate">{proxyUsed}</span>
                  </Badge>
                ) : (
                  <span className="text-muted-foreground text-[11px] truncate">
                    Direct Connection (No Proxy)
                  </span>
                )}
              </span>
            </div>
          </TabsContent>

          {/* Speed Tab */}
          <TabsContent value="speed" className="m-0 space-y-4 text-xs focus-visible:outline-none min-w-0 w-full">
            {isYTDLP ? (
              <div className="p-3 bg-muted/30 border border-primary/30 rounded-xl space-y-1.5 min-w-0 w-full">
                <div className="flex items-center space-x-1.5 font-semibold text-primary">
                  <Zap className="w-3.5 h-3.5 shrink-0" />
                  <span>YT-DLP Stream Engine</span>
                </div>
                <div className="text-[11px] text-muted-foreground leading-relaxed break-words">
                  Threading and bandwidth speed limits are managed internally by the single-process YT-DLP and FFmpeg multiplexer engine. Manual thread and speed limit adjustments are disabled for this stream.
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between pt-1 min-w-0">
                  <div className="min-w-0 mr-2">
                    <div className="flex items-center space-x-1 font-semibold text-foreground">
                      <span>Thread Count</span>
                      <HelpTooltip description="Number of parallel connection threads used to download file segments simultaneously." />
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {threadCount ? `${threadCount} threads for this download` : `Use Global Settings (${defaultThreadCount})`}
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5 bg-muted/40 border border-border rounded-xl px-2.5 py-1 shrink-0">
                    <input
                      type="number"
                      min={1}
                      max={64}
                      placeholder={String(defaultThreadCount)}
                      value={threadCount || (chunks.length > 0 ? chunks.length : '')}
                      onChange={(e) => {
                        const val = Math.max(1, Math.min(64, Number(e.target.value) || 1));
                        handleThreadCountChange(val);
                      }}
                      className="w-8 bg-transparent text-foreground text-xs font-mono font-semibold outline-none text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <div className="flex flex-col space-y-0.5 border-l border-border pl-1.5">
                      <button
                        type="button"
                        onClick={() => handleThreadCountChange((threadCount || chunks.length || 1) + 1)}
                        className="p-0.5 hover:bg-accent text-muted-foreground hover:text-foreground rounded transition-colors cursor-pointer"
                        title="Increase Threading"
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleThreadCountChange(Math.max(1, (threadCount || chunks.length || 1) - 1))
                        }
                        className="p-0.5 hover:bg-accent text-muted-foreground hover:text-foreground rounded transition-colors cursor-pointer"
                        title="Decrease Threading"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t border-border min-w-0">
                  <div className="min-w-0 mr-2">
                    <div className="flex items-center space-x-1 font-semibold text-foreground">
                      <span>Speed Limit</span>
                      <HelpTooltip description="Cap maximum download transfer speed for this download task." />
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {speedLimitEnabled && speedLimitVal > 0
                        ? `Limited to ${speedLimitVal} ${speedLimitUnit}`
                        : speedLimitEnabled
                        ? 'Limited'
                        : 'Unlimited'}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2 shrink-0">
                    {speedLimitEnabled && (
                      <div className="flex items-center space-x-1.5 animate-in fade-in duration-150">
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          placeholder="5"
                          value={speedLimitVal || ''}
                          onChange={(e) => {
                            const val =
                              e.target.value === '' ? 0 : Math.max(1, parseInt(e.target.value, 10) || 0);
                            handleSpeedLimitChange(true, val, speedLimitUnit);
                          }}
                          className="w-16 bg-background text-foreground text-xs font-mono font-semibold h-8 text-center"
                        />
                        <select
                          value={speedLimitUnit}
                          onChange={(e) => {
                            handleSpeedLimitChange(true, speedLimitVal || 5, e.target.value);
                          }}
                          className="bg-background border border-border text-foreground text-xs rounded-lg px-2 py-1 outline-none cursor-pointer h-8 font-medium"
                        >
                          <option value="MB/s" className="bg-card">
                            MB/s
                          </option>
                          <option value="KB/s" className="bg-card">
                            KB/s
                          </option>
                        </select>
                      </div>
                    )}

                    <Checkbox
                      checked={speedLimitEnabled}
                      onCheckedChange={(checked) => {
                        const enabled = Boolean(checked);
                        const defaultVal =
                          enabled && (!speedLimitVal || speedLimitVal <= 0) ? 5 : speedLimitVal;
                        handleSpeedLimitChange(enabled, defaultVal, speedLimitUnit);
                      }}
                    />
                  </div>
                </div>
              </>
            )}
          </TabsContent>

          {/* On Completion Tab */}
          <TabsContent value="completion" className="m-0 space-y-4 text-xs focus-visible:outline-none min-w-0 w-full">
            <div className="flex items-center justify-between pt-1 min-w-0">
              <div className="min-w-0 mr-2">
                <div className="flex items-center space-x-1 font-semibold text-foreground">
                  <Label htmlFor="shutdown-toggle" className="cursor-pointer font-semibold">
                    Shutdown System On Completion
                  </Label>
                  <HelpTooltip description="Automatically shut down your computer when this download finishes completely." />
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  {shutdownOnCompletion ? 'Enabled' : 'Disabled'}
                </div>
              </div>

              <Switch
                id="shutdown-toggle"
                checked={shutdownOnCompletion}
                onCheckedChange={setShutdownOnCompletion}
                className="shrink-0"
              />
            </div>
          </TabsContent>
        </div>

        {/* Main Progress Bar & Control Buttons */}
        <div className="px-4 py-3 bg-muted/20 border-t border-b border-border space-y-3 shrink-0 min-w-0 w-full">
          <div className="w-full h-3 bg-secondary/80 rounded-full overflow-hidden p-0.5 border border-border">
            <div
              className={`h-full rounded-full transition-all duration-300 shadow-md ${
                isMerging
                  ? 'bg-gradient-to-r from-primary to-accent animate-pulse'
                  : isPaused
                  ? 'bg-muted-foreground'
                  : 'bg-primary'
              }`}
              style={{ width: `${percentage}%` }}
            />
          </div>

          <div className="flex items-center justify-between min-w-0">
            <Button
              variant="outline"
              size="icon-xs"
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-8 w-8 shrink-0"
              title={isExpanded ? 'Collapse Segment Table' : 'Expand Segment Table'}
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>

            {!isMerging && (
              <div className="flex items-center space-x-2.5 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handlePauseResume}
                  className="rounded-xl px-5 text-xs font-medium space-x-1.5"
                >
                  {status === 'Error' ? (
                    <RefreshCw className="w-3.5 h-3.5" />
                  ) : isPaused ? (
                    <Play className="w-3.5 h-3.5 fill-current" />
                  ) : (
                    <Pause className="w-3.5 h-3.5 fill-current" />
                  )}
                  <span>{status === 'Error' ? 'Retry' : isPaused ? 'Resume' : 'Pause'}</span>
                </Button>

                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleCancelDownload}
                  className="rounded-xl px-5 text-xs font-medium"
                >
                  Cancel
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Expandable Chunk Breakdown Table */}
        {isExpanded && (
          <div className="flex-1 flex flex-col min-h-0 bg-card overflow-hidden min-w-0 w-full">
            {isYTDLP ? (
              <div className="flex-1 p-5 flex flex-col justify-center items-center text-center space-y-3 font-sans min-w-0 w-full overflow-y-auto custom-scrollbar">
                <div
                  className={`w-11 h-11 rounded-2xl flex items-center justify-center shadow-lg shrink-0 ${
                    status === 'Error'
                      ? 'bg-amber-500/20 text-amber-500'
                      : 'bg-primary/15 text-primary'
                  }`}
                >
                  {status === 'Error' ? (
                    <AlertTriangle className="w-5 h-5" />
                  ) : (
                    <Zap className="w-5 h-5" />
                  )}
                </div>
                <div className="space-y-1 max-w-xs min-w-0">
                  <div className="text-foreground font-semibold text-xs truncate">
                    {status === 'Error' && isYtdlpError
                      ? 'YT-DLP Not Found'
                      : 'YT-DLP Media Stream Engine'}
                  </div>
                  <div className="text-muted-foreground text-[11px] leading-relaxed break-words">
                    {status === 'Error' && isYtdlpError
                      ? 'YT-DLP is required on your system to download and multiplex adaptive media streams.'
                      : 'Direct stream download with adaptive video & audio multiplexing. Chunk segmentation is not applicable for YT-DLP tasks.'}
                  </div>
                </div>
                {status === 'Error' && isYtdlpError && !isYtdlpInstalled && !ytdlpInstallSuccess && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleInstallYtdlp}
                    disabled={isInstallingYtdlp}
                    className="text-xs shrink-0"
                  >
                    {isInstallingYtdlp ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" />
                        <span>Installing YT-DLP...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5 mr-1.5" />
                        <span>Install YT-DLP</span>
                      </>
                    )}
                  </Button>
                )}
                {status === 'Error' && (isYtdlpInstalled || ytdlpInstallSuccess) && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleRetryDownload}
                    className="text-xs flex items-center space-x-1.5 shrink-0"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>Retry Download</span>
                  </Button>
                )}
                <div className="flex items-center space-x-2 text-[11px] bg-muted/40 px-3.5 py-1.5 rounded-xl border border-border shrink-0 max-w-full truncate">
                  <span className="text-muted-foreground font-medium shrink-0">Status:</span>
                  <span
                    className={`font-semibold truncate ${
                      status === 'Error'
                        ? 'text-destructive'
                        : status === 'Finished'
                        ? 'text-emerald-500'
                        : status === 'Merging'
                        ? 'text-primary animate-pulse'
                        : 'text-primary'
                    }`}
                  >
                    {status === 'Merging' ? 'Merging Video + Audio' : status}
                  </span>
                </div>
              </div>
            ) : (
              <>
                <div className="w-full px-3 py-1.5 bg-muted/30 border-b border-border min-w-0 shrink-0">
                  <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden border border-border flex relative shadow-inner">
                    {chunks.length > 0 ? (
                      chunks.map((c, i) => {
                        const isFinished = c.status === 'Finished';
                        const isError = c.status === 'Error';
                        const isDownloading = !isPaused && c.status === 'Downloading';
                        const segPercent =
                          c.total > 0
                            ? Math.min(100, Math.max(0, (c.downloaded / c.total) * 100))
                            : isFinished
                            ? 100
                            : 0;

                        const isLast = i === chunks.length - 1;

                        return (
                          <div
                            key={c.id !== undefined ? c.id : i}
                            title={`Segment #${c.id !== undefined ? c.id + 1 : i + 1}: ${segPercent.toFixed(1)}% (${formatBytes(c.downloaded)} / ${formatBytes(c.total)}) - ${isPaused ? 'Paused' : c.status || status}`}
                            className={`flex-1 h-full relative bg-transparent overflow-hidden ${
                              !isLast ? 'border-r border-border' : ''
                            }`}
                          >
                            <div
                              className={`h-full transition-all duration-200 ${
                                isPaused
                                  ? 'bg-muted-foreground'
                                  : isError
                                  ? 'bg-destructive'
                                  : isFinished
                                  ? 'bg-emerald-500'
                                  : isMerging
                                  ? 'bg-primary animate-pulse'
                                  : isDownloading
                                  ? 'bg-emerald-500'
                                  : segPercent > 0
                                  ? 'bg-muted-foreground'
                                  : 'bg-transparent'
                              }`}
                              style={{
                                width: `${
                                  isFinished
                                    ? 100
                                    : isPaused
                                    ? segPercent
                                    : isDownloading && segPercent === 0
                                    ? 5
                                    : segPercent
                                }%`,
                              }}
                            />
                          </div>
                        );
                      })
                    ) : (
                      <div className="w-full h-full bg-secondary" />
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar px-3 pb-2 text-[11px] min-w-0 w-full">
                  <table className="w-full text-left border-collapse table-fixed">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground font-medium">
                        <th className="py-2 px-2 w-10 text-left">#</th>
                        <th className="py-2 px-2 w-28 text-left">Status</th>
                        <th className="py-2 px-2 text-left">Downloaded</th>
                        <th className="py-2 px-2 text-left">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border text-foreground/80 font-mono">
                      {chunks.length > 0 ? (
                        chunks.map((chunk, index) => (
                          <tr
                            key={chunk.id !== undefined ? chunk.id : index}
                            className="hover:bg-accent/40 transition-colors"
                          >
                            <td className="py-1.5 px-2 text-muted-foreground truncate">
                              {chunk.id !== undefined ? chunk.id + 1 : index + 1}
                            </td>
                            <td className="py-1.5 px-2 truncate">
                              <span
                                className={`truncate block ${
                                  chunk.status === 'Finished'
                                    ? 'text-emerald-500 font-medium'
                                    : isPaused
                                    ? 'text-muted-foreground font-medium'
                                    : chunk.status === 'Downloading'
                                    ? 'text-emerald-500 font-medium'
                                    : chunk.status === 'Pending'
                                    ? 'text-amber-500 font-medium'
                                    : chunk.status === 'Error'
                                    ? 'text-destructive font-medium'
                                    : 'text-foreground'
                                }`}
                              >
                                {chunk.status === 'Finished'
                                  ? 'Finished'
                                  : isPaused
                                  ? 'Paused'
                                  : chunk.status}
                              </span>
                            </td>
                            <td className="py-1.5 px-2 truncate">{formatBytes(chunk.downloaded)}</td>
                            <td className="py-1.5 px-2 truncate">{formatBytes(chunk.total)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td
                            colSpan={4}
                            className="py-4 text-center text-muted-foreground font-sans italic"
                          >
                            No chunk segments active...
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
      </Tabs>
    </div>
  );
};

export default RealTimeDownloadProgress;
