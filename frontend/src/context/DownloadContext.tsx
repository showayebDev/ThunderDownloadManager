/**
 * Main DownloadContext provider that composes SQLite storage synchronization,
 * queue scheduling, backend event listeners, and download CRUD actions.
 */
import React, { createContext, useContext, useState, useMemo, useEffect } from 'react';
import { DownloadItem, Category, GlobalSettings, QueueConfig } from '../types/download';
import { useAppearance } from './AppearanceContext';
import {
  ActiveModalType,
  DownloadContextType,
  defaultSettings,
  defaultQueues,
} from './download/types';
import { useDownloadStorageSync } from './download/storageSync';
import { useQueueScheduler } from './download/useQueueScheduler';
import { useDownloadEvents } from './download/useDownloadEvents';
import { useDownloadActions } from './download/useDownloadActions';

export type {
  ActiveModalType,
  AddDownloadOptions,
  BatchDownloadItemInput,
  DownloadContextType,
} from './download/types';
export { defaultSettings, defaultQueues } from './download/types';
export { sanitizeDownloadItem } from './download/downloadHelpers';

const DownloadContext = createContext<DownloadContextType | undefined>(undefined);

export const DownloadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [queues, setQueues] = useState<QueueConfig[]>(defaultQueues);

  const [selectedCategory, setSelectedCategory] = useState<Category>('All');
  const [selectedStatus, setSelectedStatus] = useState<'All' | 'Finished' | 'Unfinished'>('All');
  const [selectedQueue, setSelectedQueue] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeModal, setActiveModal] = useState<ActiveModalType>(null);
  const [detailDownloadId, setDetailDownloadId] = useState<string | null>(null);
  const [extensionPayload, setExtensionPayload] = useState<any>(null);
  const [globalSettings, setGlobalSettings] = useState<GlobalSettings>(defaultSettings);

  const { appearance } = useAppearance();
  const appearanceRef = React.useRef(appearance);

  useEffect(() => {
    appearanceRef.current = appearance;
  }, [appearance]);

  const globalSettingsRef = React.useRef(globalSettings);
  globalSettingsRef.current = globalSettings;
  const queuesRef = React.useRef(queues);
  queuesRef.current = queues;
  const downloadsRef = React.useRef(downloads);
  downloadsRef.current = downloads;
  const startingTaskIdsRef = React.useRef<Set<string>>(new Set());
  const taskRetryMapRef = React.useRef<Map<string, number>>(new Map());
  const deletingIdsRef = React.useRef<Set<string>>(new Set());
  const pendingProgressMapRef = React.useRef<Map<string, any>>(new Map());

  // Ref for resumeItem so queue scheduler and error retry can invoke it without circular dependencies
  const resumeItemRef = React.useRef<(id: string, force?: boolean) => Promise<void>>(async () => {});

  // 1. Storage synchronization & disk file verification
  useDownloadStorageSync({
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
  });

  // 2. Queue scheduler & queue CRUD actions
  const {
    dispatchQueueWorkers,
    addQueue,
    updateQueue,
    saveQueues,
    deleteQueue,
    reorderQueueItems,
    removeItemFromQueue,
    startQueue,
    stopQueue,
  } = useQueueScheduler({
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
  });

  // 3. Download CRUD & control actions
  const {
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
  } = useDownloadActions({
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
  });

  resumeItemRef.current = resumeItem;

  // 4. Backend progress, completion, error, and registration event listeners
  useDownloadEvents({
    setDownloads,
    downloadsRef,
    globalSettingsRef,
    deletingIdsRef,
    taskRetryMapRef,
    pendingProgressMapRef,
    setDetailDownloadId,
    dispatchQueueWorkers,
    resumeItemRef,
  });

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
      Torrents: 0,
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
      if (
        selectedQueue &&
        selectedQueue !== 'All' &&
        selectedCategory === 'All' &&
        selectedStatus === 'All'
      ) {
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
        deleteDownloads,
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
