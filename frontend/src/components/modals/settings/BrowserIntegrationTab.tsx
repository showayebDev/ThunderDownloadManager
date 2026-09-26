/**
 * Browser Integration settings tab for SettingsModal (IPC server bridge, port, browser extension cards).
 */
import React from 'react';
import { ExternalLink } from 'lucide-react';
import { BrowserOpenURL } from '../../../utils/tauriBridge';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { Switch } from '../../ui/switch';
import { Label } from '../../ui/label';
import { SettingRow } from './SettingRow';

interface BrowserIntegrationTabProps {
  browserIntegration: boolean;
  setBrowserIntegration: (val: boolean) => void;
  port: string;
  setPort: (val: string) => void;
}

const CHROME_STORE_URL =
  'https://chromewebstore.google.com/detail/thunder-download-manager/inhdofocnelidaaldldkpoljakofkbpe';
const FIREFOX_ADDON_URL =
  'https://addons.mozilla.org/en-US/firefox/addon/thunder-download-manager/';

export const BrowserIntegrationTab: React.FC<BrowserIntegrationTabProps> = ({
  browserIntegration,
  setBrowserIntegration,
  port,
  setPort,
}) => {
  return (
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
          <div
            onClick={() => BrowserOpenURL(CHROME_STORE_URL)}
            className="p-4 rounded-xl border border-border/70 bg-card/60 flex flex-col items-center text-center space-y-2.5 transition-all hover:border-primary/50 hover:bg-muted/20 cursor-pointer group select-none"
          >
            <img
              src="/browsers/chrome.svg"
              alt="Chrome"
              className="w-8 h-8 object-contain transition-transform group-hover:scale-105"
            />
            <div>
              <p className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors flex items-center justify-center gap-1">
                <span>Google Chrome</span>
                <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-primary shrink-0" />
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Chromium & Brave</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2.5 rounded-lg text-primary border-primary/30 hover:bg-primary/10 gap-1 font-medium cursor-pointer shadow-xs"
              onClick={(e) => {
                e.stopPropagation();
                BrowserOpenURL(CHROME_STORE_URL);
              }}
            >
              <ExternalLink className="w-2.5 h-2.5" />
              <span>Get Extension</span>
            </Button>
          </div>

          <div
            onClick={() => BrowserOpenURL(FIREFOX_ADDON_URL)}
            className="p-4 rounded-xl border border-border/70 bg-card/60 flex flex-col items-center text-center space-y-2.5 transition-all hover:border-primary/50 hover:bg-muted/20 cursor-pointer group select-none"
          >
            <img
              src="/browsers/firefox.svg"
              alt="Firefox"
              className="w-8 h-8 object-contain transition-transform group-hover:scale-105"
            />
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
                BrowserOpenURL(FIREFOX_ADDON_URL);
              }}
            >
              <ExternalLink className="w-2.5 h-2.5" />
              <span>Get Extension</span>
            </Button>
          </div>

          <div
            onClick={() => BrowserOpenURL(CHROME_STORE_URL)}
            className="p-4 rounded-xl border border-border/70 bg-card/60 flex flex-col items-center text-center space-y-2.5 transition-all hover:border-primary/50 hover:bg-muted/20 cursor-pointer group select-none"
          >
            <img
              src="/browsers/edge.svg"
              alt="Edge"
              className="w-8 h-8 object-contain transition-transform group-hover:scale-105"
            />
            <div>
              <p className="font-semibold text-xs text-foreground group-hover:text-primary transition-colors flex items-center justify-center gap-1">
                <span>Microsoft Edge</span>
                <ExternalLink className="w-3 h-3 text-muted-foreground group-hover:text-primary shrink-0" />
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Edge & Chromium</p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2.5 rounded-lg text-primary border-primary/30 hover:bg-primary/10 gap-1 font-medium cursor-pointer shadow-xs"
              onClick={(e) => {
                e.stopPropagation();
                BrowserOpenURL(CHROME_STORE_URL);
              }}
            >
              <ExternalLink className="w-2.5 h-2.5" />
              <span>Get Extension</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
