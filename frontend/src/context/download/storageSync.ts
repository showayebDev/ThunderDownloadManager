/**
 * SQLite storage synchronization and disk file existence tracking hooks for DownloadContext.
 */
import React, { useEffect } from 'react';
import { DownloadItem, GlobalSettings, DownloadStatus, QueueConfig } from '../../types/download';
import { loadFromThunderDB, saveToThunderDB } from '../../utils/thunderDB';
import { detectCategory } from '../../utils/category';
import { invoke } from '../../utils/tauriBridge';
import { defaultSettings, defaultQueues } from './types';
import { sanitizeDownloadItem } from './downloadHelpers';

interface UseDownloadStorageSyncParams {
  downloads: DownloadItem[];
  setDownloads: React.Dispatch<React.SetStateAction<DownloadItem[]>>;
  downloadsRef: React.MutableRefObject<DownloadItem[]>;
  queues: QueueConfig[];
  setQueues: React.Dispatch<React.SetStateAction<QueueConfig[]>>;
  queuesRef: React.MutableRefObject<QueueConfig[]>;
  globalSettings: GlobalSettings;
  setGlobalSettings: React.Dispatch<React.SetStateAction<GlobalSettings>>;
  globalSettingsRef: React.MutableRefObject<GlobalSettings>;
  deletingIdsRef: React.MutableRefObject<Set<string>>;
}

/**
 * Synchronizes downloads, queues, and engine settings with ThunderDB (SQLite)
 * and periodically checks disk file existence when trackDeletedFiles is enabled.
 */
export const useDownloadStorageSync = ({
  downloads,
  setDownloads,
  downloadsRef,
  queues,
  setQueues,
  queuesRef,
  globalSettings,
  setGlobalSettings,
  globalSettingsRef,
  deletingIdsRef,
}: UseDownloadStorageSyncParams) => {
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
      const currentDownloads = (downloadsRef.current || []).filter(
        (d) => !deletingIdsRef.current.has(d.id)
      );
      if (!currentDownloads || currentDownloads.length === 0) return;

      const baseDir = globalSettingsRef.current?.downloadPath || '';
      const isWinBase =
        baseDir.includes('\\') || (!baseDir.includes('/') && /^[a-zA-Z]:/.test(baseDir));
      const defaultSep = isWinBase ? '\\' : '/';
      const cleanDefaultBase = baseDir.replace(/[\/\\]+$/, '');

      const pathsToCheck: string[] = [];
      const itemPathMap = new Map<string, string[]>();

      currentDownloads.forEach((d) => {
        if (!d.name) return;
        const candidatePaths: string[] = [];
        const seen = new Set<string>();

        const addCandidate = (p: string) => {
          if (!p) return;
          const normalized = p.trim();
          if (!seen.has(normalized)) {
            seen.add(normalized);
            candidatePaths.push(normalized);
          }
        };

        const customCatPath =
          d.category && d.category !== 'All' && globalSettingsRef.current?.categoryPaths
            ? globalSettingsRef.current.categoryPaths[d.category]
            : undefined;

        if (d.savePath) {
          const isWin =
            d.savePath.includes('\\') ||
            (!d.savePath.includes('/') && /^[a-zA-Z]:/.test(d.savePath));
          const sep = isWin ? '\\' : '/';
          const cleanBase = d.savePath.replace(/[\/\\]+$/, '');
          addCandidate(`${cleanBase}${sep}${d.name}`);

          // If category is set, also check inside category subfolder or parent folder
          if (d.category && d.category !== 'All') {
            const lowerBase = cleanBase.toLowerCase();
            const lowerCat = d.category.toLowerCase();
            if (!lowerBase.endsWith(lowerCat) && !lowerBase.endsWith(`${sep}${lowerCat}`)) {
              addCandidate(`${cleanBase}${sep}${d.category}${sep}${d.name}`);
            } else {
              const parentDir = cleanBase.replace(/[\/\\][^\/\\]+$/, '');
              if (parentDir && parentDir !== cleanBase) {
                addCandidate(`${parentDir}${sep}${d.name}`);
              }
            }
          }

          if (customCatPath) {
            const isWinCat =
              customCatPath.includes('\\') ||
              (!customCatPath.includes('/') && /^[a-zA-Z]:/.test(customCatPath));
            const sepCat = isWinCat ? '\\' : '/';
            addCandidate(`${customCatPath.replace(/[\/\\]+$/, '')}${sepCat}${d.name}`);
          }

          const isRelative =
            !d.savePath.includes(':') &&
            !d.savePath.startsWith('/') &&
            !d.savePath.startsWith('\\\\');
          if (isRelative && cleanDefaultBase) {
            addCandidate(`${cleanDefaultBase}${defaultSep}${cleanBase}${defaultSep}${d.name}`);
            addCandidate(`${cleanDefaultBase}${defaultSep}${d.name}`);
            if (d.category && d.category !== 'All') {
              addCandidate(`${cleanDefaultBase}${defaultSep}${d.category}${defaultSep}${d.name}`);
            }
          }
        }

        if (customCatPath) {
          const isWinCat =
            customCatPath.includes('\\') ||
            (!customCatPath.includes('/') && /^[a-zA-Z]:/.test(customCatPath));
          const sepCat = isWinCat ? '\\' : '/';
          addCandidate(`${customCatPath.replace(/[\/\\]+$/, '')}${sepCat}${d.name}`);
        }

        if (cleanDefaultBase) {
          if (d.category && d.category !== 'All') {
            addCandidate(`${cleanDefaultBase}${defaultSep}${d.category}${defaultSep}${d.name}`);
          }
          addCandidate(`${cleanDefaultBase}${defaultSep}${d.name}`);
        }

        candidatePaths.forEach((p) => {
          pathsToCheck.push(p);
        });
        itemPathMap.set(d.id, candidatePaths);
      });

      if (pathsToCheck.length === 0) return;

      try {
        const infoMap = await invoke<Record<string, { exists: boolean; size: number }>>(
          'check_files_info_command',
          { paths: pathsToCheck }
        );
        if (infoMap && typeof infoMap === 'object') {
          let hasSavePathFix = false;
          setDownloads((prev) => {
            let changed = false;
            const updated = prev.map((d) => {
              if (deletingIdsRef.current.has(d.id)) return d;
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
              let healedName = d.name;
              let healedCategory = d.category;
              if (foundStat.exists && foundPath) {
                const dir = foundPath.replace(/[\/\\][^\/\\]+$/, '');
                if (dir && (!d.savePath || dir !== d.savePath)) {
                  healedSavePath = dir;
                  hasSavePathFix = true;
                }
                const filenameOnDisk = foundPath.split(/[\/\\]/).filter(Boolean).pop();
                if (filenameOnDisk && filenameOnDisk !== d.name) {
                  if (!d.name.includes('.') && filenameOnDisk.includes('.')) {
                    healedName = filenameOnDisk;
                    hasSavePathFix = true;
                  }
                }
                if (d.protocol === 'Torrent') {
                  if (healedCategory !== 'Torrents') {
                    healedCategory = 'Torrents';
                    hasSavePathFix = true;
                  }
                } else if (
                  healedCategory === 'Documents' ||
                  !healedCategory ||
                  healedCategory === 'All'
                ) {
                  const detected = detectCategory(healedName || d.url, d.protocol);
                  if (detected && detected !== 'Documents') {
                    healedCategory = detected;
                    hasSavePathFix = true;
                  }
                }
              }

              if (d.status === 'Finished') {
                const isMissing = !foundStat.exists;
                const updatedSize =
                  foundStat.exists && foundStat.size > 0 && d.size <= 0 ? foundStat.size : d.size;
                const updatedDownloaded =
                  foundStat.exists && foundStat.size > 0 && d.downloaded <= 0
                    ? foundStat.size
                    : d.downloaded;
                if (
                  d.fileMissing !== isMissing ||
                  d.savePath !== healedSavePath ||
                  d.name !== healedName ||
                  d.category !== healedCategory ||
                  d.size !== updatedSize ||
                  d.downloaded !== updatedDownloaded
                ) {
                  changed = true;
                  return {
                    ...d,
                    fileMissing: isMissing,
                    savePath: healedSavePath,
                    name: healedName,
                    category: healedCategory,
                    size: updatedSize,
                    downloaded: updatedDownloaded,
                  };
                }
              } else {
                // Non-finished items are managed by download engine and should never be marked as missing
                if (d.fileMissing) {
                  changed = true;
                  return {
                    ...d,
                    fileMissing: false,
                    savePath: healedSavePath,
                    name: healedName,
                    category: healedCategory,
                  };
                }
              }
              if (
                d.savePath !== healedSavePath ||
                d.name !== healedName ||
                d.category !== healedCategory
              ) {
                changed = true;
                return {
                  ...d,
                  savePath: healedSavePath,
                  name: healedName,
                  category: healedCategory,
                };
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
};
