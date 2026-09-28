/**
 * Shared SettingRow layout component and theme/cookie constants for SettingsModal tabs.
 */
import React from 'react';
import { ColorTheme } from '../../../context/AppearanceContext';
import { CookieBypassRule } from '../../../types/download';
import { HelpTooltip } from '../../common/Tooltip';
import { Label } from '../../ui/label';

export const COLOR_THEMES: { id: ColorTheme; name: string; hex: string }[] = [
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

export const DEFAULT_COOKIE_BYPASS_RULES: CookieBypassRule[] = [
  { domain: 'instagram.com', http: true, ytdlp: true, hls: true },
  { domain: 'tiktok.com', http: true, ytdlp: true, hls: true },
  { domain: 'facebook.com', http: true, ytdlp: true, hls: true },
  { domain: 'threads.net', http: true, ytdlp: true, hls: true },
  { domain: 'fb.watch', http: true, ytdlp: true, hls: true },
  { domain: 'fb.com', http: true, ytdlp: true, hls: true },
  { domain: 'youtube.com', http: false, ytdlp: true, hls: false },
];

export interface SettingRowProps {
  label: string;
  subtitle?: React.ReactNode;
  tooltip?: string;
  children: React.ReactNode;
  className?: string;
}

export const SettingRow: React.FC<SettingRowProps> = ({
  label,
  subtitle,
  tooltip,
  children,
  className = '',
}) => {
  return (
    <div
      className={`flex items-center justify-between py-3.5 px-4 sm:px-5 first:pt-4 last:pb-4 transition-colors hover:bg-muted/15 ${className}`}
    >
      <div className="space-y-0.5 pr-4 min-w-0">
        <div className="flex items-center gap-1.5">
          <Label className="text-[13px] font-semibold text-foreground tracking-tight select-none">
            {label}
          </Label>
          {tooltip && <HelpTooltip description={tooltip} title={label} position="top-left" />}
        </div>
        {subtitle && (
          <p className="text-[11.5px] text-muted-foreground font-normal leading-relaxed truncate">
            {subtitle}
          </p>
        )}
      </div>
      <div className="shrink-0 flex items-center">{children}</div>
    </div>
  );
};
