export type Category = 
  | 'All' 
  | 'Compressed' 
  | 'Programs' 
  | 'Videos' 
  | 'Music' 
  | 'Pictures' 
  | 'Documents';

export type DownloadStatus = 
  | 'Finished' 
  | 'Downloading' 
  | 'Paused' 
  | 'Canceled'
  | 'Error' 
  | 'Queued'
  | 'Merging'
  | 'Pending';

export type ChunkStatus = 
  | 'Downloading' 
  | 'Finished' 
  | 'Pending' 
  | 'Error' 
  | 'Connecting';

export interface DownloadChunk {
  id: number;
  status: ChunkStatus;
  downloaded: number; // bytes
  total: number; // bytes
}

export interface DownloadItem {
  id: string;
  name: string;
  category: Category;
  url: string;
  size: number; // total size in bytes (0 if unknown)
  downloaded: number; // downloaded bytes
  status: DownloadStatus;
  speed: number; // bytes per second
  timeLeft: string; // estimated time remaining
  dateAdded: string; // creation timestamp
  dateCompleted?: string;
  endTime?: string;
  queue?: string; // queue identifier
  savePath: string;
  resumeSupport: 'Yes' | 'No' | 'Unknown';
  errorMessage?: string;
  threadCount: number;
  speedLimit?: number | null; // bytes/sec (null for unlimited)
  inTray?: boolean;
  givenCheckSum?: string;
  expectedChecksum?: string;
  proxyUsed?: string;
  orderIndex?: number;
  fileMissing?: boolean;
  protocol?: string;
  username?: string;
  password?: string;
  userAgent?: string;
  referer?: string;
  cookies?: string;
  chunks: DownloadChunk[];
}

export interface QueueConfig {
  id: string;
  name: string;
  maxConcurrent: number;
  scheduleEnabled: boolean;
  activeDays: string[];
  enableAutoStartTime: boolean;
  autoStartTime: string;
  enableAutoStopTime: boolean;
  autoStopTime: string;
  isRunning: boolean;
  showRealTimeProgress?: boolean;
  showCompletionWindow?: boolean;
  threadCount?: number;
}

export interface VaultItem {
  host: string;
  user?: string;
  pass?: string;
  speedLimit?: number; // bytes/sec (0 for unlimited)
  speedLimitUnit?: 'KB/s' | 'MB/s';
  speedLimitValue?: number;
  threadCount?: number; // 0 for global settings
  userAgent?: string;
}

export type PerHostSetting = VaultItem;

export interface GlobalSettings {
  downloadPath: string;
  cachePath?: string;
  maxConcurrentDownloads: number;
  defaultThreadCount: number;
  threadCount?: number;
  globalSpeedLimit: number | null; // bytes/sec (null for unlimited)
  globalSpeedLimitValue?: number;
  globalSpeedLimitUnit?: 'KB/s' | 'MB/s';
  globalSpeedLimiter?: boolean;
  autoStartWithSystem: boolean;
  onCompletionAction: 'none' | 'shutdown' | 'sleep' | 'notify';
  showEndTime?: boolean;

  // Engine settings
  useCategoryByDefault?: boolean;
  categoryPaths?: { [category: string]: string };
  maxRetries?: number;
  dynamicPartCreation?: boolean;
  vaultItems?: VaultItem[];
  userAgent?: string;
  ignoreSsl?: boolean;
  useServersLastModified?: boolean;
  trackDeletedFiles?: boolean;
  appendExtensionToIncomplete?: boolean;
  deletePartialOnFileCancel?: boolean;
  sparseFileAllocation?: boolean;
  browserIntegration?: boolean;
  port?: string;

  // Proxy configuration
  proxyConfig?: any;
  proxyEnabled?: boolean;
  proxyHost?: string;
  proxyPort?: string;
}

