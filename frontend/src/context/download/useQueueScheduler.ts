/**
 * Queue management CRUD operations, worker dispatch logic, and 1-second schedule timer hook.
 */
import React, { useEffect } from 'react';
import { DownloadItem, GlobalSettings, QueueConfig } from '../../types/download';
import { saveToThunderDB } from '../../utils/thunderDB';
import { invoke } from '../../utils/tauriBridge';

interface UseQueueSchedulerParams {
  downloads: DownloadItem[];
  setDownloads: React.Dispatch<React.SetStateAction<DownloadItem[]>>;
  downloadsRef: React.MutableRefObject<DownloadItem[]>;
  queues: QueueConfig[];
  setQueues: React.Dispatch<React.SetStateAction<QueueConfig[]>>;
  queuesRef: React.MutableRefObject<QueueConfig[]>;
  selectedQueue: string;
  globalSettings: GlobalSettings;
  globalSettingsRef: React.MutableRefObject<GlobalSettings>;
  startingTaskIdsRef: React.MutableRefObject<Set<string>>;
  resumeItemRef: React.MutableRefObject<(id: string, force?: boolean) => Promise<void>>;
}

export const useQueueScheduler = ({
  downloads,
  setDownloads,
  downloadsRef,
  queues,
  setQueues,
  queuesRef,
  selectedQueue,
  globalSettings,
  globalSettingsRef,
  startingTaskIdsRef,
  resumeItemRef,
}: UseQueueSchedulerParams) => {
  const updateQueue = async (id: string, updates: Partial<QueueConfig>) => {
    const updated = (queuesRef.current || queues).map((q) =>
      q.id === id || q.name.toLowerCase() === id.toLowerCase() ? { ...q, ...updates } : q
    );
    setQueues(updated);
    queuesRef.current = updated;
    saveToThunderDB('queues', updated);
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
        Boolean(d.queue && d.queue.trim() !== '') &&
        (d.queue!.toLowerCase() === q.name.toLowerCase() ||
          d.queue!.toLowerCase() === q.id.toLowerCase());

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
          resumeItemRef.current(item.id, false).finally(() => {
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
    const maxGeneralAllowed = isUnlimited
      ? Infinity
      : Math.max(1, globalSettingsRef.current.maxConcurrentDownloads);

    const activeGeneralDownloads = currentDownloads.filter(
      (d) =>
        (!d.queue || d.queue.trim() === '') &&
        (d.status === 'Downloading' ||
          d.status === 'Pending' ||
          d.status === 'Merging' ||
          startingTaskIdsRef.current.has(d.id))
    );

    let remainingGeneralSlots = isUnlimited
      ? Infinity
      : Math.max(0, maxGeneralAllowed - activeGeneralDownloads.length);

    if (isUnlimited || remainingGeneralSlots > 0) {
      const generalQueued = currentDownloads.filter((d) => {
        if (d.status !== 'Queued' || startingTaskIdsRef.current.has(d.id)) {
          return false;
        }
        const qName = (d.queue || '').trim();
        // Only unassigned items (no queue assigned) are processed as general queued downloads
        return !qName;
      });
      const itemsToStart = isUnlimited
        ? generalQueued
        : generalQueued.slice(0, remainingGeneralSlots);
      for (const item of itemsToStart) {
        startingTaskIdsRef.current.add(item.id);
        if (!isUnlimited) {
          remainingGeneralSlots--;
        }
        resumeItemRef.current(item.id, false).finally(() => {
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

  const saveQueues = async (newQueues: QueueConfig[]) => {
    setQueues(newQueues);
    queuesRef.current = newQueues;
    saveToThunderDB('queues', newQueues);
  };

  const deleteQueue = async (id: string) => {
    if (id === 'main' || id.toLowerCase() === 'main') return;
    const updatedQueues = (queuesRef.current || queues).filter(
      (q) => q.id !== id && q.name.toLowerCase() !== id.toLowerCase()
    );
    setQueues(updatedQueues);
    queuesRef.current = updatedQueues;
    saveToThunderDB('queues', updatedQueues);

    const updatedDownloads = (downloadsRef.current || downloads).map((d) =>
      d.queue === id || (d.queue && d.queue.toLowerCase() === id.toLowerCase())
        ? { ...d, queue: '' }
        : d
    );
    setDownloads(updatedDownloads);
    downloadsRef.current = updatedDownloads;
    saveToThunderDB('downloads', updatedDownloads);
  };

  const reorderQueueItems = (queueName: string, fromIndex: number, toIndex: number) => {
    const isTarget = (d: DownloadItem) =>
      Boolean(d.queue && d.queue.trim() !== '') &&
      d.queue!.toLowerCase() === queueName.toLowerCase();

    const current = downloadsRef.current || downloads;
    const queueItems = current.filter(isTarget);
    const otherItems = current.filter((d) => !isTarget(d));

    if (
      fromIndex < 0 ||
      fromIndex >= queueItems.length ||
      toIndex < 0 ||
      toIndex >= queueItems.length
    ) {
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
    const updated = (downloadsRef.current || downloads).map((d) =>
      d.id === id ? { ...d, queue: '' } : d
    );
    setDownloads(updated);
    downloadsRef.current = updated;
    saveToThunderDB('downloads', updated);
  };

  const startQueue = async (queueIdentifier?: string) => {
    const currentQueues = queuesRef.current || queues;
    const targetQueue =
      currentQueues.find(
        (q) =>
          (queueIdentifier &&
            (q.id === queueIdentifier ||
              q.name.toLowerCase() === queueIdentifier.toLowerCase())) ||
          (!queueIdentifier && q.name.toLowerCase() === selectedQueue.toLowerCase())
      ) || currentQueues[0];

    if (!targetQueue) return;

    const isQueueMatch = (d: DownloadItem) =>
      Boolean(d.queue && d.queue.trim() !== '') &&
      (d.queue!.toLowerCase() === targetQueue.name.toLowerCase() ||
        d.queue!.toLowerCase() === targetQueue.id.toLowerCase());

    // Re-queue paused/errored tasks when starting the queue
    if (!targetQueue.isRunning) {
      setDownloads((prev) =>
        prev.map((d) => {
          if (
            isQueueMatch(d) &&
            (d.status === 'Paused' || d.status === 'Error' || d.status === 'Canceled')
          ) {
            return { ...d, status: 'Queued', timeLeft: 'Queued' };
          }
          return d;
        })
      );
      downloadsRef.current = (downloadsRef.current || downloads).map((d) => {
        if (
          isQueueMatch(d) &&
          (d.status === 'Paused' || d.status === 'Error' || d.status === 'Canceled')
        ) {
          return { ...d, status: 'Queued', timeLeft: 'Queued' };
        }
        return d;
      });
    }

    setQueues((prev) =>
      prev.map((q) =>
        q.id === targetQueue.id || q.name.toLowerCase() === targetQueue.name.toLowerCase()
          ? { ...q, isRunning: true }
          : q
      )
    );
    queuesRef.current = (queuesRef.current || queues).map((q) =>
      q.id === targetQueue.id || q.name.toLowerCase() === targetQueue.name.toLowerCase()
        ? { ...q, isRunning: true }
        : q
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
    const targetQueue =
      currentQueues.find(
        (q) =>
          (queueIdentifier &&
            (q.id === queueIdentifier ||
              q.name.toLowerCase() === queueIdentifier.toLowerCase())) ||
          (!queueIdentifier && q.name.toLowerCase() === selectedQueue.toLowerCase())
      ) || currentQueues[0];

    if (!targetQueue) return;

    setQueues((prev) =>
      prev.map((q) =>
        q.id === targetQueue.id || q.name.toLowerCase() === targetQueue.name.toLowerCase()
          ? { ...q, isRunning: false }
          : q
      )
    );
    queuesRef.current = (queuesRef.current || queues).map((q) =>
      q.id === targetQueue.id || q.name.toLowerCase() === targetQueue.name.toLowerCase()
        ? { ...q, isRunning: false }
        : q
    );

    const isQueueMatch = (d: DownloadItem) =>
      Boolean(d.queue && d.queue.trim() !== '') &&
      (d.queue!.toLowerCase() === targetQueue.name.toLowerCase() ||
        d.queue!.toLowerCase() === targetQueue.id.toLowerCase());

    const currentList = downloadsRef.current || downloads;
    const qItems = currentList.filter(isQueueMatch);
    // Only actively running/pending/merging items become Paused; Queued items remain Queued
    const activeInQueue = qItems.filter(
      (d) => d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging'
    );

    setDownloads((prev) =>
      prev.map((d) => {
        if (
          isQueueMatch(d) &&
          (d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging')
        ) {
          return { ...d, status: 'Paused', speed: 0, timeLeft: 'Paused' };
        }
        return d;
      })
    );

    downloadsRef.current = currentList.map((d) => {
      if (
        isQueueMatch(d) &&
        (d.status === 'Downloading' || d.status === 'Pending' || d.status === 'Merging')
      ) {
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
        ...activeInQueue.map((item) =>
          invoke('close_realtime_progress_window_command', { id: item.id })
        ),
      ]);
    } catch {}
  };

  // Track last triggered start/stop minute to avoid duplicate triggers within the same minute
  const lastSchedulerTriggerRef = React.useRef<Set<string>>(new Set());

  // Dedicated Queue Scheduler timer (runs every 1 second, independent of download progress updates)
  useEffect(() => {
    const checkScheduler = () => {
      const now = new Date();
      const dayNames = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ];
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
        const isScheduleActive = Boolean(
          q.scheduleEnabled || q.enableAutoStartTime || q.enableAutoStopTime
        );
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
          activeDaysList.some(
            (d) =>
              typeof d === 'string' &&
              d.toLowerCase().slice(0, 3) === currentDay.toLowerCase().slice(0, 3)
          );

        // Format normalized times
        const normStart = normalizeHHMM(q.autoStartTime);
        const normStop = normalizeHHMM(q.autoStopTime);

        // 1. Auto Start Check (triggers on active scheduled days)
        if (q.enableAutoStartTime && isDayActive && normStart && normStart === currentTime) {
          const triggerKey = `${q.id}_start_${dateKey}_${currentTime}`;
          if (!lastSchedulerTriggerRef.current.has(triggerKey)) {
            lastSchedulerTriggerRef.current.add(triggerKey);
            console.log(
              `[QueueScheduler] Auto-start triggered for queue '${q.name}' (${q.id}) at ${currentTime}`
            );
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
            console.log(
              `[QueueScheduler] Auto-stop triggered for queue '${q.name}' (${q.id}) at ${currentTime}`
            );
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

  return {
    dispatchQueueWorkers,
    addQueue,
    updateQueue,
    saveQueues,
    deleteQueue,
    reorderQueueItems,
    removeItemFromQueue,
    startQueue,
    stopQueue,
  };
};
