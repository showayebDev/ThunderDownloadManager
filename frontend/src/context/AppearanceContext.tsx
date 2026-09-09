import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { getTranslation, resolveLanguageCode, SupportedLanguage } from '../utils/i18n';
import { saveToThunderDB, loadFromThunderDB } from '../utils/thunderDB';
import { invoke } from '../utils/tauriBridge';

export type ColorTheme = 'violet' | 'blue' | 'emerald' | 'rose' | 'amber' | 'cyan' | 'zinc' | 'midnight' | 'oled';

export interface AppearanceSettings {
  theme: 'Dark' | 'Light' | 'System';
  colorTheme?: ColorTheme;
  language?: string;
  font: 'Default' | string;
  fontSize?: 'Default' | string;
  uiScale?: string;
  compactTopBar: boolean;
  showIconLabels: boolean;
  useRelativeDateTime: boolean;
  showEndTime: boolean;
  startOnBoot: boolean;
  useSystemTray: boolean;
  downloadSizeUnit: 'KiB' | 'KB' | 'Automatic' | 'MiB' | 'GiB';
  downloadSpeedUnit: 'KiB/s (1024 Bytes/s)' | 'KB/s (1000 Bytes/s)';
  showAverageSpeed: boolean;
  showProgressDialog: boolean;
  showCompletionDialog: boolean;
}

const defaultAppearance: AppearanceSettings = {
  theme: 'System',
  colorTheme: 'zinc',
  language: 'System (English)',
  font: 'Default',
  fontSize: '12',
  uiScale: 'System (100%)',
  compactTopBar: true,
  showIconLabels: true,
  useRelativeDateTime: true,
  showEndTime: true,
  startOnBoot: true,
  useSystemTray: true,
  downloadSizeUnit: 'Automatic',
  downloadSpeedUnit: 'KiB/s (1024 Bytes/s)',
  showAverageSpeed: true,
  showProgressDialog: true,
  showCompletionDialog: true,
};

interface AppearanceContextType {
  appearance: AppearanceSettings;
  updateAppearance: (updates: Partial<AppearanceSettings>) => void;
  saveAppearance: (settings: AppearanceSettings) => void;
  t: (key: string) => string;
  langCode: SupportedLanguage;
}

const AppearanceContext = createContext<AppearanceContextType | undefined>(undefined);

export interface ThemePalette {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  popover: string;
  popoverForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
}

export const THEME_PALETTES: Record<ColorTheme, { dark: ThemePalette; light: ThemePalette }> = {
  violet: {
    dark: {
      background: '#0c0a17',
      foreground: '#f4f2fb',
      card: '#141124',
      cardForeground: '#f4f2fb',
      popover: '#19152e',
      popoverForeground: '#f4f2fb',
      primary: '#8b5cf6',
      primaryForeground: '#ffffff',
      secondary: '#201b3b',
      secondaryForeground: '#f4f2fb',
      muted: '#19152f',
      mutedForeground: '#9d93bf',
      accent: '#271f49',
      accentForeground: '#ffffff',
      destructive: '#f43f5e',
      destructiveForeground: '#ffffff',
      border: '#29214d',
      input: '#29214d',
      ring: 'rgba(139, 92, 246, 0.45)',
    },
    light: {
      background: '#f2f1f8',
      foreground: '#0f172a',
      card: '#ffffff',
      cardForeground: '#0f172a',
      popover: '#ffffff',
      popoverForeground: '#0f172a',
      primary: '#7c3aed',
      primaryForeground: '#ffffff',
      secondary: '#eceaf5',
      secondaryForeground: '#1e293b',
      muted: '#eceaf5',
      mutedForeground: '#64748b',
      accent: '#ede9fe',
      accentForeground: '#0f172a',
      destructive: '#e11d48',
      destructiveForeground: '#ffffff',
      border: '#d8d4e5',
      input: '#d8d4e5',
      ring: 'rgba(124, 58, 237, 0.30)',
    },
  },
  blue: {
    dark: {
      background: '#070d1a',
      foreground: '#f1f5f9',
      card: '#0e182c',
      cardForeground: '#f1f5f9',
      popover: '#13213c',
      popoverForeground: '#f1f5f9',
      primary: '#3b82f6',
      primaryForeground: '#ffffff',
      secondary: '#162746',
      secondaryForeground: '#f1f5f9',
      muted: '#12203a',
      mutedForeground: '#8ea3c4',
      accent: '#1b3058',
      accentForeground: '#ffffff',
      destructive: '#f43f5e',
      destructiveForeground: '#ffffff',
      border: '#1e335b',
      input: '#1e335b',
      ring: 'rgba(59, 130, 246, 0.45)',
    },
    light: {
      background: '#f0f3f8',
      foreground: '#0f172a',
      card: '#ffffff',
      cardForeground: '#0f172a',
      popover: '#ffffff',
      popoverForeground: '#0f172a',
      primary: '#2563eb',
      primaryForeground: '#ffffff',
      secondary: '#e6edf6',
      secondaryForeground: '#1e293b',
      muted: '#e6edf6',
      mutedForeground: '#64748b',
      accent: '#dbeafe',
      accentForeground: '#0f172a',
      destructive: '#e11d48',
      destructiveForeground: '#ffffff',
      border: '#d2dce8',
      input: '#d2dce8',
      ring: 'rgba(37, 99, 235, 0.30)',
    },
  },
  emerald: {
    dark: {
      background: '#06120d',
      foreground: '#f0fdf4',
      card: '#0b1e16',
      cardForeground: '#f0fdf4',
      popover: '#0f281e',
      popoverForeground: '#f0fdf4',
      primary: '#10b981',
      primaryForeground: '#ffffff',
      secondary: '#133527',
      secondaryForeground: '#f0fdf4',
      muted: '#0f291f',
      mutedForeground: '#7fcbb1',
      accent: '#173f2f',
      accentForeground: '#ffffff',
      destructive: '#f43f5e',
      destructiveForeground: '#ffffff',
      border: '#183f30',
      input: '#183f30',
      ring: 'rgba(16, 185, 129, 0.45)',
    },
    light: {
      background: '#f0f5f2',
      foreground: '#0f172a',
      card: '#ffffff',
      cardForeground: '#0f172a',
      popover: '#ffffff',
      popoverForeground: '#0f172a',
      primary: '#059669',
      primaryForeground: '#ffffff',
      secondary: '#e5f0ea',
      secondaryForeground: '#1e293b',
      muted: '#e5f0ea',
      mutedForeground: '#64748b',
      accent: '#d1fae5',
      accentForeground: '#0f172a',
      destructive: '#e11d48',
      destructiveForeground: '#ffffff',
      border: '#d0dfd7',
      input: '#d0dfd7',
      ring: 'rgba(5, 150, 105, 0.30)',
    },
  },
  rose: {
    dark: {
      background: '#14090e',
      foreground: '#fff1f2',
      card: '#1f0f16',
      cardForeground: '#fff1f2',
      popover: '#2a141f',
      popoverForeground: '#fff1f2',
      primary: '#f43f5e',
      primaryForeground: '#ffffff',
      secondary: '#351626',
      secondaryForeground: '#fff1f2',
      muted: '#28111d',
      mutedForeground: '#e58ea0',
      accent: '#3f1a2e',
      accentForeground: '#ffffff',
      destructive: '#f43f5e',
      destructiveForeground: '#ffffff',
      border: '#451e31',
      input: '#451e31',
      ring: 'rgba(244, 63, 94, 0.45)',
    },
    light: {
      background: '#f6f1f3',
      foreground: '#0f172a',
      card: '#ffffff',
      cardForeground: '#0f172a',
      popover: '#ffffff',
      popoverForeground: '#0f172a',
      primary: '#e11d48',
      primaryForeground: '#ffffff',
      secondary: '#f3e6eb',
      secondaryForeground: '#1e293b',
      muted: '#f3e6eb',
      mutedForeground: '#64748b',
      accent: '#ffe4e6',
      accentForeground: '#0f172a',
      destructive: '#e11d48',
      destructiveForeground: '#ffffff',
      border: '#e3d0d8',
      input: '#e3d0d8',
      ring: 'rgba(225, 29, 72, 0.30)',
    },
  },
  amber: {
    dark: {
      background: '#130f07',
      foreground: '#fffbeb',
      card: '#1e170b',
      cardForeground: '#fffbeb',
      popover: '#281f0f',
      popoverForeground: '#fffbeb',
      primary: '#f59e0b',
      primaryForeground: '#ffffff',
      secondary: '#332612',
      secondaryForeground: '#fffbeb',
      muted: '#261d0d',
      mutedForeground: '#dfba6a',
      accent: '#3d2d14',
      accentForeground: '#ffffff',
      destructive: '#f43f5e',
      destructiveForeground: '#ffffff',
      border: '#423218',
      input: '#423218',
      ring: 'rgba(245, 158, 11, 0.45)',
    },
    light: {
      background: '#f6f3ed',
      foreground: '#0f172a',
      card: '#ffffff',
      cardForeground: '#0f172a',
      popover: '#ffffff',
      popoverForeground: '#0f172a',
      primary: '#d97706',
      primaryForeground: '#ffffff',
      secondary: '#f2ece0',
      secondaryForeground: '#1e293b',
      muted: '#f2ece0',
      mutedForeground: '#64748b',
      accent: '#fef3c7',
      accentForeground: '#0f172a',
      destructive: '#e11d48',
      destructiveForeground: '#ffffff',
      border: '#e2d8c7',
      input: '#e2d8c7',
      ring: 'rgba(217, 119, 6, 0.30)',
    },
  },
  cyan: {
    dark: {
      background: '#051115',
      foreground: '#ecfeff',
      card: '#0a1c23',
      cardForeground: '#ecfeff',
      popover: '#0e2630',
      popoverForeground: '#ecfeff',
      primary: '#06b6d4',
      primaryForeground: '#ffffff',
      secondary: '#123340',
      secondaryForeground: '#ecfeff',
      muted: '#0e2731',
      mutedForeground: '#68c4d6',
      accent: '#173e4f',
      accentForeground: '#ffffff',
      destructive: '#f43f5e',
      destructiveForeground: '#ffffff',
      border: '#173e4e',
      input: '#173e4e',
      ring: 'rgba(6, 182, 212, 0.45)',
    },
    light: {
      background: '#f0f5f6',
      foreground: '#0f172a',
      card: '#ffffff',
      cardForeground: '#0f172a',
      popover: '#ffffff',
      popoverForeground: '#0f172a',
      primary: '#0891b2',
      primaryForeground: '#ffffff',
      secondary: '#e4eff2',
      secondaryForeground: '#1e293b',
      muted: '#e4eff2',
      mutedForeground: '#64748b',
      accent: '#cffafe',
      accentForeground: '#0f172a',
      destructive: '#e11d48',
      destructiveForeground: '#ffffff',
      border: '#cee0e5',
      input: '#cee0e5',
      ring: 'rgba(8, 145, 178, 0.30)',
    },
  },
  zinc: {
    dark: {
      background: '#09090b',
      foreground: '#fafafa',
      card: '#121215',
      cardForeground: '#fafafa',
      popover: '#18181c',
      popoverForeground: '#fafafa',
      primary: '#e4e4e7',
      primaryForeground: '#18181b',
      secondary: '#202025',
      secondaryForeground: '#fafafa',
      muted: '#18181c',
      mutedForeground: '#a1a1aa',
      accent: '#27272f',
      accentForeground: '#ffffff',
      destructive: '#f43f5e',
      destructiveForeground: '#ffffff',
      border: '#27272d',
      input: '#27272d',
      ring: 'rgba(228, 228, 231, 0.45)',
    },
    light: {
      background: '#f1f2f4',
      foreground: '#18181b',
      card: '#ffffff',
      cardForeground: '#18181b',
      popover: '#ffffff',
      popoverForeground: '#18181b',
      primary: '#18181b',
      primaryForeground: '#ffffff',
      secondary: '#e5e7eb',
      secondaryForeground: '#18181b',
      muted: '#e5e7eb',
      mutedForeground: '#64748b',
      accent: '#e4e4e7',
      accentForeground: '#18181b',
      destructive: '#e11d48',
      destructiveForeground: '#ffffff',
      border: '#d1d5db',
      input: '#d1d5db',
      ring: 'rgba(24, 24, 27, 0.30)',
    },
  },
  midnight: {
    dark: {
      background: '#040813',
      foreground: '#e2e8f0',
      card: '#081124',
      cardForeground: '#e2e8f0',
      popover: '#0c1832',
      popoverForeground: '#e2e8f0',
      primary: '#38bdf8',
      primaryForeground: '#ffffff',
      secondary: '#102144',
      secondaryForeground: '#e2e8f0',
      muted: '#0c1a35',
      mutedForeground: '#83a1cb',
      accent: '#142953',
      accentForeground: '#ffffff',
      destructive: '#f43f5e',
      destructiveForeground: '#ffffff',
      border: '#152952',
      input: '#152952',
      ring: 'rgba(56, 189, 248, 0.45)',
    },
    light: {
      background: '#eff3f7',
      foreground: '#0f172a',
      card: '#ffffff',
      cardForeground: '#0f172a',
      popover: '#ffffff',
      popoverForeground: '#0f172a',
      primary: '#0284c7',
      primaryForeground: '#ffffff',
      secondary: '#e2ebf4',
      secondaryForeground: '#1e293b',
      muted: '#e2ebf4',
      mutedForeground: '#64748b',
      accent: '#e0f2fe',
      accentForeground: '#0f172a',
      destructive: '#e11d48',
      destructiveForeground: '#ffffff',
      border: '#ccdae7',
      input: '#ccdae7',
      ring: 'rgba(2, 132, 199, 0.30)',
    },
  },
  oled: {
    dark: {
      background: '#000000',
      foreground: '#f4f4f5',
      card: '#08080b',
      cardForeground: '#f4f4f5',
      popover: '#0f0f14',
      popoverForeground: '#f4f4f5',
      primary: '#a855f7',
      primaryForeground: '#ffffff',
      secondary: '#14141d',
      secondaryForeground: '#f4f4f5',
      muted: '#0f0f14',
      mutedForeground: '#a1a1aa',
      accent: '#1a1a26',
      accentForeground: '#ffffff',
      destructive: '#f43f5e',
      destructiveForeground: '#ffffff',
      border: '#20202a',
      input: '#20202a',
      ring: 'rgba(168, 85, 247, 0.45)',
    },
    light: {
      background: '#f2f3f5',
      foreground: '#18181b',
      card: '#ffffff',
      cardForeground: '#18181b',
      popover: '#ffffff',
      popoverForeground: '#18181b',
      primary: '#9333ea',
      primaryForeground: '#ffffff',
      secondary: '#e7e8ec',
      secondaryForeground: '#18181b',
      muted: '#e7e8ec',
      mutedForeground: '#64748b',
      accent: '#f3e8ff',
      accentForeground: '#18181b',
      destructive: '#e11d48',
      destructiveForeground: '#ffffff',
      border: '#d1d4dc',
      input: '#d1d4dc',
      ring: 'rgba(147, 51, 234, 0.30)',
    },
  },
};

export function applyAppDOMStyles(theme?: string, fontSetting?: string, fontSizeSetting?: string, colorTheme?: ColorTheme) {
  const isDefaultFont = !fontSetting || fontSetting === 'Default';
  const fontStack = isDefaultFont
    ? "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    : `"${fontSetting}", system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

  document.documentElement.style.setProperty('--app-font-family', fontStack);
  document.documentElement.style.setProperty('--font-sans', fontStack);
  document.documentElement.style.fontFamily = fontStack;
  document.body.style.fontFamily = fontStack;
  document.documentElement.style.fontSize = '';

  const isDefaultSize = !fontSizeSetting || fontSizeSetting === '12' || fontSizeSetting === 'Default' || fontSizeSetting === 'webkit Default';
  let fontSizeCSS = '';

  if (!isDefaultSize) {
    const num = parseFloat(fontSizeSetting);
    if (!isNaN(num) && num > 0) {
      document.documentElement.style.setProperty('--app-font-size', `${num}px`);
      const scale = num / 12;
      const xs = (12 * scale).toFixed(2);
      const sm = (14 * scale).toFixed(2);
      const base = (16 * scale).toFixed(2);
      const lg = (18 * scale).toFixed(2);
      const xl = (20 * scale).toFixed(2);
      const xl2 = (24 * scale).toFixed(2);

      const p8 = (8 * scale).toFixed(2);
      const p9 = (9 * scale).toFixed(2);
      const p9_5 = (9.5 * scale).toFixed(2);
      const p10 = (10 * scale).toFixed(2);
      const p10_5 = (10.5 * scale).toFixed(2);
      const p11 = (11 * scale).toFixed(2);
      const p11_5 = (11.5 * scale).toFixed(2);
      const p12 = (12 * scale).toFixed(2);
      const p12_5 = (12.5 * scale).toFixed(2);
      const p13 = (13 * scale).toFixed(2);
      const p14 = (14 * scale).toFixed(2);
      const p15 = (15 * scale).toFixed(2);

      fontSizeCSS = `
        :root {
          --app-font-size: ${num}px !important;
          --text-xs: ${xs}px !important;
          --text-sm: ${sm}px !important;
          --text-base: ${base}px !important;
          --text-lg: ${lg}px !important;
          --text-xl: ${xl}px !important;
          --text-2xl: ${xl2}px !important;
        }
        .text-xs, #root .text-xs { font-size: ${xs}px !important; }
        .text-sm, #root .text-sm { font-size: ${sm}px !important; }
        .text-base, #root .text-base { font-size: ${base}px !important; }
        .text-lg, #root .text-lg { font-size: ${lg}px !important; }
        .text-xl, #root .text-xl { font-size: ${xl}px !important; }
        .text-2xl, #root .text-2xl { font-size: ${xl2}px !important; }

        .text-\\[8px\\], #root .text-\\[8px\\] { font-size: ${p8}px !important; }
        .text-\\[9px\\], #root .text-\\[9px\\] { font-size: ${p9}px !important; }
        .text-\\[9\\.5px\\], #root .text-\\[9\\.5px\\] { font-size: ${p9_5}px !important; }
        .text-\\[10px\\], #root .text-\\[10px\\] { font-size: ${p10}px !important; }
        .text-\\[10\\.5px\\], #root .text-\\[10\\.5px\\] { font-size: ${p10_5}px !important; }
        .text-\\[11px\\], #root .text-\\[11px\\] { font-size: ${p11}px !important; }
        .text-\\[11\\.5px\\], #root .text-\\[11\\.5px\\] { font-size: ${p11_5}px !important; }
        .text-\\[12px\\], #root .text-\\[12px\\] { font-size: ${p12}px !important; }
        .text-\\[12\\.5px\\], #root .text-\\[12\\.5px\\] { font-size: ${p12_5}px !important; }
        .text-\\[13px\\], #root .text-\\[13px\\] { font-size: ${p13}px !important; }
        .text-\\[14px\\], #root .text-\\[14px\\] { font-size: ${p14}px !important; }
        .text-\\[15px\\], #root .text-\\[15px\\] { font-size: ${p15}px !important; }
      `;
    }
  } else {
    document.documentElement.style.removeProperty('--app-font-size');
  }

  // Apply Theme Mode (Dark / Light / System)
  const isLight = theme === 'Light' || (theme === 'System' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
  if (isLight) {
    document.documentElement.classList.add('light-mode', 'light');
    document.documentElement.classList.remove('dark');
    document.documentElement.style.colorScheme = 'light';
  } else {
    document.documentElement.classList.remove('light-mode', 'light');
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  }

  // Remove existing theme-* classes and add new one
  const themeClasses = ['theme-violet', 'theme-blue', 'theme-emerald', 'theme-rose', 'theme-amber', 'theme-cyan', 'theme-zinc', 'theme-midnight', 'theme-oled'];
  themeClasses.forEach((cls) => document.documentElement.classList.remove(cls));

  const activeColor: ColorTheme = (colorTheme && THEME_PALETTES[colorTheme]) ? colorTheme : 'zinc';
  document.documentElement.classList.add(`theme-${activeColor}`);

  // Retrieve exact theme palette
  const palette = THEME_PALETTES[activeColor][isLight ? 'light' : 'dark'];

  // Explicitly assign CSS custom variables on :root / document.documentElement for 100% instant reactivity
  document.documentElement.style.setProperty('--background', palette.background);
  document.documentElement.style.setProperty('--foreground', palette.foreground);
  document.documentElement.style.setProperty('--card', palette.card);
  document.documentElement.style.setProperty('--card-foreground', palette.cardForeground);
  document.documentElement.style.setProperty('--popover', palette.popover);
  document.documentElement.style.setProperty('--popover-foreground', palette.popoverForeground);
  document.documentElement.style.setProperty('--primary', palette.primary);
  document.documentElement.style.setProperty('--primary-foreground', palette.primaryForeground);
  document.documentElement.style.setProperty('--secondary', palette.secondary);
  document.documentElement.style.setProperty('--secondary-foreground', palette.secondaryForeground);
  document.documentElement.style.setProperty('--muted', palette.muted);
  document.documentElement.style.setProperty('--muted-foreground', palette.mutedForeground);
  document.documentElement.style.setProperty('--accent', palette.accent);
  document.documentElement.style.setProperty('--accent-foreground', palette.accentForeground);
  document.documentElement.style.setProperty('--destructive', palette.destructive);
  document.documentElement.style.setProperty('--destructive-foreground', palette.destructiveForeground);
  document.documentElement.style.setProperty('--border', palette.border);
  document.documentElement.style.setProperty('--input', palette.input);
  document.documentElement.style.setProperty('--ring', palette.ring);

  // Legacy mappings for full backwards compatibility
  document.documentElement.style.setProperty('--bg-main', palette.background);
  document.documentElement.style.setProperty('--bg-surface', palette.card);
  document.documentElement.style.setProperty('--bg-card', palette.card);
  document.documentElement.style.setProperty('--bg-hover', palette.accent);
  document.documentElement.style.setProperty('--border-color', palette.border);
  document.documentElement.style.setProperty('--accent-purple', palette.primary);

  // Update body background and color directly
  document.body.style.backgroundColor = palette.background;
  document.body.style.color = palette.foreground;

  let styleEl = document.getElementById('thunderdm-dynamic-font') as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'thunderdm-dynamic-font';
    document.head.appendChild(styleEl);
  }

  styleEl.textContent = `
    :root {
      --app-font-family: ${fontStack} !important;
      --font-sans: ${fontStack} !important;
      --background: ${palette.background} !important;
      --foreground: ${palette.foreground} !important;
      --card: ${palette.card} !important;
      --card-foreground: ${palette.cardForeground} !important;
      --popover: ${palette.popover} !important;
      --popover-foreground: ${palette.popoverForeground} !important;
      --primary: ${palette.primary} !important;
      --primary-foreground: ${palette.primaryForeground} !important;
      --secondary: ${palette.secondary} !important;
      --secondary-foreground: ${palette.secondaryForeground} !important;
      --muted: ${palette.muted} !important;
      --muted-foreground: ${palette.mutedForeground} !important;
      --accent: ${palette.accent} !important;
      --accent-foreground: ${palette.accentForeground} !important;
      --destructive: ${palette.destructive} !important;
      --destructive-foreground: ${palette.destructiveForeground} !important;
      --border: ${palette.border} !important;
      --input: ${palette.input} !important;
      --ring: ${palette.ring} !important;
      --bg-main: ${palette.background} !important;
      --bg-surface: ${palette.card} !important;
      --bg-card: ${palette.card} !important;
      --bg-hover: ${palette.accent} !important;
      --border-color: ${palette.border} !important;
      --accent-purple: ${palette.primary} !important;
    }
    html, body, #root,
    #root *:not(.font-preview-item, .font-preview-item *, [data-font-preview], [data-font-preview] *),
    button:not(.font-preview-item, .font-preview-item *, [data-font-preview], [data-font-preview] *),
    input:not(.font-preview-item, .font-preview-item *, [data-font-preview], [data-font-preview] *),
    select:not(.font-preview-item, .font-preview-item *, [data-font-preview], [data-font-preview] *),
    textarea:not(.font-preview-item, .font-preview-item *, [data-font-preview], [data-font-preview] *),
    div:not(.font-preview-item, .font-preview-item *, [data-font-preview], [data-font-preview] *),
    span:not(.font-preview-item, .font-preview-item *, [data-font-preview], [data-font-preview] *),
    p:not(.font-preview-item, .font-preview-item *, [data-font-preview], [data-font-preview] *),
    a:not(.font-preview-item, .font-preview-item *, [data-font-preview], [data-font-preview] *),
    h1, h2, h3, h4, h5, h6, table, th, td,
    label:not(.font-preview-item, .font-preview-item *, [data-font-preview], [data-font-preview] *) {
      font-family: ${fontStack} !important;
    }
    .font-preview-item,
    .font-preview-item *,
    [data-font-preview],
    [data-font-preview] * {
      font-family: var(--font-preview-family, ${fontStack}) !important;
    }
    code, kbd, samp, pre, .markdown-content code, .markdown-content pre, .markdown-content pre code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
    }
    ${fontSizeCSS}
  `;

  document.documentElement.style.zoom = '1.0';
}

export const AppearanceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [appearance, setAppearance] = useState<AppearanceSettings>(defaultAppearance);
  const appearanceRef = React.useRef<AppearanceSettings>(defaultAppearance);

  useEffect(() => {
    appearanceRef.current = appearance;
  }, [appearance]);

  const langCode = useMemo(() => resolveLanguageCode(appearance.language || 'en'), [appearance.language]);

  const t = useCallback((key: string) => {
    return getTranslation(key, appearance.language || 'en');
  }, [appearance.language]);

  const applyDOMStyles = useCallback((theme?: string, fontSetting?: string, fontSizeSetting?: string, colorTheme?: ColorTheme) => {
    applyAppDOMStyles(theme || appearanceRef.current.theme, fontSetting || appearanceRef.current.font, fontSizeSetting || appearanceRef.current.fontSize, colorTheme || appearanceRef.current.colorTheme);
  }, []);

  // Synchronize on changes
  useEffect(() => {
    applyAppDOMStyles(appearance.theme, appearance.font, appearance.fontSize, appearance.colorTheme);
  }, [appearance.theme, appearance.font, appearance.fontSize, appearance.colorTheme]);

  // Restore persisted preferences
  useEffect(() => {
    loadFromThunderDB<AppearanceSettings>('appearance', defaultAppearance).then(async (loaded) => {
      const merged: AppearanceSettings = { ...defaultAppearance, ...(loaded || {}) };
      appearanceRef.current = merged;
      setAppearance(merged);
      applyAppDOMStyles(merged.theme, merged.font, merged.fontSize, merged.colorTheme);

      // Default startOnBoot is enabled; ensure OS startup registry is enabled
      if (merged.startOnBoot !== false) {
        try {
          const isEnabled = await invoke('is_launch_on_startup_enabled_command');
          if (!isEnabled) {
            await invoke('set_launch_on_startup_command', { enabled: true });
          }
        } catch {}
      }
    }).catch(() => {});
  }, []);

  const updateAppearance = useCallback((updates: Partial<AppearanceSettings>) => {
    setAppearance((prev) => {
      const next = { ...prev, ...updates };
      appearanceRef.current = next;
      saveToThunderDB('appearance', next);
      return next;
    });
  }, []);

  const saveAppearance = useCallback((settings: AppearanceSettings) => {
    appearanceRef.current = settings;
    setAppearance(settings);
    saveToThunderDB('appearance', settings);
    applyDOMStyles(settings.theme, settings.font, settings.fontSize, settings.colorTheme);

    try {
      invoke('set_launch_on_startup_command', { enabled: settings.startOnBoot });
    } catch {}
  }, [applyDOMStyles]);

  return (
    <AppearanceContext.Provider
      value={{
        appearance,
        updateAppearance,
        saveAppearance,
        t,
        langCode,
      }}
    >
      {children}
    </AppearanceContext.Provider>
  );
};

export const useAppearance = (): AppearanceContextType => {
  const ctx = useContext(AppearanceContext);
  if (!ctx) {
    throw new Error('useAppearance must be used within an AppearanceProvider');
  }
  return ctx;
};

