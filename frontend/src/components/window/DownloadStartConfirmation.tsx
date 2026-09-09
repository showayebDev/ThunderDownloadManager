import React, { useState, useEffect, useRef } from 'react';
import {
  Clipboard,
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
  ChevronUp,
  Minus,
  X,
  HelpCircle,
  AlertTriangle,
  Ban,
} from 'lucide-react';
import { useDownloadContext } from '../../context/DownloadContext';
import { WindowMinimise, Quit, invoke, listen } from '../../utils/tauriBridge';
import { loadFromThunderDB, saveToThunderDB } from '../../utils/thunderDB';
import { detectCategory as utilDetectCategory } from '../../utils/category';
import { Events } from '@wailsio/runtime';
import { Tooltip, HelpTooltip } from '../common/Tooltip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface YtdlpFormat {
  format_id?: string;
  resolution?: string;
  format_note?: string;
  ext?: string;
  [key: string]: any;
}

interface QueueItem {
  id: string;
  name: string;
}

const joinPath = (base: string, sub: string): string => {
  if (!base) return sub || '';
  if (!sub) return base;
  const isWin = base.includes('\\') || (!base.includes('/') && /^[a-zA-Z]:/.test(base));
  const sep = isWin ? '\\' : '/';
  const cleanBase = base.endsWith('\\') || base.endsWith('/') ? base.slice(0, -1) : base;
  const cleanSub = sub.startsWith('\\') || sub.startsWith('/') ? sub.slice(1) : sub;
  return `${cleanBase}${sep}${cleanSub}`;
};

export const matchVaultCredentials = (
  targetUrl: string,
  vaultList: any[] = []
): { user: string; pass: string; userAgent: string; speedLimit: number; threadCount: number } | null => {
  if (!targetUrl || !vaultList || !vaultList.length) return null;
  try {
    const parsed = new URL(targetUrl);
    const urlHost = parsed.host.toLowerCase();
    const urlHostname = parsed.hostname.toLowerCase();
    const urlSchemeHost = `${parsed.protocol}//${parsed.host}`.toLowerCase();

    for (const item of vaultList) {
      if (!item || !item.host) continue;
      let vHost = item.host.trim().toLowerCase().replace(/\/+$/, '');
      if (!vHost) continue;

      let isMatch = false;

      if (vHost === urlSchemeHost || vHost === urlHost || vHost === urlHostname) {
        isMatch = true;
      } else if (vHost.startsWith('http://') || vHost.startsWith('https://')) {
        try {
          const vParsed = new URL(vHost);
          if (vParsed.hostname.toLowerCase() === urlHostname) {
            if (!vParsed.port || vParsed.port === parsed.port) {
              isMatch = true;
            }
          }
        } catch {}
      } else {
        const cleanWildcard = vHost.replace(/^\*\./, '');
        const hostWithoutPort = cleanWildcard.split(':')[0];
        if (
          vHost === urlHost ||
          urlHostname === hostWithoutPort ||
          urlHostname.endsWith('.' + hostWithoutPort)
        ) {
          isMatch = true;
        }
      }

      if (isMatch) {
        return {
          user: item.user || item.username || '',
          pass: item.pass || item.password || '',
          userAgent: item.userAgent || item.user_agent || '',
          speedLimit: item.speedLimit || item.speed_limit || 0,
          threadCount: item.threadCount || item.thread_count || 0,
        };
      }
    }
  } catch {}
  return null;
};

export const DownloadStartConfirmation: React.FC = () => {
  const { addDownload, globalSettings, extensionPayload } = useDownloadContext();

  const initialUrl = extensionPayload?.url || '';
  const initialName = extensionPayload?.filename
    ? decodeURIComponent(extensionPayload.filename)
    : '';
  const initialReferrer = extensionPayload?.referrer || '';
  const initialUserAgent = extensionPayload?.userAgent || '';
  const initialCookies = extensionPayload?.cookies || '';

  const getInitialBasePath = () => {
    return (
      extensionPayload?.basePath ||
      extensionPayload?.base_path ||
      globalSettings?.downloadPath ||
      ''
    );
  };

  const [defaultBasePath, setDefaultBasePath] = useState<string>(getInitialBasePath());
  const [defaultThreadCount, setDefaultThreadCount] = useState<number>(() => {
    return globalSettings?.defaultThreadCount || 8;
  });
  const [useCategory, setUseCategory] = useState<boolean>(() => {
    return globalSettings?.useCategoryByDefault ?? true;
  });

  const [vaultList, setVaultList] = useState<any[]>(() => {
    return globalSettings?.vaultItems || [];
  });

  const [url, setUrl] = useState<string>(initialUrl);
  const [name, setName] = useState<string>(initialName);
  const [category, setCategory] = useState<string>(extensionPayload?.category || '');
  const [isCustomPath, setIsCustomPath] = useState<boolean>(false);
  const [saveCategoryPath, setSaveCategoryPath] = useState<boolean>(false);
  const [categoryPaths, setCategoryPaths] = useState<{ [key: string]: string }>({});

  const [savePath, setSavePath] = useState<string>(() => {
    if (extensionPayload?.savePath || extensionPayload?.save_path) {
      return extensionPayload.savePath || extensionPayload.save_path;
    }
    const base = getInitialBasePath();
    const cat =
      extensionPayload?.category ||
      (initialName
        ? utilDetectCategory(initialName)
        : initialUrl
        ? utilDetectCategory(initialUrl)
        : '');
    return cat ? joinPath(base, cat) : base;
  });
  const [queue, setQueue] = useState<string>('');
  const [availableQueues, setAvailableQueues] = useState<QueueItem[]>([{ id: 'main', name: 'Main' }]);
  const [showQueuePicker, setShowQueuePicker] = useState<boolean>(false);
  const [queueCounts, setQueueCounts] = useState<{ [key: string]: number }>({});

  useEffect(() => {
    async function loadEngineData() {
      try {
        let engine = await loadFromThunderDB<any>('download_engine', null);
        if (!engine) {
          try {
            engine = await invoke<any>('get_engine_config_command');
          } catch {}
        }
        if (!engine) {
          const sysDir = await invoke<string>('get_default_download_dir');
          if (sysDir) engine = { downloadPath: sysDir };
        }
        if (engine) {
          const engineDefThreads = engine.defaultThreadCount || engine.threadCount || globalSettings?.defaultThreadCount || 8;
          setDefaultThreadCount(engineDefThreads);
        } else {
          try {
            const defFromBackend = await invoke<number>('get_default_thread_count_command');
            if (defFromBackend && defFromBackend > 0) {
              setDefaultThreadCount(defFromBackend);
            }
          } catch {}
        }
        const savedCategoryPaths =
          engine && engine.categoryPaths && typeof engine.categoryPaths === 'object'
            ? engine.categoryPaths
            : {};
        setCategoryPaths(savedCategoryPaths);
        if (engine && engine.downloadPath) {
          const basePathVal = engine.downloadPath;
          setDefaultBasePath(basePathVal);
          const ucb =
            engine.useCategoryByDefault !== undefined
              ? Boolean(engine.useCategoryByDefault)
              : true;
          setUseCategory(ucb);
          if (Array.isArray(engine.vaultItems)) {
            setVaultList(engine.vaultItems);
            if (url) {
              const matched = matchVaultCredentials(url.trim(), engine.vaultItems);
              if (matched) {
                if (matched.user) setUsername((prev) => prev || matched.user);
                if (matched.pass) setPassword((prev) => prev || matched.pass);
                if (matched.userAgent) setUserAgent((prev) => prev || matched.userAgent);
                if (matched.threadCount && matched.threadCount > 0)
                  setThreadCount((prev) => (prev === 0 ? matched.threadCount : prev));
                if (matched.speedLimit && matched.speedLimit > 0) {
                  setSpeedLimitEnabled(true);
                  if (matched.speedLimit >= 1024 * 1024) {
                    setSpeedLimitUnit('MB/s');
                    setSpeedLimitVal(Math.round(matched.speedLimit / (1024 * 1024)));
                  } else {
                    setSpeedLimitUnit('KB/s');
                    setSpeedLimitVal(Math.round(matched.speedLimit / 1024));
                  }
                }
              }
            }
          }
          setSavePath((prev) => {
            const currentCat =
              category || (name ? utilDetectCategory(name) : url ? utilDetectCategory(url) : '');
            const isRelativeOrJustCat =
              !prev ||
              prev === currentCat ||
              (!prev.includes('/') && !prev.includes('\\'));
            if (!isCustomPath || isRelativeOrJustCat) {
              if (ucb && currentCat && currentCat !== 'All' && currentCat !== 'None') {
                if (savedCategoryPaths && savedCategoryPaths[currentCat]) {
                  return savedCategoryPaths[currentCat];
                }
                return joinPath(basePathVal, currentCat);
              }
              return basePathVal;
            }
            return prev;
          });
        }

        const qList = await loadFromThunderDB<QueueItem[]>('queues', [{ id: 'main', name: 'Main' }]);
        if (Array.isArray(qList) && qList.length > 0) {
          setAvailableQueues(qList);
        }

        const existingDownloadsJson = await loadFromThunderDB<any[]>('downloads', []);
        if (Array.isArray(existingDownloadsJson)) {
          const counts: { [key: string]: number } = {};
          existingDownloadsJson.forEach((d: any) => {
            const q = d.queue;
            if (q && q.trim() !== '') {
              counts[q] = (counts[q] || 0) + 1;
            }
          });
          setQueueCounts(counts);
        }
      } catch {}
    }
    loadEngineData();
  }, []);

  // Info & Extra config state
  const [showExtraConfig, setShowExtraConfig] = useState<boolean>(false);
  const [isFetchingInfo, setIsFetchingInfo] = useState<boolean>(false);
  const [fileFetched, setFileFetched] = useState<boolean>(false);
  const [fileSizeText, setFileSizeText] = useState<string>('Unknown');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Extra config inputs
  const [speedLimitEnabled, setSpeedLimitEnabled] = useState<boolean>(false);
  const [speedLimitVal, setSpeedLimitVal] = useState<number>(0);
  const [speedLimitUnit, setSpeedLimitUnit] = useState<string>('MB/s');
  const [checksumEnabled, setChecksumEnabled] = useState<boolean>(false);
  const [checksumVal, setChecksumVal] = useState<string>('');
  const [threadCount, setThreadCount] = useState<number>(0);
  const [acceptRanges, setAcceptRanges] = useState<boolean | null>(null);
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [userAgent, setUserAgent] = useState<string>(initialUserAgent);
  const [refererPage, setRefererPage] = useState<string>(initialReferrer);
  const [cookies, setCookies] = useState<string>(initialCookies);

  const getSpeedLimitInBytes = (): number | null => {
    if (!speedLimitEnabled || !speedLimitVal || speedLimitVal <= 0) return null;
    return speedLimitUnit === 'KB/s'
      ? Math.round(speedLimitVal * 1024)
      : Math.round(speedLimitVal * 1024 * 1024);
  };

  const getInitialWindowId = (): string => {
    try {
      const hash = window.location.hash || '';
      const query = hash.includes('?')
        ? hash.split('?')[1]
        : (window.location.search || '').replace(/^\?/, '');
      const params = new URLSearchParams(query);
      const idFromUrl = params.get('id') || params.get('windowId');
      if (idFromUrl) return idFromUrl;
    } catch {}
    return '';
  };

  const handleMinimize = async () => {
    try {
      await invoke('minimize_window');
    } catch {
      try {
        WindowMinimise();
      } catch {}
    }
  };

  const handleClose = async () => {
    const currentWindowId = getInitialWindowId();
    try {
      if (currentWindowId) {
        await invoke('clear_download_confirmation_payload', currentWindowId);
        await invoke('close_download_confirmation_window_command', currentWindowId);
      } else {
        await invoke('clear_download_confirmation_payload');
        await invoke('close_window');
      }
    } catch {
      try {
        Quit();
      } catch {}
    }
  };

  const [protocol, setProtocol] = useState<string>('Auto');
  const [ytdlpQuality, setYtdlpQuality] = useState<string>('best');
  const [availableFormats, setAvailableFormats] = useState<YtdlpFormat[]>([]);
  const [isYtdlpInstalled, setIsYtdlpInstalled] = useState<boolean>(true);

  const lastFetchedKeyRef = useRef<string>('');
  const inFlightFetchRef = useRef<boolean>(false);
  const metadataCacheRef = useRef<{ [key: string]: any }>({});
  const hasCheckedYtdlpRef = useRef<boolean>(false);

  const checkYtdlpStatus = async (force = false): Promise<boolean> => {
    if (hasCheckedYtdlpRef.current && !force) return isYtdlpInstalled;
    hasCheckedYtdlpRef.current = true;
    try {
      const res = await invoke<any>('check_ytdlp');
      const allInstalled = Boolean(
        res?.allInstalled ?? (res?.installed && res?.ffmpegInstalled)
      );
      setIsYtdlpInstalled(allInstalled);
      return allInstalled;
    } catch {}
    return true;
  };

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let unlistenSpecific: (() => void) | undefined;
    let unlistenExt: (() => void) | undefined;
    async function initAndListen() {
      try {
        checkYtdlpStatus();
        const currentWindowId = getInitialWindowId();

        const applyPayload = (payload: any) => {
          if (!payload) return;
          const incomingCookies = payload.cookies || payload.cookie || '';
          const incomingUA = payload.user_agent || payload.userAgent || '';
          const incomingRef = payload.referrer || payload.referer || '';
          const incomingUser = payload.username || '';
          const incomingPass = payload.password || '';

          if (payload.basePath) {
            setDefaultBasePath(payload.basePath);
          }
          const isUcb = payload.useCategory !== undefined ? Boolean(payload.useCategory) : (globalSettings?.useCategoryByDefault ?? true);
          setUseCategory(isUcb);

          const base = payload.basePath || defaultBasePath || getInitialBasePath();
          const payloadCat = payload.category || (payload.filename ? utilDetectCategory(payload.filename) : (payload.url ? utilDetectCategory(payload.url) : ''));
          if (payloadCat) {
            setCategory(payloadCat);
          }
          if (isUcb && payloadCat && payloadCat !== 'All' && payloadCat !== 'None') {
            const customCatPath = categoryPaths[payloadCat];
            setSavePath(customCatPath || joinPath(base, payloadCat));
          } else if (payload.savePath || payload.save_path) {
            setSavePath(payload.savePath || payload.save_path);
          } else {
            setSavePath(base);
          }
          if (incomingRef) setRefererPage(incomingRef);
          if (incomingUA) setUserAgent(incomingUA);
          if (incomingCookies) setCookies(incomingCookies);
          if (incomingUser) setUsername(incomingUser);
          if (incomingPass) setPassword(incomingPass);

          if (payload.defaultThreadCount || payload.default_thread_count) {
            setDefaultThreadCount(payload.defaultThreadCount || payload.default_thread_count);
          }
          if (payload.threadCount !== undefined && payload.threadCount !== null) {
            setThreadCount(payload.threadCount);
          } else if (payload.thread_count !== undefined && payload.thread_count !== null) {
            setThreadCount(payload.thread_count);
          }

          if (payload.protocol) {
            if (
              payload.protocol.startsWith('Yt-DLP') ||
              payload.protocol.startsWith('YT-DLP')
            ) {
              setProtocol('Yt-DLP');
              if (payload.protocol.includes(':')) {
                setYtdlpQuality(payload.protocol.split(':')[1] || 'best');
              }
            } else {
              setProtocol(payload.protocol);
            }
          }
          if (payload.url) {
            setUrl(payload.url);
            handleRefreshInfo(
              payload.url,
              {
                cookies: incomingCookies,
                userAgent: incomingUA,
                referer: incomingRef,
                username: incomingUser,
                password: incomingPass,
              },
              true
            );
          }
          if (payload.filename) {
            const raw = decodeURIComponent(payload.filename);
            const targetSavePath =
              payload.savePath || payload.save_path
                ? payload.savePath || payload.save_path
                : payloadCat && payload.useCategory !== false
                ? categoryPaths[payloadCat] || joinPath(base, payloadCat)
                : base;
            invoke<string>('resolve_unique_filename_command', {
              savePath: targetSavePath,
              filename: raw,
            })
              .then((u) => {
                if (u) setName(u);
                else setName(raw);
              })
              .catch(() => {
                setName(raw);
              });
          }
        };

        try {
          let initialPayload = null;
          if (currentWindowId) {
            initialPayload = await invoke<any>(
              'get_download_confirmation_payload',
              currentWindowId
            );
          }
          if (!initialPayload) {
            initialPayload = await invoke<any>(
              'get_latest_download_confirmation_payload'
            );
          }
          if (initialPayload) {
            applyPayload(initialPayload);
          }
        } catch {}

        if (currentWindowId) {
          unlistenSpecific = await listen(
            `open-download-confirmation-payload-${currentWindowId}`,
            (event: any) => {
              applyPayload(event.payload);
            }
          );
        }

        unlisten = await listen('open-download-confirmation-payload', (event: any) => {
          const p = event?.payload;
          if (!p) return;
          if (!currentWindowId || p.windowId === currentWindowId || p.id === currentWindowId) {
            applyPayload(p);
          }
        });

        unlistenExt = await listen('extension-add-download', (event: any) => {
          applyPayload(event.payload);
        });
      } catch {}
    }
    initAndListen();
    return () => {
      if (unlisten) unlisten();
      if (unlistenSpecific) unlistenSpecific();
      if (unlistenExt) unlistenExt();
    };
  }, []);

  const detectCategory = (filename: string): string => {
    return utilDetectCategory(filename);
  };

  useEffect(() => {
    const baseDownloadPath = defaultBasePath || globalSettings?.downloadPath || '';

    if (!url.trim()) {
      setName('');
      setCategory('');
      if (!isCustomPath) setSavePath(baseDownloadPath);
      setErrorMessage('');
      return;
    }

    try {
      let pathname = url.trim();
      try {
        pathname = new URL(url.trim()).pathname;
      } catch {}

      const segments = pathname.split('/');
      const rawFilename = segments.pop() || '';
      let cleanFilename = decodeURIComponent(rawFilename).replace(/^['"]|['"]$/g, '');

      const ytDlpHosts = [
        'youtube.com',
        'youtu.be',
        'vimeo.com',
        'tiktok.com',
        'instagram.com',
        'facebook.com',
        'fb.watch',
        'twitter.com',
        'x.com',
        'dailymotion.com',
        'bilibili.com',
        'soundcloud.com',
        'twitch.tv',
      ];
      const isYTDLP =
        protocol === 'Yt-DLP' || ytDlpHosts.some((h) => url.toLowerCase().includes(h));
      const isHLS =
        !isYTDLP &&
        (url.toLowerCase().includes('.m3u8') ||
          cleanFilename.toLowerCase().endsWith('.m3u8') ||
          protocol === 'HLS');

      if (isYTDLP) {
        setProtocol('Yt-DLP');
        if (
          !cleanFilename ||
          cleanFilename === 'watch' ||
          cleanFilename.includes('?') ||
          cleanFilename === 'video'
        ) {
          cleanFilename = 'video.mp4';
        }
        if (!cleanFilename.includes('.')) cleanFilename += '.mp4';
      } else if (isHLS) {
        setProtocol('HLS');
        if (cleanFilename.toLowerCase().endsWith('.m3u8')) {
          const baseName = cleanFilename.replace(/\.m3u8$/i, '');
          cleanFilename =
            baseName === '' ||
            baseName === 'master' ||
            baseName === 'playlist' ||
            baseName === 'index'
              ? 'video.mp4'
              : `${baseName}.mp4`;
        }
      }

      if (cleanFilename) {
        const detectedCat = isYTDLP || isHLS ? 'Videos' : detectCategory(cleanFilename);
        setCategory(detectedCat);
        const customCatPath = detectedCat ? categoryPaths[detectedCat] : undefined;
        const targetPath =
          !isCustomPath && useCategory && detectedCat
            ? customCatPath || joinPath(baseDownloadPath, detectedCat)
            : !isCustomPath
            ? baseDownloadPath
            : savePath;

        if (!isCustomPath) {
          setSavePath(targetPath);
        }

        const updateUniqueName = async () => {
          try {
            const uniqueName = await invoke<string>('resolve_unique_filename_command', {
              savePath: targetPath,
              filename: cleanFilename,
            });
            setName(uniqueName || cleanFilename);
          } catch {
            setName(cleanFilename);
          }
        };

        updateUniqueName();

        const matched = matchVaultCredentials(url.trim(), vaultList);
        let customAuth: { username?: string; password?: string; userAgent?: string } = {};
        if (matched) {
          if (matched.user) {
            setUsername(matched.user);
            customAuth.username = matched.user;
          }
          if (matched.pass) {
            setPassword(matched.pass);
            customAuth.password = matched.pass;
          }
          if (matched.userAgent) {
            setUserAgent(matched.userAgent);
            customAuth.userAgent = matched.userAgent;
          }
          if (matched.threadCount && matched.threadCount > 0) {
            setThreadCount(matched.threadCount);
          }
          if (matched.speedLimit && matched.speedLimit > 0) {
            setSpeedLimitEnabled(true);
            if (matched.speedLimit >= 1024 * 1024) {
              setSpeedLimitUnit('MB/s');
              setSpeedLimitVal(Math.round(matched.speedLimit / (1024 * 1024)));
            } else {
              setSpeedLimitUnit('KB/s');
              setSpeedLimitVal(Math.round(matched.speedLimit / 1024));
            }
          }
        }

        const effectiveUa = customAuth.userAgent || userAgent;
        const effectiveUser = customAuth.username || username;
        const effectivePass = customAuth.password || password;

        const timer = setTimeout(() => {
          handleRefreshInfo(url.trim(), {
            username: effectiveUser,
            password: effectivePass,
            userAgent: effectiveUa,
            cookies,
            referer: refererPage,
          });
        }, 300);
        return () => clearTimeout(timer);
      } else {
        setName('');
        setCategory('');
        setSavePath(baseDownloadPath);
        setFileFetched(false);
        setErrorMessage('URL must point to a specific file (missing filename).');
      }
    } catch {
      setName('');
      setCategory('');
      setSavePath(baseDownloadPath);
      setFileFetched(false);
      setErrorMessage('Invalid URL format.');
    }
  }, [
    url,
    useCategory,
    defaultBasePath,
    globalSettings?.downloadPath,
    vaultList,
    cookies,
    categoryPaths,
  ]);

  useEffect(() => {
    if (!url.trim()) return;
    const timer = setTimeout(() => {
      handleRefreshInfo(url.trim(), {
        username,
        password,
        userAgent,
        referer: refererPage,
        cookies,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [username, password, userAgent, refererPage, cookies]);

  const handleCategoryChange = async (cat: string) => {
    setCategory(cat);
    setIsCustomPath(false);
    setSaveCategoryPath(false);
    const baseDownloadPath = defaultBasePath || globalSettings?.downloadPath || '';
    const customCatPath = cat ? categoryPaths[cat] : undefined;
    const targetPath =
      useCategory && cat && cat !== 'None' && cat !== 'All'
        ? customCatPath || joinPath(baseDownloadPath, cat)
        : baseDownloadPath;
    setSavePath(targetPath);

    const candidateName = name.trim() || (url ? url.split('/').pop() || '' : '');
    if (candidateName) {
      try {
        const uniqueName = await invoke<string>('resolve_unique_filename_command', {
          savePath: targetPath,
          filename: candidateName,
        });
        if (uniqueName) setName(uniqueName);
      } catch {}
    }
  };

  const handleUseCategoryToggle = async () => {
    const nextVal = !useCategory;
    setUseCategory(nextVal);
    setIsCustomPath(false);
    setSaveCategoryPath(false);
    const baseDownloadPath = defaultBasePath || globalSettings?.downloadPath || '';
    let currentCat = category;
    if (nextVal && (!currentCat || currentCat === 'None' || currentCat === 'All')) {
      const detected = utilDetectCategory(name || url);
      if (detected) {
        currentCat = detected;
        setCategory(detected);
      }
    }
    const customCatPath = currentCat ? categoryPaths[currentCat] : undefined;
    const targetPath =
      !nextVal || !currentCat || currentCat === 'None' || currentCat === 'All'
        ? baseDownloadPath
        : customCatPath || joinPath(baseDownloadPath, currentCat);
    setSavePath(targetPath);

    const candidateName = name.trim() || (url ? url.split('/').pop() || '' : '');
    if (candidateName) {
      try {
        const uniqueName = await invoke<string>('resolve_unique_filename_command', {
          savePath: targetPath,
          filename: candidateName,
        });
        if (uniqueName) setName(uniqueName);
      } catch {}
    }
  };

  const saveCategoryPathToEngine = async (cat: string, newPath: string) => {
    if (!cat || cat === 'All' || cat === 'None' || !newPath) return;
    try {
      const currentEngine = (await loadFromThunderDB<any>('download_engine', {})) || {};
      const updatedCatPaths = {
        ...(currentEngine.categoryPaths || {}),
        ...categoryPaths,
        [cat]: newPath,
      };
      setCategoryPaths(updatedCatPaths);
      const updatedEngine = { ...currentEngine, categoryPaths: updatedCatPaths };
      await saveToThunderDB('download_engine', updatedEngine);
    } catch {}
  };

  const handleSaveCategoryPathToggle = async (checked: boolean) => {
    setSaveCategoryPath(checked);
    if (checked && category && category !== 'All' && category !== 'None' && savePath) {
      await saveCategoryPathToEngine(category, savePath);
    }
  };

  const handlePickSavePath = async () => {
    try {
      const chosen = await invoke<string>('pick_folder_command');
      if (chosen) {
        setSavePath(chosen);
        setIsCustomPath(true);
        if (saveCategoryPath && category && category !== 'All' && category !== 'None') {
          await saveCategoryPathToEngine(category, chosen);
        }
        const candidateName = name.trim() || (url ? url.split('/').pop() || '' : '');
        if (candidateName) {
          try {
            const uniqueName = await invoke<string>('resolve_unique_filename_command', {
              savePath: chosen,
              filename: candidateName,
            });
            if (uniqueName) setName(uniqueName);
          } catch {}
        }
      }
    } catch {}
  };

  const handlePasteClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setUrl(text);
        }
      }
    } catch {}
  };

  const handleRefreshInfo = async (
    targetUrl?: string,
    customOpts: any = {},
    force = false
  ) => {
    const activeUrl = typeof targetUrl === 'string' && targetUrl.trim() ? targetUrl : url;
    if (!activeUrl || typeof activeUrl !== 'string' || !activeUrl.trim()) return;

    const matched = matchVaultCredentials(activeUrl.trim(), vaultList);
    let u = customOpts.username !== undefined ? customOpts.username : username;
    let p = customOpts.password !== undefined ? customOpts.password : password;
    let ua = customOpts.userAgent !== undefined ? customOpts.userAgent : userAgent;

    if (matched) {
      if (!u && matched.user) u = matched.user;
      if (!p && matched.pass) p = matched.pass;
      if (!ua && matched.userAgent) ua = matched.userAgent;
    }

    const ref = customOpts.referer !== undefined ? customOpts.referer : refererPage;
    const ck = customOpts.cookies !== undefined ? customOpts.cookies : cookies;

    const fetchKey = `${activeUrl.trim()}|${u || ''}|${p || ''}|${ua || ''}|${ref || ''}|${
      ck || ''
    }`;
    if (!force && (fetchKey === lastFetchedKeyRef.current || inFlightFetchRef.current)) {
      if (metadataCacheRef.current[fetchKey]) {
        const cached = metadataCacheRef.current[fetchKey];
        if (cached.formatted_size) setFileSizeText(cached.formatted_size);
        if (cached.ytdlp_installed !== undefined)
          setIsYtdlpInstalled(Boolean(cached.ytdlp_installed));
        setFileFetched(true);
        return;
      }
      if (inFlightFetchRef.current) return;
    }

    lastFetchedKeyRef.current = fetchKey;
    inFlightFetchRef.current = true;
    setIsFetchingInfo(true);
    setErrorMessage('');

    try {
      const info = await invoke<any>('fetch_file_info_command', {
        url: activeUrl.trim(),
        username: u ? u.trim() : undefined,
        password: p ? p.trim() : undefined,
        userAgent: ua ? ua.trim() : undefined,
        referer: ref ? ref.trim() : undefined,
        cookies: ck ? ck.trim() : undefined,
      });
      if (info && info.filename) {
        metadataCacheRef.current[fetchKey] = info;
        setFileSizeText(info.formatted_size || 'Unknown');
        setFileFetched(true);
        setErrorMessage('');
        if (info.accept_ranges !== undefined) {
          setAcceptRanges(Boolean(info.accept_ranges));
        }
        if (info.ytdlp_installed !== undefined) {
          setIsYtdlpInstalled(Boolean(info.ytdlp_installed));
        }
        const detectedCat =
          info.is_ytdlp || info.is_hls
            ? 'Videos'
            : (category && category !== 'All' && category !== 'None' ? category : utilDetectCategory(info.filename));
        if (detectedCat) {
          setCategory(detectedCat);
        }
        const baseDir = defaultBasePath || globalSettings?.downloadPath || '';
        const customCatPath = detectedCat ? categoryPaths[detectedCat] : undefined;
        const targetSavePath =
          !isCustomPath && detectedCat && useCategory
            ? customCatPath || joinPath(baseDir, detectedCat)
            : !isCustomPath
            ? baseDir
            : savePath;
        if (!isCustomPath) {
          setSavePath(targetSavePath);
        }
        invoke<string>('resolve_unique_filename_command', {
          savePath: targetSavePath,
          filename: info.filename,
        })
          .then((u) => {
            if (u) setName(u);
            else setName(info.filename);
          })
          .catch(() => {
            setName(info.filename);
          });
        if (info.is_ytdlp) {
          setProtocol('Yt-DLP');
          setCategory('Videos');
          if (Array.isArray(info.formats) && info.formats.length > 0) {
            setAvailableFormats(info.formats);
          }
        } else if (info.is_hls) {
          setProtocol('HLS');
          setCategory('Videos');
        }
      } else {
        setFileSizeText('Unknown');
        setFileFetched(false);
        setErrorMessage('Could not retrieve file information from the server.');
      }
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || 'Error fetching info';
      setFileSizeText('Unknown');
      setFileFetched(false);
      if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
        setErrorMessage(
          'Authentication Required (401): Please check your credentials in Site Credentials Vault or Extra Config (⚙️).'
        );
      } else {
        setErrorMessage(`Server Error: ${msg}`);
      }
    } finally {
      inFlightFetchRef.current = false;
      setIsFetchingInfo(false);
    }
  };

  const handleDownloadNow = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!url.trim()) return;
    if (protocol === 'Yt-DLP' && !isYtdlpInstalled) {
      setErrorMessage(
        'Media Tools (YT-DLP & FFmpeg) are not installed on this PC. Please install them first to download this video stream.'
      );
      return;
    }
    let finalName = name.trim() || url.split('/').pop() || 'download';
    if (
      finalName.toLowerCase().endsWith('.m3u8') ||
      protocol === 'HLS' ||
      protocol === 'Yt-DLP'
    ) {
      finalName = finalName.replace(/\.m3u8$/i, '.mp4');
      if (!finalName.includes('.')) finalName += '.mp4';
    }

    let finalSavePath = (savePath || '').trim();
    let currentBase = defaultBasePath || globalSettings?.downloadPath || '';
    if (!currentBase) {
      try {
        currentBase = (await invoke<string>('get_default_download_dir')) || '';
      } catch {}
    }
    const isRel = !finalSavePath || (!finalSavePath.includes(':') && !finalSavePath.startsWith('/') && !finalSavePath.startsWith('\\\\'));
    if (isRel && currentBase) {
      finalSavePath = finalSavePath ? joinPath(currentBase, finalSavePath) : currentBase;
    }

    try {
      const resolved = await invoke<string>('resolve_unique_filename_command', {
        savePath: finalSavePath,
        filename: finalName,
      });
      if (resolved) {
        finalName = resolved;
      }
    } catch {}

    const taskId = Date.now().toString();
    let effectiveProtocol =
      protocol === 'Yt-DLP' ? `Yt-DLP:${ytdlpQuality}` : protocol || 'Auto';
    if (cookies && cookies.trim()) {
      effectiveProtocol += `::cookie=${encodeURIComponent(cookies.trim())}`;
    }
    const rawChecksum = (checksumVal || '').trim();
    const givenCheckSum =
      (checksumEnabled || rawChecksum !== '') && rawChecksum !== '' ? rawChecksum : '';
    const resolvedCat =
      category && category !== 'All' ? category : detectCategory(finalName || url);
    const calculatedLimit = getSpeedLimitInBytes();

    let baseList: any[] = [];
    try {
      const existingDownloadsJson = await loadFromThunderDB<any[]>('downloads', []);
      baseList = Array.isArray(existingDownloadsJson) ? existingDownloadsJson : [];
    } catch {}

    const cleanQueue = (queue || '').trim();
    const isQueueAssigned = cleanQueue !== '';
    let shouldQueue = false;

    if (isQueueAssigned) {
      let targetQ: any = null;
      try {
        const storedQueues = await loadFromThunderDB<any[]>('queues', []);
        if (Array.isArray(storedQueues)) {
          targetQ = storedQueues.find(
            (q: any) =>
              q.name?.toLowerCase() === cleanQueue.toLowerCase() ||
              q.id?.toLowerCase() === cleanQueue.toLowerCase()
          );
        }
      } catch {}

      if (!targetQ || !targetQ.isRunning) {
        shouldQueue = true;
      } else {
        const queueMax = Math.max(1, targetQ.maxConcurrent || 1);
        const activeInQueue = baseList.filter(
          (d: any) =>
            Boolean(d.queue && d.queue.trim() !== '') &&
            (d.queue.toLowerCase() === targetQ.name?.toLowerCase() ||
              d.queue.toLowerCase() === targetQ.id?.toLowerCase()) &&
            (d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging')
        ).length;
        shouldQueue = activeInQueue >= queueMax;
      }
    } else {
      let maxAllowed = Infinity;
      let isUnlimited = true;
      try {
        const engine = await loadFromThunderDB<any>('download_engine', null);
        const conf = engine || globalSettings;
        if (conf) {
          const mc =
            conf.maxConcurrentDownloads !== undefined
              ? conf.maxConcurrentDownloads
              : conf.maxConcurrent;
          if (mc === 0 || mc === undefined || mc === null || mc >= 999) {
            isUnlimited = true;
            maxAllowed = Infinity;
          } else {
            isUnlimited = false;
            maxAllowed = Math.max(1, Number(mc));
          }
        }
      } catch {}

      const activeGeneralCount = baseList.filter(
        (d: any) =>
          (!d.queue || d.queue.trim() === '') &&
          (d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging')
      ).length;

      shouldQueue = !isUnlimited && activeGeneralCount >= maxAllowed;
    }
    const matchedVault = matchVaultCredentials(url.trim(), vaultList);

    const taskItem: any = {
      id: taskId,
      name: finalName,
      category: resolvedCat,
      url,
      size: 0,
      downloaded: 0,
      status: shouldQueue ? 'Queued' : 'Downloading',
      speed: 0,
      timeLeft: shouldQueue ? 'Queued' : 'Calculating...',
      dateAdded: new Date().toISOString(),
      queue: queue || '',
      savePath: finalSavePath,
      resumeSupport:
        acceptRanges === true ? 'Yes' : acceptRanges === false ? 'No' : 'Unknown',
      threadCount:
        matchedVault?.threadCount ||
        (threadCount > 0 ? threadCount : defaultThreadCount || globalSettings?.defaultThreadCount || 8),
      speedLimit:
        matchedVault?.speedLimit && matchedVault.speedLimit > 0
          ? matchedVault.speedLimit * 1024
          : calculatedLimit,
      username: username.trim() || matchedVault?.user || undefined,
      password: password.trim() || matchedVault?.pass || undefined,
      userAgent: userAgent.trim() || matchedVault?.userAgent || undefined,
      referer: refererPage.trim() || undefined,
      cookies: cookies.trim() || undefined,
      chunks: [],
    };

    if (givenCheckSum) {
      taskItem.givenCheckSum = givenCheckSum;
      taskItem.expectedChecksum = givenCheckSum;
    }

    try {
      Events.Emit('register-download-item', taskItem);
    } catch {}

    try {
      const updatedList = [taskItem, ...baseList.filter((d: any) => d.id !== taskId)];
      await saveToThunderDB('downloads', updatedList);
    } catch (err) {
      console.error('Failed to save download to json:', err);
    }

    if (saveCategoryPath && resolvedCat && resolvedCat !== 'All' && resolvedCat !== 'None' && finalSavePath) {
      await saveCategoryPathToEngine(resolvedCat, finalSavePath);
    }

    if (!shouldQueue) {
      try {
        const appData = await loadFromThunderDB<any>('appearance', {});
        const shouldShowProgress = appData && typeof appData.showProgressDialog === 'boolean'
          ? appData.showProgressDialog
          : true;

        if (shouldShowProgress) {
          await invoke('remove_hidden_download_command', { id: taskId });
          await invoke('open_realtime_progress_window_command', {
            id: taskId,
            taskId: taskId,
            filename: finalName,
            url: url,
            savePath: finalSavePath,
            resumeSupport: acceptRanges === true ? 'Yes' : acceptRanges === false ? 'No' : 'Unknown',
            resumable: acceptRanges === true,
            force: true,
            showRealTimeProgress: true,
          });
        }
      } catch (e) {
        console.error('Failed to open realtime progress window from confirmation:', e);
      }

      try {
        await invoke('start_download', {
          id: taskId,
          url,
          savePath: finalSavePath,
          filename: finalName,
          category: resolvedCat,
          queue: queue || '',
          threadCount:
            matchedVault?.threadCount ||
            (threadCount > 0 ? threadCount : defaultThreadCount || globalSettings?.defaultThreadCount || 8),
          speedLimit:
            matchedVault?.speedLimit && matchedVault.speedLimit > 0
              ? matchedVault.speedLimit * 1024
              : calculatedLimit,
          speed_limit:
            matchedVault?.speedLimit && matchedVault.speedLimit > 0
              ? matchedVault.speedLimit * 1024
              : calculatedLimit,
          protocol: effectiveProtocol,
          givenCheckSum: givenCheckSum || undefined,
          expectedChecksum: givenCheckSum || undefined,
          username: username.trim() || matchedVault?.user || undefined,
          password: password.trim() || matchedVault?.pass || undefined,
          userAgent: userAgent.trim() || matchedVault?.userAgent || undefined,
          referer: refererPage.trim() || undefined,
          cookies: cookies.trim() || undefined,
        });
      } catch {
        if (addDownload) {
          await addDownload(url, finalName, (category || 'Other') as any, finalSavePath, queue, {
            givenCheckSum,
            expectedChecksum: givenCheckSum,
            threadCount: threadCount > 0 ? threadCount : defaultThreadCount || globalSettings?.defaultThreadCount || 8,
            speedLimit: calculatedLimit,
            protocol: effectiveProtocol,
            username: username.trim() || undefined,
            password: password.trim() || undefined,
            userAgent: userAgent.trim() || undefined,
            referer: refererPage.trim() || undefined,
            cookies: cookies.trim() || undefined,
          });
        }
      }
    }
    handleClose();
  };

  const handleAddOnly = async (targetQueueName?: string) => {
    if (!url.trim()) return;
    if (protocol === 'Yt-DLP' && !isYtdlpInstalled) {
      setErrorMessage(
        'Media Tools (YT-DLP & FFmpeg) are not installed on this PC. Please install them first to add this video stream.'
      );
      return;
    }
    const isWithoutQueue = targetQueueName === '';
    const resolvedQueue =
      targetQueueName === ''
        ? ''
        : typeof targetQueueName === 'string' && targetQueueName.trim() !== ''
        ? targetQueueName.trim()
        : queue || 'Main';
    let finalName = name.trim() || url.split('/').pop() || 'download';
    if (
      finalName.toLowerCase().endsWith('.m3u8') ||
      protocol === 'HLS' ||
      protocol === 'Yt-DLP'
    ) {
      finalName = finalName.replace(/\.m3u8$/i, '.mp4');
      if (!finalName.includes('.')) finalName += '.mp4';
    }

    let finalSavePath = (savePath || '').trim();
    let currentBase = defaultBasePath || globalSettings?.downloadPath || '';
    if (!currentBase) {
      try {
        currentBase = (await invoke<string>('get_default_download_dir')) || '';
      } catch {}
    }
    const isRel = !finalSavePath || (!finalSavePath.includes(':') && !finalSavePath.startsWith('/') && !finalSavePath.startsWith('\\\\'));
    if (isRel && currentBase) {
      finalSavePath = finalSavePath ? joinPath(currentBase, finalSavePath) : currentBase;
    }

    try {
      const resolved = await invoke<string>('resolve_unique_filename_command', {
        savePath: finalSavePath,
        filename: finalName,
      });
      if (resolved) {
        finalName = resolved;
      }
    } catch {}

    const taskId = Date.now().toString();
    let effectiveProtocol =
      protocol === 'Yt-DLP' ? `Yt-DLP:${ytdlpQuality}` : protocol || 'Auto';
    if (cookies && cookies.trim()) {
      effectiveProtocol += `::cookie=${encodeURIComponent(cookies.trim())}`;
    }
    const rawChecksum = (checksumVal || '').trim();
    const givenCheckSum =
      (checksumEnabled || rawChecksum !== '') && rawChecksum !== '' ? rawChecksum : '';
    const resolvedCat =
      category && category !== 'All' ? category : detectCategory(finalName || url);
    const calculatedLimit = getSpeedLimitInBytes();
    const matchedVault = matchVaultCredentials(url.trim(), vaultList);

    const taskItem: any = {
      id: taskId,
      name: finalName,
      category: resolvedCat,
      url,
      size: 0,
      downloaded: 0,
      status: isWithoutQueue ? 'Paused' : 'Queued',
      speed: 0,
      timeLeft: isWithoutQueue ? 'Paused' : 'Queued',
      dateAdded: new Date().toISOString(),
      queue: resolvedQueue,
      savePath: finalSavePath,
      resumeSupport:
        acceptRanges === true ? 'Yes' : acceptRanges === false ? 'No' : 'Unknown',
      threadCount:
        matchedVault?.threadCount ||
        (threadCount > 0 ? threadCount : defaultThreadCount || globalSettings?.defaultThreadCount || 8),
      speedLimit: calculatedLimit,
      username: username.trim() || undefined,
      password: password.trim() || undefined,
      userAgent: userAgent.trim() || undefined,
      referer: refererPage.trim() || undefined,
      cookies: cookies.trim() || undefined,
      chunks: [],
    };

    if (givenCheckSum) {
      taskItem.givenCheckSum = givenCheckSum;
      taskItem.expectedChecksum = givenCheckSum;
    }

    try {
      Events.Emit('register-download-item', taskItem);
    } catch {}

    try {
      const existingDownloadsJson = await loadFromThunderDB<any[]>('downloads', []);
      const baseList = Array.isArray(existingDownloadsJson) ? existingDownloadsJson : [];

      const updatedList = [taskItem, ...baseList.filter((d: any) => d.id !== taskId)];
      await saveToThunderDB('downloads', updatedList);
    } catch (err) {
      console.error('Failed to save download to json:', err);
    }

    if (saveCategoryPath && resolvedCat && resolvedCat !== 'All' && resolvedCat !== 'None' && finalSavePath) {
      await saveCategoryPathToEngine(resolvedCat, finalSavePath);
    }

    handleClose();
  };

  const renderCategoryIcon = () => {
    if (category === 'Videos') return <Video className="w-4 h-4 text-primary" />;
    if (category === 'Compressed') return <Archive className="w-4 h-4 text-amber-500" />;
    if (category === 'Music') return <Music className="w-4 h-4 text-emerald-500" />;
    if (category === 'Pictures') return <ImageIcon className="w-4 h-4 text-blue-500" />;
    if (category === 'Documents') return <FileText className="w-4 h-4 text-sky-500" />;
    return <Folder className="w-4 h-4 text-muted-foreground" />;
  };

  return (
    <div
      onClick={() => setShowQueuePicker(false)}
      className="h-screen w-screen flex flex-col bg-card font-sans antialiased text-foreground select-none overflow-hidden border border-border"
    >
      {/* Custom Titlebar */}
      <div
        style={{ '--wails-draggable': 'drag' } as React.CSSProperties}
        className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b border-border cursor-move shrink-0"
      >
        <div className="flex items-center space-x-2.5 pointer-events-none">
          <div className="w-5 h-5 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center shrink-0">
            <img src="/icon.svg" alt="ThunderDM" className="w-3.5 h-3.5 object-contain" />
          </div>
          <span className="text-[13px] font-semibold text-foreground tracking-tight">
            Add Download
          </span>
        </div>

        {/* Window Controls */}
        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={handleMinimize}
            className="p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground rounded transition-colors cursor-pointer"
            title="Minimize"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 hover:bg-red-500 hover:text-white dark:hover:bg-red-600 text-muted-foreground rounded transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body & Flyout Panel */}
      <div className="flex-1 flex overflow-hidden relative min-w-0">
        <div className="flex-1 p-4 flex flex-col justify-between overflow-y-auto overflow-x-hidden space-y-3.5 text-xs min-w-0 custom-scrollbar">
          <form onSubmit={handleDownloadNow} className="space-y-3.5 min-w-0">
            {/* Row 1: URL Input */}
            <div className="relative flex items-center min-w-0">
              <Input
                type="url"
                required
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste download URL here..."
                className="w-full bg-background border-border text-foreground font-mono text-[11px] pr-9 h-9"
              />
              <button
                type="button"
                onClick={handlePasteClipboard}
                className="absolute right-2.5 text-muted-foreground hover:text-foreground transition-colors p-1 cursor-pointer"
                title="Paste from Clipboard"
              >
                <Clipboard className="w-4 h-4" />
              </button>
            </div>

            {/* Row 2: Category controls & File info badge */}
            <div className="flex items-center justify-between gap-2 min-w-0">
              <div className="flex items-center space-x-2 shrink-0">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="use-category"
                    checked={useCategory}
                    onCheckedChange={handleUseCategoryToggle}
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
                    {renderCategoryIcon()}
                    <select
                      value={category}
                      onChange={(e) => handleCategoryChange(e.target.value)}
                      className="bg-transparent text-foreground text-xs outline-none cursor-pointer pr-4 appearance-none"
                    >
                      <option value="" className="bg-card text-muted-foreground">
                        None
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
                {renderCategoryIcon()}
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

            {/* Protocol & Quality Selection Row */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex items-center space-x-2 bg-muted/40 border border-border rounded-xl px-3 py-1.5 shrink-0">
                <span className="text-muted-foreground font-medium text-[11px]">Protocol:</span>
                <select
                  value={protocol}
                  onChange={(e) => {
                    const newProto = e.target.value;
                    setProtocol(newProto);
                    if (newProto === 'Yt-DLP') {
                      setCategory('Videos');
                      checkYtdlpStatus();
                    }
                  }}
                  className="bg-transparent text-foreground text-xs font-semibold outline-none cursor-pointer pr-2 appearance-none"
                >
                  <option value="Auto" className="bg-card">
                    Auto
                  </option>
                  <option value="HTTP" className="bg-card">
                    HTTP
                  </option>
                  <option value="HLS" className="bg-card">
                    HLS
                  </option>
                  <option value="Yt-DLP" className="bg-card text-primary">
                    Yt-DLP
                  </option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              </div>

              {protocol === 'Yt-DLP' && (
                <div className="flex-1 flex items-center space-x-2 bg-muted/40 border border-primary/40 rounded-xl px-3 py-1.5 min-w-0">
                  <span className="text-primary font-semibold text-[11px] shrink-0">Quality:</span>
                  <select
                    value={ytdlpQuality}
                    onChange={(e) => setYtdlpQuality(e.target.value)}
                    className="bg-transparent text-foreground text-xs font-medium outline-none cursor-pointer w-full truncate"
                  >
                    <option value="best" className="bg-card text-primary font-semibold">
                      ★ Best Quality (Auto-Merged MP4)
                    </option>
                    <option value="1080p" className="bg-card">
                      1080p (Full HD)
                    </option>
                    <option value="720p" className="bg-card">
                      720p (HD)
                    </option>
                    <option value="480p" className="bg-card">
                      480p (SD)
                    </option>
                    <option value="360p" className="bg-card">
                      360p (Low)
                    </option>
                    <option value="audio" className="bg-card text-emerald-500">
                      🎵 Audio Only (MP3)
                    </option>
                    {availableFormats.map((f, idx) => (
                      <option key={f.format_id || idx} value={f.format_id} className="bg-card">
                        {f.resolution || f.format_note} ({f.ext || 'mp4'})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Row 3: Save Path & Actions */}
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex-1 relative flex items-center min-w-0">
                <Input
                  type="text"
                  value={savePath}
                  onChange={(e) => {
                    setSavePath(e.target.value);
                    setIsCustomPath(true);
                  }}
                  onBlur={async () => {
                    if (savePath.trim() && (name.trim() || url.trim())) {
                      const candidateName = name.trim() || url.split('/').pop() || '';
                      try {
                        const uniqueName = await invoke<string>(
                          'resolve_unique_filename_command',
                          {
                            savePath: savePath.trim(),
                            filename: candidateName,
                          }
                        );
                        if (uniqueName) setName(uniqueName);
                      } catch {}
                    }
                  }}
                  className="w-full bg-background border-border text-foreground font-mono text-[11px] pr-9 h-8 truncate"
                />
                <div className="absolute right-2 flex items-center">
                  <Tooltip description="Choose folder location on disk" position="top-right">
                    <button
                      type="button"
                      onClick={handlePickSavePath}
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
                    onClick={() => handleRefreshInfo()}
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
                    onClick={() => setShowExtraConfig(!showExtraConfig)}
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
                  onCheckedChange={(c) => handleSaveCategoryPathToggle(Boolean(c))}
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
                onChange={(e) => setName(e.target.value)}
                placeholder="Filename"
                className="w-full bg-background border-border text-foreground font-mono text-[11px] h-8"
              />
            </div>
          </form>

          {/* Missing Media Tools Notice */}
          {protocol === 'Yt-DLP' && !isYtdlpInstalled && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-start gap-3 text-xs animate-in fade-in duration-200 min-w-0">
              <div className="p-2 bg-amber-500/20 rounded-xl text-amber-500 shrink-0 mt-0.5">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div className="space-y-1 min-w-0 flex-1">
                <div className="text-amber-500 font-semibold text-[12px]">
                  Media Tools (YT-DLP & FFmpeg) Required
                </div>
                <div className="text-muted-foreground text-[11px] leading-relaxed">
                  To download video & audio streams with YT-DLP, open the main window, click{' '}
                  <strong className="text-foreground">Tools</strong>, and select{' '}
                  <strong className="text-foreground">Install Media Tools</strong>.
                </div>
              </div>
            </div>
          )}

          {/* Error Message Display */}
          {errorMessage && url.trim() && !isFetchingInfo && (
            <div className="text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-2 text-[11px] font-medium animate-in fade-in duration-200 mt-2 min-w-0 break-all break-words [overflow-wrap:anywhere] max-h-24 overflow-y-auto custom-scrollbar select-text">
              {errorMessage}
            </div>
          )}

          {/* Bottom Action Buttons */}
          <div className="flex items-center justify-between pt-2 border-t border-border min-w-0">
            <div className="flex items-center space-x-2">
              <div className="relative">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowQueuePicker(!showQueuePicker);
                  }}
                  disabled={
                    isFetchingInfo || !url.trim() || (protocol === 'Yt-DLP' && !isYtdlpInstalled)
                  }
                  className="rounded-xl font-medium text-xs flex items-center space-x-1.5"
                >
                  <span>Add</span>
                  <ChevronUp
                    className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 ${
                      showQueuePicker ? 'rotate-180 text-primary' : ''
                    }`}
                  />
                </Button>

                {/* Queue Selection Popover Menu */}
                {showQueuePicker && (
                  <div
                    className="absolute bottom-full left-0 mb-2 w-56 bg-popover border border-border rounded-2xl shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="px-2.5 py-1.5 text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border flex items-center justify-between">
                      <span>Select Queue</span>
                      <span className="text-primary font-normal">{availableQueues.length} Queues</span>
                    </div>
                    <div className="py-1 max-h-48 overflow-y-auto space-y-0.5 custom-scrollbar">
                      {/* Without Queue Option */}
                      <button
                        type="button"
                        onClick={() => {
                          setShowQueuePicker(false);
                          handleAddOnly('');
                        }}
                        className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-accent text-xs font-medium text-foreground hover:text-accent-foreground transition-colors cursor-pointer text-left group"
                      >
                        <div className="flex items-center space-x-2 min-w-0">
                          <Ban className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate">Without queue</span>
                        </div>
                      </button>

                      {availableQueues.length > 0 && (
                        <div className="my-1 border-t border-border" />
                      )}

                      {availableQueues.map((q) => {
                        const qName = q.name || q.id;
                        const count = queueCounts[qName] || 0;
                        return (
                          <button
                            key={q.id || q.name}
                            type="button"
                            onClick={() => {
                              setShowQueuePicker(false);
                              handleAddOnly(qName);
                            }}
                            className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-accent text-xs font-medium text-foreground hover:text-accent-foreground transition-colors cursor-pointer text-left group"
                          >
                            <div className="flex items-center space-x-2 min-w-0">
                              <Folder className="w-3.5 h-3.5 text-primary shrink-0" />
                              <span className="truncate">{qName}</span>
                            </div>
                            <span className="text-[10px] bg-muted group-hover:bg-accent text-muted-foreground group-hover:text-foreground px-2 py-0.5 rounded-full ml-2 shrink-0 font-mono transition-colors">
                              {count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <Button
                type="button"
                onClick={handleDownloadNow}
                disabled={
                  isFetchingInfo || !url.trim() || (protocol === 'Yt-DLP' && !isYtdlpInstalled)
                }
                size="sm"
                className="rounded-xl px-6 font-medium text-xs shadow-md"
              >
                {protocol === 'Yt-DLP' && !isYtdlpInstalled
                  ? 'Media Tools Required'
                  : isFetchingInfo
                  ? 'Checking...'
                  : 'Download'}
              </Button>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleClose}
              className="rounded-xl px-5 font-medium text-xs"
            >
              Cancel
            </Button>
          </div>
        </div>

        {/* Extra Config Overlay Flyout Panel */}
        {showExtraConfig && (
          <div className="absolute inset-y-0 right-0 w-[250px] bg-card border-l border-border p-4 flex flex-col justify-between animate-in slide-in-from-right duration-150 text-xs space-y-3 z-30 shadow-2xl overflow-y-auto overflow-x-hidden custom-scrollbar">
            <div>
              <div className="flex items-center justify-between border-b border-border pb-2 mb-3">
                <span className="font-semibold text-foreground text-xs">Extra Config</span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  type="button"
                  onClick={() => setShowExtraConfig(false)}
                  className="h-6 w-6 rounded-md text-muted-foreground hover:bg-red-500 hover:text-white dark:hover:bg-red-600 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>

              <div className="space-y-4">
                {/* Speed Limit */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-foreground font-medium text-[11px] flex items-center space-x-1">
                      <span>Speed Limit</span>
                      <HelpTooltip description="Cap maximum download speed." badge position="left" />
                    </Label>
                    <Checkbox
                      checked={speedLimitEnabled}
                      onCheckedChange={(checked) => {
                        setSpeedLimitEnabled(Boolean(checked));
                        if (checked && (!speedLimitVal || speedLimitVal <= 0)) {
                          setSpeedLimitVal(5);
                        }
                      }}
                    />
                  </div>
                  <div>
                    {speedLimitEnabled ? (
                      <div className="flex items-center space-x-1.5 pt-1">
                        <Input
                          type="number"
                          min="1"
                          placeholder="5"
                          value={speedLimitVal || ''}
                          onChange={(e) => {
                            const val =
                              e.target.value === ''
                                ? 0
                                : Math.max(1, parseInt(e.target.value, 10) || 0);
                            setSpeedLimitVal(val);
                          }}
                          className="flex-1 bg-background text-foreground text-xs font-mono h-8"
                        />
                        <select
                          value={speedLimitUnit}
                          onChange={(e) => setSpeedLimitUnit(e.target.value)}
                          className="bg-background border border-border text-foreground rounded-md px-2 py-1 text-xs outline-none cursor-pointer h-8"
                        >
                          <option value="MB/s">MB/s</option>
                          <option value="KB/s">KB/s</option>
                        </select>
                      </div>
                    ) : (
                      <div className="text-[10px] text-muted-foreground">Unlimited</div>
                    )}
                  </div>
                </div>

                {/* File Checksum */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-foreground font-medium text-[11px] flex items-center space-x-1">
                      <span>File Checksum</span>
                      <HelpTooltip description="Verify integrity after download with MD5/SHA256." badge position="left" />
                    </Label>
                    <Checkbox
                      checked={checksumEnabled}
                      onCheckedChange={(c) => setChecksumEnabled(Boolean(c))}
                    />
                  </div>
                  {checksumEnabled && (
                    <Input
                      type="text"
                      placeholder="Expected MD5/SHA256"
                      value={checksumVal}
                      onChange={(e) => setChecksumVal(e.target.value)}
                      className="w-full bg-background font-mono text-xs h-8"
                    />
                  )}
                </div>

                {/* Queue Selection */}
                <div className="space-y-1">
                  <Label className="text-foreground font-medium text-[11px] flex items-center space-x-1">
                    <span>Queue</span>
                    <HelpTooltip description="Assign download to a specific queue." badge position="left" />
                  </Label>
                  <select
                    value={queue}
                    onChange={(e) => setQueue(e.target.value)}
                    className="w-full bg-background border border-border text-foreground rounded-lg px-2 py-1 text-xs outline-none cursor-pointer h-8"
                  >
                    <option value="" className="bg-card text-muted-foreground">
                      None (Direct Download)
                    </option>
                    {availableQueues.map((q) => (
                      <option key={q.id || q.name} value={q.name} className="bg-card">
                        {q.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Thread Count */}
                <div className="space-y-1">
                  <Label className="text-foreground font-medium text-[11px] flex items-center space-x-1">
                    <span>Thread Count</span>
                    <HelpTooltip description="Concurrent connection threads." badge position="left" />
                  </Label>
                  <select
                    value={threadCount}
                    onChange={(e) => setThreadCount(Number(e.target.value))}
                    className="w-full bg-background border border-border text-foreground rounded-lg px-2 py-1 text-xs outline-none h-8"
                  >
                    <option value={0}>Use Global Settings ({defaultThreadCount || 8})</option>
                    <option value={1}>1 Thread</option>
                    <option value={2}>2 Threads</option>
                    <option value={4}>4 Threads</option>
                    <option value={8}>8 Threads</option>
                    {defaultThreadCount && ![1, 2, 4, 8, 16, 32].includes(defaultThreadCount) && (
                      <option value={defaultThreadCount}>{defaultThreadCount} Threads (Default)</option>
                    )}
                    <option value={16}>16 Threads</option>
                    <option value={32}>32 Threads</option>
                  </select>
                </div>

                {/* User Agent */}
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-[10px]">User Agent</Label>
                  <Input
                    type="text"
                    placeholder="Custom User-Agent"
                    value={userAgent}
                    onChange={(e) => setUserAgent(e.target.value)}
                    className="w-full bg-background font-mono text-[10px] h-7"
                  />
                </div>

                {/* Referer */}
                <div className="space-y-1">
                  <Label className="text-muted-foreground text-[10px]">Referer URL</Label>
                  <Input
                    type="text"
                    placeholder="https://..."
                    value={refererPage}
                    onChange={(e) => setRefererPage(e.target.value)}
                    className="w-full bg-background font-mono text-[10px] h-7"
                  />
                </div>

                {/* Authentication */}
                <div className="space-y-1.5 pt-1 border-t border-border">
                  <Label className="text-[10px] text-muted-foreground font-medium">
                    HTTP Authentication
                  </Label>
                  <Input
                    type="text"
                    placeholder="Username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full bg-background text-[10px] h-7"
                  />
                  <Input
                    type="password"
                    placeholder="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-background text-[10px] h-7"
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DownloadStartConfirmation;
