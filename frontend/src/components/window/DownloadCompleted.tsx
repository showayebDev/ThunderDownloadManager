import React, { useState, useEffect, useRef } from 'react';
import { Minus, X, Check, FileText } from 'lucide-react';
import { WindowMinimise, Quit } from '../../utils/tauriBridge';
import { invoke, listen } from '../../utils/tauriBridge';
import { Tooltip } from '../common/Tooltip';
import { useAppearance } from '../../context/AppearanceContext';
import { formatBytes as utilsFormatBytes } from '../../utils/formatters';
import { Button } from '@/components/ui/button';

export const DownloadCompleted: React.FC = () => {
  const { appearance } = useAppearance();
  const formatBytes = (bytes: number) =>
    utilsFormatBytes(bytes, 2, appearance?.downloadSizeUnit || 'Automatic');
  const [_taskId, setTaskId] = useState<string>('');
  const [name, setName] = useState<string>('');
  const [savePath, setSavePath] = useState<string>('');
  const [downloaded, setDownloaded] = useState<number>(0);
  const [totalSize, setTotalSize] = useState<number>(0);

  const taskIdRef = useRef<string>('');
  const nameRef = useRef<string>('');
  const savePathRef = useRef<string>('');
  const destPathRef = useRef<string>('');

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

  const handleMinimize = async () => {
    try {
      WindowMinimise();
    } catch {}
  };

  const handleClose = async () => {
    try {
      const currentId = taskIdRef.current || getInitialTaskId();
      if (currentId) {
        await invoke('clear_download_completed_payload', { id: currentId });
        await invoke('close_download_completed_window_command', { id: currentId });
      } else {
        await invoke('clear_download_completed_payload');
      }
      Quit();
    } catch {
      Quit();
    }
  };

  const getFullPath = (): string => {
    if (destPathRef.current) return destPathRef.current;
    const fn = name || nameRef.current;
    if (!fn) return '';
    if (fn.includes(':\\') || fn.startsWith('/') || fn.startsWith('\\\\')) {
      return fn;
    }
    const dir = savePath || savePathRef.current || '';
    if (!dir) return fn;
    const isWin = dir.includes('\\') || (!dir.includes('/') && /^[a-zA-Z]:/.test(dir));
    const sep = isWin ? '\\' : '/';
    const cleanPath = dir.replace(/[/\\]+$/, '');
    return `${cleanPath}${sep}${fn}`;
  };

  const handleOpenFile = async () => {
    const fullPath = getFullPath();
    if (!fullPath) return;
    try {
      await invoke('open_file_command', { filePath: fullPath });
    } catch (err) {
      console.error('Failed to open file:', err);
    } finally {
      handleClose();
    }
  };

  const handleOpenFolder = async () => {
    const fullPath = getFullPath();
    if (!fullPath) return;
    try {
      await invoke('open_folder_command', { filePath: fullPath });
    } catch (err) {
      console.error('Failed to open folder:', err);
    } finally {
      handleClose();
    }
  };

  const resetState = (p: any) => {
    if (!p) return;
    const tid = p?.id || p?.task_id || p?.taskId || '';
    if (tid) {
      setTaskId(tid);
      taskIdRef.current = tid;
    }
    const fn = p?.filename || p?.name || '';
    setName(fn);
    nameRef.current = fn;
    const sp = p?.save_path || p?.savePath || '';
    setSavePath(sp);
    savePathRef.current = sp;
    const dp = p?.dest_file_path || p?.destFilePath || p?.filePath || p?.path || '';
    if (dp) {
      destPathRef.current = dp;
    }
    setDownloaded(p?.downloaded ?? p?.downloaded_bytes ?? 0);
    setTotalSize(p?.total_size ?? p?.total_bytes ?? 0);
  };

  useEffect(() => {
    let unlistenOpen: (() => void) | undefined;
    let unlistenSpecific: (() => void) | undefined;
    let unlistenCloseSpecific: (() => void) | undefined;

    async function init() {
      try {
        const urlTaskId = getInitialTaskId();
        if (urlTaskId) {
          setTaskId(urlTaskId);
          taskIdRef.current = urlTaskId;
          try {
            const initPayload = await invoke<any>('get_download_completed_payload', { id: urlTaskId });
            if (initPayload) {
              resetState(initPayload);
            }
          } catch {}

          unlistenSpecific = await listen(`open-download-completed-payload-${urlTaskId}`, (event: any) => {
            const p = event.payload;
            if (p) resetState(p);
          });

          unlistenCloseSpecific = await listen(`close-download-completed-${urlTaskId}`, () => {
            Quit();
          });
        } else {
          try {
            const initPayload = await invoke<any>('get_latest_download_completed_payload');
            if (initPayload) {
              resetState(initPayload);
            }
          } catch {}
        }

        unlistenOpen = await listen('open-download-completed-payload', (event: any) => {
          const p = event.payload;
          if (!p) return;
          const incomingId = p.id || p.task_id || p.taskId || '';
          if (urlTaskId && incomingId && incomingId !== urlTaskId) return;
          if (!taskIdRef.current || incomingId === taskIdRef.current || !urlTaskId) {
            resetState(p);
          }
        });
      } catch {}
    }

    init();

    return () => {
      if (unlistenOpen) unlistenOpen();
      if (unlistenSpecific) unlistenSpecific();
      if (unlistenCloseSpecific) unlistenCloseSpecific();
    };
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen bg-card text-foreground font-sans text-xs select-none border border-border overflow-hidden">
      {/* Title Bar */}
      <div
        style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
        className="flex items-center justify-between px-3 py-2.5 bg-muted/40 border-b border-border shrink-0 cursor-move"
      >
        <div className="flex items-center space-x-2 min-w-0 pr-4 pointer-events-none">
          <div className="w-5 h-5 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center shrink-0">
            <img src="/icon.svg" alt="Logo" className="w-3.5 h-3.5 object-contain" />
          </div>
          <span className="text-[13px] font-semibold text-foreground truncate tracking-tight">
            {name || 'Download Completed'}
          </span>
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
            onClick={handleClose}
            className="p-1 hover:bg-red-500 hover:text-white dark:hover:bg-red-600 text-muted-foreground rounded transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Completion Body Content */}
      <div className="flex-1 flex items-center px-6 py-5 bg-card space-x-7">
        {/* File icon + size */}
        <div className="flex flex-col items-center justify-center shrink-0">
          <FileText className="w-10 h-10 text-muted-foreground stroke-[1.5]" />
          <span className="text-xs text-foreground font-medium mt-2 whitespace-nowrap">
            {formatBytes(totalSize || downloaded)}
          </span>
        </div>

        {/* Download Completed status + filename */}
        <div className="flex flex-col justify-center min-w-0 space-y-1">
          <div className="flex items-center space-x-2.5">
            <Check className="w-6 h-6 text-emerald-500 stroke-[3] shrink-0" />
            <span className="text-lg font-bold text-emerald-500 tracking-tight whitespace-nowrap">
              Download Completed
            </span>
          </div>
          <span className="text-xs text-muted-foreground font-medium pl-[34px] truncate">
            {name}
          </span>
        </div>
      </div>

      {/* Footer / Action Bar */}
      <div className="px-4 py-3 bg-muted/40 border-t border-border flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-2">
          <Tooltip text="Open downloaded file with default application" position="top-left">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleOpenFile}
              className="text-xs font-medium rounded-xl px-4"
            >
              Open
            </Button>
          </Tooltip>

          <Tooltip text="Show file location in Explorer" position="top-left">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleOpenFolder}
              className="text-xs font-medium rounded-xl px-4"
            >
              Open Folder
            </Button>
          </Tooltip>
        </div>

        <Tooltip text="Close notification" position="top-right">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClose}
            className="text-xs font-medium rounded-xl px-5"
          >
            Close
          </Button>
        </Tooltip>
      </div>
    </div>
  );
};

export default DownloadCompleted;
