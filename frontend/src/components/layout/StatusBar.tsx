import React, { useState, useEffect } from 'react';
import { List, ArrowDown } from 'lucide-react';
import { useDownloadContext } from '../../context/DownloadContext';
import { useAppearance } from '../../context/AppearanceContext';
import { formatSpeed } from '../../utils/formatters';
import { invoke } from '../../utils/tauriBridge';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';
import { Badge } from '../ui/badge';

export const StatusBar: React.FC = () => {
  const { filteredDownloads, selectedIds, totalSpeed, globalSettings } = useDownloadContext();
  const { appearance, t } = useAppearance();
  const [proxySummary, setProxySummary] = useState<string>('');

  useEffect(() => {
    const checkProxy = async () => {
      try {
        if (globalSettings?.proxyConfig) {
          const cfg = globalSettings.proxyConfig;
          if (cfg && cfg.mode && cfg.mode !== 'none') {
            if (cfg.mode === 'manual') setProxySummary(`${cfg.proxyType || 'HTTP'} ${cfg.host}:${cfg.port}`);
            else if (cfg.mode === 'system') setProxySummary('System Proxy');
            else if (cfg.mode === 'pac') setProxySummary('PAC Proxy');
            return;
          }
        }
        const cfg = await invoke<any>('get_proxy_config_command');
        if (cfg && cfg.mode && cfg.mode !== 'none') {
          if (cfg.mode === 'manual') setProxySummary(`${cfg.proxyType || 'HTTP'} ${cfg.host}:${cfg.port}`);
          else if (cfg.mode === 'system') setProxySummary('System Proxy');
          else if (cfg.mode === 'pac') setProxySummary('PAC Proxy');
        } else {
          setProxySummary('');
        }
      } catch {}
    };

    checkProxy();
    const interval = setInterval(checkProxy, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <footer className="h-7 bg-card border-t border-border px-3 flex items-center justify-between text-xs text-muted-foreground select-none">
      {/* Item count */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center space-x-2 cursor-default">
            <List className="w-3.5 h-3.5" />
            <span>
              {selectedIds.size > 0
                ? `${selectedIds.size} / ${filteredDownloads.length} ${t('statusbar.selected')}`
                : `${filteredDownloads.length} ${filteredDownloads.length === 1 ? t('statusbar.item') : t('statusbar.items')}`}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">Total number of tasks in the active view / current selection</TooltipContent>
      </Tooltip>

      {/* Proxy status */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center space-x-1.5 text-[11px] cursor-default">
            {proxySummary ? (
              <Badge variant="outline" className="flex items-center space-x-1.5 px-2 py-0.5 border-primary/30 text-primary bg-primary/10">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Proxy: {proxySummary}</span>
              </Badge>
            ) : (
              <span className="text-muted-foreground/60">{t('statusbar.proxyDirect')}</span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          {proxySummary ? `Network traffic routed through: ${proxySummary}` : "Direct network connection without proxy"}
        </TooltipContent>
      </Tooltip>

      {/* Combined download speed */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center space-x-1.5 text-foreground cursor-default">
            <ArrowDown className="w-3.5 h-3.5 text-primary" />
            <span className="font-mono text-[11px] font-medium">{formatSpeed(totalSpeed, appearance.downloadSpeedUnit)}</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">Combined real-time download bandwidth across all active tasks</TooltipContent>
      </Tooltip>
    </footer>
  );
};
