/**
 * Type definitions and default configuration constants for DownloadContext.
 */
import React from 'react';
import { DownloadItem, Category, GlobalSettings, QueueConfig } from '../../types/download';

export type ActiveModalType =
  | 'newDownload'
  | 'downloadDetail'
  | 'settings'
  | 'extensionAddDownload'
  | 'queues'
  | 'downloadComplete'
  | 'deleteConfirm'
  | 'openSourceLicenses'
  | 'about'
  | 'batchDownload'
  | 'perHostSettings'
  | null;

export interface AddDownloadOptions {
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

export interface BatchDownloadItemInput {
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
}

export interface DownloadContextType {
  downloads: DownloadItem[];
  queues: QueueConfig[];
  selectedCategory: Category;
  selectedStatus: 'All' | 'Finished' | 'Unfinished';
  selectedQueue: string;
  searchQuery: string;
  selectedIds: Set<string>;
  activeModal: ActiveModalType;
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
    options?: AddDownloadOptions
  ) => Promise<string>;
  addBatchDownloads: (
    items: BatchDownloadItemInput[],
    startImmediately?: boolean,
    onProgress?: (current: number, total: number, currentItemName?: string) => void
  ) => Promise<void>;
  resumeSelected: () => void;
  pauseSelected: () => void;
  pauseItem: (id: string) => Promise<void>;
  resumeItem: (id: string, force?: boolean) => Promise<void>;
  deleteDownloads: (ids: string[], deleteFromDisk?: boolean) => Promise<void>;
  deleteSelected: (deleteFromDisk?: boolean) => void;
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
  openModal: (modal: Exclude<ActiveModalType, null>, downloadId?: string) => void;
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

export const defaultSettings: GlobalSettings = {
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

export const defaultQueues: QueueConfig[] = [
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
