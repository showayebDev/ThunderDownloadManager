/**
 * Type definitions for RealTimeDownloadProgress and its sub-components.
 */

export interface ChunkInfo {
  id?: number;
  status?: string;
  downloaded: number;
  total: number;
}

export interface ParsedSpeedLimit {
  enabled: boolean;
  val: number;
  unit: string;
}
