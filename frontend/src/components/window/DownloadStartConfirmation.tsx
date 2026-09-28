/**
 * DownloadStartConfirmation Popup Window Orchestrator.
 * Coordinates URL probing, category/path resolution, protocol & format selection,
 * cookie bypass rules, extra configuration options, and download task registration.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Clipboard, Minus, X } from 'lucide-react';
import { useDownloadContext } from '../../context/DownloadContext';
import { CookieBypassRule } from '../../types/download';
import { invoke, listen } from '../../utils/tauriBridge';
import { loadFromThunderDB, saveToThunderDB } from '../../utils/thunderDB';
import { detectCategory as utilDetectCategory } from '../../utils/category';
import { Input } from '@/components/ui/input';
import { QueueItem, RefreshInfoOptions, YtdlpFormat } from './confirmation/types';
import {
  joinPath,
  matchVaultCredentials,
  DEFAULT_COOKIE_BYPASS_RULES,
  normalizeProtocolCategory,
  findMatchedCookieBypassRule,
  isCookieBypassedByDatabase,
  getInitialWindowId,
  deriveInitialName,
  deriveInitialCategory,
  deriveInitialSavePath,
  isTorrentUrl,
  minimizeConfirmationWindow,
  closeConfirmationWindow,
  resizeConfirmationWindow,
  analyzeUrlProtocolAndFilename,
  extractCookieBypassRules,
  formatProbeErrorMessage,
  loadInitialEngineAndQueues,
  resolvePayloadCategoryAndProtocol,
  executeDownloadNowTask,
  executeAddOnlyTask,
} from './confirmation/utils';
import { CategorySelectorRow, SavePathAndFilenameSection } from './confirmation/CategoryPathSelector';
import { MediaFormatSelector, MissingMediaToolsBanner } from './confirmation/MediaFormatSelector';
import { QueuePickerFooter } from './confirmation/QueuePickerFooter';
import { AdvancedDownloadOptions } from './confirmation/AdvancedDownloadOptions';

export {
  matchVaultCredentials,
  DEFAULT_COOKIE_BYPASS_RULES,
  normalizeProtocolCategory,
  findMatchedCookieBypassRule,
  isCookieBypassedByDatabase,
};

export const DownloadStartConfirmation: React.FC = () => {
  const { addDownload, globalSettings, extensionPayload } = useDownloadContext();

  const initialUrl = extensionPayload?.url || '';
  const initialName = deriveInitialName(extensionPayload?.filename, initialUrl);
  const initialReferrer = extensionPayload?.referrer || '';
  const initialUserAgent = extensionPayload?.userAgent || '';
  const initialCookies = extensionPayload?.cookies || '';

  const getInitialBasePath = () =>
    extensionPayload?.basePath ||
    extensionPayload?.base_path ||
    globalSettings?.downloadPath ||
    '';

  const [defaultBasePath, setDefaultBasePath] = useState<string>(getInitialBasePath());
  const [defaultThreadCount, setDefaultThreadCount] = useState<number>(
    () => globalSettings?.defaultThreadCount || 8
  );
  const [useCategory, setUseCategory] = useState<boolean>(
    () => globalSettings?.useCategoryByDefault ?? true
  );
  const [vaultList, setVaultList] = useState<any[]>(() => globalSettings?.vaultItems || []);

  const [url, setUrl] = useState<string>(initialUrl);
  const [name, setName] = useState<string>(initialName);
  const [category, setCategory] = useState<string>(() =>
    deriveInitialCategory(extensionPayload?.category, initialUrl, initialName)
  );
  const [isCustomPath, setIsCustomPath] = useState<boolean>(false);
  const [saveCategoryPath, setSaveCategoryPath] = useState<boolean>(false);
  const [categoryPaths, setCategoryPaths] = useState<{ [key: string]: string }>({});
  const [savePath, setSavePath] = useState<string>(() =>
    deriveInitialSavePath(extensionPayload, getInitialBasePath(), initialUrl, initialName)
  );
  const [queue, setQueue] = useState<string>('');
  const [availableQueues, setAvailableQueues] = useState<QueueItem[]>([
    { id: 'main', name: 'Main' },
  ]);
  const [showQueuePicker, setShowQueuePicker] = useState<boolean>(false);
  const [queueCounts, setQueueCounts] = useState<{ [key: string]: number }>({});

  const userManuallyToggledCookieRef = useRef<boolean>(false);
  const lastEvaluatedDomainRef = useRef<string>('');
  const lastEvaluatedCookieRef = useRef<boolean | null>(null);

  const [showExtraConfig, setShowExtraConfig] = useState<boolean>(false);
  const [isFetchingInfo, setIsFetchingInfo] = useState<boolean>(false);
  const [fileFetched, setFileFetched] = useState<boolean>(false);
  const [fileSizeText, setFileSizeText] = useState<string>('Unknown');
  const [errorMessage, setErrorMessage] = useState<string>('');

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

  const [protocol, setProtocol] = useState<string>(() => {
    if (extensionPayload?.protocol) return extensionPayload.protocol;
    return isTorrentUrl(initialUrl) ? 'Torrent' : 'Auto';
  });
  const [ytdlpQuality, setYtdlpQuality] = useState<string>('best');
  const [availableFormats, setAvailableFormats] = useState<YtdlpFormat[]>([]);
  const [isYtdlpInstalled, setIsYtdlpInstalled] = useState<boolean>(true);

  const [cookieBypassRules, setCookieBypassRules] = useState<CookieBypassRule[]>(
    () =>
      extractCookieBypassRules(extensionPayload) ||
      extractCookieBypassRules(globalSettings) ||
      DEFAULT_COOKIE_BYPASS_RULES
  );

  const { isBypassed: isBypassedByRule, matchedRule: matchedCookieRule } =
    isCookieBypassedByDatabase(url, protocol, cookieBypassRules);

  const [useCookie, setUseCookie] = useState<boolean>(() => {
    if (extensionPayload?.useCookie !== undefined) return Boolean(extensionPayload.useCookie);
    const initialRules =
      extractCookieBypassRules(extensionPayload) ||
      extractCookieBypassRules(globalSettings) ||
      DEFAULT_COOKIE_BYPASS_RULES;
    return !isCookieBypassedByDatabase(initialUrl, extensionPayload?.protocol || 'Auto', initialRules)
      .isBypassed;
  });

  const lastFetchedKeyRef = useRef<string>('');
  const inFlightFetchRef = useRef<boolean>(false);
  const metadataCacheRef = useRef<{ [key: string]: any }>({});
  const hasCheckedYtdlpRef = useRef<boolean>(false);

  const getSpeedLimitInBytes = (): number | null => {
    if (!speedLimitEnabled || !speedLimitVal || speedLimitVal <= 0) return null;
    return speedLimitUnit === 'KB/s'
      ? Math.round(speedLimitVal * 1024)
      : Math.round(speedLimitVal * 1024 * 1024);
  };

  const applyVaultSpeedLimit = (limitBytes: number) => {
    setSpeedLimitEnabled(true);
    if (limitBytes >= 1024 * 1024) {
      setSpeedLimitUnit('MB/s');
      setSpeedLimitVal(Math.round(limitBytes / (1024 * 1024)));
    } else {
      setSpeedLimitUnit('KB/s');
      setSpeedLimitVal(Math.round(limitBytes / 1024));
    }
  };

  const checkYtdlpStatus = async (force = false): Promise<boolean> => {
    if (hasCheckedYtdlpRef.current && !force) return isYtdlpInstalled;
    hasCheckedYtdlpRef.current = true;
    try {
      const res = await invoke<any>('check_ytdlp');
      const allInstalled = Boolean(res?.allInstalled ?? (res?.installed && res?.ffmpegInstalled));
      setIsYtdlpInstalled(allInstalled);
      return allInstalled;
    } catch {}
    return true;
  };

  useEffect(() => {
    loadInitialEngineAndQueues(globalSettings?.defaultThreadCount || 8)
      .then(({ engine, resolvedDefaultThreads, savedCategoryPaths, loadedRules, queues, queueCounts: counts }) => {
        setDefaultThreadCount(resolvedDefaultThreads);
        setCategoryPaths(savedCategoryPaths);
        if (loadedRules.length > 0) setCookieBypassRules(loadedRules);

        if (url && loadedRules.length > 0 && !userManuallyToggledCookieRef.current) {
          const { isBypassed } = isCookieBypassedByDatabase(url, protocol, loadedRules);
          const computedUseCookie = !isBypassed;
          if (lastEvaluatedCookieRef.current !== computedUseCookie) {
            lastEvaluatedCookieRef.current = computedUseCookie;
            setUseCookie(computedUseCookie);
            handleRefreshInfo(url.trim(), { useCookie: computedUseCookie }, true);
          }
        }

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
                if (matched.threadCount && matched.threadCount > 0) {
                  setThreadCount((prev) => (prev === 0 ? matched.threadCount : prev));
                }
                if (matched.speedLimit && matched.speedLimit > 0) {
                  applyVaultSpeedLimit(matched.speedLimit);
                }
              }
            }
          }
          setSavePath((prev) => {
            const currentCat =
              category || (name ? utilDetectCategory(name) : url ? utilDetectCategory(url) : '');
            const isRelativeOrJustCat =
              !prev || prev === currentCat || (!prev.includes('/') && !prev.includes('\\'));
            if (!isCustomPath || isRelativeOrJustCat) {
              if (ucb && currentCat && currentCat !== 'All' && currentCat !== 'None') {
                return savedCategoryPaths[currentCat] || joinPath(basePathVal, currentCat);
              }
              return basePathVal;
            }
            return prev;
          });
        }

        if (queues) setAvailableQueues(queues);
        setQueueCounts(counts);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let currentDomain = '';
    try {
      currentDomain = url && url.includes('://') ? new URL(url).hostname.toLowerCase() : url.toLowerCase();
    } catch {}

    if (currentDomain && currentDomain !== lastEvaluatedDomainRef.current) {
      lastEvaluatedDomainRef.current = currentDomain;
      userManuallyToggledCookieRef.current = false;
      lastEvaluatedCookieRef.current = null;
    }

    if (!userManuallyToggledCookieRef.current && url.trim()) {
      const { isBypassed } = isCookieBypassedByDatabase(url, protocol, cookieBypassRules);
      const newUseCookie = !isBypassed;
      if (lastEvaluatedCookieRef.current !== newUseCookie) {
        lastEvaluatedCookieRef.current = newUseCookie;
        setUseCookie(newUseCookie);
        handleRefreshInfo(url.trim(), { useCookie: newUseCookie }, true);
      }
    }
  }, [url, protocol, cookieBypassRules]);

  useEffect(() => {
    resizeConfirmationWindow(Boolean(errorMessage && url.trim() && !isFetchingInfo));
  }, [errorMessage, url, isFetchingInfo]);

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

          if (payload.basePath) setDefaultBasePath(payload.basePath);
          const isUcb =
            payload.useCategory !== undefined
              ? Boolean(payload.useCategory)
              : globalSettings?.useCategoryByDefault ?? true;
          setUseCategory(isUcb);

          const base = payload.basePath || defaultBasePath || getInitialBasePath();
          const { payloadCat, payloadProtocol, ytdlpQuality: nextQuality } =
            resolvePayloadCategoryAndProtocol(payload, protocol);

          if (payloadCat) setCategory(payloadCat);
          if (isUcb && payloadCat && payloadCat !== 'All' && payloadCat !== 'None') {
            setSavePath(categoryPaths[payloadCat] || joinPath(base, payloadCat));
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
          if (payload.threadCount !== undefined && payload.thread_count !== null) {
            setThreadCount(payload.threadCount);
          } else if (payload.thread_count !== undefined && payload.thread_count !== null) {
            setThreadCount(payload.thread_count);
          }

          let effectiveRules = cookieBypassRules;
          const extracted = extractCookieBypassRules(payload);
          if (extracted) {
            effectiveRules = extracted;
            setCookieBypassRules(extracted);
          }

          if (payload.protocol) {
            setProtocol(payloadProtocol);
            if (nextQuality) setYtdlpQuality(nextQuality);
          }

          const effectiveCookieUsage =
            payload.useCookie !== undefined
              ? Boolean(payload.useCookie)
              : payload.url
              ? !isCookieBypassedByDatabase(payload.url, payloadProtocol, effectiveRules).isBypassed
              : true;
          userManuallyToggledCookieRef.current = false;
          lastEvaluatedCookieRef.current = effectiveCookieUsage;
          setUseCookie(effectiveCookieUsage);

          if (payload.url) {
            setUrl(payload.url);
            handleRefreshInfo(
              payload.url,
              {
                protocol: payloadProtocol,
                cookies: incomingCookies,
                userAgent: incomingUA,
                referer: incomingRef,
                username: incomingUser,
                password: incomingPass,
                useCookie: effectiveCookieUsage,
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
              .then((u) => setName(u || raw))
              .catch(() => setName(raw));
          }
        };

        try {
          let initialPayload = currentWindowId
            ? await invoke<any>('get_download_confirmation_payload', currentWindowId)
            : null;
          if (!initialPayload) {
            initialPayload = await invoke<any>('get_latest_download_confirmation_payload');
          }
          if (initialPayload) applyPayload(initialPayload);
        } catch {}

        if (currentWindowId) {
          unlistenSpecific = await listen(
            `open-download-confirmation-payload-${currentWindowId}`,
            (event: any) => applyPayload(event.payload)
          );
        }
        unlisten = await listen('open-download-confirmation-payload', (event: any) => {
          const p = event?.payload;
          if (p && (!currentWindowId || p.windowId === currentWindowId || p.id === currentWindowId)) {
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
      const { isTorrent, isYTDLP, isHLS, cleanFilename, nextProtocol } =
        analyzeUrlProtocolAndFilename(url, protocol, initialName, name);
      if (nextProtocol) setProtocol(nextProtocol);

      if (cleanFilename) {
        const detectedCat = isTorrent
          ? 'Torrents'
          : isYTDLP || isHLS
          ? 'Videos'
          : utilDetectCategory(cleanFilename);
        setCategory(detectedCat);
        const customCatPath = detectedCat ? categoryPaths[detectedCat] : undefined;
        const targetPath =
          !isCustomPath && useCategory && detectedCat
            ? customCatPath || joinPath(baseDownloadPath, detectedCat)
            : !isCustomPath
            ? baseDownloadPath
            : savePath;
        if (!isCustomPath) setSavePath(targetPath);

        invoke<string>('resolve_unique_filename_command', {
          savePath: targetPath,
          filename: cleanFilename,
        })
          .then((uniqueName) => setName(uniqueName || cleanFilename))
          .catch(() => setName(cleanFilename));

        const matched = matchVaultCredentials(url.trim(), vaultList);
        const customAuth: { username?: string; password?: string; userAgent?: string } = {};
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
          if (matched.threadCount && matched.threadCount > 0) setThreadCount(matched.threadCount);
          if (matched.speedLimit && matched.speedLimit > 0) applyVaultSpeedLimit(matched.speedLimit);
        }

        const timer = setTimeout(() => {
          const { isBypassed } = isCookieBypassedByDatabase(url, protocol, cookieBypassRules);
          const effectiveCookieUsage = userManuallyToggledCookieRef.current ? useCookie : !isBypassed;
          handleRefreshInfo(url.trim(), {
            username: customAuth.username || username,
            password: customAuth.password || password,
            userAgent: customAuth.userAgent || userAgent,
            cookies,
            referer: refererPage,
            useCookie: effectiveCookieUsage,
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
    useCookie,
    protocol,
    cookieBypassRules,
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
        useCookie,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [username, password, userAgent, refererPage, cookies, useCookie]);

  const resolveCandidateUniqueFilename = async (targetPath: string) => {
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
    await resolveCandidateUniqueFilename(targetPath);
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
    await resolveCandidateUniqueFilename(targetPath);
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
      await saveToThunderDB('download_engine', { ...currentEngine, categoryPaths: updatedCatPaths });
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
        await resolveCandidateUniqueFilename(chosen);
      }
    } catch {}
  };

  const handlePasteClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) setUrl(text);
      }
    } catch {}
  };

  const handleRefreshInfo = async (
    targetUrl?: string,
    customOpts: RefreshInfoOptions = {},
    force = false
  ) => {
    const activeUrl = typeof targetUrl === 'string' && targetUrl.trim() ? targetUrl : url;
    if (!activeUrl || typeof activeUrl !== 'string' || !activeUrl.trim()) return;

    const matched = matchVaultCredentials(activeUrl.trim(), vaultList);
    const u = (customOpts.username !== undefined ? customOpts.username : username) || matched?.user || '';
    const p = (customOpts.password !== undefined ? customOpts.password : password) || matched?.pass || '';
    const ua = (customOpts.userAgent !== undefined ? customOpts.userAgent : userAgent) || matched?.userAgent || '';
    const ref = customOpts.referer !== undefined ? customOpts.referer : refererPage;
    const effectiveUseCookie =
      customOpts.useCookie !== undefined ? customOpts.useCookie : useCookie;
    const rawCk = customOpts.cookies !== undefined ? customOpts.cookies : cookies;
    const ck = effectiveUseCookie ? rawCk : '';
    const protoToFetch = customOpts.protocol !== undefined ? customOpts.protocol : protocol;

    const fetchKey = `${activeUrl.trim()}|${protoToFetch || ''}|${u}|${p}|${ua}|${ref || ''}|${ck || ''}|${
      effectiveUseCookie ? 'useCookie' : 'noCookie'
    }`;
    if (!force && (fetchKey === lastFetchedKeyRef.current || inFlightFetchRef.current)) {
      if (metadataCacheRef.current[fetchKey]) {
        const cached = metadataCacheRef.current[fetchKey];
        if (cached.formatted_size) setFileSizeText(cached.formatted_size);
        if (cached.ytdlp_installed !== undefined) setIsYtdlpInstalled(Boolean(cached.ytdlp_installed));
        setFileFetched(true);
        return;
      }
      if (inFlightFetchRef.current) return;
    }

    lastFetchedKeyRef.current = fetchKey;
    inFlightFetchRef.current = true;
    setIsFetchingInfo(true);
    try {
      let info: any = null;
      let lastErr: any = null;

      try {
        info = await invoke<any>('fetch_file_info_command', {
          url: activeUrl.trim(),
          protocol: protoToFetch,
          username: u ? u.trim() : undefined,
          password: p ? p.trim() : undefined,
          userAgent: ua ? ua.trim() : undefined,
          referer: ref ? ref.trim() : undefined,
          cookies: ck ? ck.trim() : undefined,
          forceCookie: effectiveUseCookie,
          force_cookie: effectiveUseCookie,
        });
      } catch (err: any) {
        lastErr = err;
      }

      if (info && (info.filename || info.is_ytdlp)) {
        metadataCacheRef.current[fetchKey] = info;
        setFileSizeText(
          info.formatted_size || (info.is_ytdlp ? 'Dynamic Stream (YT-DLP)' : 'Unknown')
        );
        setFileFetched(true);
        setErrorMessage('');
        if (info.accept_ranges !== undefined) setAcceptRanges(Boolean(info.accept_ranges));
        if (info.ytdlp_installed !== undefined) setIsYtdlpInstalled(Boolean(info.ytdlp_installed));

        let detectedCat = '';
        if (info.is_torrent || protocol === 'Torrent') {
          detectedCat = 'Torrents';
          setProtocol('Torrent');
        } else if (info.is_ytdlp || protocol === 'Yt-DLP') {
          detectedCat = 'Videos';
          setProtocol('Yt-DLP');
          if (Array.isArray(info.formats) && info.formats.length > 0) {
            setAvailableFormats(info.formats);
          }
        } else if (info.is_hls || protocol === 'HLS') {
          detectedCat = 'Videos';
          setProtocol('HLS');
        } else {
          detectedCat = utilDetectCategory(info.filename || activeUrl, protocol);
        }

        if (detectedCat) setCategory(detectedCat);
        const baseDir = defaultBasePath || globalSettings?.downloadPath || '';
        const customCatPath = detectedCat ? categoryPaths[detectedCat] : undefined;
        const targetSavePath =
          !isCustomPath && detectedCat && useCategory
            ? customCatPath || joinPath(baseDir, detectedCat)
            : !isCustomPath
            ? baseDir
            : savePath;
        if (!isCustomPath) setSavePath(targetSavePath);

        const candidateFilename = info.filename || name || 'video.mp4';
        invoke<string>('resolve_unique_filename_command', {
          savePath: targetSavePath,
          filename: candidateFilename,
        })
          .then((uName) => setName(uName || candidateFilename))
          .catch(() => setName(candidateFilename));
      } else if (lastErr) {
        throw lastErr;
      } else {
        setFileSizeText('Unknown');
        setFileFetched(false);
        setErrorMessage(
          !effectiveUseCookie
            ? 'Could not retrieve file information from the server. Cookies are disabled for this site. Enable "Use Cookie" if this is a private resource.'
            : 'Could not retrieve file information from the server.'
        );
      }
    } catch (err: any) {
      setFileSizeText('Unknown');
      setFileFetched(false);
      setErrorMessage(formatProbeErrorMessage(err, effectiveUseCookie));
    } finally {
      inFlightFetchRef.current = false;
      setIsFetchingInfo(false);
    }
  };

  const handleToggleUseCookie = (checked: boolean) => {
    userManuallyToggledCookieRef.current = true;
    setUseCookie(checked);
    if (url.trim()) {
      handleRefreshInfo(url.trim(), { useCookie: checked }, true);
    }
  };

  const handleProtocolChange = (newProto: string) => {
    setProtocol(newProto);
    if (newProto === 'Yt-DLP') {
      setCategory('Videos');
      checkYtdlpStatus(true);
      setName((prev) => {
        if (
          !prev ||
          prev === 'download' ||
          prev.toLowerCase().endsWith('.html') ||
          prev.toLowerCase().endsWith('.htm') ||
          !prev.includes('.')
        ) {
          return 'video.mp4';
        }
        return prev;
      });
      handleRefreshInfo(url.trim(), { protocol: 'Yt-DLP' }, true);
    } else if (newProto === 'Torrent') {
      setCategory('Torrents');
      handleRefreshInfo(url.trim(), { protocol: 'Torrent' }, true);
    } else {
      handleRefreshInfo(url.trim(), { protocol: newProto }, true);
    }
  };

  const getSubmissionContext = () => ({
    url,
    name,
    protocol,
    category,
    savePath,
    defaultBasePath,
    globalSettings,
    isCustomPath,
    useCategory,
    categoryPaths,
    ytdlpQuality,
    useCookie,
    cookies,
    checksumEnabled,
    checksumVal,
    calculatedLimit: getSpeedLimitInBytes(),
    queue,
    vaultList,
    threadCount,
    defaultThreadCount,
    acceptRanges,
    username,
    password,
    userAgent,
    refererPage,
    saveCategoryPath,
    onSaveCategoryPath: saveCategoryPathToEngine,
    addDownload,
  });

  const handleDownloadNow = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!url.trim()) return;
    if (protocol === 'Yt-DLP' && !isYtdlpInstalled) {
      setErrorMessage(
        'Media Tools (YT-DLP & FFmpeg) are not installed on this PC. Please install them first to download this video stream.'
      );
      return;
    }
    await executeDownloadNowTask(getSubmissionContext());
    closeConfirmationWindow();
  };

  const handleAddOnly = async (targetQueueName?: string) => {
    if (!url.trim()) return;
    if (protocol === 'Yt-DLP' && !isYtdlpInstalled) {
      setErrorMessage(
        'Media Tools (YT-DLP & FFmpeg) are not installed on this PC. Please install them first to add this video stream.'
      );
      return;
    }
    await executeAddOnlyTask(getSubmissionContext(), targetQueueName);
    closeConfirmationWindow();
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

        <div className="flex items-center space-x-1">
          <button
            type="button"
            onClick={minimizeConfirmationWindow}
            className="p-1.5 hover:bg-accent text-muted-foreground hover:text-foreground rounded transition-colors cursor-pointer"
            title="Minimize"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={closeConfirmationWindow}
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
            <CategorySelectorRow
              useCategory={useCategory}
              onUseCategoryToggle={handleUseCategoryToggle}
              category={category}
              onCategoryChange={handleCategoryChange}
              protocol={protocol}
              isYtdlpInstalled={isYtdlpInstalled}
              fileSizeText={fileSizeText}
              fileFetched={fileFetched}
            />

            {/* Protocol, Quality & Cookie Filter Rows */}
            <MediaFormatSelector
              protocol={protocol}
              onProtocolChange={handleProtocolChange}
              ytdlpQuality={ytdlpQuality}
              onYtdlpQualityChange={setYtdlpQuality}
              availableFormats={availableFormats}
              useCookie={useCookie}
              onToggleUseCookie={handleToggleUseCookie}
              matchedCookieRule={matchedCookieRule}
              isBypassedByRule={isBypassedByRule}
            />

            {/* Row 3 & 4: Save Path, Actions & Filename Input */}
            <SavePathAndFilenameSection
              savePath={savePath}
              onSavePathChange={(val) => {
                setSavePath(val);
                setIsCustomPath(true);
              }}
              onSavePathBlur={async () => {
                if (savePath.trim() && (name.trim() || url.trim())) {
                  await resolveCandidateUniqueFilename(savePath.trim());
                }
              }}
              onPickSavePath={handlePickSavePath}
              onRefreshInfo={() => handleRefreshInfo()}
              isFetchingInfo={isFetchingInfo}
              showExtraConfig={showExtraConfig}
              onToggleExtraConfig={() => setShowExtraConfig(!showExtraConfig)}
              isCustomPath={isCustomPath}
              category={category}
              saveCategoryPath={saveCategoryPath}
              onSaveCategoryPathToggle={handleSaveCategoryPathToggle}
              name={name}
              onNameChange={setName}
            />
          </form>

          {/* Missing Media Tools Notice */}
          <MissingMediaToolsBanner protocol={protocol} isYtdlpInstalled={isYtdlpInstalled} />

          {/* Error Message Display */}
          {errorMessage && url.trim() && !isFetchingInfo && (
            <div className="text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2 text-xs font-medium animate-in fade-in duration-200 mt-2 min-w-0 shrink-0 break-all break-words [overflow-wrap:anywhere] select-text h-auto leading-relaxed">
              {errorMessage}
            </div>
          )}

          {/* Bottom Action Buttons */}
          <QueuePickerFooter
            showQueuePicker={showQueuePicker}
            onToggleQueuePicker={() => setShowQueuePicker(!showQueuePicker)}
            onSelectQueueAndAdd={(queueName) => {
              setShowQueuePicker(false);
              handleAddOnly(queueName);
            }}
            availableQueues={availableQueues}
            queueCounts={queueCounts}
            onDownloadNow={() => handleDownloadNow()}
            onClose={closeConfirmationWindow}
            isFetchingInfo={isFetchingInfo}
            url={url}
            protocol={protocol}
            isYtdlpInstalled={isYtdlpInstalled}
          />
        </div>

        {/* Extra Config Overlay Flyout Panel */}
        <AdvancedDownloadOptions
          showExtraConfig={showExtraConfig}
          onCloseExtraConfig={() => setShowExtraConfig(false)}
          speedLimitEnabled={speedLimitEnabled}
          onSpeedLimitEnabledChange={setSpeedLimitEnabled}
          speedLimitVal={speedLimitVal}
          onSpeedLimitValChange={setSpeedLimitVal}
          speedLimitUnit={speedLimitUnit}
          onSpeedLimitUnitChange={setSpeedLimitUnit}
          checksumEnabled={checksumEnabled}
          onChecksumEnabledChange={setChecksumEnabled}
          checksumVal={checksumVal}
          onChecksumValChange={setChecksumVal}
          queue={queue}
          onQueueChange={setQueue}
          availableQueues={availableQueues}
          threadCount={threadCount}
          onThreadCountChange={setThreadCount}
          defaultThreadCount={defaultThreadCount}
          userAgent={userAgent}
          onUserAgentChange={setUserAgent}
          refererPage={refererPage}
          onRefererPageChange={setRefererPage}
          useCookie={useCookie}
          onToggleUseCookie={handleToggleUseCookie}
          matchedCookieRule={matchedCookieRule}
          cookies={cookies}
          onCookiesChange={setCookies}
          username={username}
          onUsernameChange={setUsername}
          password={password}
          onPasswordChange={setPassword}
        />
      </div>
    </div>
  );
};

export default DownloadStartConfirmation;
