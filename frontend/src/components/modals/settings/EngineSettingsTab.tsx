/**
 * Download Engine settings tab for SettingsModal (storage, bandwidth, concurrency, proxy, SSL, cookie bypass rules).
 */
import React, { useState } from 'react';
import { Folder, Minus, Plus, X } from 'lucide-react';
import { CookieBypassRule } from '../../../types/download';
import { ProxyConfig } from '../ProxyModal';
import { HelpTooltip } from '../../common/Tooltip';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { Switch } from '../../ui/switch';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../../ui/select';
import { SettingRow, DEFAULT_COOKIE_BYPASS_RULES } from './SettingRow';

interface EngineSettingsTabProps {
  downloadPath: string;
  setDownloadPath: (path: string) => void;
  onPickDownloadFolder: () => void;
  useCategoryByDefault: boolean;
  setUseCategoryByDefault: (val: boolean) => void;
  threadCount: number;
  setThreadCount: (val: number) => void;
  maxConcurrent: number;
  setMaxConcurrent: (val: number) => void;
  maxRetries: number;
  setMaxRetries: (val: number) => void;
  dynamicPartCreation: boolean;
  setDynamicPartCreation: (val: boolean) => void;
  globalSpeedLimiter: boolean;
  setGlobalSpeedLimiter: (val: boolean) => void;
  globalSpeedLimitVal: number;
  setGlobalSpeedLimitVal: (val: number) => void;
  globalSpeedLimitUnit: 'KB/s' | 'MB/s';
  setGlobalSpeedLimitUnit: (unit: 'KB/s' | 'MB/s') => void;
  proxyConfig: ProxyConfig;
  onOpenProxyModal: () => void;
  userAgent: string;
  setUserAgent: (val: string) => void;
  useServersLastModified: boolean;
  setUseServersLastModified: (val: boolean) => void;
  ignoreSsl: boolean;
  setIgnoreSsl: (val: boolean) => void;
  sparseFileAllocation: boolean;
  setSparseFileAllocation: (val: boolean) => void;
  appendExtensionToIncomplete: boolean;
  setAppendExtensionToIncomplete: (val: boolean) => void;
  trackDeletedFiles: boolean;
  setTrackDeletedFiles: (val: boolean) => void;
  deletePartialOnFileCancel: boolean;
  setDeletePartialOnFileCancel: (val: boolean) => void;
  cookieBypassRules: CookieBypassRule[];
  setCookieBypassRules: React.Dispatch<React.SetStateAction<CookieBypassRule[]>>;
}

export const EngineSettingsTab: React.FC<EngineSettingsTabProps> = ({
  downloadPath,
  setDownloadPath,
  onPickDownloadFolder,
  useCategoryByDefault,
  setUseCategoryByDefault,
  threadCount,
  setThreadCount,
  maxConcurrent,
  setMaxConcurrent,
  maxRetries,
  setMaxRetries,
  dynamicPartCreation,
  setDynamicPartCreation,
  globalSpeedLimiter,
  setGlobalSpeedLimiter,
  globalSpeedLimitVal,
  setGlobalSpeedLimitVal,
  globalSpeedLimitUnit,
  setGlobalSpeedLimitUnit,
  proxyConfig,
  onOpenProxyModal,
  userAgent,
  setUserAgent,
  useServersLastModified,
  setUseServersLastModified,
  ignoreSsl,
  setIgnoreSsl,
  sparseFileAllocation,
  setSparseFileAllocation,
  appendExtensionToIncomplete,
  setAppendExtensionToIncomplete,
  trackDeletedFiles,
  setTrackDeletedFiles,
  deletePartialOnFileCancel,
  setDeletePartialOnFileCancel,
  cookieBypassRules,
  setCookieBypassRules,
}) => {
  const [newRuleDomain, setNewRuleDomain] = useState<string>('');
  const [newRuleHttp, setNewRuleHttp] = useState<boolean>(true);
  const [newRuleYtdlp, setNewRuleYtdlp] = useState<boolean>(true);
  const [newRuleHls, setNewRuleHls] = useState<boolean>(true);

  const handleAddRule = () => {
    const trimmed = newRuleDomain
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
    if (trimmed) {
      const existingIdx = cookieBypassRules.findIndex((r) => r.domain.toLowerCase() === trimmed);
      if (existingIdx >= 0) {
        const updated = [...cookieBypassRules];
        updated[existingIdx] = {
          domain: trimmed,
          http: newRuleHttp,
          ytdlp: newRuleYtdlp,
          hls: newRuleHls,
        };
        setCookieBypassRules(updated);
      } else {
        setCookieBypassRules([
          ...cookieBypassRules,
          {
            domain: trimmed,
            http: newRuleHttp,
            ytdlp: newRuleYtdlp,
            hls: newRuleHls,
          },
        ]);
      }
      setNewRuleDomain('');
    }
  };

  const handleToggleRuleProtocol = (domain: string, protocol: 'http' | 'ytdlp' | 'hls') => {
    setCookieBypassRules(
      cookieBypassRules.map((r) => {
        if (r.domain.toLowerCase() === domain.toLowerCase()) {
          return { ...r, [protocol]: !r[protocol] };
        }
        return r;
      })
    );
  };

  const handleRemoveRule = (domainToRemove: string) => {
    setCookieBypassRules(
      cookieBypassRules.filter((r) => r.domain.toLowerCase() !== domainToRemove.toLowerCase())
    );
  };

  const handleResetRules = () => {
    setCookieBypassRules(DEFAULT_COOKIE_BYPASS_RULES);
  };

  return (
    <div className="space-y-5 animate-in fade-in-50 duration-150">
      {/* Storage & Directories */}
      <div className="rounded-xl border border-border/70 bg-card/60 shadow-xs overflow-hidden divide-y divide-border/40">
        <SettingRow
          label="Default Download Location"
          subtitle={downloadPath || 'Not configured'}
          tooltip="Primary directory on your computer where downloaded files are saved."
        >
          <div className="flex items-center gap-2 max-w-xs w-full">
            <Input
              type="text"
              value={downloadPath}
              onChange={(e) => setDownloadPath(e.target.value)}
              className="h-8.5 text-xs font-mono flex-1 bg-card border-border truncate"
              placeholder="C:\Downloads"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={onPickDownloadFolder}
              className="h-8.5 gap-1.5 shrink-0 text-xs"
            >
              <Folder className="w-3.5 h-3.5" />
              <span>Browse</span>
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          label="Categorize Downloads Automatically"
          subtitle={useCategoryByDefault ? 'Enabled' : 'Disabled'}
          tooltip="Automatically routes files into subfolders based on file type (Videos, Programs, Compressed, etc.)."
        >
          <Switch checked={useCategoryByDefault} onCheckedChange={setUseCategoryByDefault} />
        </SettingRow>
      </div>

      {/* Bandwidth & Concurrency */}
      <div className="rounded-xl border border-border/70 bg-card/60 shadow-xs overflow-hidden divide-y divide-border/40">
        <SettingRow
          label="Default Threads per Download"
          subtitle={`${threadCount} simultaneous segmented connections`}
          tooltip="Number of parallel segmented connection streams created per download task (1-64)."
        >
          <div className="flex items-center rounded-lg border border-border bg-card p-0.5 shadow-2xs">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={threadCount <= 1}
              onClick={() => setThreadCount(Math.max(1, threadCount - 1))}
              className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer disabled:opacity-30"
            >
              <Minus className="w-3.5 h-3.5" />
            </Button>
            <Input
              type="number"
              min="1"
              max="64"
              value={threadCount}
              onChange={(e) => {
                const v = parseInt(e.target.value);
                if (!isNaN(v)) setThreadCount(Math.max(1, Math.min(64, v)));
                else setThreadCount(1);
              }}
              className="h-7 w-12 text-xs text-center font-mono tabular-nums bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 shadow-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={threadCount >= 64}
              onClick={() => setThreadCount(Math.min(64, threadCount + 1))}
              className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer disabled:opacity-30"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          label="Max Concurrent Downloads"
          subtitle={maxConcurrent === 0 ? 'Unlimited (0)' : `${maxConcurrent} active downloads`}
          tooltip="Maximum number of simultaneous active general downloads (0 for unlimited). Queues manage their concurrency independently."
        >
          <div className="flex items-center rounded-lg border border-border bg-card p-0.5 shadow-2xs">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={maxConcurrent <= 0}
              onClick={() => setMaxConcurrent(Math.max(0, maxConcurrent - 1))}
              className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer disabled:opacity-30"
            >
              <Minus className="w-3.5 h-3.5" />
            </Button>
            <Input
              type="number"
              min="0"
              max="32"
              value={maxConcurrent}
              onChange={(e) => {
                const v = parseInt(e.target.value);
                if (!isNaN(v)) setMaxConcurrent(Math.max(0, Math.min(32, v)));
                else setMaxConcurrent(0);
              }}
              className="h-7 w-12 text-xs text-center font-mono tabular-nums bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 shadow-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={maxConcurrent >= 32}
              onClick={() => setMaxConcurrent(Math.min(32, maxConcurrent + 1))}
              className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer disabled:opacity-30"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          label="Max Connection Retries"
          subtitle={
            maxRetries <= 1
              ? '1 automatic retry attempt'
              : `${maxRetries} automatic retry attempts`
          }
          tooltip="Number of automatic reconnection attempts if a download connection drops (1-20)."
        >
          <div className="flex items-center rounded-lg border border-border bg-card p-0.5 shadow-2xs">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={maxRetries <= 1}
              onClick={() => setMaxRetries(Math.max(1, maxRetries - 1))}
              className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer disabled:opacity-30"
            >
              <Minus className="w-3.5 h-3.5" />
            </Button>
            <Input
              type="number"
              min="1"
              max="20"
              value={maxRetries}
              onChange={(e) => {
                const v = parseInt(e.target.value);
                if (!isNaN(v)) setMaxRetries(Math.max(1, Math.min(20, v)));
                else setMaxRetries(1);
              }}
              className="h-7 w-12 text-xs text-center font-mono tabular-nums bg-transparent border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 shadow-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={maxRetries >= 20}
              onClick={() => setMaxRetries(Math.min(20, maxRetries + 1))}
              className="h-7 w-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-pointer disabled:opacity-30"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
        </SettingRow>

        <SettingRow
          label="Dynamic Part Creation"
          subtitle={dynamicPartCreation ? 'Enabled (Adaptive chunk segmentation)' : 'Disabled'}
          tooltip="Dynamically adjust chunk segments during download execution for faster acceleration."
        >
          <Switch checked={dynamicPartCreation} onCheckedChange={setDynamicPartCreation} />
        </SettingRow>

        <SettingRow
          label="Global Speed Limiter"
          subtitle={
            globalSpeedLimiter
              ? `Throttled to ${globalSpeedLimitVal} ${globalSpeedLimitUnit}`
              : 'Disabled (Unlimited speed)'
          }
          tooltip="Restricts the aggregated bandwidth used across all simultaneous downloads."
        >
          <div className="flex items-center gap-2">
            {globalSpeedLimiter && (
              <div className="flex items-center gap-1.5 animate-in fade-in duration-150">
                <Input
                  type="number"
                  min="1"
                  value={globalSpeedLimitVal}
                  onChange={(e) =>
                    setGlobalSpeedLimitVal(Math.max(1, parseInt(e.target.value) || 1))
                  }
                  className="h-8.5 w-20 text-xs text-center font-mono tabular-nums bg-card border-border"
                />
                <Select
                  value={globalSpeedLimitUnit}
                  onValueChange={(v: any) => setGlobalSpeedLimitUnit(v)}
                >
                  <SelectTrigger className="h-8.5 w-24 text-xs bg-card border-border">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="KB/s">KB/s</SelectItem>
                    <SelectItem value="MB/s">MB/s</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <Switch checked={globalSpeedLimiter} onCheckedChange={setGlobalSpeedLimiter} />
          </div>
        </SettingRow>
      </div>

      {/* Network & Proxy */}
      <div className="rounded-xl border border-border/70 bg-card/60 shadow-xs overflow-hidden divide-y divide-border/40">
        <SettingRow
          label="Network Proxy"
          subtitle={(() => {
            if (proxyConfig.mode === 'none') return 'No Proxy (Direct connection)';
            if (proxyConfig.mode === 'system') return 'System Proxy';
            if (proxyConfig.mode === 'pac')
              return `Proxy Auto Configuration (${proxyConfig.pacUrl || 'PAC Script'})`;
            if (proxyConfig.mode === 'manual')
              return `${proxyConfig.proxyType} Proxy: ${proxyConfig.host}:${proxyConfig.port}`;
            return 'No Proxy';
          })()}
          tooltip="Route network traffic through a custom HTTP, SOCKS5 proxy server or PAC script."
        >
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenProxyModal}
            className="h-8.5 text-xs font-medium px-4 gap-1.5"
          >
            <span>Configure Proxy</span>
          </Button>
        </SettingRow>

        <SettingRow
          label="Default HTTP User-Agent"
          subtitle={userAgent ? userAgent : 'Default (Engine Header)'}
          tooltip="Custom HTTP User-Agent header sent to remote servers with web requests."
        >
          <Input
            type="text"
            placeholder="e.g. Mozilla/5.0 (Windows NT 10.0; Win64; x64)..."
            value={userAgent}
            onChange={(e) => setUserAgent(e.target.value)}
            className="h-8.5 w-64 text-xs font-mono bg-card border-border"
          />
        </SettingRow>

        <SettingRow
          label="Preserve Server Timestamp"
          subtitle={useServersLastModified ? 'Enabled' : 'Disabled'}
          tooltip="Sets the local downloaded file timestamp to match the server's Last-Modified header."
        >
          <Switch
            checked={useServersLastModified}
            onCheckedChange={setUseServersLastModified}
          />
        </SettingRow>

        <SettingRow
          label="Ignore SSL Certificate Errors"
          subtitle={
            ignoreSsl ? 'Enabled (Warning: insecure)' : 'Disabled (Strict verification)'
          }
          tooltip="Allows downloading from servers with expired or self-signed SSL/TLS certificates."
        >
          <Switch checked={ignoreSsl} onCheckedChange={setIgnoreSsl} />
        </SettingRow>
      </div>

      {/* Storage & Resilience Flags */}
      <div className="rounded-xl border border-border/70 bg-card/60 shadow-xs overflow-hidden divide-y divide-border/40">
        <SettingRow
          label="Sparse File Allocation"
          subtitle={sparseFileAllocation ? 'Enabled' : 'Disabled'}
          tooltip="Allocates disk space on supported file systems without writing zeros, speeding up download start time."
        >
          <Switch checked={sparseFileAllocation} onCheckedChange={setSparseFileAllocation} />
        </SettingRow>

        <SettingRow
          label="Append .thunder Extension"
          subtitle={appendExtensionToIncomplete ? 'Enabled' : 'Disabled'}
          tooltip="Appends .thunder extension to files while downloading to prevent opening incomplete files."
        >
          <Switch
            checked={appendExtensionToIncomplete}
            onCheckedChange={setAppendExtensionToIncomplete}
          />
        </SettingRow>

        <SettingRow
          label="Track Deleted Files on Disk"
          subtitle={trackDeletedFiles ? 'Enabled' : 'Disabled'}
          tooltip="Checks if completed files still exist on disk and displays a warning badge if missing."
        >
          <Switch checked={trackDeletedFiles} onCheckedChange={setTrackDeletedFiles} />
        </SettingRow>

        <SettingRow
          label="Delete Partial on Cancel"
          subtitle={deletePartialOnFileCancel ? 'Enabled' : 'Disabled'}
          tooltip="Deletes temporary segment files immediately when a download task is canceled."
        >
          <Switch
            checked={deletePartialOnFileCancel}
            onCheckedChange={setDeletePartialOnFileCancel}
          />
        </SettingRow>
      </div>

      {/* Global Cookie Bypass Rules (HTTP / YT-DLP / HLS) */}
      <div className="rounded-xl border border-border/70 bg-card/60 shadow-xs overflow-hidden p-4 space-y-3.5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground">
                Cookie Bypass Rules (Global: HTTP / YT-DLP / HLS)
              </span>
              <HelpTooltip description="Selectively bypass sending browser session cookies for specific domains and download protocols to prevent extractor crashes or download anonymously." />
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Configure which download engines (HTTP, YT-DLP, HLS) will omit cookie headers for each
              domain.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleResetRules}
            className="h-7 text-[11px] text-muted-foreground hover:text-foreground px-2.5 rounded-lg border border-border/50 cursor-pointer shrink-0"
          >
            Reset Defaults
          </Button>
        </div>

        {/* Add Rule Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-2.5 rounded-lg bg-muted/40 border border-border/50">
          <Input
            type="text"
            placeholder="e.g. instagram.com, tiktok.com, example.com"
            value={newRuleDomain}
            onChange={(e) => setNewRuleDomain(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddRule();
              }
            }}
            className="h-8 text-xs font-mono bg-card border-border flex-1"
          />

          <div className="flex items-center justify-between sm:justify-start gap-3 px-1 text-xs">
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] font-medium text-foreground">
              <input
                type="checkbox"
                checked={newRuleHttp}
                onChange={(e) => setNewRuleHttp(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary/30"
              />
              <span>HTTP</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] font-medium text-foreground">
              <input
                type="checkbox"
                checked={newRuleYtdlp}
                onChange={(e) => setNewRuleYtdlp(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary/30"
              />
              <span>YT-DLP</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px] font-medium text-foreground">
              <input
                type="checkbox"
                checked={newRuleHls}
                onChange={(e) => setNewRuleHls(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary/30"
              />
              <span>HLS</span>
            </label>
          </div>

          <Button
            type="button"
            size="sm"
            onClick={handleAddRule}
            className="h-8 text-xs px-3.5 gap-1 font-medium cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Rule</span>
          </Button>
        </div>

        {/* Rules List / Table */}
        <div className="space-y-1.5 pt-1">
          {cookieBypassRules.map((rule) => (
            <div
              key={rule.domain}
              className="flex items-center justify-between p-2 rounded-lg bg-card border border-border/70 text-xs gap-2 transition-colors hover:border-border"
            >
              <span className="font-mono text-[11px] font-medium text-foreground truncate max-w-[180px] sm:max-w-[240px]">
                {rule.domain}
              </span>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px]">
                  <input
                    type="checkbox"
                    checked={rule.http}
                    onChange={() => handleToggleRuleProtocol(rule.domain, 'http')}
                    className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary/30"
                  />
                  <span
                    className={
                      rule.http ? 'text-foreground font-medium' : 'text-muted-foreground line-through'
                    }
                  >
                    HTTP
                  </span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px]">
                  <input
                    type="checkbox"
                    checked={rule.ytdlp}
                    onChange={() => handleToggleRuleProtocol(rule.domain, 'ytdlp')}
                    className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary/30"
                  />
                  <span
                    className={
                      rule.ytdlp
                        ? 'text-foreground font-medium'
                        : 'text-muted-foreground line-through'
                    }
                  >
                    YT-DLP
                  </span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer select-none text-[11px]">
                  <input
                    type="checkbox"
                    checked={rule.hls}
                    onChange={() => handleToggleRuleProtocol(rule.domain, 'hls')}
                    className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary/30"
                  />
                  <span
                    className={
                      rule.hls ? 'text-foreground font-medium' : 'text-muted-foreground line-through'
                    }
                  >
                    HLS
                  </span>
                </label>

                <button
                  type="button"
                  onClick={() => handleRemoveRule(rule.domain)}
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded p-1 cursor-pointer transition-colors ml-1"
                  title={`Remove rule for ${rule.domain}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}

          {cookieBypassRules.length === 0 && (
            <div className="text-center py-3 text-[11px] text-muted-foreground italic border border-dashed border-border/60 rounded-lg">
              No bypass rules configured. Cookies will be sent for all requests.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
