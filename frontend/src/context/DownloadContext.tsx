import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import { DownloadItem, Category, GlobalSettings, DownloadStatus, QueueConfig } from '../types/download';
import { loadFromThunderDB, saveToThunderDB } from '../utils/thunderDB';
import { detectCategory } from '../utils/category';
import { invoke, listen } from '../utils/tauriBridge';
import { useAppearance } from './AppearanceContext';

interface DownloadContextType {
  downloads: DownloadItem[];
  queues: QueueConfig[];
  selectedCategory: Category;
  selectedStatus: 'All' | 'Finished' | 'Unfinished';
  selectedQueue: string;
  searchQuery: string;
  selectedIds: Set<string>;
  activeModal: 'newDownload' | 'downloadDetail' | 'settings' | 'extensionAddDownload' | 'queues' | 'downloadComplete' | 'deleteConfirm' | 'openSourceLicenses' | 'about' | 'batchDownload' | 'perHostSettings' | null;
  detailDownloadId: string | null;
  extensionPayload: any;
  globalSettings: GlobalSettings;
  
  // Action handlers
  setSearchQuery: (query: string) => void;
  setSelectedCategory: (cat: Category) => void;
  setSelectedStatus: (status: 'All' | 'Finished' | 'Unfinished') => void;
  setSelectedQueue: (queue: string) => void;
  toggleSelectId: (id: string) => void;
  toggleSelectAll: () => void;
  clearSelection: () => void;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  addDownload: (
    url: string,
    name: string,
    category: Category,
    savePath: string,
    queue: string,
    options?: {
      givenCheckSum?: string;
      expectedChecksum?: string;
      threadCount?: number;
      speedLimit?: number | null;
      protocol?: string;
      username?: string;
      password?: string;
      userAgent?: string;
      referer?: string;
      cookies?: string;
      [key: string]: any;
    }
  ) => Promise<string>;
  addBatchDownloads: (
    items: Array<{
      url: string;
      filename?: string;
      category?: Category;
      savePath?: string;
      queue?: string;
      useCategory?: boolean;
      options?: {
        threadCount?: number;
        speedLimit?: number | null;
        protocol?: string;
        username?: string;
        password?: string;
        userAgent?: string;
        referer?: string;
        cookies?: string;
        [key: string]: any;
      };
    }>,
    startImmediately?: boolean,
    onProgress?: (current: number, total: number, currentItemName?: string) => void
  ) => Promise<void>;
  resumeSelected: () => void;
  pauseSelected: () => void;
  pauseItem: (id: string) => Promise<void>;
  resumeItem: (id: string, force?: boolean) => Promise<void>;
  deleteSelected: () => void;
  deleteAllMissing: () => Promise<void>;
  deleteAllFinished: () => Promise<void>;
  deleteAllUnfinished: () => Promise<void>;
  deleteEntireList: () => Promise<void>;
  addQueue: (name: string) => Promise<string>;
  updateQueue: (id: string, updates: Partial<QueueConfig>) => Promise<void>;
  saveQueues: (newQueues: QueueConfig[]) => Promise<void>;
  deleteQueue: (id: string) => Promise<void>;
  reorderQueueItems: (queueName: string, fromIndex: number, toIndex: number) => void;
  removeItemFromQueue: (id: string) => void;
  startQueue: (queueIdentifier?: string) => Promise<void>;
  stopQueue: (queueIdentifier?: string) => Promise<void>;
  stopAll: () => void;
  openModal: (modal: 'newDownload' | 'downloadDetail' | 'settings' | 'extensionAddDownload' | 'queues' | 'downloadComplete' | 'deleteConfirm' | 'openSourceLicenses' | 'about' | 'batchDownload' | 'perHostSettings', downloadId?: string) => void;
  closeModal: () => void;
  updateDownloadItem: (id: string, updates: Partial<DownloadItem>) => void;
  updateGlobalSettings: (settings: Partial<GlobalSettings>) => void;
  
  // Computed metrics
  filteredDownloads: DownloadItem[];
  categoryCounts: Record<Category, number>;
  statusCounts: { finished: number; unfinished: number };
  queueCounts: Record<string, number>;
  totalSpeed: number;
}

const defaultSettings: GlobalSettings = {
  downloadPath: '',
  defaultThreadCount: 8,
  maxConcurrentDownloads: 0, // 0 = unlimited
  maxRetries: 3,
  dynamicPartCreation: true,
  useCategoryByDefault: true,
  globalSpeedLimit: null,
  globalSpeedLimiter: false,
  autoStartWithSystem: true,
  onCompletionAction: 'none',
  showEndTime: true,
  userAgent: '',
  ignoreSsl: false,
  useServersLastModified: false,
  trackDeletedFiles: true,
  appendExtensionToIncomplete: true,
  deletePartialOnFileCancel: false,
  sparseFileAllocation: true,
  browserIntegration: true,
  port: '37555',
  vaultItems: [],
  proxyConfig: {
    mode: 'none',
    pacUrl: '',
    proxyType: 'HTTP',
    host: '',
    port: '',
    useAuth: false,
    username: '',
    password: '',
    bypassList: 'localhost 127.0.0.1 <local>',
  },
  proxyEnabled: false,
  proxyHost: '',
  proxyPort: '',
};


const defaultQueues: QueueConfig[] = [
  {
    id: 'main',
    name: 'Main',
    maxConcurrent: 2,
    scheduleEnabled: false,
    activeDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    enableAutoStartTime: false,
    autoStartTime: '02:30',
    enableAutoStopTime: false,
    autoStopTime: '07:30',
    isRunning: false,
    showRealTimeProgress: false,
    showCompletionWindow: false,
  },
];

const sanitizeDownloadItem = (item: DownloadItem): DownloadItem => {
  const detected = detectCategory(item.name || item.url);
  let cat = item.category;
  if (!cat || cat === 'All' || ((cat === 'Programs' || cat === 'Documents') && detected === 'Videos')) {
    cat = detected;
  }

  // Reset active states to paused on startup
  let resolvedStatus = item.status;
  let resolvedSpeed = item.speed;
  let resolvedTimeLeft = item.timeLeft;
  if (resolvedStatus === 'Downloading' || resolvedStatus === 'Pending' || resolvedStatus === 'Merging') {
    resolvedStatus = 'Paused';
    resolvedSpeed = 0;
    resolvedTimeLeft = 'Paused';
  } else if ((resolvedStatus === 'Canceled' || (resolvedStatus as string) === 'Cancelled') && item.downloaded > 0 && item.size > 0 && item.downloaded >= item.size) {
    // Mark complete downloads as finished
    resolvedStatus = 'Finished';
    resolvedSpeed = 0;
    resolvedTimeLeft = '-';
  } else if (resolvedStatus === 'Finished' && item.size > 0 && item.downloaded < item.size) {
    // Incomplete file was prematurely marked finished - restore to Paused
    resolvedStatus = 'Paused';
    resolvedSpeed = 0;
    resolvedTimeLeft = 'Paused';
  }

  let resolvedDateAdded = item.dateAdded;
  if (!resolvedDateAdded || resolvedDateAdded === 'Just now' || isNaN(Date.parse(resolvedDateAdded))) {
    const tsFromId = !isNaN(Number(item.id)) && Number(item.id) > 1000000000000 ? Number(item.id) : Date.now();
    resolvedDateAdded = new Date(tsFromId).toISOString();
  }

  let resolvedEndTime = item.endTime || item.dateCompleted;
  if (resolvedStatus === 'Finished' && (!resolvedEndTime || resolvedEndTime === 'Just now' || isNaN(Date.parse(resolvedEndTime)))) {
    resolvedEndTime = new Date().toISOString();
  }

  const rawChecksum = (item as any).givenCheckSum || (item as any).given_checksum || (item as any).expectedChecksum || (item as any).expected_checksum || '';

  const sanitized: DownloadItem = {
    ...item,
    category: cat,
    status: resolvedStatus,
    speed: resolvedSpeed,
    timeLeft: resolvedTimeLeft,
    dateAdded: resolvedDateAdded,
    dateCompleted: resolvedEndTime,
    endTime: resolvedEndTime,
  };

  if (rawChecksum && typeof rawChecksum === 'string' && rawChecksum.trim() !== '') {
    sanitized.givenCheckSum = rawChecksum.trim();
    sanitized.expectedChecksum = rawChecksum.trim();
  } else {
    delete sanitized.givenCheckSum;
    delete sanitized.expectedChecksum;
  }

  return sanitized;
};

const DownloadContext = createContext<DownloadContextType | undefined>(undefined);

export const DownloadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [queues, setQueues] = useState<QueueConfig[]>(defaultQueues);

  const [selectedCategory, setSelectedCategory] = useState<Category>('All');
  const [selectedStatus, setSelectedStatus] = useState<'All' | 'Finished' | 'Unfinished'>('All');
  const [selectedQueue, setSelectedQueue] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeModal, setActiveModal] = useState<'newDownload' | 'downloadDetail' | 'settings' | 'extensionAddDownload' | 'queues' | 'downloadComplete' | 'deleteConfirm' | 'openSourceLicenses' | 'about' | 'batchDownload' | 'perHostSettings' | null>(null);
  const [detailDownloadId, setDetailDownloadId] = useState<string | null>(null);
  const [extensionPayload, setExtensionPayload] = useState<any>(null);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>(defaultSettings);

  const { appearance } = useAppearance();
  const appearanceRef = React.useRef(appearance);

  useEffect(() => {
    appearanceRef.current = appearance;
  }, [appearance]);

  const isLoaded = React.useRef(false);

  // Load persisted data on mount
  useEffect(() => {
    async function loadStorageData() {
      let sysDownloadDir = '';
      try {
        sysDownloadDir = (await invoke<string>('get_default_download_dir')) || '';
      } catch {}

      const loadedDownloads = await loadFromThunderDB<DownloadItem[]>('downloads', []);
      if (loadedDownloads && loadedDownloads.length > 0) {
        const sanitized = loadedDownloads.map(sanitizeDownloadItem);
        setDownloads(sanitized);
        downloadsRef.current = sanitized;
      }

      const loadedQueues = await loadFromThunderDB<QueueConfig[]>('queues', defaultQueues);
      if (loadedQueues && Array.isArray(loadedQueues) && loadedQueues.length > 0) {
        const sanitizedQueues = loadedQueues.map((q) => ({ ...q, isRunning: false }));
        setQueues(sanitizedQueues);
        queuesRef.current = sanitizedQueues;
      }

      let loadedSettings = await loadFromThunderDB<GlobalSettings>('download_engine', defaultSettings);
      
      // Migrate legacy settings if present
      try {
        const legacySettings = await loadFromThunderDB<any>('settings', null);
        if (legacySettings) {
          loadedSettings = { ...defaultSettings, ...legacySettings, ...loadedSettings };
        }
        const legacyEngine = await loadFromThunderDB<any>('engine_settings', null);
        if (legacyEngine) {
          loadedSettings = { ...defaultSettings, ...legacyEngine, ...loadedSettings };
        }
      } catch {}

      if (loadedSettings) {
        if (!loadedSettings.downloadPath && sysDownloadDir) {
          loadedSettings.downloadPath = sysDownloadDir;
        }
        if (!loadedSettings.defaultThreadCount && (loadedSettings as any).threadCount) {
          loadedSettings.defaultThreadCount = (loadedSettings as any).threadCount;
        }
        setGlobalSettings(loadedSettings);
        globalSettingsRef.current = loadedSettings;
      } else if (sysDownloadDir) {
        setGlobalSettings((prev) => {
          const next = { ...prev, downloadPath: sysDownloadDir };
          globalSettingsRef.current = next;
          return next;
        });
      }
      
      isLoaded.current = true;
    }
    loadStorageData();
  }, []);

  // Pause active downloads before window closes
  useEffect(() => {
    const handleBeforeUnload = () => {
      try {
        const currentList = downloadsRef.current || downloads;
        const paused = currentList.map((d) =>
          d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging'
            ? { ...d, status: 'Paused' as DownloadStatus, speed: 0, timeLeft: 'Paused' }
            : d
        );
        saveToThunderDB('downloads', paused);
        const stoppedQueues = (queuesRef.current || queues).map((q) => ({ ...q, isRunning: false }));
        saveToThunderDB('queues', stoppedQueues);
      } catch {}
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Reliable periodic background flush to SQLite (every 2 seconds) so sudden exits or Ctrl+C never lose progress
  useEffect(() => {
    const interval = setInterval(() => {
      if (isLoaded.current && downloadsRef.current && downloadsRef.current.length > 0) {
        saveToThunderDB('downloads', downloadsRef.current);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isLoaded.current) {
      saveToThunderDB('queues', queues);
    }
  }, [queues]);

  useEffect(() => {
    if (isLoaded.current) {
      saveToThunderDB('download_engine', globalSettings);
    }
  }, [globalSettings]);

  const globalSettingsRef = React.useRef(globalSettings);
  globalSettingsRef.current = globalSettings;
  const queuesRef = React.useRef(queues);
  queuesRef.current = queues;
  const downloadsRef = React.useRef(downloads);
  downloadsRef.current = downloads;
  const startingTaskIdsRef = React.useRef<Set<string>>(new Set());

  // Poll filesystem to verify existence of downloaded files
  useEffect(() => {
    if (!globalSettings.trackDeletedFiles) {
      // Clear missing flags when tracking is disabled
      setDownloads((prev) => {
        if (prev.some((d) => d.fileMissing)) {
          return prev.map((d) => (d.fileMissing ? { ...d, fileMissing: false } : d));
        }
        return prev;
      });
      return;
    }

    const checkDiskFiles = async () => {
      const currentDownloads = downloadsRef.current;
      if (!currentDownloads || currentDownloads.length === 0) return;

      const baseDir = globalSettingsRef.current?.downloadPath || '';
      const isWinBase = baseDir.includes('\\') || (!baseDir.includes('/') && /^[a-zA-Z]:/.test(baseDir));
      const defaultSep = isWinBase ? '\\' : '/';
      const cleanDefaultBase = baseDir.replace(/[\/\\]+$/, '');

      const pathsToCheck: string[] = [];
      const itemPathMap = new Map<string, string[]>();

      currentDownloads.forEach((d) => {
        if (!d.name) return;
        const candidatePaths: string[] = [];

        if (d.savePath) {
          const isWin = d.savePath.includes('\\') || (!d.savePath.includes('/') && /^[a-zA-Z]:/.test(d.savePath));
          const sep = isWin ? '\\' : '/';
          const cleanBase = d.savePath.replace(/[\/\\]+$/, '');
          candidatePaths.push(`${cleanBase}${sep}${d.name}`);

          const isRelative = !d.savePath.includes(':') && !d.savePath.startsWith('/') && !d.savePath.startsWith('\\\\');
          if (isRelative && cleanDefaultBase) {
            candidatePaths.push(`${cleanDefaultBase}${defaultSep}${cleanBase}${defaultSep}${d.name}`);
            candidatePaths.push(`${cleanDefaultBase}${defaultSep}${d.name}`);
          }
        } else if (cleanDefaultBase) {
          if (d.category && d.category !== 'All') {
            candidatePaths.push(`${cleanDefaultBase}${defaultSep}${d.category}${defaultSep}${d.name}`);
          }
          candidatePaths.push(`${cleanDefaultBase}${defaultSep}${d.name}`);
        }

        candidatePaths.forEach((p) => {
          pathsToCheck.push(p);
        });
        itemPathMap.set(d.id, candidatePaths);
      });

      if (pathsToCheck.length === 0) return;

      try {
        const infoMap = await invoke<Record<string, { exists: boolean; size: number }>>('check_files_info_command', { paths: pathsToCheck });
        if (infoMap && typeof infoMap === 'object') {
          let hasSavePathFix = false;
          setDownloads((prev) => {
            let changed = false;
            const updated = prev.map((d) => {
              const candidates = itemPathMap.get(d.id) || [];
              let foundStat: { exists: boolean; size: number } | undefined;
              let foundPath: string | undefined;

              for (const p of candidates) {
                let stat = infoMap[p];
                if (stat === undefined) {
                  const alt1 = p.replace(/\//g, '\\');
                  const alt2 = p.replace(/\\/g, '/');
                  stat = infoMap[alt1] ?? infoMap[alt2];
                }
                if (stat && stat.exists) {
                  foundStat = stat;
                  foundPath = p;
                  break;
                }
                if (stat && !foundStat) {
                  foundStat = stat;
                  foundPath = p;
                }
              }

              if (!foundStat) return d;

              let healedSavePath = d.savePath;
              if (foundStat.exists && foundPath) {
                const isRel = !d.savePath || (!d.savePath.includes(':') && !d.savePath.startsWith('/') && !d.savePath.startsWith('\\\\'));
                if (isRel) {
                  const dir = foundPath.replace(/[\/\\][^\/\\]+$/, '');
                  if (dir && dir !== d.savePath) {
                    healedSavePath = dir;
                    hasSavePathFix = true;
                  }
                }
              }

              if (d.status === 'Finished') {
                const isMissing = !foundStat.exists;
                if (d.fileMissing !== isMissing || d.savePath !== healedSavePath) {
                  changed = true;
                  return { ...d, fileMissing: isMissing, savePath: healedSavePath };
                }
              } else if (foundStat.exists && foundStat.size > 0 && (d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Paused' || d.status === 'Error')) {
                // If file is already fully completed on disk
                const finalSize = d.size > 0 ? d.size : 0;
                if (finalSize > 0 && foundStat.size >= finalSize) {
                  changed = true;
                  return {
                    ...d,
                    savePath: healedSavePath,
                    status: 'Finished' as DownloadStatus,
                    downloaded: foundStat.size,
                    size: finalSize,
                    speed: 0,
                    timeLeft: '-',
                    fileMissing: false,
                    dateCompleted: d.dateCompleted || new Date().toISOString(),
                    endTime: d.endTime || new Date().toISOString(),
                  };
                }
              }
              if (d.savePath !== healedSavePath) {
                changed = true;
                return { ...d, savePath: healedSavePath };
              }
              return d;
            });

            if (!changed) return prev;
            downloadsRef.current = updated;
            if (hasSavePathFix) {
              saveToThunderDB('downloads', updated);
            }
            return updated;
          });
        }
      } catch (err) {
        console.error('Failed to check deleted files:', err);
      }
    };

    checkDiskFiles();
    const interval = setInterval(checkDiskFiles, 2000);
    window.addEventListener('focus', checkDiskFiles);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', checkDiskFiles);
    };
  }, [globalSettings.trackDeletedFiles]);

  // Count items per category
  const categoryCounts = useMemo(() => {
    const counts: Record<Category, number> = {
      All: downloads.length,
      Compressed: 0,
      Programs: 0,
      Videos: 0,
      Music: 0,
      Pictures: 0,
      Documents: 0,
    };
    downloads.forEach((item) => {
      if (item.category && item.category !== 'All') {
        counts[item.category] = (counts[item.category] || 0) + 1;
      }
    });
    return counts;
  }, [downloads]);

  // Count finished vs unfinished
  const statusCounts = useMemo(() => {
    const finished = downloads.filter((d) => d.status === 'Finished').length;
    const unfinished = downloads.length - finished;
    return { finished, unfinished };
  }, [downloads]);

  // Count downloads per queue
  const queueCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    queues.forEach((q) => {
      counts[q.name] = 0;
      counts[q.id] = 0;
    });
    downloads.forEach((d) => {
      if (d.queue && d.queue.trim() !== '') {
        counts[d.queue] = (counts[d.queue] || 0) + 1;
      }
    });
    return counts;
  }, [queues, downloads]);

  // Calculate aggregate download speed
  const totalSpeed = useMemo(() => {
    return downloads.reduce((acc, d) => acc + (d.status === 'Downloading' ? d.speed : 0), 0);
  }, [downloads]);

  // Filter items by category, status, queue, and query
  const filteredDownloads = useMemo(() => {
    return downloads.filter((item) => {
      // Filter by category
      if (selectedCategory !== 'All' && item.category !== selectedCategory) {
        return false;
      }
      // Filter by status
      if (selectedStatus === 'Finished' && item.status !== 'Finished') {
        return false;
      }
      if (selectedStatus === 'Unfinished' && item.status === 'Finished') {
        return false;
      }
      // Filter by active queue
      if (selectedQueue && selectedQueue !== 'All' && selectedCategory === 'All' && selectedStatus === 'All') {
        const itemQueue = (item.queue || '').toLowerCase();
        if (itemQueue !== selectedQueue.toLowerCase()) {
          return false;
        }
      }
      // Filter by search keyword
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return item.name.toLowerCase().includes(q) || item.url.toLowerCase().includes(q);
      }
      return true;
    });
  }, [downloads, selectedCategory, selectedStatus, selectedQueue, searchQuery]);

  const toggleSelectId = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredDownloads.length && filteredDownloads.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredDownloads.map((d) => d.id)));
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const pendingProgressMapRef = React.useRef<Map<string, any>>(new Map());
  const progressFlushTimerRef = React.useRef<any>(null);

  // Listen for backend progress events with high-performance throttled batching
  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenAdded: (() => void) | undefined;
    let unlistenRegister: (() => void) | undefined;
    let unlistenTray: (() => void) | undefined;
    let unlistenError: (() => void) | undefined;
    let isMounted = true;

    let dispatchQueueTimer: any = null;
    const scheduleQueueDispatch = () => {
      if (dispatchQueueTimer) return;
      dispatchQueueTimer = setTimeout(() => {
        dispatchQueueTimer = null;
        dispatchQueueWorkers();
      }, 150);
    };

    const flushProgressBatch = () => {
      if (pendingProgressMapRef.current.size === 0) return;
      const updates = new Map(pendingProgressMapRef.current);
      pendingProgressMapRef.current.clear();

      let finishedIds: string[] = [];
      let hadTerminalChange = false;

      setDownloads((prev) => {
        let changed = false;
        const next = prev.map((d) => {
          const payload = updates.get(d.id);
          if (!payload) return d;
          changed = true;

          const isFinished = payload.status === 'Finished';
          if (isFinished) {
            if (d.status !== 'Finished') {
              finishedIds.push(d.id);
            }
            hadTerminalChange = true;
          } else if (payload.status === 'Error' || payload.status === 'Canceled' || payload.status === 'Paused') {
            hadTerminalChange = true;
          }

          const finishTime = isFinished ? (d.endTime || d.dateCompleted || new Date().toISOString()) : d.endTime;
          
          // Format remaining time
          let timeLeftStr = d.timeLeft;
          if (payload.status === 'Paused') {
            timeLeftStr = 'Paused';
          } else if (payload.status === 'Canceled') {
            timeLeftStr = '-';
          } else if (payload.status === 'Error') {
            timeLeftStr = 'Error';
          } else if (payload.eta !== undefined) {
            if (payload.eta === 0) timeLeftStr = '0s';
            else {
              const h = Math.floor(payload.eta / 3600);
              const m = Math.floor((payload.eta % 3600) / 60);
              const s = Math.floor(payload.eta % 60);
              const parts: string[] = [];
              if (h > 0) parts.push(`${h}h`);
              if (m > 0) parts.push(`${m}m`);
              if (s > 0) parts.push(`${s}s`);
              timeLeftStr = parts.join(' ') || '0s';
            }
          } else if (payload.time_left !== undefined) {
            timeLeftStr = payload.time_left;
          }

          const incomingDL = payload.downloaded_bytes !== undefined ? payload.downloaded_bytes : payload.downloaded;
          const incomingTotal = payload.total_bytes || payload.total_size;

          const finalDL = (incomingDL !== undefined && incomingDL !== null)
            ? incomingDL
            : d.downloaded;

          const finalSize = (incomingTotal && incomingTotal > 0)
            ? incomingTotal
            : d.size;

          const updatedFilename = payload.filename || d.name;
          const detectedCat = detectCategory(updatedFilename || d.url);
          const updatedCat = (d.category && d.category !== 'All' && !((d.category === 'Programs' || d.category === 'Documents') && detectedCat === 'Videos'))
            ? d.category
            : detectedCat;

          let finalStatus = (payload.status as any) || d.status;
          if (payload.status === 'Finished' || (finalSize > 0 && finalDL >= finalSize && (payload.status === 'Finished' || isFinished))) {
            finalStatus = 'Finished';
          }

          let updatedResumeSupport = d.resumeSupport;
          if (payload.resume_support !== undefined && payload.resume_support !== null) {
            updatedResumeSupport = (payload.resume_support === 'Yes' || payload.resume_support === true) ? 'Yes' : 'No';
          } else if (payload.resumable !== undefined && payload.resumable !== null) {
            updatedResumeSupport = payload.resumable ? 'Yes' : 'No';
          } else if (payload.accept_ranges !== undefined && payload.accept_ranges !== null) {
            updatedResumeSupport = payload.accept_ranges ? 'Yes' : 'No';
          }

          const incomingChecksum = payload.given_checksum || payload.givenCheckSum || payload.expected_checksum || payload.expectedChecksum;
          const finalChecksum = (incomingChecksum && incomingChecksum.trim()) ? incomingChecksum.trim() : (d.givenCheckSum || d.expectedChecksum || '');

          const finalSpeed = finalStatus === 'Finished' || finalStatus === 'Paused' || finalStatus === 'Canceled' || finalStatus === 'Error' ? 0 : (payload.speed !== undefined ? payload.speed : d.speed);
          const finalTimeLeft = finalStatus === 'Finished' ? '-' : timeLeftStr;

          // Check if any visible property actually changed before creating new object
          const isItemUnchanged =
            d.name === updatedFilename &&
            d.category === updatedCat &&
            d.downloaded === finalDL &&
            d.size === finalSize &&
            d.speed === finalSpeed &&
            d.status === finalStatus &&
            d.timeLeft === finalTimeLeft &&
            d.resumeSupport === updatedResumeSupport &&
            (payload.chunks === undefined || payload.chunks === null);

          if (isItemUnchanged) {
            return d;
          }

          changed = true;

          const updatedItem: DownloadItem = {
            ...d,
            name: updatedFilename,
            category: updatedCat,
            downloaded: finalDL,
            size: finalSize,
            speed: finalSpeed,
            status: finalStatus,
            timeLeft: finalTimeLeft,
            resumeSupport: updatedResumeSupport,
            threadCount: (payload.thread_count && payload.thread_count > 0) ? payload.thread_count : ((payload as any).threadCount || d.threadCount || 8),
            speedLimit: payload.speed_limit !== undefined ? payload.speed_limit : d.speedLimit,
            proxyUsed: payload.proxy_used !== undefined ? payload.proxy_used : d.proxyUsed,
            errorMessage: payload.error_message || d.errorMessage,
            dateCompleted: finishTime,
            endTime: finishTime,
            chunks: (payload.chunks || []).map((c: any) => ({
              id: c.id,
              status: (c.status as any) || 'Downloading',
              downloaded: c.downloaded,
              total: c.total,
            })),
          };

          if (finalChecksum && finalChecksum.trim()) {
            updatedItem.givenCheckSum = finalChecksum.trim();
            updatedItem.expectedChecksum = finalChecksum.trim();
          } else if (!updatedItem.givenCheckSum) {
            delete updatedItem.givenCheckSum;
            delete updatedItem.expectedChecksum;
          }

          return updatedItem;
        });

        if (!changed) return prev;
        downloadsRef.current = next;
        return next;
      });

      if (finishedIds.length > 0) {
        setDetailDownloadId(finishedIds[finishedIds.length - 1]);
      }

      if (hadTerminalChange) {
        scheduleQueueDispatch();
      }
    };
    
    async function setupListener() {
      try {
        unlistenProgress = await listen<{
          id: string;
          downloaded: number;
          total_size: number;
          speed: number;
          status: string;
          time_left: string;
          chunks: Array<{
            id: number;
            start_byte: number;
            end_byte: number;
            downloaded: number;
            total: number;
            status: string;
          }>;
          error_message?: string;
        }>('download-progress', (event: { payload: any }) => {
          const payload = event.payload;
          const taskId = payload.task_id || payload.id;
          if (!taskId) return;

          const isTerminal = payload.status === 'Finished' || payload.status === 'Error' || payload.status === 'Paused' || payload.status === 'Canceled';
          pendingProgressMapRef.current.set(taskId, payload);

          if (isTerminal) {
            if (progressFlushTimerRef.current) {
              clearTimeout(progressFlushTimerRef.current);
              progressFlushTimerRef.current = null;
            }
            flushProgressBatch();
          } else if (!progressFlushTimerRef.current) {
            progressFlushTimerRef.current = setTimeout(() => {
              progressFlushTimerRef.current = null;
              flushProgressBatch();
            }, 250); // Responsive 250ms batching for smooth progress without CPU saturation
          }
        });

        unlistenError = await listen<any>('download-error', (event: { payload: any }) => {
          const payload = event.payload || {};
          const taskId = payload.task_id || payload.id;
          if (!taskId) return;

          setDownloads((prev) => {
            const next = prev.map((d) => {
              if (d.id === taskId) {
                return {
                  ...d,
                  status: 'Error' as DownloadStatus,
                  speed: 0,
                  timeLeft: 'Error',
                  errorMessage: payload.error || d.errorMessage || 'Download error occurred',
                };
              }
              return d;
            });
            downloadsRef.current = next;
            return next;
          });
          scheduleQueueDispatch();
        });

        unlistenAdded = await listen<{
          id: string;
          url: string;
          filename: string;
          save_path: string;
          category?: Category;
          queue?: string;
          given_checksum?: string;
          givenCheckSum?: string;
          expected_checksum?: string;
          expectedChecksum?: string;
        }>('download-added', (event: { payload: any }) => {
          const payload = event.payload;
          if (!payload || !payload.id) return;
          const incomingChecksum = (payload.given_checksum || payload.givenCheckSum || payload.expected_checksum || payload.expectedChecksum || '').trim();
          const prev = downloadsRef.current || [];
          const existingIndex = prev.findIndex((d) => d.id === payload.id);
          if (existingIndex >= 0) {
            // Already present in state (e.g. from addBatchDownloads or newDownload modal), do not recreate or flood DB
            return;
          }
          const filename = payload.filename || payload.url.split('/').pop() || 'download';
          const cat = (payload.category && payload.category !== 'All')
            ? payload.category
            : detectCategory(filename || payload.url);

          let targetSave = payload.save_path || globalSettingsRef.current.downloadPath || defaultSettings.downloadPath;
          const isRel = !targetSave || (!targetSave.includes(':') && !targetSave.startsWith('/') && !targetSave.startsWith('\\\\'));
          if (isRel) {
            const base = globalSettingsRef.current.downloadPath || defaultSettings.downloadPath;
            if (base) {
              const isWin = base.includes('\\') || (!base.includes('/') && /^[a-zA-Z]:/.test(base));
              const sep = isWin ? '\\' : '/';
              const cleanBase = base.replace(/[\/\\]+$/, '');
              targetSave = targetSave ? `${cleanBase}${sep}${targetSave}` : cleanBase;
            }
          }

          const newItem: DownloadItem = {
            id: payload.id,
            name: filename,
            category: cat,
            url: payload.url,
            size: 0,
            downloaded: 0,
            status: 'Downloading',
            speed: 0,
            timeLeft: 'Calculating...',
            dateAdded: new Date().toISOString(),
            queue: payload.queue || '',
            savePath: targetSave,
            resumeSupport: (payload.resume_support === 'Yes' || payload.resume_support === 'No')
              ? payload.resume_support
              : (payload.resumable !== undefined
                ? (payload.resumable ? 'Yes' : 'No')
                : (payload.accept_ranges !== undefined
                  ? (payload.accept_ranges ? 'Yes' : 'No')
                  : 'Unknown')),
            threadCount: (payload.thread_count && payload.thread_count > 0)
              ? payload.thread_count
              : ((payload as any).threadCount || globalSettingsRef.current.defaultThreadCount || 8),
            chunks: [],
          };
          if (incomingChecksum) {
            newItem.givenCheckSum = incomingChecksum;
            newItem.expectedChecksum = incomingChecksum;
          }
          const updated = [newItem, ...prev];
          setDownloads(updated);
          downloadsRef.current = updated;
          saveToThunderDB('downloads', updated);
        });

        unlistenRegister = await listen<any>('register-download-item', (event: { payload: any }) => {
          const payload = event.payload;
          if (!payload || !payload.id) return;
          const prev = downloadsRef.current || [];
          const existingIndex = prev.findIndex((d) => d.id === payload.id);
          let itemPayload = { ...payload };
          if (itemPayload.savePath) {
            const isRel = !itemPayload.savePath.includes(':') && !itemPayload.savePath.startsWith('/') && !itemPayload.savePath.startsWith('\\\\');
            if (isRel) {
              const base = globalSettingsRef.current.downloadPath || defaultSettings.downloadPath;
              if (base) {
                const isWin = base.includes('\\') || (!base.includes('/') && /^[a-zA-Z]:/.test(base));
                const sep = isWin ? '\\' : '/';
                const cleanBase = base.replace(/[\/\\]+$/, '');
                itemPayload.savePath = `${cleanBase}${sep}${itemPayload.savePath}`;
              }
            }
          }
          let updated: DownloadItem[];
          if (existingIndex >= 0) {
            updated = [...prev];
            updated[existingIndex] = sanitizeDownloadItem({
              ...updated[existingIndex],
              ...itemPayload,
              givenCheckSum: itemPayload.givenCheckSum || (itemPayload as any).given_checksum || updated[existingIndex].givenCheckSum,
              expectedChecksum: itemPayload.expectedChecksum || (itemPayload as any).expected_checksum || updated[existingIndex].expectedChecksum,
            });
          } else {
            updated = [sanitizeDownloadItem(itemPayload), ...prev];
          }
          setDownloads(updated);
          downloadsRef.current = updated;
          saveToThunderDB('downloads', updated);
        });

        unlistenTray = await listen('download-item-tray-changed', (event: any) => {
          const payload = event.payload || {};
          if (payload.id) {
            setDownloads((prev) =>
              prev.map((d) => (d.id === payload.id ? { ...d, inTray: Boolean(payload.inTray) } : d))
            );
          }
        });

        if (!isMounted) {
          if (unlistenProgress) unlistenProgress();
          if (unlistenAdded) unlistenAdded();
          if (unlistenRegister) unlistenRegister();
          if (unlistenTray) unlistenTray();
          if (unlistenError) unlistenError();
        }
      } catch {
        // Browser fallback
      }
    }

    setupListener();

    return () => {
      isMounted = false;
      if (unlistenProgress) unlistenProgress();
      if (unlistenAdded) unlistenAdded();
      if (unlistenRegister) unlistenRegister();
      if (unlistenTray) unlistenTray();
      if (unlistenError) unlistenError();
    };
  }, []);

  const addDownload = async (
    url: string,
    name: string,
    category: Category,
    savePath: string,
    queue: string,
    options?: {
      givenCheckSum?: string;
      expectedChecksum?: string;
      threadCount?: number;
      speedLimit?: number | null;
      protocol?: string;
      username?: string;
      password?: string;
      userAgent?: string;
      referer?: string;
      cookies?: string;
      [key: string]: any;
    }
  ) => {
    const id = Date.now().toString();
    let filename = name || url.split('/').pop() || 'download';
    const isHLS = url.toLowerCase().includes('.m3u8') || filename.toLowerCase().endsWith('.m3u8');
    if (isHLS && filename.toLowerCase().endsWith('.m3u8')) {
      const base = filename.replace(/\.m3u8$/i, '');
      filename = (base === '' || base === 'master' || base === 'playlist' || base === 'index') ? 'video.mp4' : `${base}.mp4`;
    }
    const cat = isHLS ? 'Videos' : ((category && category !== 'All') ? category : detectCategory(filename || url));
    
    const isWin = globalSettings.downloadPath.includes('\\') || (!globalSettings.downloadPath.includes('/') && /^[a-zA-Z]:/.test(globalSettings.downloadPath));
    const sep = isWin ? '\\' : '/';
    const cleanBase = globalSettings.downloadPath.endsWith('\\') || globalSettings.downloadPath.endsWith('/')
      ? globalSettings.downloadPath.slice(0, -1)
      : globalSettings.downloadPath;
    const categoryPath = (globalSettings.useCategoryByDefault !== false && cat && (cat as string) !== 'All')
      ? (globalSettings.categoryPaths && globalSettings.categoryPaths[cat] ? globalSettings.categoryPaths[cat] : `${cleanBase}${sep}${cat}`)
      : globalSettings.downloadPath;

    let targetPath = savePath;
    const isRelativeOrJustCat = !targetPath || targetPath === cat || (!targetPath.includes('/') && !targetPath.includes('\\'));
    if (isRelativeOrJustCat || targetPath === globalSettings.downloadPath || targetPath === cleanBase) {
      targetPath = (globalSettings.useCategoryByDefault !== false && cat && (cat as string) !== 'All') ? categoryPath : (savePath || globalSettings.downloadPath);
    }
    const givenHash = options?.givenCheckSum || options?.expectedChecksum || '';

    // Disambiguate duplicate filename if needed
    let finalFilename = filename;
    const existingNamesInPath = new Set(
      (downloadsRef.current || downloads)
        .filter((d) => (d.savePath || '').toLowerCase() === targetPath.toLowerCase())
        .map((d) => d.name.toLowerCase())
    );
    if (existingNamesInPath.has(finalFilename.toLowerCase())) {
      const lastDot = filename.lastIndexOf('.');
      const baseName = lastDot > 0 ? filename.slice(0, lastDot) : filename;
      const ext = lastDot > 0 ? filename.slice(lastDot) : '';
      let counter = 1;
      while (existingNamesInPath.has(`${baseName}_${counter}${ext}`.toLowerCase())) {
        counter++;
      }
      finalFilename = `${baseName}_${counter}${ext}`;
    }

    const isQueueAssigned = Boolean(queue && queue.trim() !== '');
    const targetQueue = isQueueAssigned
      ? (queuesRef.current || queues).find(
          (q) => q.name.toLowerCase() === queue.trim().toLowerCase() || q.id.toLowerCase() === queue.trim().toLowerCase()
        )
      : undefined;
    const isQueueRunning = Boolean(targetQueue && targetQueue.isRunning);

    let initialStatus: DownloadStatus = 'Downloading';
    let initialTimeLeft = 'Calculating...';

    if (isQueueAssigned) {
      if (!targetQueue || !isQueueRunning) {
        initialStatus = 'Queued';
        initialTimeLeft = 'Queued';
      } else {
        const qMax = Math.max(1, targetQueue.maxConcurrent || 1);
        const qActive = (downloadsRef.current || downloads).filter(
          (d) =>
            Boolean(d.queue && d.queue.trim() !== '') &&
            (d.queue!.toLowerCase() === targetQueue.name.toLowerCase() ||
              d.queue!.toLowerCase() === targetQueue.id.toLowerCase()) &&
            (d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging')
        ).length;
        if (qActive >= qMax) {
          initialStatus = 'Queued';
          initialTimeLeft = 'Queued';
        }
      }
    } else {
      const isUnlimited =
        globalSettingsRef.current.maxConcurrentDownloads === 0 ||
        !globalSettingsRef.current.maxConcurrentDownloads ||
        globalSettingsRef.current.maxConcurrentDownloads >= 999;
      const maxGeneralAllowed = isUnlimited ? Infinity : Math.max(1, globalSettingsRef.current.maxConcurrentDownloads);
      const activeGeneral = (downloadsRef.current || downloads).filter(
        (d) =>
          (!d.queue || d.queue.trim() === '') &&
          (d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging')
      ).length;
      if (!isUnlimited && activeGeneral >= maxGeneralAllowed) {
        initialStatus = 'Queued';
        initialTimeLeft = 'Queued';
      }
    }

    const newItem: DownloadItem = {
      id,
      name: finalFilename,
      category: cat,
      url,
      size: 0,
      downloaded: 0,
      status: initialStatus,
      speed: 0,
      timeLeft: initialTimeLeft,
      dateAdded: new Date().toISOString(),
      queue: queue || '',
      savePath: targetPath,
      resumeSupport: isHLS ? 'Yes' : 'Unknown',
      threadCount: options?.threadCount || globalSettingsRef.current.defaultThreadCount || 8,
      speedLimit: options?.speedLimit !== undefined ? options.speedLimit : null,
      username: options?.username,
      password: options?.password,
      userAgent: options?.userAgent,
      referer: options?.referer,
      cookies: options?.cookies,
      givenCheckSum: givenHash,
      expectedChecksum: givenHash,
      chunks: [],
    };

    const updated = [newItem, ...(downloadsRef.current || downloads).filter((d) => d.id !== id)];
    setDownloads(updated);
    downloadsRef.current = updated;
    saveToThunderDB('downloads', updated);

    if (initialStatus === 'Downloading') {
      if (!queue || queue.trim() === '') {
        try {
          const appData = await loadFromThunderDB<any>('appearance', {});
          const shouldShowProgressDialog = appData && typeof appData.showProgressDialog === 'boolean'
            ? appData.showProgressDialog
            : (appearanceRef.current?.showProgressDialog ?? appearance.showProgressDialog ?? true);

          if (shouldShowProgressDialog) {
            await invoke('remove_hidden_download_command', { id });
            await invoke('open_realtime_progress_window_command', {
              id,
              taskId: id,
              filename: finalFilename,
              url,
              savePath: targetPath,
              resumeSupport: 'Unknown',
              resumable: false,
              force: true,
              showRealTimeProgress: true,
            });
          }
        } catch (e) {
          console.error('Failed to open realtime progress window in addDownload:', e);
        }
      }

      try {
        await invoke('start_download', {
          id,
          url,
          savePath: targetPath,
          filename: finalFilename,
          threadCount: options?.threadCount || globalSettingsRef.current.defaultThreadCount || 8,
          speedLimit: options?.speedLimit !== undefined ? options.speedLimit : null,
          protocol: options?.protocol || (isHLS ? 'HLS' : 'Auto'),
          checksum: givenHash,
          givenCheckSum: givenHash,
          expectedChecksum: givenHash,
          username: options?.username,
          password: options?.password,
          userAgent: options?.userAgent,
          referer: options?.referer,
          cookies: options?.cookies,
        });
      } catch (err: any) {
        setDownloads((prev) =>
          prev.map((d) => (d.id === id ? { ...d, status: 'Error', errorMessage: err?.message || String(err) } : d))
        );
      }
    }

    return id;
  };

  const addBatchDownloads = async (
    items: Array<{
      url: string;
      filename?: string;
      category?: Category;
      savePath?: string;
      queue?: string;
      useCategory?: boolean;
      options?: {
        threadCount?: number;
        speedLimit?: number | null;
        protocol?: string;
        username?: string;
        password?: string;
        userAgent?: string;
        referer?: string;
        cookies?: string;
        [key: string]: any;
      };
    }>,
    startImmediately: boolean = false,
    onProgress?: (current: number, total: number, currentItemName?: string) => void
  ) => {
    if (!items || items.length === 0) return;

    const total = items.length;
    const nowBase = Date.now();
    const isWin = globalSettingsRef.current.downloadPath.includes('\\') || (!globalSettingsRef.current.downloadPath.includes('/') && /^[a-zA-Z]:/.test(globalSettingsRef.current.downloadPath));
    const sep = isWin ? '\\' : '/';

    // Track assigned filenames per save directory to prevent collisions
    const usedNamesMap = new Map<string, Set<string>>();
    (downloadsRef.current || downloads).forEach((d) => {
      const sp = (d.savePath || '').toLowerCase();
      if (!usedNamesMap.has(sp)) {
        usedNamesMap.set(sp, new Set<string>());
      }
      if (d.name) {
        usedNamesMap.get(sp)!.add(d.name.toLowerCase());
      }
    });

    const isBatchUnlimited =
      globalSettingsRef.current.maxConcurrentDownloads === 0 ||
      !globalSettingsRef.current.maxConcurrentDownloads ||
      globalSettingsRef.current.maxConcurrentDownloads >= 999;
    const maxGeneralAllowed = isBatchUnlimited ? Infinity : Math.max(1, globalSettingsRef.current.maxConcurrentDownloads);
    const activeGeneral = (downloadsRef.current || downloads).filter(
      (d) =>
        (!d.queue || d.queue.trim() === '') &&
        (d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging')
    ).length;
    let remainingGeneralSlots = isBatchUnlimited ? Infinity : Math.max(0, maxGeneralAllowed - activeGeneral);

    const preparedBatch: Array<{ downloadItem: DownloadItem; entry: typeof items[0]; shouldStart: boolean }> = [];

    for (let idx = 0; idx < total; idx++) {
      const entry = items[idx];
      const id = `${nowBase + idx}_${Math.random().toString(36).substring(2, 6)}`;
      let fname = entry.filename || '';
      if (!fname) {
        try {
          const u = new URL(entry.url);
          fname = u.pathname.split('/').filter(Boolean).pop() || '';
          if (fname) fname = decodeURIComponent(fname);
        } catch {
          fname = entry.url.split('/').pop() || 'download';
        }
      }
      if (!fname) fname = `download_${idx + 1}`;

      const isHLS = entry.url.toLowerCase().includes('.m3u8') || fname.toLowerCase().endsWith('.m3u8');
      if (isHLS && fname.toLowerCase().endsWith('.m3u8')) {
        const base = fname.replace(/\.m3u8$/i, '');
        fname = (base === '' || base === 'master' || base === 'playlist' || base === 'index') ? 'video.mp4' : `${base}.mp4`;
      }

      const itemUseCategory = entry.useCategory !== undefined
        ? entry.useCategory
        : (entry.options?.useCategory !== undefined
            ? entry.options.useCategory
            : (globalSettingsRef.current.useCategoryByDefault !== false));

      const detectedCat = isHLS ? 'Videos' : ((entry.category && entry.category !== 'All') ? entry.category : detectCategory(fname || entry.url));
      const cat: Category = itemUseCategory ? detectedCat : 'All';

      let baseFolder = entry.savePath || globalSettingsRef.current.downloadPath || '';
      if (baseFolder && !baseFolder.includes('/') && !baseFolder.includes('\\')) {
        baseFolder = globalSettingsRef.current.downloadPath || '';
      }
      const cleanBaseFolder = baseFolder.replace(/[\/\\]+$/, '');

      let targetPath = cleanBaseFolder || globalSettingsRef.current.downloadPath;
      if (itemUseCategory && cat && cat !== 'All') {
        const customCatPath = globalSettingsRef.current.categoryPaths?.[cat];
        if (customCatPath && customCatPath.trim() !== '') {
          targetPath = customCatPath;
        } else {
          const lowerBase = cleanBaseFolder.toLowerCase();
          const lowerCat = cat.toLowerCase();
          if (
            lowerBase.endsWith(`${sep}${lowerCat}`) ||
            lowerBase.endsWith(`/${lowerCat}`) ||
            lowerBase.endsWith(`\\${lowerCat}`) ||
            lowerBase === lowerCat
          ) {
            targetPath = cleanBaseFolder;
          } else {
            targetPath = `${cleanBaseFolder}${sep}${cat}`;
          }
        }
      }

      const normTargetPath = targetPath.toLowerCase();
      if (!usedNamesMap.has(normTargetPath)) {
        usedNamesMap.set(normTargetPath, new Set<string>());
      }
      const usedInTarget = usedNamesMap.get(normTargetPath)!;

      // Disambiguate duplicate filenames
      let finalFname = fname;
      if (usedInTarget.has(finalFname.toLowerCase())) {
        const lastDot = fname.lastIndexOf('.');
        const baseName = lastDot > 0 ? fname.slice(0, lastDot) : fname;
        const ext = lastDot > 0 ? fname.slice(lastDot) : '';
        let counter = 1;
        while (usedInTarget.has(`${baseName}_${counter}${ext}`.toLowerCase())) {
          counter++;
        }
        finalFname = `${baseName}_${counter}${ext}`;
      }
      usedInTarget.add(finalFname.toLowerCase());

      const isUnassigned = !entry.queue || entry.queue.trim() === '';
      let shouldStart = false;
      if (startImmediately && isUnassigned) {
        if (isBatchUnlimited || remainingGeneralSlots > 0) {
          shouldStart = true;
          if (!isBatchUnlimited) {
            remainingGeneralSlots--;
          }
        }
      }

      const initialStatus: DownloadStatus = shouldStart ? 'Downloading' : 'Queued';
      const initialTimeLeft = shouldStart ? 'Calculating...' : 'Queued';

      const downloadItem: DownloadItem = {
        id,
        name: finalFname,
        category: cat,
        url: entry.url,
        size: 0,
        downloaded: 0,
        status: initialStatus,
        speed: 0,
        timeLeft: initialTimeLeft,
        dateAdded: new Date(nowBase + idx * 10).toISOString(),
        queue: entry.queue || '',
        savePath: targetPath,
        resumeSupport: isHLS ? 'Yes' : 'Unknown',
        threadCount: entry.options?.threadCount || globalSettingsRef.current.defaultThreadCount,
        speedLimit: entry.options?.speedLimit !== undefined ? entry.options.speedLimit : null,
        username: entry.options?.username,
        password: entry.options?.password,
        userAgent: entry.options?.userAgent,
        referer: entry.options?.referer,
        cookies: entry.options?.cookies,
        chunks: [],
      };

      preparedBatch.push({ downloadItem, entry, shouldStart });
    }

    // Insert ALL new items into state and SQLite up-front so they exist in state before any events fire
    const allNewItems = preparedBatch.map((p) => p.downloadItem);
    setDownloads((prev) => {
      const updated = [...allNewItems, ...prev];
      downloadsRef.current = updated;
      return updated;
    });
    await saveToThunderDB('downloads', downloadsRef.current || allNewItems, true);

    // Stagger-dispatch the start_download calls and update loading progress
    for (let idx = 0; idx < total; idx++) {
      const { downloadItem, entry, shouldStart } = preparedBatch[idx];

      if (shouldStart) {
        if (entry.options?.showRealTimeProgress === true) {
          try {
            invoke('open_realtime_progress_window_command', {
              id: downloadItem.id,
              taskId: downloadItem.id,
              filename: downloadItem.name,
              url: downloadItem.url,
              savePath: downloadItem.savePath,
              resumeSupport: downloadItem.resumeSupport,
              resumable: downloadItem.resumeSupport === 'Yes',
              force: true,
            }).catch(() => {});
          } catch (e) {}
        }

        invoke('start_download', {
          id: downloadItem.id,
          url: downloadItem.url,
          savePath: downloadItem.savePath,
          filename: downloadItem.name,
          threadCount: entry.options?.threadCount || downloadItem.threadCount || globalSettingsRef.current.defaultThreadCount,
          speedLimit: entry.options?.speedLimit !== undefined ? entry.options.speedLimit : downloadItem.speedLimit,
          protocol: entry.options?.protocol || (downloadItem.url.toLowerCase().includes('.m3u8') ? 'HLS' : 'HTTP'),
          showCompletionWindow: entry.options?.showCompletionWindow !== undefined ? entry.options.showCompletionWindow : false,
          show_completion: entry.options?.showCompletionWindow !== undefined ? entry.options.showCompletionWindow : false,
          checksum: entry.options?.checksum || entry.options?.givenCheckSum || entry.options?.expectedChecksum || '',
          givenCheckSum: entry.options?.checksum || entry.options?.givenCheckSum || entry.options?.expectedChecksum || '',
          expectedChecksum: entry.options?.checksum || entry.options?.givenCheckSum || entry.options?.expectedChecksum || '',
          username: entry.options?.username || downloadItem.username,
          password: entry.options?.password || downloadItem.password,
          userAgent: entry.options?.userAgent || downloadItem.userAgent,
          referer: entry.options?.referer || downloadItem.referer,
          cookies: entry.options?.cookies || downloadItem.cookies,
        }).catch((err: any) => {
          setDownloads((prev) =>
            prev.map((d) => (d.id === downloadItem.id ? { ...d, status: 'Error', errorMessage: err?.message || String(err) } : d))
          );
        });
      }

      if (onProgress) {
        onProgress(idx + 1, total, downloadItem.name);
      }

      // Smooth micro-stagger between items to prevent server socket congestion and show smooth registration progress
      if (total > 1 && idx < total - 1) {
        await new Promise((resolve) => setTimeout(resolve, 35));
      }
    }

    // Flush any pending progress and save current synchronized list
    if (downloadsRef.current) {
      await saveToThunderDB('downloads', downloadsRef.current, true);
    }

    // If startImmediately is true and items were assigned to a queue, start that queue
    if (startImmediately && items.some((i) => i.queue && i.queue.trim() !== '')) {
      const assignedQueues = new Set(items.map((i) => i.queue).filter(Boolean));
      assignedQueues.forEach((qName) => {
        if (qName) {
          startQueue(qName);
        }
      });
    }
  };

  const resumeSelected = async () => {
    if (selectedIds.size === 0) return;
    const itemsToResume = downloads.filter((d) => selectedIds.has(d.id) && (d.status === 'Paused' || d.status === 'Error' || d.status === 'Canceled' || d.status === 'Queued'));
    if (itemsToResume.length === 0) return;

    for (const item of itemsToResume) {
      await resumeItem(item.id, false);
    }
  };

  const pauseSelected = async () => {
    if (selectedIds.size === 0) return;
    const currentList = downloadsRef.current || downloads;
    const idsToPause = Array.from(selectedIds).filter((id) => {
      const d = currentList.find((item) => item.id === id);
      return d && (d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging' || d.status === 'Queued');
    });
    if (idsToPause.length === 0) return;

    const updated = currentList.map((d) => {
      if (idsToPause.includes(d.id) && (d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging' || d.status === 'Queued')) {
        return { ...d, status: 'Paused' as DownloadStatus, speed: 0, timeLeft: 'Paused' };
      }
      return d;
    });
    setDownloads(updated);
    downloadsRef.current = updated;
    saveToThunderDB('downloads', updated);

    try {
      await Promise.allSettled(
        idsToPause.map((id) => invoke('pause_download', { id }))
      );
    } catch {
      // Browser fallback
    }
  };

  const pauseItem = async (id: string) => {
    const updated = (downloadsRef.current || downloads).map((d) =>
      d.id === id ? { ...d, status: 'Paused' as DownloadStatus, speed: 0, timeLeft: 'Paused' } : d
    );
    setDownloads(updated);
    downloadsRef.current = updated;
    saveToThunderDB('downloads', updated);
    try {
      await invoke('pause_download', { id });
    } catch {}
    dispatchQueueWorkers();
  };

  const resumeItem = async (id: string, force: boolean = false) => {
    const item = downloadsRef.current.find((d) => d.id === id) || downloads.find((d) => d.id === id);
    if (!item) return;

    const updated = (downloadsRef.current || downloads).map((d) => (d.id === id ? { ...d, status: 'Downloading' as DownloadStatus, speed: 0, timeLeft: 'Calculating...' } : d));
    setDownloads(updated);
    downloadsRef.current = updated;
    saveToThunderDB('downloads', updated);

    try {
      let queueConfig: QueueConfig | undefined;
      const isQueueDownload = Boolean(item.queue && item.queue.trim() !== '');
      if (isQueueDownload && item.queue) {
        const qTrim = item.queue.trim().toLowerCase();
        queueConfig = (queuesRef.current || queues).find(
          (q) => q.name.toLowerCase() === qTrim || q.id.toLowerCase() === qTrim
        );
      }

      // Check in database for appearance preferences
      const appData = await loadFromThunderDB<any>('appearance', {});
      const dbShowProgress = appData && typeof appData.showProgressDialog === 'boolean'
        ? appData.showProgressDialog
        : (appearanceRef.current?.showProgressDialog ?? appearance.showProgressDialog ?? true);

      const dbShowCompletion = appData && typeof appData.showCompletionDialog === 'boolean'
        ? appData.showCompletionDialog
        : (appearanceRef.current?.showCompletionDialog ?? appearance.showCompletionDialog ?? true);

      // Queue downloads use their own queueConfig; non-queue downloads check database showProgressDialog
      const shouldShowProgressDialog = isQueueDownload
        ? (queueConfig?.showRealTimeProgress ?? false)
        : dbShowProgress;

      const showCompletionWindow = isQueueDownload
        ? (queueConfig?.showCompletionWindow ?? false)
        : dbShowCompletion;

      if (force || shouldShowProgressDialog) {
        await invoke('remove_hidden_download_command', { id: item.id });
        await invoke('open_realtime_progress_window_command', {
          id: item.id,
          taskId: item.id,
          filename: item.name,
          url: item.url,
          savePath: item.savePath,
          resumeSupport: item.resumeSupport,
          resumable: item.resumeSupport === 'Yes',
          force: true,
          showRealTimeProgress: true,
        });
      } else {
        const pct = item.size > 0 ? Math.floor((item.downloaded / item.size) * 100) : 0;
        await invoke('hide_realtime_download_to_tray_command', {
          id: item.id,
          filename: item.name,
          progress: pct,
        });
      }

      await invoke('resume_download', {
        id: item.id,
        url: item.url,
        savePath: item.savePath,
        filename: item.name,
        threadCount: item.threadCount || (queueConfig?.threadCount && queueConfig.threadCount > 0 ? queueConfig.threadCount : globalSettingsRef.current.defaultThreadCount) || 8,
        speedLimit: item.speedLimit !== undefined ? item.speedLimit : null,
        protocol: item.protocol,
        username: item.username,
        password: item.password,
        userAgent: item.userAgent,
        referer: item.referer,
        cookies: item.cookies,
        showCompletionWindow: showCompletionWindow,
        show_completion: showCompletionWindow,
      });
    } catch (err: any) {
      setDownloads((prev) =>
        prev.map((d) => (d.id === id ? { ...d, status: 'Error', errorMessage: err?.message || String(err) } : d))
      );
    }
  };

  const deleteSelected = async () => {
    const idsToDelete = Array.from(selectedIds);
    const remaining = (downloadsRef.current || downloads).filter((d) => !selectedIds.has(d.id));
    setDownloads(remaining);
    downloadsRef.current = remaining;
    saveToThunderDB('downloads', remaining);
    setSelectedIds(new Set());

    try {
      for (const id of idsToDelete) {
        await invoke('cancel_download', { id });
        await invoke('close_realtime_progress_window_command', { id });
      }
    } catch {
      // Browser fallback
    }
    dispatchQueueWorkers();
  };

  const deleteAllMissing = async () => {
    const missingItems = (downloadsRef.current || downloads).filter((d) => Boolean(d.fileMissing));
    if (missingItems.length === 0) return;
    const missingIds = new Set(missingItems.map((d) => d.id));
    const remaining = (downloadsRef.current || downloads).filter((d) => !missingIds.has(d.id));
    setDownloads(remaining);
    downloadsRef.current = remaining;
    saveToThunderDB('downloads', remaining);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      missingIds.forEach((id) => next.delete(id));
      return next;
    });
    for (const item of missingItems) {
      try {
        await invoke('cancel_download', { id: item.id });
        await invoke('close_realtime_progress_window_command', { id: item.id });
      } catch {}
    }
  };

  const deleteAllFinished = async () => {
    const finishedItems = (downloadsRef.current || downloads).filter((d) => d.status === 'Finished');
    if (finishedItems.length === 0) return;
    const finishedIds = new Set(finishedItems.map((d) => d.id));
    const remaining = (downloadsRef.current || downloads).filter((d) => !finishedIds.has(d.id));
    setDownloads(remaining);
    downloadsRef.current = remaining;
    saveToThunderDB('downloads', remaining);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      finishedIds.forEach((id) => next.delete(id));
      return next;
    });
  };

  const deleteAllUnfinished = async () => {
    const unfinishedItems = (downloadsRef.current || downloads).filter((d) => d.status !== 'Finished');
    if (unfinishedItems.length === 0) return;
    const unfinishedIds = new Set(unfinishedItems.map((d) => d.id));
    const remaining = (downloadsRef.current || downloads).filter((d) => !unfinishedIds.has(d.id));
    setDownloads(remaining);
    downloadsRef.current = remaining;
    saveToThunderDB('downloads', remaining);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      unfinishedIds.forEach((id) => next.delete(id));
      return next;
    });
    for (const item of unfinishedItems) {
      try {
        await invoke('cancel_download', { id: item.id });
        await invoke('close_realtime_progress_window_command', { id: item.id });
      } catch {}
    }
  };

  const deleteEntireList = async () => {
    const allItems = [...(downloadsRef.current || downloads)];
    if (allItems.length === 0) return;
    setDownloads([]);
    downloadsRef.current = [];
    saveToThunderDB('downloads', []);
    setSelectedIds(new Set());
    for (const item of allItems) {
      try {
        if (item.status !== 'Finished') {
          await invoke('cancel_download', { id: item.id });
          await invoke('close_realtime_progress_window_command', { id: item.id });
        }
      } catch {}
    }
  };

  const dispatchQueueWorkers = async (targetQueueId?: string) => {
    const currentQueues = queuesRef.current;
    const currentDownloads = downloadsRef.current;

    // 1. Process running Queues independently based on each queue's own maxConcurrent setting
    for (const q of currentQueues) {
      if (targetQueueId && q.id !== targetQueueId && q.name !== targetQueueId) {
        continue;
      }
      if (!q.isRunning) {
        continue;
      }

      const isQueueMatch = (d: DownloadItem) =>
        Boolean(d.queue && d.queue.trim() !== '') && (
          d.queue!.toLowerCase() === q.name.toLowerCase() ||
          d.queue!.toLowerCase() === q.id.toLowerCase()
        );

      const qItems = currentDownloads.filter(isQueueMatch);
      const activeInQueue = qItems.filter(
        (d) =>
          d.status === 'Downloading' ||
          d.status === 'Pending' ||
          d.status === 'Merging' ||
          startingTaskIdsRef.current.has(d.id)
      );

      const maxQueueAllowed = Math.max(1, q.maxConcurrent || 1);
      const availableQueueSlots = Math.max(0, maxQueueAllowed - activeInQueue.length);

      if (availableQueueSlots > 0) {
        // Pick queued items within available queue capacity
        const queuedItems = qItems.filter(
          (d) => d.status === 'Queued' && !startingTaskIdsRef.current.has(d.id)
        );

        const itemsToStart = queuedItems.slice(0, availableQueueSlots);
        for (const item of itemsToStart) {
          startingTaskIdsRef.current.add(item.id);
          resumeItem(item.id, false).finally(() => {
            setTimeout(() => {
              startingTaskIdsRef.current.delete(item.id);
            }, 600);
          });
        }
      }

      // Mark queue as inactive when all tasks finish
      if (q.isRunning) {
        const unfinished = qItems.filter(
          (d) => d.status !== 'Finished' && d.status !== 'Canceled'
        );
        if (qItems.length > 0 && unfinished.length === 0) {
          updateQueue(q.id, { isRunning: false });
        }
      }
    }

    // 2. Process unassigned general downloads governed by Download Engine maxConcurrentDownloads
    const isUnlimited =
      globalSettingsRef.current.maxConcurrentDownloads === 0 ||
      !globalSettingsRef.current.maxConcurrentDownloads ||
      globalSettingsRef.current.maxConcurrentDownloads >= 999;
    const maxGeneralAllowed = isUnlimited ? Infinity : Math.max(1, globalSettingsRef.current.maxConcurrentDownloads);

    const activeGeneralDownloads = currentDownloads.filter(
      (d) =>
        (!d.queue || d.queue.trim() === '') &&
        (d.status === 'Downloading' ||
          d.status === 'Pending' ||
          d.status === 'Merging' ||
          startingTaskIdsRef.current.has(d.id))
    );

    let remainingGeneralSlots = isUnlimited ? Infinity : Math.max(0, maxGeneralAllowed - activeGeneralDownloads.length);

    if (isUnlimited || remainingGeneralSlots > 0) {
      const generalQueued = currentDownloads.filter((d) => {
        if (d.status !== 'Queued' || startingTaskIdsRef.current.has(d.id)) {
          return false;
        }
        const qName = (d.queue || '').trim();
        // Only unassigned items (no queue assigned) are processed as general queued downloads
        return !qName;
      });
      const itemsToStart = isUnlimited ? generalQueued : generalQueued.slice(0, remainingGeneralSlots);
      for (const item of itemsToStart) {
        startingTaskIdsRef.current.add(item.id);
        if (!isUnlimited) {
          remainingGeneralSlots--;
        }
        resumeItem(item.id, false).finally(() => {
          setTimeout(() => {
            startingTaskIdsRef.current.delete(item.id);
          }, 600);
        });
      }
    }
  };

  const addQueue = async (name: string): Promise<string> => {
    const cleanName = name.trim();
    if (!cleanName) return '';
    const newId = `queue_${Date.now()}`;
    const newQueue: QueueConfig = {
      id: newId,
      name: cleanName,
      maxConcurrent: 2,
      scheduleEnabled: false,
      activeDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      enableAutoStartTime: false,
      autoStartTime: '02:30',
      enableAutoStopTime: false,
      autoStopTime: '07:30',
      isRunning: false,
      showRealTimeProgress: false,
      showCompletionWindow: false,
    };
    setQueues((prev) => [...prev, newQueue]);
    return newId;
  };

  const updateQueue = async (id: string, updates: Partial<QueueConfig>) => {
    const updated = (queuesRef.current || queues).map((q) =>
      q.id === id || q.name.toLowerCase() === id.toLowerCase() ? { ...q, ...updates } : q
    );
    setQueues(updated);
    queuesRef.current = updated;
    saveToThunderDB('queues', updated);
  };

  const saveQueues = async (newQueues: QueueConfig[]) => {
    setQueues(newQueues);
    queuesRef.current = newQueues;
    saveToThunderDB('queues', newQueues);
  };

  const deleteQueue = async (id: string) => {
    if (id === 'main' || id.toLowerCase() === 'main') return;
    const updatedQueues = (queuesRef.current || queues).filter((q) => q.id !== id && q.name.toLowerCase() !== id.toLowerCase());
    setQueues(updatedQueues);
    queuesRef.current = updatedQueues;
    saveToThunderDB('queues', updatedQueues);

    const updatedDownloads = (downloadsRef.current || downloads).map((d) =>
      d.queue === id || (d.queue && d.queue.toLowerCase() === id.toLowerCase()) ? { ...d, queue: '' } : d
    );
    setDownloads(updatedDownloads);
    downloadsRef.current = updatedDownloads;
    saveToThunderDB('downloads', updatedDownloads);
  };

  const reorderQueueItems = (queueName: string, fromIndex: number, toIndex: number) => {
    const isTarget = (d: DownloadItem) =>
      Boolean(d.queue && d.queue.trim() !== '') && (
        d.queue!.toLowerCase() === queueName.toLowerCase()
      );

    const current = downloadsRef.current || downloads;
    const queueItems = current.filter(isTarget);
    const otherItems = current.filter((d) => !isTarget(d));

    if (fromIndex < 0 || fromIndex >= queueItems.length || toIndex < 0 || toIndex >= queueItems.length) {
      return;
    }

    const reordered = [...queueItems];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);

    const updated = [...reordered, ...otherItems];
    setDownloads(updated);
    downloadsRef.current = updated;
    saveToThunderDB('downloads', updated);
  };

  const removeItemFromQueue = (id: string) => {
    const updated = (downloadsRef.current || downloads).map((d) => (d.id === id ? { ...d, queue: '' } : d));
    setDownloads(updated);
    downloadsRef.current = updated;
    saveToThunderDB('downloads', updated);
  };

  const startQueue = async (queueIdentifier?: string) => {
    const currentQueues = queuesRef.current || queues;
    const targetQueue = currentQueues.find(
      (q) =>
        (queueIdentifier && (q.id === queueIdentifier || q.name.toLowerCase() === queueIdentifier.toLowerCase())) ||
        (!queueIdentifier && q.name.toLowerCase() === selectedQueue.toLowerCase())
    ) || currentQueues[0];

    if (!targetQueue) return;

    const isQueueMatch = (d: DownloadItem) =>
      Boolean(d.queue && d.queue.trim() !== '') && (
        d.queue!.toLowerCase() === targetQueue.name.toLowerCase() ||
        d.queue!.toLowerCase() === targetQueue.id.toLowerCase()
      );

    // Re-queue paused/errored tasks when starting the queue
    if (!targetQueue.isRunning) {
      setDownloads((prev) =>
        prev.map((d) => {
          if (isQueueMatch(d) && (d.status === 'Paused' || d.status === 'Error' || d.status === 'Canceled')) {
            return { ...d, status: 'Queued', timeLeft: 'Queued' };
          }
          return d;
        })
      );
      downloadsRef.current = (downloadsRef.current || downloads).map((d) => {
        if (isQueueMatch(d) && (d.status === 'Paused' || d.status === 'Error' || d.status === 'Canceled')) {
          return { ...d, status: 'Queued', timeLeft: 'Queued' };
        }
        return d;
      });
    }

    setQueues((prev) =>
      prev.map((q) => (q.id === targetQueue.id || q.name.toLowerCase() === targetQueue.name.toLowerCase() ? { ...q, isRunning: true } : q))
    );
    queuesRef.current = (queuesRef.current || queues).map((q) =>
      q.id === targetQueue.id || q.name.toLowerCase() === targetQueue.name.toLowerCase() ? { ...q, isRunning: true } : q
    );

    try {
      saveToThunderDB('downloads', downloadsRef.current);
      saveToThunderDB('queues', queuesRef.current);
    } catch {}

    setTimeout(() => {
      dispatchQueueWorkers(targetQueue.id);
    }, 50);
  };

  const stopQueue = async (queueIdentifier?: string) => {
    const currentQueues = queuesRef.current || queues;
    const targetQueue = currentQueues.find(
      (q) =>
        (queueIdentifier && (q.id === queueIdentifier || q.name.toLowerCase() === queueIdentifier.toLowerCase())) ||
        (!queueIdentifier && q.name.toLowerCase() === selectedQueue.toLowerCase())
    ) || currentQueues[0];

    if (!targetQueue) return;

    setQueues((prev) =>
      prev.map((q) => (q.id === targetQueue.id || q.name.toLowerCase() === targetQueue.name.toLowerCase() ? { ...q, isRunning: false } : q))
    );
    queuesRef.current = (queuesRef.current || queues).map((q) =>
      q.id === targetQueue.id || q.name.toLowerCase() === targetQueue.name.toLowerCase() ? { ...q, isRunning: false } : q
    );

    const isQueueMatch = (d: DownloadItem) =>
      Boolean(d.queue && d.queue.trim() !== '') && (
        d.queue!.toLowerCase() === targetQueue.name.toLowerCase() ||
        d.queue!.toLowerCase() === targetQueue.id.toLowerCase()
      );

    const currentList = downloadsRef.current || downloads;
    const qItems = currentList.filter(isQueueMatch);
    // Only actively running/pending/merging items become Paused; Queued items remain Queued
    const activeInQueue = qItems.filter(
      (d) => d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging'
    );

    setDownloads((prev) =>
      prev.map((d) => {
        if (isQueueMatch(d) && (d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging')) {
          return { ...d, status: 'Paused', speed: 0, timeLeft: 'Paused' };
        }
        return d;
      })
    );

    downloadsRef.current = currentList.map((d) => {
      if (isQueueMatch(d) && (d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging')) {
        return { ...d, status: 'Paused', speed: 0, timeLeft: 'Paused' };
      }
      return d;
    });

    try {
      saveToThunderDB('downloads', downloadsRef.current);
      saveToThunderDB('queues', queuesRef.current);
    } catch {}

    try {
      await Promise.allSettled([
        ...activeInQueue.map((item) => invoke('pause_download', { id: item.id })),
        ...activeInQueue.map((item) => invoke('close_realtime_progress_window_command', { id: item.id })),
      ]);
    } catch {}
  };

  // Track last triggered start/stop minute to avoid duplicate triggers within the same minute
  const lastSchedulerTriggerRef = React.useRef<Set<string>>(new Set());

  // Dedicated Queue Scheduler timer (runs every 1 second, independent of download progress updates)
  useEffect(() => {
    const checkScheduler = () => {
      const now = new Date();
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      const currentDay = dayNames[now.getDay()];
      const currentHours = String(now.getHours()).padStart(2, '0');
      const currentMins = String(now.getMinutes()).padStart(2, '0');
      const currentTime = `${currentHours}:${currentMins}`;
      const dateKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

      const currentQueues = queuesRef.current || [];

      const normalizeHHMM = (timeStr?: string): string => {
        if (!timeStr) return '';
        const clean = timeStr.trim();
        const match = clean.match(/(\d{1,2})\s*:\s*(\d{1,2})/);
        if (!match) return '';
        const h = String(parseInt(match[1], 10)).padStart(2, '0');
        const m = String(parseInt(match[2], 10)).padStart(2, '0');
        return `${h}:${m}`;
      };

      currentQueues.forEach((q) => {
        const isScheduleActive = Boolean(q.scheduleEnabled || q.enableAutoStartTime || q.enableAutoStopTime);
        if (!isScheduleActive) return;

        // Check if today is an active day
        let activeDaysList: string[] = [];
        if (Array.isArray(q.activeDays)) {
          activeDaysList = q.activeDays;
        } else if (typeof q.activeDays === 'string') {
          try {
            const parsed = JSON.parse(q.activeDays);
            if (Array.isArray(parsed)) activeDaysList = parsed;
          } catch {
            activeDaysList = [];
          }
        }

        const isDayActive =
          activeDaysList.length === 0 ||
          activeDaysList.some((d) => typeof d === 'string' && d.toLowerCase().slice(0, 3) === currentDay.toLowerCase().slice(0, 3));

        // Format normalized times
        const normStart = normalizeHHMM(q.autoStartTime);
        const normStop = normalizeHHMM(q.autoStopTime);

        // 1. Auto Start Check (triggers on active scheduled days)
        if (q.enableAutoStartTime && isDayActive && normStart && normStart === currentTime) {
          const triggerKey = `${q.id}_start_${dateKey}_${currentTime}`;
          if (!lastSchedulerTriggerRef.current.has(triggerKey)) {
            lastSchedulerTriggerRef.current.add(triggerKey);
            console.log(`[QueueScheduler] Auto-start triggered for queue '${q.name}' (${q.id}) at ${currentTime}`);
            if (!q.isRunning) {
              startQueue(q.id);
            }
          }
        }

        // 2. Auto Stop Check (always stops active running queue or queue downloads when scheduled time hits)
        if (q.enableAutoStopTime && normStop && normStop === currentTime) {
          const triggerKey = `${q.id}_stop_${dateKey}_${currentTime}`;
          if (!lastSchedulerTriggerRef.current.has(triggerKey)) {
            lastSchedulerTriggerRef.current.add(triggerKey);
            console.log(`[QueueScheduler] Auto-stop triggered for queue '${q.name}' (${q.id}) at ${currentTime}`);
            // Stop the queue and pause all downloads in this queue
            stopQueue(q.id);
          }
        }
      });

      // Periodically check and advance queued workers safely when a queue is active or queued downloads exist
      const currentList = downloadsRef.current;
      const hasRunningQueue = currentQueues.some((q) => q.isRunning);
      const hasQueuedDownloads = currentList && currentList.some((d) => d.status === 'Queued');
      if (hasRunningQueue || hasQueuedDownloads) {
        dispatchQueueWorkers();
      }

      // Cleanup old trigger keys if the set grows too large
      if (lastSchedulerTriggerRef.current.size > 200) {
        lastSchedulerTriggerRef.current.clear();
      }
    };

    const timer = setInterval(checkScheduler, 1000);
    checkScheduler();

    return () => clearInterval(timer);
  }, []);

  // Dispatch queued workers when queues change configuration, downloads update, or max concurrency settings change
  useEffect(() => {
    const hasRunningQueue = queues.some((q) => q.isRunning);
    const hasQueuedDownloads = downloads.some((d) => d.status === 'Queued');
    if (hasRunningQueue || hasQueuedDownloads) {
      dispatchQueueWorkers();
    }
  }, [queues, downloads, globalSettings.maxConcurrentDownloads]);

  const stopAll = async () => {
    // Clear in-flight startup locks
    startingTaskIdsRef.current.clear();

    // 1. Stop all running queues immediately
    const stoppedQueues = (queuesRef.current || queues).map((q) => ({ ...q, isRunning: false }));
    setQueues(stoppedQueues);
    queuesRef.current = stoppedQueues;

    // 2. Find all active/in-progress and queued tasks to pause (Downloading, Pending, Merging, Queued)
    const currentList = downloadsRef.current || downloads;
    const activeOrQueuedTasks = currentList.filter(
      (d) =>
        d.status === 'Downloading' ||
        d.status === 'Pending' ||
        d.status === 'Merging' ||
        d.status === 'Queued'
    );

    // 3. Set ALL actively downloading/merging/pending and queued items to Paused
    const pausedList = currentList.map((d) =>
      d.status === 'Downloading' ||
      d.status === 'Pending' ||
      d.status === 'Merging' ||
      d.status === 'Queued'
        ? { ...d, status: 'Paused' as DownloadStatus, speed: 0, timeLeft: 'Paused' }
        : d
    );
    setDownloads(pausedList);
    downloadsRef.current = pausedList;

    // 4. Save paused state and stopped queues to SQLite
    try {
      await saveToThunderDB('downloads', pausedList);
      await saveToThunderDB('queues', stoppedQueues);
    } catch {}

    // 5. Trigger backend pause for all tasks concurrently
    try {
      await invoke('pause_all');
    } catch {}

    // 6. Explicitly pause each individual active task to guarantee context cancellation and close realtime windows
    try {
      await Promise.allSettled([
        ...activeOrQueuedTasks.map((item) => invoke('pause_download', { id: item.id })),
        ...activeOrQueuedTasks.map((item) => invoke('close_realtime_progress_window_command', { id: item.id })),
      ]);
    } catch {}
  };

  const openModal = async (
    modal: 'newDownload' | 'downloadDetail' | 'settings' | 'extensionAddDownload' | 'queues' | 'downloadComplete' | 'deleteConfirm' | 'openSourceLicenses' | 'about' | 'batchDownload' | 'perHostSettings',
    downloadId?: string
  ) => {
    if (downloadId) {
      setDetailDownloadId(downloadId);
    }

    if (modal === 'deleteConfirm') {
      setActiveModal('deleteConfirm');
      return;
    }

    if (modal === 'newDownload') {
      setExtensionPayload(null);
      setActiveModal('newDownload');
      return;
    }

    if (modal === 'extensionAddDownload') {
      setActiveModal('newDownload');
      return;
    }

    setActiveModal(modal);
  };

  const closeModal = () => {
    setActiveModal(null);
    setDetailDownloadId(null);
    setExtensionPayload(null);
  };

  const updateDownloadItem = (id: string, updates: Partial<DownloadItem>) => {
    const updated = (downloadsRef.current || downloads).map((d) => (d.id === id ? { ...d, ...updates } : d));
    setDownloads(updated);
    downloadsRef.current = updated;
    saveToThunderDB('downloads', updated);
  };

  const updateGlobalSettings = (settings: Partial<GlobalSettings>) => {
    setGlobalSettings((prev) => {
      const next = { ...prev, ...settings };
      globalSettingsRef.current = next;
      return next;
    });
  };

  return (
    <DownloadContext.Provider
      value={{
        downloads,
        queues,
        selectedCategory,
        selectedStatus,
        selectedQueue,
        searchQuery,
        selectedIds,
        activeModal,
        detailDownloadId,
        extensionPayload,
        globalSettings,
        setSearchQuery,
        setSelectedCategory,
        setSelectedStatus,
        setSelectedQueue,
        toggleSelectId,
        toggleSelectAll,
        clearSelection,
        setSelectedIds,
        addDownload,
        addBatchDownloads,
        resumeSelected,
        pauseSelected,
        pauseItem,
        resumeItem,
        deleteSelected,
        deleteAllMissing,
        deleteAllFinished,
        deleteAllUnfinished,
        deleteEntireList,
        addQueue,
        updateQueue,
        saveQueues,
        deleteQueue,
        reorderQueueItems,
        removeItemFromQueue,
        startQueue,
        stopQueue,
        stopAll,
        openModal,
        closeModal,
        updateDownloadItem,
        updateGlobalSettings,
        filteredDownloads,
        categoryCounts,
        statusCounts,
        queueCounts,
        totalSpeed,
      }}
    >
      {children}
    </DownloadContext.Provider>
  );
};

export const useDownloadContext = () => {
  const context = useContext(DownloadContext);
  if (!context) {
    throw new Error('useDownloadContext must be used within a DownloadProvider');
  }
  return context;
};

