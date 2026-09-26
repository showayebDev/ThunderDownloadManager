/**
 * Backend event listeners for download progress, errors, completion, registration, and tray state.
 */
import React, { useEffect } from 'react';
import { DownloadItem, Category, GlobalSettings, DownloadStatus } from '../../types/download';
import { loadFromThunderDB, saveToThunderDB } from '../../utils/thunderDB';
import { detectCategory } from '../../utils/category';
import { listen } from '../../utils/tauriBridge';
import { defaultSettings } from './types';
import { sanitizeDownloadItem, formatEtaSeconds, resolveRelativeSavePath } from './downloadHelpers';

interface UseDownloadEventsParams {
  setDownloads: React.Dispatch<React.SetStateAction<DownloadItem[]>>;
  downloadsRef: React.MutableRefObject<DownloadItem[]>;
  globalSettingsRef: React.MutableRefObject<GlobalSettings>;
  deletingIdsRef: React.MutableRefObject<Set<string>>;
  taskRetryMapRef: React.MutableRefObject<Map<string, number>>;
  pendingProgressMapRef: React.MutableRefObject<Map<string, any>>;
  setDetailDownloadId: React.Dispatch<React.SetStateAction<string | null>>;
  dispatchQueueWorkers: (targetQueueId?: string) => Promise<void>;
  resumeItemRef: React.MutableRefObject<(id: string, force?: boolean) => Promise<void>>;
}

export const useDownloadEvents = ({
  setDownloads,
  downloadsRef,
  globalSettingsRef,
  deletingIdsRef,
  taskRetryMapRef,
  pendingProgressMapRef,
  setDetailDownloadId,
  dispatchQueueWorkers,
  resumeItemRef,
}: UseDownloadEventsParams) => {
  const progressFlushTimerRef = React.useRef<any>(null);

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenCompleted: (() => void) | undefined;
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
        const handledIds = new Set<string>();

        const next = prev.map((d) => {
          if (deletingIdsRef.current.has(d.id)) {
            return d;
          }
          const payload = updates.get(d.id);
          if (!payload) return d;
          handledIds.add(d.id);
          changed = true;

          const isFinished = payload.status === 'Finished';
          if (isFinished) {
            if (d.status !== 'Finished') {
              finishedIds.push(d.id);
            }
            hadTerminalChange = true;
          } else if (
            payload.status === 'Error' ||
            payload.status === 'Canceled' ||
            payload.status === 'Paused'
          ) {
            hadTerminalChange = true;
          }

          const finishTime = isFinished
            ? d.endTime || d.dateCompleted || new Date().toISOString()
            : d.endTime;

          // Format remaining time
          let timeLeftStr = d.timeLeft;
          if (payload.status === 'Paused') {
            timeLeftStr = 'Paused';
          } else if (payload.status === 'Canceled') {
            timeLeftStr = '-';
          } else if (payload.status === 'Error') {
            timeLeftStr = 'Error';
          } else if (payload.eta !== undefined) {
            timeLeftStr = formatEtaSeconds(payload.eta);
          } else if (payload.time_left !== undefined) {
            timeLeftStr = payload.time_left;
          }

          const incomingDL =
            payload.downloaded_bytes !== undefined ? payload.downloaded_bytes : payload.downloaded;
          const incomingTotal = payload.total_bytes || payload.total_size;

          const finalDL =
            incomingDL !== undefined && incomingDL !== null ? incomingDL : d.downloaded;

          let finalStatus = (payload.status as any) || d.status;
          if (
            payload.status === 'Finished' ||
            isFinished ||
            (incomingTotal && incomingTotal > 0 && finalDL >= incomingTotal)
          ) {
            finalStatus = 'Finished';
          }

          const finalSize =
            incomingTotal !== undefined && incomingTotal !== null && incomingTotal > 0
              ? incomingTotal
              : (finalStatus === 'Finished' || isFinished) && finalDL > 0
              ? finalDL
              : d.size || 0;

          const updatedFilename = payload.filename || d.name;
          const detectedCat = detectCategory(
            updatedFilename || d.url,
            d.protocol || payload.protocol
          );
          const updatedCat =
            d.category &&
            d.category !== 'All' &&
            !(
              (d.category === 'Programs' || d.category === 'Documents') &&
              (detectedCat === 'Videos' ||
                detectedCat === 'Torrents' ||
                detectedCat === 'Compressed')
            )
              ? d.category
              : detectedCat;

          let updatedResumeSupport = d.resumeSupport;
          if (payload.resume_support !== undefined && payload.resume_support !== null) {
            updatedResumeSupport =
              payload.resume_support === 'Yes' || payload.resume_support === true ? 'Yes' : 'No';
          } else if (payload.resumable !== undefined && payload.resumable !== null) {
            updatedResumeSupport = payload.resumable ? 'Yes' : 'No';
          } else if (payload.accept_ranges !== undefined && payload.accept_ranges !== null) {
            updatedResumeSupport = payload.accept_ranges ? 'Yes' : 'No';
          }

          const incomingChecksum =
            payload.given_checksum ||
            payload.givenCheckSum ||
            payload.expected_checksum ||
            payload.expectedChecksum;
          const finalChecksum =
            incomingChecksum && incomingChecksum.trim()
              ? incomingChecksum.trim()
              : d.givenCheckSum || d.expectedChecksum || '';

          const finalSpeed =
            finalStatus === 'Finished' ||
            finalStatus === 'Paused' ||
            finalStatus === 'Canceled' ||
            finalStatus === 'Error'
              ? 0
              : payload.speed !== undefined
              ? payload.speed
              : d.speed;
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
            (finalStatus !== 'Finished' || !d.fileMissing) &&
            (payload.chunks === undefined || payload.chunks === null);

          if (isItemUnchanged) {
            return d;
          }

          changed = true;

          const updatedItem: DownloadItem = {
            ...d,
            name: updatedFilename,
            category: updatedCat,
            url: payload.url || d.url,
            downloaded: finalDL,
            size: finalSize,
            speed: finalSpeed,
            status: finalStatus,
            timeLeft: finalTimeLeft,
            fileMissing: finalStatus === 'Finished' ? false : d.fileMissing,
            savePath: payload.save_path || payload.savePath || d.savePath,
            resumeSupport: updatedResumeSupport,
            threadCount:
              payload.thread_count && payload.thread_count > 0
                ? payload.thread_count
                : (payload as any).threadCount || d.threadCount || 8,
            speedLimit: payload.speed_limit !== undefined ? payload.speed_limit : d.speedLimit,
            proxyUsed: payload.proxy_used !== undefined ? payload.proxy_used : d.proxyUsed,
            errorMessage: payload.error_message || d.errorMessage,
            protocol: payload.protocol || d.protocol,
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

        // Auto-discover newly added downloads that were not yet in state
        const newItems: DownloadItem[] = [];
        updates.forEach((payload, taskId) => {
          if (deletingIdsRef.current.has(taskId)) {
            return;
          }
          // Never auto-create items for terminal / canceled / paused / errored / finished status payloads
          if (
            payload.status === 'Canceled' ||
            payload.status === 'Paused' ||
            payload.status === 'Error' ||
            payload.status === 'Finished' ||
            payload.status === 'Completed'
          ) {
            return;
          }

          if (!handledIds.has(taskId) && !prev.some((d) => d.id === taskId)) {
            changed = true;
            handledIds.add(taskId);

            const isFinished = payload.status === 'Finished';
            if (isFinished) {
              finishedIds.push(taskId);
              hadTerminalChange = true;
            } else if (
              payload.status === 'Error' ||
              payload.status === 'Canceled' ||
              payload.status === 'Paused'
            ) {
              hadTerminalChange = true;
            }

            const incomingDL =
              payload.downloaded_bytes !== undefined
                ? payload.downloaded_bytes
                : payload.downloaded !== undefined
                ? payload.downloaded
                : 0;
            const incomingTotal =
              payload.total_bytes !== undefined
                ? payload.total_bytes
                : payload.total_size !== undefined
                ? payload.total_size
                : 0;

            let rawFilename = payload.filename || '';
            if (!rawFilename && payload.url) {
              try {
                const urlObj = new URL(payload.url);
                rawFilename = urlObj.pathname.split('/').pop() || '';
              } catch {
                rawFilename = payload.url.split('/').pop()?.split('?')[0] || '';
              }
            }
            if (!rawFilename) rawFilename = 'download';

            const detectedCat = detectCategory(rawFilename || payload.url, payload.protocol);
            const updatedCat =
              payload.category &&
              payload.category !== 'All' &&
              !(
                (payload.category === 'Programs' || payload.category === 'Documents') &&
                (detectedCat === 'Videos' ||
                  detectedCat === 'Torrents' ||
                  detectedCat === 'Compressed')
              )
                ? payload.category
                : detectedCat;

            const baseDir =
              globalSettingsRef.current.downloadPath || defaultSettings.downloadPath;
            const targetSave = resolveRelativeSavePath(
              payload.save_path || payload.savePath || baseDir,
              baseDir
            );

            let timeLeftStr = 'Calculating...';
            if (payload.status === 'Paused') {
              timeLeftStr = 'Paused';
            } else if (payload.status === 'Canceled') {
              timeLeftStr = '-';
            } else if (payload.status === 'Error') {
              timeLeftStr = 'Error';
            } else if (isFinished) {
              timeLeftStr = '-';
            } else if (payload.eta !== undefined) {
              timeLeftStr = formatEtaSeconds(payload.eta);
            } else if (payload.time_left !== undefined) {
              timeLeftStr = payload.time_left;
            }

            let resumeSupp: 'Yes' | 'No' | 'Unknown' = 'Unknown';
            if (payload.resume_support !== undefined && payload.resume_support !== null) {
              resumeSupp =
                payload.resume_support === 'Yes' || payload.resume_support === true ? 'Yes' : 'No';
            } else if (payload.resumable !== undefined && payload.resumable !== null) {
              resumeSupp = payload.resumable ? 'Yes' : 'No';
            } else if (payload.accept_ranges !== undefined && payload.accept_ranges !== null) {
              resumeSupp = payload.accept_ranges ? 'Yes' : 'No';
            }

            const finishTime = isFinished ? new Date().toISOString() : undefined;
            const finalSpeed =
              isFinished ||
              payload.status === 'Paused' ||
              payload.status === 'Canceled' ||
              payload.status === 'Error'
                ? 0
                : payload.speed || 0;

            const newItem: DownloadItem = {
              id: taskId,
              name: rawFilename,
              category: updatedCat,
              url: payload.url || '',
              size: incomingTotal > 0 ? incomingTotal : isFinished && incomingDL > 0 ? incomingDL : 0,
              downloaded: incomingDL >= 0 ? incomingDL : 0,
              status: (payload.status as any) || 'Downloading',
              speed: finalSpeed,
              timeLeft: isFinished ? '-' : timeLeftStr,
              dateAdded: new Date().toISOString(),
              dateCompleted: finishTime,
              endTime: finishTime,
              queue: payload.queue || '',
              savePath: targetSave,
              resumeSupport: resumeSupp,
              threadCount:
                payload.thread_count && payload.thread_count > 0
                  ? payload.thread_count
                  : (payload as any).threadCount ||
                    globalSettingsRef.current.defaultThreadCount ||
                    8,
              speedLimit: payload.speed_limit !== undefined ? payload.speed_limit : null,
              proxyUsed: payload.proxy_used,
              errorMessage: payload.error_message || payload.error,
              protocol: payload.protocol,
              chunks: (payload.chunks || []).map((c: any) => ({
                id: c.id,
                status: (c.status as any) || 'Downloading',
                downloaded: c.downloaded,
                total: c.total,
              })),
            };

            const incomingChecksum =
              payload.given_checksum ||
              payload.givenCheckSum ||
              payload.expected_checksum ||
              payload.expectedChecksum;
            if (incomingChecksum && incomingChecksum.trim()) {
              newItem.givenCheckSum = incomingChecksum.trim();
              newItem.expectedChecksum = incomingChecksum.trim();
            }

            newItems.push(newItem);
          }
        });

        if (!changed) return prev;
        const result = newItems.length > 0 ? [...newItems, ...next] : next;
        downloadsRef.current = result;
        if (newItems.length > 0) {
          saveToThunderDB('downloads', result);
        }
        return result;
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
          if (deletingIdsRef.current.has(taskId)) {
            pendingProgressMapRef.current.delete(taskId);
            return;
          }

          if (
            payload.status === 'Finished' ||
            (payload.status === 'Downloading' && payload.speed > 0)
          ) {
            taskRetryMapRef.current.delete(taskId);
          }

          const isTerminal =
            payload.status === 'Finished' ||
            payload.status === 'Error' ||
            payload.status === 'Paused' ||
            payload.status === 'Canceled';
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
            }, 100); // Snappy 100ms batching for smooth real-time table progress
          }
        });

        unlistenError = await listen<any>('download-error', async (event: { payload: any }) => {
          const payload = event.payload || {};
          const taskId = payload.task_id || payload.id;
          if (!taskId || deletingIdsRef.current.has(taskId)) return;

          let maxRetries = 3;
          try {
            const engine = await loadFromThunderDB<any>('download_engine', null);
            if (engine && engine.maxRetries !== undefined) {
              maxRetries = Number(engine.maxRetries) || 3;
            } else if (globalSettingsRef.current?.maxRetries !== undefined) {
              maxRetries = Number(globalSettingsRef.current.maxRetries) || 3;
            }
          } catch {
            maxRetries = Number(globalSettingsRef.current?.maxRetries) || 3;
          }

          const currentAttempts = taskRetryMapRef.current.get(taskId) || 0;
          if (currentAttempts < maxRetries) {
            const nextAttempt = currentAttempts + 1;
            taskRetryMapRef.current.set(taskId, nextAttempt);

            setDownloads((prev) => {
              const next = prev.map((d) => {
                if (d.id === taskId) {
                  return {
                    ...d,
                    status: 'Downloading' as DownloadStatus,
                    speed: 0,
                    timeLeft: `Retrying (${nextAttempt}/${maxRetries})...`,
                    errorMessage: `Reconnecting (attempt ${nextAttempt}/${maxRetries})...`,
                  };
                }
                return d;
              });
              downloadsRef.current = next;
              return next;
            });

            setTimeout(() => {
              resumeItemRef.current(taskId, false).catch(() => {});
            }, 1500);
            return;
          }

          taskRetryMapRef.current.delete(taskId);
          setDownloads((prev) => {
            const next = prev.map((d) => {
              if (d.id === taskId) {
                return {
                  ...d,
                  status: 'Error' as DownloadStatus,
                  speed: 0,
                  timeLeft: 'Error',
                  errorMessage:
                    payload.error ||
                    d.errorMessage ||
                    `Download failed after ${maxRetries} retry attempts`,
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
          if (!payload || !payload.id || deletingIdsRef.current.has(payload.id)) return;
          const incomingChecksum = (
            payload.given_checksum ||
            payload.givenCheckSum ||
            payload.expected_checksum ||
            payload.expectedChecksum ||
            ''
          ).trim();
          const prev = downloadsRef.current || [];
          const existingIndex = prev.findIndex((d) => d.id === payload.id);
          if (existingIndex >= 0) {
            return;
          }
          const filename =
            payload.filename ||
            (payload.url ? payload.url.split('/').pop()?.split('?')[0] : '') ||
            'download';
          const detected = detectCategory(filename || payload.url, payload.protocol);
          const cat =
            payload.category &&
            payload.category !== 'All' &&
            !(payload.category === 'Documents' && detected !== 'Documents')
              ? payload.category
              : detected;

          const baseDir = globalSettingsRef.current.downloadPath || defaultSettings.downloadPath;
          const targetSave = resolveRelativeSavePath(payload.save_path || baseDir, baseDir);

          const newItem: DownloadItem = {
            id: payload.id,
            name: filename,
            category: cat,
            url: payload.url || '',
            size: payload.total_size || payload.total_bytes || 0,
            downloaded: payload.downloaded || payload.downloaded_bytes || 0,
            status: (payload.status as any) || 'Downloading',
            speed: payload.speed || 0,
            timeLeft: 'Calculating...',
            dateAdded: new Date().toISOString(),
            queue: payload.queue || '',
            savePath: targetSave,
            protocol: payload.protocol,
            resumeSupport:
              payload.resume_support === 'Yes' || payload.resume_support === 'No'
                ? payload.resume_support
                : payload.resumable !== undefined
                ? payload.resumable
                  ? 'Yes'
                  : 'No'
                : payload.accept_ranges !== undefined
                ? payload.accept_ranges
                  ? 'Yes'
                  : 'No'
                : 'Unknown',
            threadCount:
              payload.thread_count && payload.thread_count > 0
                ? payload.thread_count
                : (payload as any).threadCount ||
                  globalSettingsRef.current.defaultThreadCount ||
                  8,
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
          const itemPayload = { ...payload };
          if (itemPayload.savePath) {
            const base = globalSettingsRef.current.downloadPath || defaultSettings.downloadPath;
            itemPayload.savePath = resolveRelativeSavePath(itemPayload.savePath, base);
          }
          let updated: DownloadItem[];
          if (existingIndex >= 0) {
            updated = [...prev];
            updated[existingIndex] = sanitizeDownloadItem({
              ...updated[existingIndex],
              ...itemPayload,
              givenCheckSum:
                itemPayload.givenCheckSum ||
                (itemPayload as any).given_checksum ||
                updated[existingIndex].givenCheckSum,
              expectedChecksum:
                itemPayload.expectedChecksum ||
                (itemPayload as any).expected_checksum ||
                updated[existingIndex].expectedChecksum,
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

        unlistenCompleted = await listen<any>('download-completed', (event: { payload: any }) => {
          const payload = event.payload || {};
          const taskId = payload.task_id || payload.taskId || payload.id;
          if (!taskId) return;

          taskRetryMapRef.current.delete(taskId);

          setDownloads((prev) => {
            const next = prev.map((d) => {
              if (d.id === taskId) {
                const finalFn = payload.filename || payload.name || d.name;
                const finalPath = payload.save_path || payload.savePath || d.savePath;
                const finalSize =
                  payload.total_size ||
                  payload.total_bytes ||
                  payload.totalSize ||
                  payload.downloaded ||
                  payload.downloaded_bytes ||
                  d.size;
                const finalDL = payload.downloaded || payload.downloaded_bytes || finalSize;
                const finishTime = d.endTime || d.dateCompleted || new Date().toISOString();
                return {
                  ...d,
                  name: finalFn,
                  savePath: finalPath,
                  size: finalSize > 0 ? finalSize : d.size,
                  downloaded:
                    finalDL > 0 ? finalDL : finalSize > 0 ? finalSize : d.downloaded,
                  status: 'Finished' as DownloadStatus,
                  speed: 0,
                  timeLeft: '-',
                  fileMissing: false,
                  dateCompleted: finishTime,
                  endTime: finishTime,
                };
              }
              return d;
            });
            downloadsRef.current = next;
            saveToThunderDB('downloads', next);
            return next;
          });

          setDetailDownloadId(taskId);
          scheduleQueueDispatch();
        });

        if (!isMounted) {
          if (unlistenProgress) unlistenProgress();
          if (unlistenCompleted) unlistenCompleted();
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
      if (unlistenCompleted) unlistenCompleted();
      if (unlistenAdded) unlistenAdded();
      if (unlistenRegister) unlistenRegister();
      if (unlistenTray) unlistenTray();
      if (unlistenError) unlistenError();
    };
  }, []);
};
