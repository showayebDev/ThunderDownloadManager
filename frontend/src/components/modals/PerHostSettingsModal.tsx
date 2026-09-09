import React, { useState, useEffect, useRef } from 'react';
import { Search, Plus, Trash2, Check, Globe, X } from 'lucide-react';
import { useDownloadContext } from '../../context/DownloadContext';
import { VaultItem } from '../../types/download';
import { HelpTooltip } from '../common/Tooltip';
import { saveToThunderDB } from '../../utils/thunderDB';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

interface PerHostSettingsModalProps {
  onClose: () => void;
}

interface LocalHostEntry {
  id: string;
  host: string;
  user: string;
  pass: string;
  speedLimitEnabled: boolean;
  speedLimitVal: number;
  speedLimitUnit: 'KB/s' | 'MB/s';
  threadCount: number;
  userAgent: string;
}

export const PerHostSettingsModal: React.FC<PerHostSettingsModalProps> = ({ onClose }) => {
  const { globalSettings, updateGlobalSettings } = useDownloadContext();

  // Convert vaultItems to LocalHostEntry array
  const [entries, setEntries] = useState<LocalHostEntry[]>(() => {
    const rawItems: VaultItem[] = globalSettings?.vaultItems || [];
    return rawItems.map((item, index) => {
      const spLimit = item.speedLimit || 0;
      let spEnabled = spLimit > 0;
      let spVal = 2;
      let spUnit: 'KB/s' | 'MB/s' = 'MB/s';

      if (spLimit > 0) {
        if (spLimit >= 1024 * 1024) {
          spUnit = 'MB/s';
          spVal = Math.round(spLimit / (1024 * 1024));
        } else {
          spUnit = 'KB/s';
          spVal = Math.round(spLimit / 1024);
        }
      } else if (item.speedLimitValue) {
        spVal = item.speedLimitValue;
        spUnit = item.speedLimitUnit || 'MB/s';
      }

      return {
        id: `host-${index}-${Date.now()}`,
        host: item.host || '',
        user: item.user || '',
        pass: item.pass || '',
        speedLimitEnabled: spEnabled,
        speedLimitVal: spVal,
        speedLimitUnit: spUnit,
        threadCount: item.threadCount || 0,
        userAgent: item.userAgent || '',
      };
    });
  });

  const [selectedId, setSelectedId] = useState<string | null>(() => {
    return globalSettings?.vaultItems && globalSettings.vaultItems.length > 0 ? `host-0` : null;
  });

  // Keep first item selected if none selected and items exist
  useEffect(() => {
    if (entries.length > 0 && !selectedId) {
      setSelectedId(entries[0].id);
    } else if (entries.length === 0) {
      setSelectedId(null);
    }
  }, [entries.length, selectedId]);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const hostInputRef = useRef<HTMLInputElement>(null);

  const filteredEntries = entries.filter((e) =>
    e.host.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedEntry = entries.find((e) => e.id === selectedId) || null;

  const handleSelect = (id: string) => {
    setSelectedId(id);
  };

  const handleAddNew = () => {
    const newId = `host-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newEntry: LocalHostEntry = {
      id: newId,
      host: '',
      user: '',
      pass: '',
      speedLimitEnabled: false,
      speedLimitVal: 2,
      speedLimitUnit: 'MB/s',
      threadCount: 0,
      userAgent: '',
    };
    setEntries((prev) => [...prev, newEntry]);
    setSelectedId(newId);
    setTimeout(() => {
      hostInputRef.current?.focus();
    }, 50);
  };

  const handleDeleteSelected = () => {
    if (!selectedId) return;
    const remaining = entries.filter((e) => e.id !== selectedId);
    setEntries(remaining);
    if (remaining.length > 0) {
      setSelectedId(remaining[0].id);
    } else {
      setSelectedId(null);
    }
  };

  const updateSelected = (updates: Partial<LocalHostEntry>) => {
    if (!selectedId) return;
    setEntries((prev) =>
      prev.map((e) => (e.id === selectedId ? { ...e, ...updates } : e))
    );
  };

  const handleSave = () => {
    const finalVaultItems: VaultItem[] = entries
      .filter((e) => e.host.trim() !== '')
      .map((e) => {
        let calculatedLimit: number = 0;
        if (e.speedLimitEnabled && e.speedLimitVal > 0) {
          calculatedLimit =
            e.speedLimitUnit === 'MB/s'
              ? Math.round(e.speedLimitVal * 1024 * 1024)
              : Math.round(e.speedLimitVal * 1024);
        }

        return {
          host: e.host.trim(),
          user: e.user.trim(),
          pass: e.pass,
          speedLimit: calculatedLimit,
          speedLimitValue: e.speedLimitVal,
          speedLimitUnit: e.speedLimitUnit,
          threadCount: e.threadCount || 0,
          userAgent: e.userAgent.trim(),
        };
      });

    const updatedSettings = {
      ...globalSettings,
      vaultItems: finalVaultItems,
    };

    updateGlobalSettings(updatedSettings);
    saveToThunderDB('download_engine', updatedSettings);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-3xl w-full h-[80vh] max-h-[640px] p-0 gap-0 overflow-hidden flex flex-col bg-background border border-border/80 rounded-2xl shadow-2xl">
        {/* Title Bar */}
        <div className="flex flex-row items-center justify-between px-5 py-3.5 border-b border-border/70 bg-card/60 shrink-0 select-none">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold text-foreground tracking-tight">
                Per Host Settings
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Site credentials vault, thread overrides, and bandwidth limits
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-red-500 hover:text-white dark:hover:bg-red-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Content Body */}
        <div className="flex-1 flex overflow-hidden p-4 gap-4">
          {/* Left Column: Host List & Controls */}
          <div className="w-60 bg-muted/30 border border-border rounded-xl flex flex-col overflow-hidden shrink-0 shadow-inner">
            {/* Host List Area */}
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1 custom-scrollbar">
              {filteredEntries.length === 0 ? (
                <div className="h-full flex items-center justify-center p-4 text-center">
                  <span className="text-muted-foreground text-xs italic">
                    {entries.length === 0 ? 'List is empty' : 'No match found'}
                  </span>
                </div>
              ) : (
                filteredEntries.map((item) => {
                  const isSelected = item.id === selectedId;
                  const label = item.host.trim() || '<New Host>';

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelect(item.id)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center justify-between cursor-pointer ${
                        isSelected
                          ? 'bg-primary/15 text-primary font-semibold border-l-[3px] border-primary pl-2.5 shadow-xs'
                          : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground'
                      }`}
                    >
                      <span className="truncate pr-1">{label}</span>
                    </button>
                  );
                })
              )}
            </div>

            {/* Bottom Search & Action Bar */}
            <div className="p-2 border-t border-border bg-card flex items-center gap-1.5">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                <Input
                  type="text"
                  placeholder="Search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-background border-border pl-7.5 pr-2 py-1 h-7 text-xs placeholder:text-muted-foreground"
                />
              </div>

              {/* Add New Host */}
              <Button
                variant="outline"
                size="icon-xs"
                type="button"
                onClick={handleAddNew}
                className="h-7 w-7 shrink-0"
                title="Add New Host"
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>

              {/* Delete Host */}
              <Button
                variant="outline"
                size="icon-xs"
                type="button"
                onClick={handleDeleteSelected}
                disabled={!selectedId}
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive hover:border-destructive/50"
                title="Delete Selected Host"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* Right Column: Host Settings Form */}
          <div className="flex-1 flex flex-col justify-between overflow-hidden">
            {!selectedEntry ? (
              <div className="h-full flex items-center justify-center p-6 text-center">
                <span className="text-muted-foreground text-xs italic">
                  Create or select a host item first
                </span>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 text-xs custom-scrollbar">
                {/* Host Field */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center space-x-1.5">
                    <Label className="font-semibold text-foreground text-xs">Host</Label>
                    <HelpTooltip description="Domain name or host IP address (e.g. rapidgator.net, drive.google.com, localhost:3000)." />
                  </div>
                  <Input
                    ref={hostInputRef}
                    type="text"
                    placeholder="e.g. example.com"
                    value={selectedEntry.host}
                    onChange={(e) => updateSelected({ host: e.target.value })}
                    className="w-56 bg-background border-border text-foreground text-xs font-mono h-8"
                  />
                </div>

                {/* Speed Limit Field */}
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center space-x-1.5">
                      <Label className="font-semibold text-foreground text-xs">Speed Limit</Label>
                      <HelpTooltip description="Set a maximum bandwidth download speed limit for this specific host." />
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {selectedEntry.speedLimitEnabled
                        ? `${selectedEntry.speedLimitVal} ${selectedEntry.speedLimitUnit}`
                        : 'Unlimited'}
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {selectedEntry.speedLimitEnabled && (
                      <div className="flex items-center space-x-1.5 animate-in fade-in duration-100">
                        <Input
                          type="number"
                          min={1}
                          max={9999}
                          value={selectedEntry.speedLimitVal}
                          onChange={(e) =>
                            updateSelected({
                              speedLimitVal: Math.max(1, Number(e.target.value) || 1),
                            })
                          }
                          className="w-20 bg-background border-border text-foreground text-xs text-right font-mono h-8"
                        />
                        <select
                          value={selectedEntry.speedLimitUnit}
                          onChange={(e) =>
                            updateSelected({
                              speedLimitUnit: e.target.value as 'KB/s' | 'MB/s',
                            })
                          }
                          className="bg-background border border-border text-foreground rounded-md px-2 py-1 text-xs outline-none cursor-pointer h-8"
                        >
                          <option value="KB/s">KB/s</option>
                          <option value="MB/s">MB/s</option>
                        </select>
                      </div>
                    )}

                    <Button
                      type="button"
                      variant={selectedEntry.speedLimitEnabled ? 'default' : 'outline'}
                      size="icon-xs"
                      onClick={() =>
                        updateSelected({
                          speedLimitEnabled: !selectedEntry.speedLimitEnabled,
                        })
                      }
                      className="h-8 w-8"
                    >
                      <Check
                        className={`w-3.5 h-3.5 ${
                          selectedEntry.speedLimitEnabled ? 'opacity-100' : 'opacity-0'
                        }`}
                      />
                    </Button>
                  </div>
                </div>

                {/* Thread Count Field */}
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center space-x-1.5">
                      <Label className="font-semibold text-foreground text-xs">Thread Count</Label>
                      <HelpTooltip description="Maximum number of parallel connection threads for downloads from this host (0 = Use Global Settings)." />
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {selectedEntry.threadCount === 0
                        ? `Use Global Settings (${globalSettings?.defaultThreadCount || 8})`
                        : `${selectedEntry.threadCount} Threads`}
                    </div>
                  </div>

                  <div className="flex items-center space-x-1.5">
                    <Input
                      type="number"
                      min={0}
                      max={32}
                      value={selectedEntry.threadCount}
                      onChange={(e) =>
                        updateSelected({
                          threadCount: Math.min(32, Math.max(0, Number(e.target.value) || 0)),
                        })
                      }
                      className="w-20 bg-background border-border text-foreground text-xs text-right font-mono h-8"
                    />
                  </div>
                </div>

                {/* Username Field */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center space-x-1.5">
                    <Label className="font-semibold text-foreground text-xs">Username</Label>
                    <HelpTooltip description="Username for HTTP / FTP basic authentication on this host." />
                  </div>
                  <Input
                    type="text"
                    placeholder="Username"
                    value={selectedEntry.user}
                    onChange={(e) => updateSelected({ user: e.target.value })}
                    className="w-56 bg-background border-border text-foreground text-xs h-8"
                  />
                </div>

                {/* Password Field */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center space-x-1.5">
                    <Label className="font-semibold text-foreground text-xs">Password</Label>
                    <HelpTooltip description="Password for HTTP / FTP basic authentication on this host." />
                  </div>
                  <Input
                    type="password"
                    placeholder="Password"
                    value={selectedEntry.pass}
                    onChange={(e) => updateSelected({ pass: e.target.value })}
                    className="w-56 bg-background border-border text-foreground text-xs h-8"
                  />
                </div>

                {/* Default User-Agent Field */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center space-x-1.5">
                    <Label className="font-semibold text-foreground text-xs">Default User-Agent</Label>
                    <HelpTooltip description="Custom User-Agent header string sent with HTTP requests to this host." />
                  </div>
                  <Input
                    type="text"
                    placeholder="e.g. Mozilla/5.0..."
                    value={selectedEntry.userAgent}
                    onChange={(e) => updateSelected({ userAgent: e.target.value })}
                    className="w-56 bg-background border-border text-foreground text-xs h-8"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom Actions: Update / Cancel */}
        <div className="px-5 py-3.5 border-t border-border/70 bg-card/60 flex flex-row items-center justify-end gap-2.5 shrink-0 select-none">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="rounded-lg px-4 text-xs"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            className="rounded-lg px-5 text-xs shadow-sm"
          >
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
