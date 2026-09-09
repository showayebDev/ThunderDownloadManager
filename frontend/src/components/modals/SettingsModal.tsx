import React, { useState, useEffect } from 'react';
import {
  Palette,
  CloudDownload,
  Globe,
  Folder,
  X,
  ExternalLink,
  AlertTriangle,
  Minus,
  Plus,
} from 'lucide-react';
import { useDownloadContext } from '../../context/DownloadContext';
import { useAppearance, AppearanceSettings, ColorTheme, applyAppDOMStyles } from '../../context/AppearanceContext';
import { saveToThunderDB, loadFromThunderDB } from '../../utils/thunderDB';
import { invoke, BrowserOpenURL } from '../../utils/tauriBridge';
import { ProxyModal, ProxyConfig, defaultProxyConfig } from './ProxyModal';
import { GlobalSettings, VaultItem } from '../../types/download';
import { FontSelect } from '../common/FontSelect';
import { HelpTooltip } from '../common/Tooltip';

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../ui/select';
import { ScrollArea } from '../ui/scroll-area';
import { Badge } from '../ui/badge';

const COLOR_THEMES: { id: ColorTheme; name: string; hex: string }[] = [
  { id: 'violet', name: 'Violet (Cosmic Purple)', hex: '#8b5cf6' },
  { id: 'blue', name: 'Blue (Sapphire Ocean)', hex: '#3b82f6' },
  { id: 'emerald', name: 'Emerald (Mint Forest)', hex: '#10b981' },
  { id: 'rose', name: 'Rose (Crimson Coral)', hex: '#f43f5e' },
  { id: 'amber', name: 'Amber (Warm Gold)', hex: '#f59e0b' },
  { id: 'cyan', name: 'Cyan (High-Tech Teal)', hex: '#06b6d4' },
  { id: 'zinc', name: 'Zinc (Monochrome)', hex: '#f4f4f5' },
  { id: 'midnight', name: 'Midnight (Deep Navy)', hex: '#38bdf8' },
  { id: 'oled', name: 'OLED (Pure Pitch Black)', hex: '#a855f7' },
];

interface SettingRowProps {
  label: string;
  subtitle?: React.ReactNode;
  tooltip?: string;
  children: React.ReactNode;
  className?: string;
}

const SettingRow: React.FC<SettingRowProps> = ({
  label,
  subtitle,
  tooltip,
  children,
  className = '',
}) => {
  return (
    <div className={`flex items-center justify-between py-3.5 px-4 sm:px-5 first:pt-4 last:pb-4 transition-colors hover:bg-muted/15 ${className}`}>
      <div className="space-y-0.5 pr-4 min-w-0">
        <div className="flex items-center gap-1.5">
          <Label className="text-[13px] font-semibold text-foreground tracking-tight select-none">
            {label}
          </Label>
          {tooltip && (
            <HelpTooltip description={tooltip} title={label} position="top-left" />
          )}
        </div>
        {subtitle && (
          <p className="text-[11.5px] text-muted-foreground font-normal leading-relaxed truncate">
            {subtitle}
          </p>
        )}
      </div>
      <div className="shrink-0 flex items-center">
        {children}
      </div>
    </div>
  );
};

export const SettingsModal: React.FC = () => {
  const { closeModal, globalSettings, updateGlobalSettings } = useDownloadContext();
  const { appearance, saveAppearance } = useAppearance();

  const isSavedRef = React.useRef(false);
  const initialAppearanceRef = React.useRef({
    theme: appearance.theme,
    font: appearance.font,
    fontSize: appearance.fontSize,
    colorTheme: appearance.colorTheme,
  });

  const [activeTab, setActiveTab] = useState<'appearance' | 'engine' | 'browser' | 'danger'>('appearance');

  // Appearance preferences state
  const [theme, setTheme] = useState<'Dark' | 'Light' | 'System'>(appearance.theme || 'System');
  const [colorTheme, setColorTheme] = useState<ColorTheme>(appearance.colorTheme || 'zinc');
  const [font, setFont] = useState<string>(appearance.font || 'Default');
  const [fontSize, setFontSize] = useState<string>(appearance.fontSize === 'Default' || !appearance.fontSize ? '12' : appearance.fontSize);
  const [systemFonts, setSystemFonts] = useState<string[]>(['Default']);

  useEffect(() => {
    async function loadFonts() {
      try {
        const fonts = await invoke<string[]>('get_system_fonts');
        if (Array.isArray(fonts) && fonts.length > 0) {
          setSystemFonts(fonts);
        }
      } catch (err) {
        console.error('Failed to load system fonts:', err);
      }
    }
    loadFonts();
  }, []);

  const [compactTopBar, setCompactTopBar] = useState(appearance.compactTopBar ?? true);
  const [showIconLabels, setShowIconLabels] = useState(appearance.showIconLabels ?? true);
  const [useRelativeDateTime, setUseRelativeDateTime] = useState(appearance.useRelativeDateTime ?? true);
  const [showEndTime, setShowEndTime] = useState(appearance.showEndTime ?? globalSettings?.showEndTime ?? true);
  const [startOnBoot, setStartOnBoot] = useState(appearance.startOnBoot ?? true);

  useEffect(() => {
    setStartOnBoot(appearance.startOnBoot ?? true);
  }, [appearance.startOnBoot]);

  const [useSystemTray, setUseSystemTray] = useState(appearance.useSystemTray ?? true);
  const [downloadSizeUnit, setDownloadSizeUnit] = useState<'KiB' | 'KB' | 'Automatic' | 'MiB' | 'GiB'>(appearance.downloadSizeUnit || 'Automatic');
  const [downloadSpeedUnit, setDownloadSpeedUnit] = useState<'KiB/s (1024 Bytes/s)' | 'KB/s (1000 Bytes/s)'>(appearance.downloadSpeedUnit === 'KB/s (1000 Bytes/s)' ? 'KB/s (1000 Bytes/s)' : 'KiB/s (1024 Bytes/s)');
  const [showAverageSpeed, setShowAverageSpeed] = useState(appearance.showAverageSpeed ?? true);
  const [showProgressDialog, setShowProgressDialog] = useState(appearance.showProgressDialog ?? true);
  const [showCompletionDialog, setShowCompletionDialog] = useState(appearance.showCompletionDialog ?? true);

  // Live appearance preview
  const handleThemeChange = (newTheme: 'Dark' | 'Light' | 'System') => {
    setTheme(newTheme);
    applyAppDOMStyles(newTheme, font, fontSize, colorTheme);
  };

  const handleColorThemeChange = (newColor: ColorTheme) => {
    setColorTheme(newColor);
    applyAppDOMStyles(theme, font, fontSize, newColor);
  };

  const handleFontChange = (newFont: string) => {
    setFont(newFont);
    applyAppDOMStyles(theme, newFont, fontSize, colorTheme);
  };

  const handleFontSizeChange = (newSize: string) => {
    setFontSize(newSize);
    applyAppDOMStyles(theme, font, newSize, colorTheme);
  };

  useEffect(() => {
    return () => {
      if (!isSavedRef.current) {
        applyAppDOMStyles(
          initialAppearanceRef.current.theme,
          initialAppearanceRef.current.font,
          initialAppearanceRef.current.fontSize,
          initialAppearanceRef.current.colorTheme
        );
      }
    };
  }, []);

  // Engine configuration
  const savedSettings = globalSettings || {};
  const [downloadPath, setDownloadPath] = useState(globalSettings.downloadPath || '');
  const [useCategoryByDefault, setUseCategoryByDefault] = useState<boolean>(() => {
    if (globalSettings?.useCategoryByDefault !== undefined) return Boolean(globalSettings.useCategoryByDefault);
    if (savedSettings?.useCategoryByDefault !== undefined) return Boolean(savedSettings.useCategoryByDefault);
    return true;
  });

  React.useEffect(() => {
    if (!downloadPath) {
      invoke<string>('get_default_download_dir').then((dir) => {
        if (dir) setDownloadPath(dir);
      }).catch(() => { });
    }
  }, []);

  useEffect(() => {
    async function loadEngineSettings() {
      try {
        const engine = await loadFromThunderDB<GlobalSettings>('download_engine', null as any);
        if (engine) {
          if (engine.useCategoryByDefault !== undefined) setUseCategoryByDefault(Boolean(engine.useCategoryByDefault));
          else setUseCategoryByDefault(true);
          if (engine.downloadPath) setDownloadPath(engine.downloadPath);
          if (engine.globalSpeedLimiter !== undefined) setGlobalSpeedLimiter(Boolean(engine.globalSpeedLimiter));
          if (engine.globalSpeedLimitValue !== undefined) setGlobalSpeedLimitVal(engine.globalSpeedLimitValue);
          if (engine.globalSpeedLimitUnit) setGlobalSpeedLimitUnit(engine.globalSpeedLimitUnit);
          if (engine.defaultThreadCount || (engine as any).threadCount) setThreadCount(engine.defaultThreadCount || (engine as any).threadCount || 8);
          if (engine.maxConcurrentDownloads !== undefined || (engine as any).maxConcurrent !== undefined) {
            const mc = engine.maxConcurrentDownloads !== undefined ? engine.maxConcurrentDownloads : (engine as any).maxConcurrent;
            setMaxConcurrent(Number(mc));
          }
          if (engine.maxRetries !== undefined) setMaxRetries(engine.maxRetries);
          if (engine.dynamicPartCreation !== undefined) setDynamicPartCreation(Boolean(engine.dynamicPartCreation));
          if (engine.userAgent !== undefined) setUserAgent(engine.userAgent);
          if (engine.ignoreSsl !== undefined) setIgnoreSsl(Boolean(engine.ignoreSsl));
          if (engine.useServersLastModified !== undefined) setUseServersLastModified(Boolean(engine.useServersLastModified));
          if (engine.trackDeletedFiles !== undefined) setTrackDeletedFiles(Boolean(engine.trackDeletedFiles));
          if (engine.appendExtensionToIncomplete !== undefined) setAppendExtensionToIncomplete(Boolean(engine.appendExtensionToIncomplete));
          if (engine.deletePartialOnFileCancel !== undefined) setDeletePartialOnFileCancel(Boolean(engine.deletePartialOnFileCancel));
          if (engine.sparseFileAllocation !== undefined) setSparseFileAllocation(Boolean(engine.sparseFileAllocation));
          if (engine.browserIntegration !== undefined) setBrowserIntegration(Boolean(engine.browserIntegration));
          if (engine.port) setPort(engine.port);
          if (Array.isArray(engine.vaultItems)) setVaultItems(engine.vaultItems);
          if (engine.proxyConfig) setProxyConfig(engine.proxyConfig);
        }
      } catch (err) {
        console.error('Failed to load engine settings in SettingsModal:', err);
      }
    }
    loadEngineSettings();

    invoke<string>('get_server_port_command').then((p) => {
      if (p) setPort(p);
    }).catch(() => { });
  }, []);

  const [globalSpeedLimiter, setGlobalSpeedLimiter] = useState(
    globalSettings.globalSpeedLimiter !== undefined
      ? globalSettings.globalSpeedLimiter
      : (savedSettings.globalSpeedLimiter ?? false)
  );
  const [globalSpeedLimitVal, setGlobalSpeedLimitVal] = useState<number>(() => {
    if (globalSettings.globalSpeedLimitValue !== undefined) return globalSettings.globalSpeedLimitValue;
    if (savedSettings.globalSpeedLimitValue !== undefined) return savedSettings.globalSpeedLimitValue;
    return 2;
  });
  const [globalSpeedLimitUnit, setGlobalSpeedLimitUnit] = useState<'KB/s' | 'MB/s'>(() => {
    if (globalSettings.globalSpeedLimitUnit) return globalSettings.globalSpeedLimitUnit;
    if (savedSettings.globalSpeedLimitUnit) return savedSettings.globalSpeedLimitUnit;
    return 'MB/s';
  });

  const [threadCount, setThreadCount] = useState((savedSettings as any).threadCount || savedSettings.defaultThreadCount || globalSettings.defaultThreadCount || 8);
  const [maxConcurrent, setMaxConcurrent] = useState<number>(() => {
    if (globalSettings.maxConcurrentDownloads !== undefined) return Number(globalSettings.maxConcurrentDownloads);
    if (savedSettings.maxConcurrentDownloads !== undefined) return Number(savedSettings.maxConcurrentDownloads);
    return 0;
  });
  const [maxRetries, setMaxRetries] = useState(savedSettings.maxRetries || 3);
  const [dynamicPartCreation, setDynamicPartCreation] = useState(
    globalSettings.dynamicPartCreation !== undefined
      ? globalSettings.dynamicPartCreation
      : (savedSettings.dynamicPartCreation ?? true)
  );

  const [userAgent, setUserAgent] = useState(savedSettings.userAgent || globalSettings.userAgent || '');
  const [ignoreSsl, setIgnoreSsl] = useState(
    globalSettings.ignoreSsl !== undefined
      ? globalSettings.ignoreSsl
      : (savedSettings.ignoreSsl ?? false)
  );
  const [useServersLastModified, setUseServersLastModified] = useState(
    globalSettings.useServersLastModified !== undefined
      ? globalSettings.useServersLastModified
      : (savedSettings.useServersLastModified ?? false)
  );
  const [trackDeletedFiles, setTrackDeletedFiles] = useState(
    globalSettings.trackDeletedFiles !== undefined
      ? globalSettings.trackDeletedFiles
      : (savedSettings.trackDeletedFiles ?? true)
  );
  const [appendExtensionToIncomplete, setAppendExtensionToIncomplete] = useState(
    globalSettings.appendExtensionToIncomplete !== undefined
      ? globalSettings.appendExtensionToIncomplete
      : (savedSettings.appendExtensionToIncomplete ?? true)
  );
  const [deletePartialOnFileCancel, setDeletePartialOnFileCancel] = useState(
    globalSettings.deletePartialOnFileCancel !== undefined
      ? globalSettings.deletePartialOnFileCancel
      : (savedSettings.deletePartialOnFileCancel ?? false)
  );
  const [sparseFileAllocation, setSparseFileAllocation] = useState(
    globalSettings.sparseFileAllocation !== undefined
      ? globalSettings.sparseFileAllocation
      : (savedSettings.sparseFileAllocation ?? true)
  );

  const savedProxy = savedSettings.proxyConfig || (savedSettings.proxyEnabled ? {
    ...defaultProxyConfig,
    mode: 'manual' as const,
    host: savedSettings.proxyHost || '',
    port: savedSettings.proxyPort || '',
  } : defaultProxyConfig);

  const [proxyConfig, setProxyConfig] = useState<ProxyConfig>(savedProxy);
  const [isProxyModalOpen, setIsProxyModalOpen] = useState<boolean>(false);
  const [vaultItems, setVaultItems] = useState<VaultItem[]>(savedSettings.vaultItems || []);
  const [browserIntegration, setBrowserIntegration] = useState(savedSettings.browserIntegration ?? true);
  const [port, setPort] = useState(savedSettings.port || '37555');

  const handleProxySave = (newConfig: ProxyConfig) => {
    setProxyConfig(newConfig);
    try {
      invoke('set_proxy_config_command', newConfig);
    } catch { }
  };

  const handlePickDownloadFolder = async () => {
    try {
      const chosen = await invoke<string | null>('pick_folder_command');
      if (chosen) setDownloadPath(chosen);
    } catch (err) {
      console.error('Failed to pick folder:', err);
    }
  };

  const handleSave = () => {
    const appearanceData: AppearanceSettings = {
      theme,
      colorTheme,
      language: appearance.language || 'System (English)',
      font,
      fontSize,
      uiScale: appearance.uiScale || 'System (100%)',
      compactTopBar,
      showIconLabels,
      useRelativeDateTime,
      showEndTime,
      startOnBoot,
      useSystemTray,
      downloadSizeUnit,
      downloadSpeedUnit,
      showAverageSpeed,
      showProgressDialog,
      showCompletionDialog,
    };

    const calculatedGlobalSpeedLimit = globalSpeedLimiter && globalSpeedLimitVal > 0
      ? (globalSpeedLimitUnit === 'MB/s' ? Math.round(globalSpeedLimitVal * 1024 * 1024) : Math.round(globalSpeedLimitVal * 1024))
      : null;

    const combinedSettings: GlobalSettings = {
      ...globalSettings,
      downloadPath,
      useCategoryByDefault,
      globalSpeedLimiter,
      globalSpeedLimit: calculatedGlobalSpeedLimit,
      globalSpeedLimitValue: globalSpeedLimitVal,
      globalSpeedLimitUnit,
      defaultThreadCount: threadCount,
      threadCount: threadCount,
      maxConcurrentDownloads: maxConcurrent,
      maxRetries,
      dynamicPartCreation,
      vaultItems,
      proxyConfig,
      proxyEnabled: proxyConfig.mode !== 'none',
      proxyHost: proxyConfig.host,
      proxyPort: proxyConfig.port,
      userAgent,
      ignoreSsl,
      useServersLastModified,
      trackDeletedFiles,
      appendExtensionToIncomplete,
      deletePartialOnFileCancel,
      sparseFileAllocation,
      browserIntegration,
      port,
      autoStartWithSystem: startOnBoot,
      onCompletionAction: globalSettings.onCompletionAction || 'none',
      showEndTime,
    };

    isSavedRef.current = true;
    saveAppearance(appearanceData);
    saveToThunderDB('download_engine', combinedSettings, true);

    try { invoke('set_proxy_config_command', proxyConfig); } catch { }
    try { invoke('set_launch_on_startup_command', { enabled: startOnBoot }); } catch { }
    try { invoke('set_server_port_command', { port }); } catch { }
    try { invoke('set_browser_integration_command', { enabled: browserIntegration }); } catch { }

    updateGlobalSettings(combinedSettings);
    closeModal();
  };

  const handleResetAllDefaults = () => {
    setTheme('System');
    setColorTheme('zinc');
    setFont('Default');
    setFontSize('12');
    handleThemeChange('System');
    handleColorThemeChange('zinc');
    handleFontChange('Default');
    handleFontSizeChange('12');
    setCompactTopBar(true);
    setShowIconLabels(true);
    setUseRelativeDateTime(true);
    setShowEndTime(true);
    setStartOnBoot(true);
    setUseSystemTray(true);
    setDownloadSizeUnit('Automatic');
    setDownloadSpeedUnit('KiB/s (1024 Bytes/s)');
    setShowAverageSpeed(true);
    setShowProgressDialog(true);
    setShowCompletionDialog(true);
    setUseCategoryByDefault(true);
    setGlobalSpeedLimiter(false);
    setThreadCount(8);
    setMaxConcurrent(0);
    setMaxRetries(3);
    setDynamicPartCreation(true);
    setUserAgent('');
    setIgnoreSsl(false);
    setUseServersLastModified(false);
    setTrackDeletedFiles(true);
    setAppendExtensionToIncomplete(true);
    setDeletePartialOnFileCancel(false);
    setSparseFileAllocation(true);
    setBrowserIntegration(true);
    setPort('37555');
  };

  const TABS = [
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'engine', label: 'Download Engine', icon: CloudDownload },
    { id: 'browser', label: 'Browser Integration', icon: Globe },
    { id: 'danger', label: 'Danger Zone', icon: AlertTriangle },
  ] as const;

  return (
    <Dialog open={true} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent showCloseButton={false} className="max-w-3xl sm:max-w-4xl w-full h-[88vh] max-h-[720px] p-0 gap-0 overflow-hidden flex flex-col bg-background border border-border/80 rounded-2xl shadow-2xl">
        {/* Title bar */}
        <div className="px-5 py-3.5 border-b border-border/70 bg-card/60 flex flex-row items-center justify-between shrink-0 select-none">
          <div className="flex items-center space-x-2.5">
            <div className="w-6 h-6 rounded-md bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0 shadow-xs">
              <img src="/icon.svg" alt="Logo" className="w-4 h-4 object-contain" />
            </div>
            <DialogTitle className="text-sm font-semibold tracking-tight text-foreground">
              Settings
            </DialogTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-red-500 hover:text-white dark:hover:bg-red-600 transition-colors cursor-pointer"
            onClick={closeModal}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Modal Body: Left Rail + Main Stage */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Navigation Rail */}
          <aside className="w-56 sm:w-60 shrink-0 border-r border-border/70 bg-card/30 flex flex-col p-3 space-y-1 select-none">
            {TABS.map((tabItem) => {
              const Icon = tabItem.icon;
              const isActive = activeTab === tabItem.id;
              const isDanger = tabItem.id === 'danger';
              return (
                <button
                  key={tabItem.id}
                  type="button"
                  onClick={() => setActiveTab(tabItem.id)}
                  className={`relative flex items-center w-full px-3 py-2.5 rounded-lg text-xs font-medium transition-all text-left group cursor-pointer ${isActive
                      ? isDanger
                        ? 'bg-destructive/10 text-destructive font-semibold shadow-xs border border-destructive/30'
                        : 'bg-card text-foreground font-semibold shadow-xs border border-border/60'
                      : isDanger
                        ? 'text-destructive/80 hover:text-destructive hover:bg-destructive/10'
                        : 'text-muted-foreground hover:text-foreground hover:bg-card/40'
                    }`}
                >
                  {isActive && (
                    <span className={`absolute left-1.5 top-1/2 -translate-y-1/2 w-1 h-4 rounded-full ${isDanger ? 'bg-destructive' : 'bg-primary'}`} />
                  )}
                  <Icon
                    className={`w-4 h-4 mr-2.5 shrink-0 transition-colors ${isActive
                        ? isDanger
                          ? 'text-destructive'
                          : 'text-primary'
                        : isDanger
                          ? 'text-destructive/80 group-hover:text-destructive'
                          : 'text-muted-foreground group-hover:text-foreground'
                      }`}
                  />
                  <span className="truncate">{tabItem.label}</span>
                </button>
              );
            })}
          </aside>

          {/* Right Main Stage Content Area */}
          <ScrollArea className="flex-1 p-5 sm:p-6 overflow-y-auto">
            {/* ================= APPEARANCE TAB ================= */}
            {activeTab === 'appearance' && (
              <div className="space-y-5 animate-in fade-in-50 duration-150">
                {/* Core Theme & Typography Card */}
                <div className="rounded-xl border border-border/70 bg-card/60 shadow-xs overflow-hidden divide-y divide-border/40">
                  {/* Theme Mode Selector */}
                  <SettingRow
                    label="Theme"
                    subtitle={theme === 'Dark' ? 'Dark' : theme === 'Light' ? 'Light' : 'System Auto'}
                    tooltip="Switch between Dark Mode, Light Mode, or automatic System theme."
                  >
                    <Select value={theme} onValueChange={(val: any) => handleThemeChange(val)}>
                      <SelectTrigger className="h-8.5 w-44 text-xs font-medium bg-card border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Dark">Dark</SelectItem>
                        <SelectItem value="Light">Light</SelectItem>
                        <SelectItem value="System">System Auto</SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingRow>

                  {/* Font Family Selector */}
                  <SettingRow
                    label="Font"
                    subtitle={font === 'Default' ? 'Default (System UI)' : font}
                    tooltip="Choose the primary interface font family from system fonts."
                  >
                    <FontSelect
                      value={font}
                      options={systemFonts}
                      onChange={handleFontChange}
                      className="w-44"
                    />
                  </SettingRow>

                  {/* Color Accent Palette */}
                  <SettingRow
                    label="Theme Color Palette"
                    subtitle={`Active: ${COLOR_THEMES.find((c) => c.id === colorTheme)?.name || 'Violet'}`}
                    tooltip="Accent color applied to active states, buttons, switches, and progress indicators."
                  >
                    <Select value={colorTheme} onValueChange={(val: any) => { if (val) handleColorThemeChange(val); }}>
                      <SelectTrigger className="h-8.5 w-44 text-xs font-medium bg-card border-border">
                        <div className="flex items-center gap-2 truncate">
                          <span
                            className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20"
                            style={{ backgroundColor: COLOR_THEMES.find((c) => c.id === colorTheme)?.hex || '#8b5cf6' }}
                          />
                          <span>{COLOR_THEMES.find((c) => c.id === colorTheme)?.name || 'Violet'}</span>
                        </div>
                      </SelectTrigger>
                      <SelectContent>
                        {COLOR_THEMES.map((tColor) => (
                          <SelectItem key={tColor.id} value={tColor.id}>
                            <div className="flex items-center gap-2">
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20"
                                style={{ backgroundColor: tColor.hex }}
                              />
                              <span>{tColor.name}</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </SettingRow>

                  {/* Base Font Size */}
                  <SettingRow
                    label="Base Font Size"
                    subtitle={`${fontSize}px`}
                    tooltip="Adjust the base font scaling size in pixels (default: 12px)."
                  >
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min="10"
                        max="18"
                        value={fontSize}
                        onChange={(e) => handleFontSizeChange(e.target.value)}
                        className="h-8.5 w-20 text-xs text-center font-mono tabular-nums bg-card border-border"
                      />
                      <span className="text-xs text-muted-foreground font-mono">px</span>
                    </div>
                  </SettingRow>
                </div>

                {/* Display & Behavior Switches Card */}
                <div className="rounded-xl border border-border/70 bg-card/60 shadow-xs overflow-hidden divide-y divide-border/40">
                  <SettingRow
                    label="Compact Top Bar"
                    subtitle={compactTopBar ? 'Enabled' : 'Disabled'}
                    tooltip="Reduces the vertical height of the title and menu bar for more download list area."
                  >
                    <Switch checked={compactTopBar} onCheckedChange={setCompactTopBar} />
                  </SettingRow>

                  <SettingRow
                    label="Show Icon Labels"
                    subtitle={showIconLabels ? 'Enabled' : 'Disabled'}
                    tooltip="Displays text labels beneath toolbar action icons for easier discovery."
                  >
                    <Switch checked={showIconLabels} onCheckedChange={setShowIconLabels} />
                  </SettingRow>

                  <SettingRow
                    label="Use relative date/time"
                    subtitle={useRelativeDateTime ? 'Enabled' : 'Disabled'}
                    tooltip="Formats dates as relative timestamps (e.g. '2 hours ago') instead of absolute timestamps."
                  >
                    <Switch checked={useRelativeDateTime} onCheckedChange={setUseRelativeDateTime} />
                  </SettingRow>

                  <SettingRow
                    label="Show End Time / Completed Date"
                    subtitle={showEndTime ? 'Enabled' : 'Disabled'}
                    tooltip="Displays estimated completion time for active downloads and finish date for completed items."
                  >
                    <Switch checked={showEndTime} onCheckedChange={setShowEndTime} />
                  </SettingRow>

                  <SettingRow
                    label="Start On Boot"
                    subtitle={startOnBoot ? 'Enabled' : 'Disabled'}
                    tooltip="Automatically launches Thunder Download Manager minimized when your computer starts."
                  >
                    <Switch checked={startOnBoot} onCheckedChange={setStartOnBoot} />
                  </SettingRow>

                  <SettingRow
                    label="Minimize to System Tray"
                    subtitle={useSystemTray ? 'Enabled' : 'Disabled'}
                    tooltip="Keeps Thunder Download Manager running in the background notification area when closed."
                  >
                    <Switch checked={useSystemTray} onCheckedChange={setUseSystemTray} />
                  </SettingRow>

                  <SettingRow
                    label="Show Real-Time Progress Window"
                    subtitle={showProgressDialog ? 'Enabled' : 'Disabled'}
                    tooltip="Pops up a dedicated real-time progress monitor window when a new download starts."
                  >
                    <Switch checked={showProgressDialog} onCheckedChange={setShowProgressDialog} />
                  </SettingRow>

                  <SettingRow
                    label="Show Completion Window"
                    subtitle={showCompletionDialog ? 'Enabled' : 'Disabled'}
                    tooltip="Displays a completion notification dialog when a download finishes successfully."
                  >
                    <Switch checked={showCompletionDialog} onCheckedChange={setShowCompletionDialog} />
                  </SettingRow>

                  <SettingRow
                    label="Show Average Speed"
                    subtitle={showAverageSpeed ? 'Enabled' : 'Disabled'}
                    tooltip="Calculates and displays the average transfer speed alongside instantaneous speed."
                  >
                    <Switch checked={showAverageSpeed} onCheckedChange={setShowAverageSpeed} />
                  </SettingRow>
                </div>

                {/* Units & Formatting Card */}
                <div className="rounded-xl border border-border/70 bg-card/60 shadow-xs overflow-hidden divide-y divide-border/40">
                  <SettingRow
                    label="Download Size Units"
                    subtitle={downloadSizeUnit}
                    tooltip="Choose whether file sizes are displayed in decimal (KB/MB/GB) or binary (KiB/MiB/GiB) units."
                  >
                    <Select value={downloadSizeUnit} onValueChange={(val: any) => setDownloadSizeUnit(val)}>
                      <SelectTrigger className="h-8.5 w-44 text-xs font-medium bg-card border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Automatic">Automatic (KB / MB / GB)</SelectItem>
                        <SelectItem value="KB">KB (Kilobytes - 1000 Bytes)</SelectItem>
                        <SelectItem value="KiB">KiB (Kibibytes - 1024 Bytes)</SelectItem>
                        <SelectItem value="MiB">MiB (Mebibytes)</SelectItem>
                        <SelectItem value="GiB">GiB (Gibibytes)</SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingRow>

                  <SettingRow
                    label="Download Speed Units"
                    subtitle={downloadSpeedUnit}
                    tooltip="Format bandwidth speeds using binary (KiB/s = 1024 B/s) or decimal (KB/s = 1000 B/s)."
                  >
                    <Select value={downloadSpeedUnit} onValueChange={(val: any) => setDownloadSpeedUnit(val)}>
                      <SelectTrigger className="h-8.5 w-44 text-xs font-medium bg-card border-border">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="KiB/s (1024 Bytes/s)">KiB/s (1024 Bytes/s - Binary)</SelectItem>
                        <SelectItem value="KB/s (1000 Bytes/s)">KB/s (1000 Bytes/s - Decimal)</SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingRow>
                </div>
              </div>
            )}

            {/* ================= ENGINE TAB ================= */}
            {activeTab === 'engine' && (
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
                      <Button variant="outline" size="sm" onClick={handlePickDownloadFolder} className="h-8.5 gap-1.5 shrink-0 text-xs">
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
                    subtitle={globalSpeedLimiter ? `Throttled to ${globalSpeedLimitVal} ${globalSpeedLimitUnit}` : 'Disabled (Unlimited speed)'}
                    tooltip="Restricts the aggregated bandwidth used across all simultaneous downloads."
                  >
                    <div className="flex items-center gap-2">
                      {globalSpeedLimiter && (
                        <div className="flex items-center gap-1.5 animate-in fade-in duration-150">
                          <Input
                            type="number"
                            min="1"
                            value={globalSpeedLimitVal}
                            onChange={(e) => setGlobalSpeedLimitVal(Math.max(1, parseInt(e.target.value) || 1))}
                            className="h-8.5 w-20 text-xs text-center font-mono tabular-nums bg-card border-border"
                          />
                          <Select value={globalSpeedLimitUnit} onValueChange={(v: any) => setGlobalSpeedLimitUnit(v)}>
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
                      if (proxyConfig.mode === 'pac') return `Proxy Auto Configuration (${proxyConfig.pacUrl || 'PAC Script'})`;
                      if (proxyConfig.mode === 'manual') return `${proxyConfig.proxyType} Proxy: ${proxyConfig.host}:${proxyConfig.port}`;
                      return 'No Proxy';
                    })()}
                    tooltip="Route network traffic through a custom HTTP, SOCKS5 proxy server or PAC script."
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsProxyModalOpen(true)}
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
                    <Switch checked={useServersLastModified} onCheckedChange={setUseServersLastModified} />
                  </SettingRow>

                  <SettingRow
                    label="Ignore SSL Certificate Errors"
                    subtitle={ignoreSsl ? 'Enabled (Warning: insecure)' : 'Disabled (Strict verification)'}
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
                    <Switch checked={appendExtensionToIncomplete} onCheckedChange={setAppendExtensionToIncomplete} />
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
                    <Switch checked={deletePartialOnFileCancel} onCheckedChange={setDeletePartialOnFileCancel} />
                  </SettingRow>
                </div>
              </div>
            )}

            {/* ================= BROWSER INTEGRATION TAB ================= */}
            {activeTab === 'browser' && (
              <div className="space-y-5 animate-in fade-in-50 duration-150">
                <div className="rounded-xl border border-border/70 bg-card/60 shadow-xs overflow-hidden divide-y divide-border/40">
                  <SettingRow
                    label="Browser Integration Bridge"
                    subtitle={browserIntegration ? 'Enabled (IPC server active)' : 'Disabled'}
                    tooltip="Enables the local background IPC server to intercept downloads from web browser extensions."
                  >
                    <Switch checked={browserIntegration} onCheckedChange={setBrowserIntegration} />
                  </SettingRow>

                  <SettingRow
                    label="IPC Server Port"
                    subtitle={`App is running on port ${port || '37555'}`}
                    tooltip="Local TCP port used to communicate with the ThunderDM Chrome/Firefox extension."
                  >
                    <Input
                      type="number"
                      min={1024}
                      max={65535}
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      className="h-8.5 w-28 text-xs font-mono text-center tabular-nums bg-card border-border"
                      placeholder="37555"
                    />
                  </SettingRow>
                </div>

                {/* Available Browser Extensions */}
                <div className="space-y-3">
                  <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
                    Available Browser Extensions
                  </Label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-4 rounded-xl border border-border/70 bg-card/60 flex flex-col items-center text-center space-y-2.5 transition-all hover:border-primary/50">
                      <img src="/browsers/chrome.svg" alt="Chrome" className="w-8 h-8 object-contain" />
                      <div>
                        <p className="font-semibold text-xs text-foreground">Google Chrome</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">Chromium & Brave</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] bg-muted/40 font-medium">Universal WebExtension</Badge>
                    </div>

                    <div
                      onClick={() => BrowserOpenURL('https://addons.mozilla.org/en-US/firefox/addon/thunder-download-manager/')}
                      className="p-4 rounded-xl border border-border/70 bg-card/60 flex flex-col items-center text-center space-y-2.5 transition-all hover:border-primary/50 hover:bg-muted/20 cursor-pointer group select-none"
                    >
                      <img src="/browsers/firefox.svg" alt="Firefox" className="w-8 h-8 object-contain transition-transform group-hover:scale-105" />
                      <div>
                        <p className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors flex items-center justify-center gap-1">
                          <span>Mozilla Firefox</span>
                          <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-primary shrink-0" />
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">Gecko Engine</p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-6 text-[10px] px-2.5 rounded-lg text-primary border-primary/30 hover:bg-primary/10 gap-1 font-medium cursor-pointer shadow-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          BrowserOpenURL('https://addons.mozilla.org/en-US/firefox/addon/thunder-download-manager/');
                        }}
                      >
                        <ExternalLink className="w-2.5 h-2.5" />
                        <span>Get Extension</span>
                      </Button>
                    </div>

                    <div className="p-4 rounded-xl border border-border/70 bg-card/60 flex flex-col items-center text-center space-y-2.5 transition-all hover:border-primary/50">
                      <img src="/browsers/edge.svg" alt="Edge" className="w-8 h-8 object-contain" />
                      <div>
                        <p className="font-semibold text-xs text-foreground">Microsoft Edge</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">Edge Addons</p>
                      </div>
                      <Badge variant="outline" className="text-[10px] bg-muted/40 font-medium">Universal WebExtension</Badge>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ================= DANGER ZONE TAB ================= */}
            {activeTab === 'danger' && (
              <div className="space-y-5 animate-in fade-in-50 duration-150">
                {/* Warning Banner */}
                <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 flex items-start gap-3">
                  <div className="p-2 bg-destructive/20 rounded-lg text-destructive shrink-0 mt-0.5">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div className="space-y-1 min-w-0 flex-1">
                    <p className="text-xs font-semibold text-destructive">
                      Irreversible Actions
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Actions in this section can reset your application preferences or permanently delete all download databases and configurations. Please proceed with caution.
                    </p>
                  </div>
                </div>

                {/* Reset Preferences Card */}
                <div className="rounded-xl border border-border/70 bg-card/60 shadow-xs overflow-hidden divide-y divide-border/40">
                  <SettingRow
                    label="Reset Preferences to Default"
                    subtitle="Restore all UI theme, font, speed limits, and engine settings to factory defaults"
                    tooltip="Resets all configurable preferences to default values without deleting download history or files."
                  >
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (window.confirm("Reset all settings and preferences to default values?")) {
                          handleResetAllDefaults();
                        }
                      }}
                      className="h-8.5 text-xs font-medium px-4 border-border hover:bg-muted/40 cursor-pointer"
                    >
                      Reset Preferences
                    </Button>
                  </SettingRow>
                </div>

                {/* Full Data Purge & Wipe Card */}
                <div className="rounded-xl border border-destructive/30 bg-destructive/5 shadow-xs overflow-hidden divide-y divide-destructive/20">
                  <SettingRow
                    label="Purge App Data & Reset"
                    subtitle="Completely wipe all stored settings, database tables, download history, and configurations (~/.thunderdm)"
                    tooltip="Completely wipes ~/.thunderdm data and resets application to initial state."
                  >
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={async () => {
                        if (window.confirm("Are you sure you want to completely purge all ThunderDM settings, database records, and data in ~/.thunderdm? This action cannot be undone.")) {
                          try {
                            await invoke('purge_all_user_data_command');
                            window.location.reload();
                          } catch (err) {
                            console.error("Failed to purge data:", err);
                          }
                        }
                      }}
                      className="h-8.5 text-xs font-medium px-4 shadow-sm cursor-pointer"
                    >
                      Reset & Clean Data
                    </Button>
                  </SettingRow>
                </div>
              </div>
            )}
          </ScrollArea>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-border/70 bg-card/60 flex flex-row items-center justify-end gap-2.5 shrink-0 select-none">
          <Button
            variant="outline"
            size="sm"
            onClick={closeModal}
            className="h-9 px-4 text-xs font-medium border-border hover:bg-card text-foreground cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            className="h-9 px-5 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm active:scale-[0.98] cursor-pointer"
          >
            Save Settings
          </Button>
        </div>

        {/* Proxy configuration modal */}
        <ProxyModal
          isOpen={isProxyModalOpen}
          onClose={() => setIsProxyModalOpen(false)}
          config={proxyConfig}
          onSave={handleProxySave}
        />
      </DialogContent>
    </Dialog>
  );
};

