/**
 * Extra Config flyout panel for DownloadStartConfirmation: speed limits, file checksums,
 * queue assignment, thread counts, custom headers (User-Agent, Referer), cookie filtering,
 * and HTTP authentication.
 */

import React from 'react';
import { X, Cookie } from 'lucide-react';
import { CookieBypassRule } from '../../../types/download';
import { HelpTooltip } from '../../common/Tooltip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { QueueItem } from './types';

interface AdvancedDownloadOptionsProps {
  showExtraConfig: boolean;
  onCloseExtraConfig: () => void;
  speedLimitEnabled: boolean;
  onSpeedLimitEnabledChange: (enabled: boolean) => void;
  speedLimitVal: number;
  onSpeedLimitValChange: (val: number) => void;
  speedLimitUnit: string;
  onSpeedLimitUnitChange: (unit: string) => void;
  checksumEnabled: boolean;
  onChecksumEnabledChange: (enabled: boolean) => void;
  checksumVal: string;
  onChecksumValChange: (val: string) => void;
  queue: string;
  onQueueChange: (queue: string) => void;
  availableQueues: QueueItem[];
  threadCount: number;
  onThreadCountChange: (count: number) => void;
  defaultThreadCount: number;
  userAgent: string;
  onUserAgentChange: (ua: string) => void;
  refererPage: string;
  onRefererPageChange: (ref: string) => void;
  useCookie: boolean;
  onToggleUseCookie: (checked: boolean) => void;
  matchedCookieRule: CookieBypassRule | null;
  cookies: string;
  onCookiesChange: (cookies: string) => void;
  username: string;
  onUsernameChange: (username: string) => void;
  password: string;
  onPasswordChange: (password: string) => void;
}

export const AdvancedDownloadOptions: React.FC<AdvancedDownloadOptionsProps> = ({
  showExtraConfig,
  onCloseExtraConfig,
  speedLimitEnabled,
  onSpeedLimitEnabledChange,
  speedLimitVal,
  onSpeedLimitValChange,
  speedLimitUnit,
  onSpeedLimitUnitChange,
  checksumEnabled,
  onChecksumEnabledChange,
  checksumVal,
  onChecksumValChange,
  queue,
  onQueueChange,
  availableQueues,
  threadCount,
  onThreadCountChange,
  defaultThreadCount,
  userAgent,
  onUserAgentChange,
  refererPage,
  onRefererPageChange,
  useCookie,
  onToggleUseCookie,
  matchedCookieRule,
  cookies,
  onCookiesChange,
  username,
  onUsernameChange,
  password,
  onPasswordChange,
}) => {
  if (!showExtraConfig) return null;

  return (
    <div className="absolute inset-y-0 right-0 w-[250px] bg-card border-l border-border p-4 flex flex-col justify-between animate-in slide-in-from-right duration-150 text-xs space-y-3 z-30 shadow-2xl overflow-y-auto overflow-x-hidden custom-scrollbar">
      <div>
        <div className="flex items-center justify-between border-b border-border pb-2 mb-3">
          <span className="font-semibold text-foreground text-xs">Extra Config</span>
          <Button
            variant="ghost"
            size="icon-xs"
            type="button"
            onClick={onCloseExtraConfig}
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
                  const enabled = Boolean(checked);
                  onSpeedLimitEnabledChange(enabled);
                  if (enabled && (!speedLimitVal || speedLimitVal <= 0)) {
                    onSpeedLimitValChange(5);
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
                      onSpeedLimitValChange(val);
                    }}
                    className="flex-1 bg-background text-foreground text-xs font-mono h-8"
                  />
                  <select
                    value={speedLimitUnit}
                    onChange={(e) => onSpeedLimitUnitChange(e.target.value)}
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
                <HelpTooltip
                  description="Verify integrity after download with MD5/SHA256."
                  badge
                  position="left"
                />
              </Label>
              <Checkbox
                checked={checksumEnabled}
                onCheckedChange={(c) => onChecksumEnabledChange(Boolean(c))}
              />
            </div>
            {checksumEnabled && (
              <Input
                type="text"
                placeholder="Expected MD5/SHA256"
                value={checksumVal}
                onChange={(e) => onChecksumValChange(e.target.value)}
                className="w-full bg-background font-mono text-xs h-8"
              />
            )}
          </div>

          {/* Queue Selection */}
          <div className="space-y-1">
            <Label className="text-foreground font-medium text-[11px] flex items-center space-x-1">
              <span>Queue</span>
              <HelpTooltip
                description="Assign download to a specific queue."
                badge
                position="left"
              />
            </Label>
            <select
              value={queue}
              onChange={(e) => onQueueChange(e.target.value)}
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
              onChange={(e) => onThreadCountChange(Number(e.target.value))}
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
              onChange={(e) => onUserAgentChange(e.target.value)}
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
              onChange={(e) => onRefererPageChange(e.target.value)}
              className="w-full bg-background font-mono text-[10px] h-7"
            />
          </div>

          {/* Cookie Configuration & Database Filtering */}
          <div className="space-y-1.5 pt-1 border-t border-border">
            <div className="flex items-center justify-between">
              <Label className="text-foreground font-medium text-[11px] flex items-center space-x-1">
                <Cookie className="w-3.5 h-3.5 text-amber-500" />
                <span>Cookie Filtering</span>
                <HelpTooltip
                  description="Toggle cookies or view bypass rules configured in Settings."
                  badge
                  position="left"
                />
              </Label>
              <Checkbox
                checked={useCookie}
                onCheckedChange={(c) => onToggleUseCookie(Boolean(c))}
              />
            </div>
            {matchedCookieRule && (
              <div className="bg-muted/30 border border-border/60 rounded-lg p-2 text-[10px] space-y-1 text-muted-foreground">
                <div className="font-semibold text-foreground flex items-center justify-between">
                  <span>Database Rule:</span>
                  <span className="font-mono text-primary">{matchedCookieRule.domain}</span>
                </div>
                <div className="grid grid-cols-3 gap-1 pt-0.5 text-center font-mono text-[9.5px]">
                  <div
                    className={`px-1 py-0.5 rounded ${
                      matchedCookieRule.http
                        ? 'bg-destructive/15 text-destructive'
                        : 'bg-emerald-500/15 text-emerald-500'
                    }`}
                  >
                    HTTP: {matchedCookieRule.http ? 'Bypass' : 'Allow'}
                  </div>
                  <div
                    className={`px-1 py-0.5 rounded ${
                      matchedCookieRule.ytdlp
                        ? 'bg-destructive/15 text-destructive'
                        : 'bg-emerald-500/15 text-emerald-500'
                    }`}
                  >
                    YT-DLP: {matchedCookieRule.ytdlp ? 'Bypass' : 'Allow'}
                  </div>
                  <div
                    className={`px-1 py-0.5 rounded ${
                      matchedCookieRule.hls
                        ? 'bg-destructive/15 text-destructive'
                        : 'bg-emerald-500/15 text-emerald-500'
                    }`}
                  >
                    HLS: {matchedCookieRule.hls ? 'Bypass' : 'Allow'}
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-muted-foreground text-[10px]">Raw Cookie Header</Label>
              <Input
                type="text"
                placeholder="key=value; session_id=..."
                value={cookies}
                onChange={(e) => onCookiesChange(e.target.value)}
                className="w-full bg-background font-mono text-[10px] h-7"
              />
            </div>
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
              onChange={(e) => onUsernameChange(e.target.value)}
              className="w-full bg-background text-[10px] h-7"
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              className="w-full bg-background text-[10px] h-7"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
