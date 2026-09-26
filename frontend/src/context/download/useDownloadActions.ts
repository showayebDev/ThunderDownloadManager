/**
 * Download CRUD and lifecycle actions hook (add, batch add, resume, pause, delete, stopAll).
 */
import React from 'react';
import {
  DownloadItem,
  Category,
  GlobalSettings,
  DownloadStatus,
  QueueConfig,
} from '../../types/download';
import { loadFromThunderDB, saveToThunderDB } from '../../utils/thunderDB';
import { detectCategory } from '../../utils/category';
import { invoke } from '../../utils/tauriBridge';
import {
  ActiveModalType,
  AddDownloadOptions,
  BatchDownloadItemInput,
  defaultSettings,
} from './types';
import { disambiguateFilename } from './downloadHelpers';

interface UseDownloadActionsParams {
  downloads: DownloadItem[];
  setDownloads: React.Dispatch<React.SetStateAction<DownloadItem[]>>;
  downloadsRef: React.MutableRefObject<DownloadItem[]>;
  queues: QueueConfig[];
  setQueues: React.Dispatch<React.SetStateAction<QueueConfig[]>>;
  queuesRef: React.MutableRefObject<QueueConfig[]>;
  globalSettings: GlobalSettings;
  setGlobalSettings: React.Dispatch<React.SetStateAction<GlobalSettings>>;
  globalSettingsRef: React.MutableRefObject<GlobalSettings>;
  selectedIds: Set<string>;
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  appearance: any;
  appearanceRef: React.MutableRefObject<any>;
  startingTaskIdsRef: React.MutableRefObject<Set<string>>;
  taskRetryMapRef: React.MutableRefObject<Map<string, number>>;
  deletingIdsRef: React.MutableRefObject<Set<string>>;
  pendingProgressMapRef: React.MutableRefObject<Map<string, any>>;
  setActiveModal: React.Dispatch<React.SetStateAction<ActiveModalType>>;
  setDetailDownloadId: React.Dispatch<React.SetStateAction<string | null>>;
  setExtensionPayload: React.Dispatch<React.SetStateAction<any>>;
  dispatchQueueWorkers: (targetQueueId?: string) => Promise<void>;
  startQueue: (queueIdentifier?: string) => Promise<void>;
}

export const useDownloadActions = ({
  downloads,
  setDownloads,
  downloadsRef,
  queues,
  setQueues,
  queuesRef,
  globalSettings,
  setGlobalSettings,
  globalSettingsRef,
  selectedIds,
  setSelectedIds,
  appearance,
  appearanceRef,
  startingTaskIdsRef,
  taskRetryMapRef,
  deletingIdsRef,
  pendingProgressMapRef,
  setActiveModal,
  setDetailDownloadId,
  setExtensionPayload,
  dispatchQueueWorkers,
  startQueue,
}: UseDownloadActionsParams) => {
  const resumeItem = async (id: string, force: boolean = false) => {
    const item =
      downloadsRef.current.find((d) => d.id === id) || downloads.find((d) => d.id === id);
    if (!item) return;

    const updated = (downloadsRef.current || downloads).map((d) =>
      d.id === id
        ? { ...d, status: 'Downloading' as DownloadStatus, speed: 0, timeLeft: 'Calculating...' }
        : d
    );
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
      const dbShowProgress =
        appData && typeof appData.showProgressDialog === 'boolean'
          ? appData.showProgressDialog
          : appearanceRef.current?.showProgressDialog ?? appearance.showProgressDialog ?? true;

      const dbShowCompletion =
        appData && typeof appData.showCompletionDialog === 'boolean'
          ? appData.showCompletionDialog
          : appearanceRef.current?.showCompletionDialog ?? appearance.showCompletionDialog ?? true;

      // Queue downloads use their own queueConfig; non-queue downloads check database showProgressDialog
      const shouldShowProgressDialog = isQueueDownload
        ? queueConfig?.showRealTimeProgress ?? false
        : dbShowProgress;

      const showCompletionWindow = isQueueDownload
        ? queueConfig?.showCompletionWindow ?? false
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
        threadCount:
          item.threadCount ||
          (queueConfig?.threadCount && queueConfig.threadCount > 0
            ? queueConfig.threadCount
            : globalSettingsRef.current.defaultThreadCount) ||
          8,
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
        prev.map((d) =>
          d.id === id ? { ...d, status: 'Error', errorMessage: err?.message || String(err) } : d
        )
      );
    }
  };

  const addDownload = async (
    url: string,
    name: string,
    category: Category,
    savePath: string,
    queue: string,
    options?: AddDownloadOptions
  ) => {
    const id = Date.now().toString();
    let filename = name || url.split('/').pop() || 'download';
    const isTorrent =
      options?.protocol === 'Torrent' ||
      url.toLowerCase().startsWith('magnet:') ||
      url.toLowerCase().endsWith('.torrent');
    const isHLS = url.toLowerCase().includes('.m3u8') || filename.toLowerCase().endsWith('.m3u8');
    if (isHLS && filename.toLowerCase().endsWith('.m3u8')) {
      const base = filename.replace(/\.m3u8$/i, '');
      filename =
        base === '' || base === 'master' || base === 'playlist' || base === 'index'
          ? 'video.mp4'
          : `${base}.mp4`;
    }
    const detected = detectCategory(
      filename || url,
      options?.protocol || (isTorrent ? 'Torrent' : undefined)
    );
    const cat = isTorrent
      ? 'Torrents'
      : isHLS
      ? 'Videos'
      : category && category !== 'All' && !(category === 'Documents' && detected !== 'Documents')
      ? category
      : detected;

    const isWin =
      globalSettings.downloadPath.includes('\\') ||
      (!globalSettings.downloadPath.includes('/') &&
        /^[a-zA-Z]:/.test(globalSettings.downloadPath));
    const sep = isWin ? '\\' : '/';
    const cleanBase =
      globalSettings.downloadPath.endsWith('\\') || globalSettings.downloadPath.endsWith('/')
        ? globalSettings.downloadPath.slice(0, -1)
        : globalSettings.downloadPath;
    const categoryPath =
      globalSettings.useCategoryByDefault !== false && cat && (cat as string) !== 'All'
        ? globalSettings.categoryPaths && globalSettings.categoryPaths[cat]
          ? globalSettings.categoryPaths[cat]
          : `${cleanBase}${sep}${cat}`
        : globalSettings.downloadPath;

    let targetPath = savePath;
    const isRelativeOrJustCat =
      !targetPath ||
      targetPath === cat ||
      (!targetPath.includes('/') && !targetPath.includes('\\'));
    if (
      isRelativeOrJustCat ||
      targetPath === globalSettings.downloadPath ||
      targetPath === cleanBase
    ) {
      targetPath =
        globalSettings.useCategoryByDefault !== false && cat && (cat as string) !== 'All'
          ? categoryPath
          : savePath || globalSettings.downloadPath;
    }
    const givenHash = options?.givenCheckSum || options?.expectedChecksum || '';

    // Disambiguate duplicate filename if needed
    const existingNamesInPath = new Set(
      (downloadsRef.current || downloads)
        .filter((d) => (d.savePath || '').toLowerCase() === targetPath.toLowerCase())
        .map((d) => d.name.toLowerCase())
    );
    const finalFilename = disambiguateFilename(filename, existingNamesInPath);

    const isQueueAssigned = Boolean(queue && queue.trim() !== '');
    const targetQueue = isQueueAssigned
      ? (queuesRef.current || queues).find(
          (q) =>
            q.name.toLowerCase() === queue.trim().toLowerCase() ||
            q.id.toLowerCase() === queue.trim().toLowerCase()
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
      const maxGeneralAllowed = isUnlimited
        ? Infinity
        : Math.max(1, globalSettingsRef.current.maxConcurrentDownloads);
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
          const shouldShowProgressDialog =
            appData && typeof appData.showProgressDialog === 'boolean'
              ? appData.showProgressDialog
              : appearanceRef.current?.showProgressDialog ?? appearance.showProgressDialog ?? true;

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
          prev.map((d) =>
            d.id === id ? { ...d, status: 'Error', errorMessage: err?.message || String(err) } : d
          )
        );
      }
    }

    return id;
  };

  const addBatchDownloads = async (
    items: BatchDownloadItemInput[],
    startImmediately: boolean = false,
    onProgress?: (current: number, total: number, currentItemName?: string) => void
  ) => {
    if (!items || items.length === 0) return;

    const total = items.length;
    const nowBase = Date.now();
    const isWin =
      globalSettingsRef.current.downloadPath.includes('\\') ||
      (!globalSettingsRef.current.downloadPath.includes('/') &&
        /^[a-zA-Z]:/.test(globalSettingsRef.current.downloadPath));
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
    const maxGeneralAllowed = isBatchUnlimited
      ? Infinity
      : Math.max(1, globalSettingsRef.current.maxConcurrentDownloads);
    const activeGeneral = (downloadsRef.current || downloads).filter(
      (d) =>
        (!d.queue || d.queue.trim() === '') &&
        (d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging')
    ).length;
    let remainingGeneralSlots = isBatchUnlimited
      ? Infinity
      : Math.max(0, maxGeneralAllowed - activeGeneral);

    const preparedBatch: Array<{
      downloadItem: DownloadItem;
      entry: BatchDownloadItemInput;
      shouldStart: boolean;
    }> = [];

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
        fname =
          base === '' || base === 'master' || base === 'playlist' || base === 'index'
            ? 'video.mp4'
            : `${base}.mp4`;
      }

      const itemUseCategory =
        entry.useCategory !== undefined
          ? entry.useCategory
          : entry.options?.useCategory !== undefined
          ? entry.options.useCategory
          : globalSettingsRef.current.useCategoryByDefault !== false;

      const detectedCat = isHLS
        ? 'Videos'
        : entry.category && entry.category !== 'All'
        ? entry.category
        : detectCategory(fname || entry.url);
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
      const finalFname = disambiguateFilename(fname, usedInTarget);
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
          } catch {}
        }

        invoke('start_download', {
          id: downloadItem.id,
          url: downloadItem.url,
          savePath: downloadItem.savePath,
          filename: downloadItem.name,
          threadCount:
            entry.options?.threadCount ||
            downloadItem.threadCount ||
            globalSettingsRef.current.defaultThreadCount,
          speedLimit:
            entry.options?.speedLimit !== undefined
              ? entry.options.speedLimit
              : downloadItem.speedLimit,
          protocol:
            entry.options?.protocol ||
            (downloadItem.url.toLowerCase().includes('.m3u8') ? 'HLS' : 'HTTP'),
          showCompletionWindow:
            entry.options?.showCompletionWindow !== undefined
              ? entry.options.showCompletionWindow
              : false,
          show_completion:
            entry.options?.showCompletionWindow !== undefined
              ? entry.options.showCompletionWindow
              : false,
          checksum:
            entry.options?.checksum ||
            entry.options?.givenCheckSum ||
            entry.options?.expectedChecksum ||
            '',
          givenCheckSum:
            entry.options?.checksum ||
            entry.options?.givenCheckSum ||
            entry.options?.expectedChecksum ||
            '',
          expectedChecksum:
            entry.options?.checksum ||
            entry.options?.givenCheckSum ||
            entry.options?.expectedChecksum ||
            '',
          username: entry.options?.username || downloadItem.username,
          password: entry.options?.password || downloadItem.password,
          userAgent: entry.options?.userAgent || downloadItem.userAgent,
          referer: entry.options?.referer || downloadItem.referer,
          cookies: entry.options?.cookies || downloadItem.cookies,
        }).catch((err: any) => {
          setDownloads((prev) =>
            prev.map((d) =>
              d.id === downloadItem.id
                ? { ...d, status: 'Error', errorMessage: err?.message || String(err) }
                : d
            )
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
    const itemsToResume = downloads.filter(
      (d) =>
        selectedIds.has(d.id) &&
        (d.status === 'Paused' ||
          d.status === 'Error' ||
          d.status === 'Canceled' ||
          d.status === 'Queued')
    );
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
      return (
        d &&
        (d.status === 'Downloading' ||
          d.status === 'Pending' ||
          d.status === 'Merging' ||
          d.status === 'Queued')
      );
    });
    if (idsToPause.length === 0) return;

    const updated = currentList.map((d) => {
      if (
        idsToPause.includes(d.id) &&
        (d.status === 'Downloading' ||
          d.status === 'Pending' ||
          d.status === 'Merging' ||
          d.status === 'Queued')
      ) {
        return { ...d, status: 'Paused' as DownloadStatus, speed: 0, timeLeft: 'Paused' };
      }
      return d;
    });
    setDownloads(updated);
    downloadsRef.current = updated;
    saveToThunderDB('downloads', updated);

    try {
      await Promise.allSettled(idsToPause.map((id) => invoke('pause_download', { id })));
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

  const deleteDownloads = async (ids: string[], deleteFromDisk = false) => {
    if (!ids || ids.length === 0) return;
    const idsSet = new Set(ids);

    // Track IDs being deleted to prevent checkDiskFiles / progress / error race conditions
    ids.forEach((id) => {
      deletingIdsRef.current.add(id);
      pendingProgressMapRef.current.delete(id);
      taskRetryMapRef.current.delete(id);
    });

    // Build file paths map for backend cleanup
    const filePathsMap: Record<string, string> = {};
    const currentList = downloadsRef.current || downloads;
    currentList.forEach((d) => {
      if (idsSet.has(d.id)) {
        const sp =
          d.savePath || globalSettingsRef.current.downloadPath || defaultSettings.downloadPath || '';
        if (sp && d.name) {
          const isWin = sp.includes('\\') || (!sp.includes('/') && /^[a-zA-Z]:/.test(sp));
          const sep = isWin ? '\\' : '/';
          const cleanDir = sp.replace(/[\/\\]+$/, '');
          filePathsMap[d.id] = `${cleanDir}${sep}${d.name}`;
        }
      }
    });

    const remaining = currentList.filter((d) => !idsSet.has(d.id));
    setDownloads(remaining);
    downloadsRef.current = remaining;
    saveToThunderDB('downloads', remaining);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });

    try {
      await invoke('batch_delete_downloads_command', {
        ids,
        delete_files_from_disk: deleteFromDisk,
        file_paths: filePathsMap,
      });
    } catch (err) {
      console.error('Failed to execute batch_delete_downloads_command:', err);
      // Fallback to individual cancellation
      for (const id of ids) {
        try {
          await invoke('cancel_download', { id });
          await invoke('close_realtime_progress_window_command', { id });
        } catch {}
      }
    } finally {
      setTimeout(() => {
        ids.forEach((id) => deletingIdsRef.current.delete(id));
      }, 6000);
    }

    dispatchQueueWorkers();
  };

  const deleteSelected = async (deleteFromDisk = false) => {
    const idsToDelete = Array.from(selectedIds);
    await deleteDownloads(idsToDelete, deleteFromDisk);
  };

  const deleteAllMissing = async () => {
    const missingItems = (downloadsRef.current || downloads).filter((d) => Boolean(d.fileMissing));
    if (missingItems.length === 0) return;
    const missingIds = missingItems.map((d) => d.id);
    await deleteDownloads(missingIds, false);
  };

  const deleteAllFinished = async () => {
    const finishedItems = (downloadsRef.current || downloads).filter(
      (d) => d.status === 'Finished'
    );
    if (finishedItems.length === 0) return;
    const finishedIds = finishedItems.map((d) => d.id);
    await deleteDownloads(finishedIds, false);
  };

  const deleteAllUnfinished = async () => {
    const unfinishedItems = (downloadsRef.current || downloads).filter(
      (d) => d.status !== 'Finished'
    );
    if (unfinishedItems.length === 0) return;
    const unfinishedIds = unfinishedItems.map((d) => d.id);
    await deleteDownloads(unfinishedIds, false);
  };

  const deleteEntireList = async () => {
    const allItems = [...(downloadsRef.current || downloads)];
    if (allItems.length === 0) return;
    const allIds = allItems.map((d) => d.id);
    await deleteDownloads(allIds, false);
  };

  const stopAll = async () => {
    // Clear in-flight startup locks
    startingTaskIdsRef.current.clear();

    // 1. Stop all running queues immediately
    const stoppedQueues = (queuesRef.current || queues).map((q) => ({ ...q, isRunning: false }));
    setQueues(stoppedQueues);
    queuesRef.current = stoppedQueues;

    // 2. Find all active/in-progress tasks to pause (Downloading, Pending, Merging)
    const currentList = downloadsRef.current || downloads;
    const activeTasks = currentList.filter(
      (d) => d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging'
    );

    // 3. Set actively downloading/merging/pending items to Paused; Queued items remain Queued
    const pausedList = currentList.map((d) =>
      d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging'
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
        ...activeTasks.map((item) => invoke('pause_download', { id: item.id })),
        ...activeTasks.map((item) =>
          invoke('close_realtime_progress_window_command', { id: item.id })
        ),
      ]);
    } catch {}
  };

  const openModal = async (modal: Exclude<ActiveModalType, null>, downloadId?: string) => {
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
    const updated = (downloadsRef.current || downloads).map((d) =>
      d.id === id ? { ...d, ...updates } : d
    );
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

  return {
    addDownload,
    addBatchDownloads,
    resumeSelected,
    pauseSelected,
    pauseItem,
    resumeItem,
    deleteDownloads,
    deleteSelected,
    deleteAllMissing,
    deleteAllFinished,
    deleteAllUnfinished,
    deleteEntireList,
    stopAll,
    openModal,
    closeModal,
    updateDownloadItem,
    updateGlobalSettings,
  };
};
