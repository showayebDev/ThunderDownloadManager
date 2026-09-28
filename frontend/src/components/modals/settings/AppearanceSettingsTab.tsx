/**
 * Appearance settings tab for SettingsModal (theme, font, color palette, display toggles, units).
 */
import React from 'react';
import { ColorTheme } from '../../../context/AppearanceContext';
import { FontSelect } from '../../common/FontSelect';
import { Input } from '../../ui/input';
import { Switch } from '../../ui/switch';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../../ui/select';
import { SettingRow, COLOR_THEMES } from './SettingRow';

interface AppearanceSettingsTabProps {
  theme: 'Dark' | 'Light' | 'System';
  onThemeChange: (newTheme: 'Dark' | 'Light' | 'System') => void;
  colorTheme: ColorTheme;
  onColorThemeChange: (newColor: ColorTheme) => void;
  font: string;
  onFontChange: (newFont: string) => void;
  systemFonts: string[];
  fontSize: string;
  onFontSizeChange: (newSize: string) => void;
  compactTopBar: boolean;
  setCompactTopBar: (val: boolean) => void;
  showIconLabels: boolean;
  setShowIconLabels: (val: boolean) => void;
  useRelativeDateTime: boolean;
  setUseRelativeDateTime: (val: boolean) => void;
  showEndTime: boolean;
  setShowEndTime: (val: boolean) => void;
  startOnBoot: boolean;
  setStartOnBoot: (val: boolean) => void;
  useSystemTray: boolean;
  setUseSystemTray: (val: boolean) => void;
  showProgressDialog: boolean;
  setShowProgressDialog: (val: boolean) => void;
  showCompletionDialog: boolean;
  setShowCompletionDialog: (val: boolean) => void;
  showAverageSpeed: boolean;
  setShowAverageSpeed: (val: boolean) => void;
  downloadSizeUnit: 'KiB' | 'KB' | 'Automatic' | 'MiB' | 'GiB';
  setDownloadSizeUnit: (unit: 'KiB' | 'KB' | 'Automatic' | 'MiB' | 'GiB') => void;
  downloadSpeedUnit: 'KiB/s (1024 Bytes/s)' | 'KB/s (1000 Bytes/s)';
  setDownloadSpeedUnit: (unit: 'KiB/s (1024 Bytes/s)' | 'KB/s (1000 Bytes/s)') => void;
}

export const AppearanceSettingsTab: React.FC<AppearanceSettingsTabProps> = ({
  theme,
  onThemeChange,
  colorTheme,
  onColorThemeChange,
  font,
  onFontChange,
  systemFonts,
  fontSize,
  onFontSizeChange,
  compactTopBar,
  setCompactTopBar,
  showIconLabels,
  setShowIconLabels,
  useRelativeDateTime,
  setUseRelativeDateTime,
  showEndTime,
  setShowEndTime,
  startOnBoot,
  setStartOnBoot,
  useSystemTray,
  setUseSystemTray,
  showProgressDialog,
  setShowProgressDialog,
  showCompletionDialog,
  setShowCompletionDialog,
  showAverageSpeed,
  setShowAverageSpeed,
  downloadSizeUnit,
  setDownloadSizeUnit,
  downloadSpeedUnit,
  setDownloadSpeedUnit,
}) => {
  return (
    <div className="space-y-5 animate-in fade-in-50 duration-150">
      {/* Core Theme & Typography Card */}
      <div className="rounded-xl border border-border/70 bg-card/60 shadow-xs overflow-hidden divide-y divide-border/40">
        {/* Theme Mode Selector */}
        <SettingRow
          label="Theme"
          subtitle={theme === 'Dark' ? 'Dark' : theme === 'Light' ? 'Light' : 'System Auto'}
          tooltip="Switch between Dark Mode, Light Mode, or automatic System theme."
        >
          <Select value={theme} onValueChange={(val: any) => onThemeChange(val)}>
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
            onChange={onFontChange}
            className="w-44"
          />
        </SettingRow>

        {/* Color Accent Palette */}
        <SettingRow
          label="Theme Color Palette"
          subtitle={`Active: ${COLOR_THEMES.find((c) => c.id === colorTheme)?.name || 'Violet'}`}
          tooltip="Accent color applied to active states, buttons, switches, and progress indicators."
        >
          <Select
            value={colorTheme}
            onValueChange={(val: any) => {
              if (val) onColorThemeChange(val);
            }}
          >
            <SelectTrigger className="h-8.5 w-44 text-xs font-medium bg-card border-border">
              <div className="flex items-center gap-2 truncate">
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20"
                  style={{
                    backgroundColor:
                      COLOR_THEMES.find((c) => c.id === colorTheme)?.hex || '#8b5cf6',
                  }}
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
              onChange={(e) => onFontSizeChange(e.target.value)}
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
  );
};
