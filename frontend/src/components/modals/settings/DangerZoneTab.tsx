/**
 * Danger Zone settings tab for SettingsModal (reset preferences to default and full data purge).
 */
import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { invoke } from '../../../utils/tauriBridge';
import { Button } from '../../ui/button';
import { SettingRow } from './SettingRow';

interface DangerZoneTabProps {
  onResetAllDefaults: () => void;
}

export const DangerZoneTab: React.FC<DangerZoneTabProps> = ({ onResetAllDefaults }) => {
  return (
    <div className="space-y-5 animate-in fade-in-50 duration-150">
      {/* Warning Banner */}
      <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 flex items-start gap-3">
        <div className="p-2 bg-destructive/20 rounded-lg text-destructive shrink-0 mt-0.5">
          <AlertTriangle className="w-4 h-4" />
        </div>
        <div className="space-y-1 min-w-0 flex-1">
          <p className="text-xs font-semibold text-destructive">Irreversible Actions</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            Actions in this section can reset your application preferences or permanently delete all
            download databases and configurations. Please proceed with caution.
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
              if (window.confirm('Reset all settings and preferences to default values?')) {
                onResetAllDefaults();
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
              if (
                window.confirm(
                  'Are you sure you want to completely purge all ThunderDM settings, database records, and data in ~/.thunderdm? This action cannot be undone.'
                )
              ) {
                try {
                  await invoke('purge_all_user_data_command');
                  window.location.reload();
                } catch (err) {
                  console.error('Failed to purge data:', err);
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
  );
};
