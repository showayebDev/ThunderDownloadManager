/**
 * SettingsModal shell managing appearance, engine, browser integration, and danger zone tabs.
 */
import React, { useState, useEffect } from 'react';
import { Palette, CloudDownload, Globe, X, AlertTriangle } from 'lucide-react';
import { useDownloadContext } from '../../context/DownloadContext';
import {
  useAppearance,
  AppearanceSettings,
  ColorTheme,
  applyAppDOMStyles,
} from '../../context/AppearanceContext';
import { saveToThunderDB, loadFromThunderDB } from '../../utils/thunderDB';
import { invoke } from '../../utils/tauriBridge';
import { ProxyModal, ProxyConfig, defaultProxyConfig } from './ProxyModal';
import { GlobalSettings, VaultItem, CookieBypassRule } from '../../types/download';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { DEFAULT_COOKIE_BYPASS_RULES } from './settings/SettingRow';
import { AppearanceSettingsTab } from './settings/AppearanceSettingsTab';
import { EngineSettingsTab } from './settings/EngineSettingsTab';
import { BrowserIntegrationTab } from './settings/BrowserIntegrationTab';
import { DangerZoneTab } from './settings/DangerZoneTab';

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

  const [activeTab, setActiveTab] = useState<'appearance' | 'engine' | 'browser' | 'danger'>(
    'appearance'
  );

  // Appearance preferences state
  const [theme, setTheme] = useState<'Dark' | 'Light' | 'System'>(appearance.theme || 'System');
  const [colorTheme, setColorTheme] = useState<ColorTheme>(appearance.colorTheme || 'zinc');
  const [font, setFont] = useState<string>(appearance.font || 'Default');
  const [fontSize, setFontSize] = useState<string>(
    appearance.fontSize === 'Default' || !appearance.fontSize ? '12' : appearance.fontSize
  );
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
  const [useRelativeDateTime, setUseRelativeDateTime] = useState(
    appearance.useRelativeDateTime ?? true
  );
  const [showEndTime, setShowEndTime] = useState(
    appearance.showEndTime ?? globalSettings?.showEndTime ?? true
  );
  const [startOnBoot, setStartOnBoot] = useState(appearance.startOnBoot ?? true);

  useEffect(() => {
    setStartOnBoot(appearance.startOnBoot ?? true);
  }, [appearance.startOnBoot]);

  const [useSystemTray, setUseSystemTray] = useState(appearance.useSystemTray ?? true);
  const [downloadSizeUnit, setDownloadSizeUnit] = useState<
    'KiB' | 'KB' | 'Automatic' | 'MiB' | 'GiB'
  >(appearance.downloadSizeUnit || 'Automatic');
  const [downloadSpeedUnit, setDownloadSpeedUnit] = useState<
    'KiB/s (1024 Bytes/s)' | 'KB/s (1000 Bytes/s)'
  >(
    appearance.downloadSpeedUnit === 'KB/s (1000 Bytes/s)'
      ? 'KB/s (1000 Bytes/s)'
      : 'KiB/s (1024 Bytes/s)'
  );
  const [showAverageSpeed, setShowAverageSpeed] = useState(appearance.showAverageSpeed ?? true);
  const [showProgressDialog, setShowProgressDialog] = useState(
    appearance.showProgressDialog ?? true
  );
  const [showCompletionDialog, setShowCompletionDialog] = useState(
    appearance.showCompletionDialog ?? true
  );

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
    if (globalSettings?.useCategoryByDefault !== undefined)
      return Boolean(globalSettings.useCategoryByDefault);
    if (savedSettings?.useCategoryByDefault !== undefined)
      return Boolean(savedSettings.useCategoryByDefault);
    return true;
  });

  React.useEffect(() => {
    if (!downloadPath) {
      invoke<string>('get_default_download_dir')
        .then((dir) => {
          if (dir) setDownloadPath(dir);
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    async function loadEngineSettings() {
      try {
        const engine = await loadFromThunderDB<GlobalSettings>('download_engine', null as any);
        if (engine) {
          if (engine.useCategoryByDefault !== undefined)
            setUseCategoryByDefault(Boolean(engine.useCategoryByDefault));
          else setUseCategoryByDefault(true);
          if (engine.downloadPath) setDownloadPath(engine.downloadPath);
          if (engine.globalSpeedLimiter !== undefined)
            setGlobalSpeedLimiter(Boolean(engine.globalSpeedLimiter));
          if (engine.globalSpeedLimitValue !== undefined)
            setGlobalSpeedLimitVal(engine.globalSpeedLimitValue);
          if (engine.globalSpeedLimitUnit) setGlobalSpeedLimitUnit(engine.globalSpeedLimitUnit);
          if (engine.defaultThreadCount || (engine as any).threadCount)
            setThreadCount(engine.defaultThreadCount || (engine as any).threadCount || 8);
          if (
            engine.maxConcurrentDownloads !== undefined ||
            (engine as any).maxConcurrent !== undefined
          ) {
            const mc =
              engine.maxConcurrentDownloads !== undefined
                ? engine.maxConcurrentDownloads
                : (engine as any).maxConcurrent;
            setMaxConcurrent(Number(mc));
          }
          if (engine.maxRetries !== undefined) setMaxRetries(engine.maxRetries);
          if (engine.dynamicPartCreation !== undefined)
            setDynamicPartCreation(Boolean(engine.dynamicPartCreation));
          if (engine.userAgent !== undefined) setUserAgent(engine.userAgent);
          if (engine.ignoreSsl !== undefined) setIgnoreSsl(Boolean(engine.ignoreSsl));
          if (engine.useServersLastModified !== undefined)
            setUseServersLastModified(Boolean(engine.useServersLastModified));
          if (engine.trackDeletedFiles !== undefined)
            setTrackDeletedFiles(Boolean(engine.trackDeletedFiles));
          if (engine.appendExtensionToIncomplete !== undefined)
            setAppendExtensionToIncomplete(Boolean(engine.appendExtensionToIncomplete));
          if (engine.deletePartialOnFileCancel !== undefined)
            setDeletePartialOnFileCancel(Boolean(engine.deletePartialOnFileCancel));
          if (engine.sparseFileAllocation !== undefined)
            setSparseFileAllocation(Boolean(engine.sparseFileAllocation));
          if (engine.browserIntegration !== undefined)
            setBrowserIntegration(Boolean(engine.browserIntegration));
          if (engine.port) setPort(engine.port);
          if (Array.isArray(engine.vaultItems)) setVaultItems(engine.vaultItems);
          if (engine.proxyConfig) setProxyConfig(engine.proxyConfig);
          if (Array.isArray(engine.cookieBypassRules) && engine.cookieBypassRules.length > 0) {
            setCookieBypassRules(engine.cookieBypassRules);
          } else if (
            Array.isArray(engine.cookieBypassDomains) &&
            engine.cookieBypassDomains.length > 0
          ) {
            setCookieBypassRules(
              engine.cookieBypassDomains.map((d: string) => ({
                domain: d,
                http: true,
                ytdlp: true,
                hls: true,
              }))
            );
          }
        }
      } catch (err) {
        console.error('Failed to load engine settings in SettingsModal:', err);
      }
    }
    loadEngineSettings();

    invoke<string>('get_server_port_command')
      .then((p) => {
        if (p) setPort(p);
      })
      .catch(() => {});
  }, []);

  const [globalSpeedLimiter, setGlobalSpeedLimiter] = useState(
    globalSettings.globalSpeedLimiter !== undefined
      ? globalSettings.globalSpeedLimiter
      : savedSettings.globalSpeedLimiter ?? false
  );
  const [globalSpeedLimitVal, setGlobalSpeedLimitVal] = useState<number>(() => {
    if (globalSettings.globalSpeedLimitValue !== undefined)
      return globalSettings.globalSpeedLimitValue;
    if (savedSettings.globalSpeedLimitValue !== undefined)
      return savedSettings.globalSpeedLimitValue;
    return 2;
  });
  const [globalSpeedLimitUnit, setGlobalSpeedLimitUnit] = useState<'KB/s' | 'MB/s'>(() => {
    if (globalSettings.globalSpeedLimitUnit) return globalSettings.globalSpeedLimitUnit;
    if (savedSettings.globalSpeedLimitUnit) return savedSettings.globalSpeedLimitUnit;
    return 'MB/s';
  });

  const [threadCount, setThreadCount] = useState(
    (savedSettings as any).threadCount ||
      savedSettings.defaultThreadCount ||
      globalSettings.defaultThreadCount ||
      8
  );
  const [maxConcurrent, setMaxConcurrent] = useState<number>(() => {
    if (globalSettings.maxConcurrentDownloads !== undefined)
      return Number(globalSettings.maxConcurrentDownloads);
    if (savedSettings.maxConcurrentDownloads !== undefined)
      return Number(savedSettings.maxConcurrentDownloads);
    return 0;
  });
  const [maxRetries, setMaxRetries] = useState(savedSettings.maxRetries || 3);
  const [dynamicPartCreation, setDynamicPartCreation] = useState(
    globalSettings.dynamicPartCreation !== undefined
      ? globalSettings.dynamicPartCreation
      : savedSettings.dynamicPartCreation ?? true
  );

  const [userAgent, setUserAgent] = useState(
    savedSettings.userAgent || globalSettings.userAgent || ''
  );
  const [ignoreSsl, setIgnoreSsl] = useState(
    globalSettings.ignoreSsl !== undefined
      ? globalSettings.ignoreSsl
      : savedSettings.ignoreSsl ?? false
  );
  const [useServersLastModified, setUseServersLastModified] = useState(
    globalSettings.useServersLastModified !== undefined
      ? globalSettings.useServersLastModified
      : savedSettings.useServersLastModified ?? false
  );
  const [trackDeletedFiles, setTrackDeletedFiles] = useState(
    globalSettings.trackDeletedFiles !== undefined
      ? globalSettings.trackDeletedFiles
      : savedSettings.trackDeletedFiles ?? true
  );
  const [appendExtensionToIncomplete, setAppendExtensionToIncomplete] = useState(
    globalSettings.appendExtensionToIncomplete !== undefined
      ? globalSettings.appendExtensionToIncomplete
      : savedSettings.appendExtensionToIncomplete ?? true
  );
  const [deletePartialOnFileCancel, setDeletePartialOnFileCancel] = useState(
    globalSettings.deletePartialOnFileCancel !== undefined
      ? globalSettings.deletePartialOnFileCancel
      : savedSettings.deletePartialOnFileCancel ?? false
  );
  const [sparseFileAllocation, setSparseFileAllocation] = useState(
    globalSettings.sparseFileAllocation !== undefined
      ? globalSettings.sparseFileAllocation
      : savedSettings.sparseFileAllocation ?? true
  );

  const savedProxy =
    savedSettings.proxyConfig ||
    (savedSettings.proxyEnabled
      ? {
          ...defaultProxyConfig,
          mode: 'manual' as const,
          host: savedSettings.proxyHost || '',
          port: savedSettings.proxyPort || '',
        }
      : defaultProxyConfig);

  const [proxyConfig, setProxyConfig] = useState<ProxyConfig>(savedProxy);
  const [isProxyModalOpen, setIsProxyModalOpen] = useState<boolean>(false);
  const [vaultItems, setVaultItems] = useState<VaultItem[]>(savedSettings.vaultItems || []);
  const [browserIntegration, setBrowserIntegration] = useState(
    savedSettings.browserIntegration ?? true
  );
  const [port, setPort] = useState(savedSettings.port || '37555');

  const [cookieBypassRules, setCookieBypassRules] = useState<CookieBypassRule[]>(() => {
    if (
      Array.isArray(globalSettings?.cookieBypassRules) &&
      globalSettings.cookieBypassRules.length > 0
    ) {
      return globalSettings.cookieBypassRules;
    }
    if (
      Array.isArray(savedSettings?.cookieBypassRules) &&
      savedSettings.cookieBypassRules.length > 0
    ) {
      return savedSettings.cookieBypassRules;
    }
    return DEFAULT_COOKIE_BYPASS_RULES;
  });

  const handleProxySave = (newConfig: ProxyConfig) => {
    setProxyConfig(newConfig);
    try {
      invoke('set_proxy_config_command', newConfig);
    } catch {}
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

    const calculatedGlobalSpeedLimit =
      globalSpeedLimiter && globalSpeedLimitVal > 0
        ? globalSpeedLimitUnit === 'MB/s'
          ? Math.round(globalSpeedLimitVal * 1024 * 1024)
          : Math.round(globalSpeedLimitVal * 1024)
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
      cookieBypassRules,
      cookieBypassDomains: cookieBypassRules.map((r) => r.domain),
    };

    isSavedRef.current = true;
    saveAppearance(appearanceData);
    saveToThunderDB('download_engine', combinedSettings, true);

    try {
      invoke('set_proxy_config_command', proxyConfig);
    } catch {}
    try {
      invoke('set_launch_on_startup_command', { enabled: startOnBoot });
    } catch {}
    try {
      invoke('set_server_port_command', { port });
    } catch {}
    try {
      invoke('set_browser_integration_command', { enabled: browserIntegration });
    } catch {}

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
    setCookieBypassRules(DEFAULT_COOKIE_BYPASS_RULES);
  };

  const TABS = [
    { id: 'appearance', label: 'Appearance', icon: Palette },
    { id: 'engine', label: 'Download Engine', icon: CloudDownload },
    { id: 'browser', label: 'Browser Integration', icon: Globe },
    { id: 'danger', label: 'Danger Zone', icon: AlertTriangle },
  ] as const;

  return (
    <Dialog open={true} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent
        showCloseButton={false}
        className="max-w-3xl sm:max-w-4xl w-full h-[88vh] max-h-[720px] p-0 gap-0 overflow-hidden flex flex-col bg-background border border-border/80 rounded-2xl shadow-2xl"
      >
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
                  className={`relative flex items-center w-full px-3 py-2.5 rounded-lg text-xs font-medium transition-all text-left group cursor-pointer ${
                    isActive
                      ? isDanger
                        ? 'bg-destructive/10 text-destructive font-semibold shadow-xs border border-destructive/30'
                        : 'bg-card text-foreground font-semibold shadow-xs border border-border/60'
                      : isDanger
                      ? 'text-destructive/80 hover:text-destructive hover:bg-destructive/10'
                      : 'text-muted-foreground hover:text-foreground hover:bg-card/40'
                  }`}
                >
                  {isActive && (
                    <span
                      className={`absolute left-1.5 top-1/2 -translate-y-1/2 w-1 h-4 rounded-full ${
                        isDanger ? 'bg-destructive' : 'bg-primary'
                      }`}
                    />
                  )}
                  <Icon
                    className={`w-4 h-4 mr-2.5 shrink-0 transition-colors ${
                      isActive
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
            {activeTab === 'appearance' && (
              <AppearanceSettingsTab
                theme={theme}
                onThemeChange={handleThemeChange}
                colorTheme={colorTheme}
                onColorThemeChange={handleColorThemeChange}
                font={font}
                onFontChange={handleFontChange}
                systemFonts={systemFonts}
                fontSize={fontSize}
                onFontSizeChange={handleFontSizeChange}
                compactTopBar={compactTopBar}
                setCompactTopBar={setCompactTopBar}
                showIconLabels={showIconLabels}
                setShowIconLabels={setShowIconLabels}
                useRelativeDateTime={useRelativeDateTime}
                setUseRelativeDateTime={setUseRelativeDateTime}
                showEndTime={showEndTime}
                setShowEndTime={setShowEndTime}
                startOnBoot={startOnBoot}
                setStartOnBoot={setStartOnBoot}
                useSystemTray={useSystemTray}
                setUseSystemTray={setUseSystemTray}
                showProgressDialog={showProgressDialog}
                setShowProgressDialog={setShowProgressDialog}
                showCompletionDialog={showCompletionDialog}
                setShowCompletionDialog={setShowCompletionDialog}
                showAverageSpeed={showAverageSpeed}
                setShowAverageSpeed={setShowAverageSpeed}
                downloadSizeUnit={downloadSizeUnit}
                setDownloadSizeUnit={setDownloadSizeUnit}
                downloadSpeedUnit={downloadSpeedUnit}
                setDownloadSpeedUnit={setDownloadSpeedUnit}
              />
            )}

            {activeTab === 'engine' && (
              <EngineSettingsTab
                downloadPath={downloadPath}
                setDownloadPath={setDownloadPath}
                onPickDownloadFolder={handlePickDownloadFolder}
                useCategoryByDefault={useCategoryByDefault}
                setUseCategoryByDefault={setUseCategoryByDefault}
                threadCount={threadCount}
                setThreadCount={setThreadCount}
                maxConcurrent={maxConcurrent}
                setMaxConcurrent={setMaxConcurrent}
                maxRetries={maxRetries}
                setMaxRetries={setMaxRetries}
                dynamicPartCreation={dynamicPartCreation}
                setDynamicPartCreation={setDynamicPartCreation}
                globalSpeedLimiter={globalSpeedLimiter}
                setGlobalSpeedLimiter={setGlobalSpeedLimiter}
                globalSpeedLimitVal={globalSpeedLimitVal}
                setGlobalSpeedLimitVal={setGlobalSpeedLimitVal}
                globalSpeedLimitUnit={globalSpeedLimitUnit}
                setGlobalSpeedLimitUnit={setGlobalSpeedLimitUnit}
                proxyConfig={proxyConfig}
                onOpenProxyModal={() => setIsProxyModalOpen(true)}
                userAgent={userAgent}
                setUserAgent={setUserAgent}
                useServersLastModified={useServersLastModified}
                setUseServersLastModified={setUseServersLastModified}
                ignoreSsl={ignoreSsl}
                setIgnoreSsl={setIgnoreSsl}
                sparseFileAllocation={sparseFileAllocation}
                setSparseFileAllocation={setSparseFileAllocation}
                appendExtensionToIncomplete={appendExtensionToIncomplete}
                setAppendExtensionToIncomplete={setAppendExtensionToIncomplete}
                trackDeletedFiles={trackDeletedFiles}
                setTrackDeletedFiles={setTrackDeletedFiles}
                deletePartialOnFileCancel={deletePartialOnFileCancel}
                setDeletePartialOnFileCancel={setDeletePartialOnFileCancel}
                cookieBypassRules={cookieBypassRules}
                setCookieBypassRules={setCookieBypassRules}
              />
            )}

            {activeTab === 'browser' && (
              <BrowserIntegrationTab
                browserIntegration={browserIntegration}
                setBrowserIntegration={setBrowserIntegration}
                port={port}
                setPort={setPort}
              />
            )}

            {activeTab === 'danger' && (
              <DangerZoneTab onResetAllDefaults={handleResetAllDefaults} />
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
