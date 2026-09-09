import React, { useState, useEffect } from 'react';
import { Copy, Check, Scale, ShieldCheck, Zap, X } from 'lucide-react';
import { BrowserOpenURL, invoke } from '../../utils/tauriBridge';
import { useAppearance } from '../../context/AppearanceContext';
import { useDownloadContext } from '../../context/DownloadContext';
import appLicenseData from '../../data/appLicense.json';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

interface AboutModalProps {
  onClose: () => void;
  appVersion?: string;
}

export const AboutModal: React.FC<AboutModalProps> = ({
  onClose,
  appVersion: initialAppVersion,
}) => {
  const { t } = useAppearance();
  const { openModal } = useDownloadContext();
  const [copied, setCopied] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<string>('about');
  const [version, setVersion] = useState<string>(
    initialAppVersion || (appLicenseData as any).version || '1.0.6'
  );

  useEffect(() => {
    let isMounted = true;
    invoke<string>('get_app_version')
      .then((v) => {
        if (v && isMounted) {
          setVersion(v);
        }
      })
      .catch((err) => {
        console.warn('Could not fetch app version from backend:', err);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleCopyLicense = () => {
    if (appLicenseData.fullText) {
      navigator.clipboard.writeText(appLicenseData.fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenGitHub = () => {
    BrowserOpenURL('https://github.com/Showayeb/ThunderDownloadManager');
  };

  const handleOpenOpenSourceLicenses = () => {
    onClose();
    openModal('openSourceLicenses');
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-2xl w-full max-h-[85vh] p-0 gap-0 overflow-hidden flex flex-col bg-background border border-border/80 rounded-2xl shadow-2xl">
        {/* Title Bar */}
        <div className="flex flex-row items-center justify-between px-5 py-3.5 border-b border-border/70 bg-card/60 shrink-0 select-none">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <Zap className="w-4 h-4 fill-current" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold text-foreground tracking-tight">
                {t('about.title') || 'About Thunder Download Manager'}
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Version details, system specifications, and licensing
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

        {/* Hero Section */}
        <div className="p-5 bg-muted/20 border-b border-border flex items-center space-x-4 shrink-0">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-primary to-accent p-0.5 shadow-lg shrink-0 flex items-center justify-center">
            <div className="w-full h-full bg-card rounded-[14px] flex items-center justify-center">
              <Zap className="w-7 h-7 text-primary fill-primary/20" />
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center space-x-2">
              <h2 className="text-base font-bold text-foreground tracking-tight">
                Thunder Download Manager
              </h2>
              <Badge variant="secondary" className="font-mono text-[11px] px-2 py-0.5">
                v{version}
              </Badge>
            </div>
            <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
              Fast, resilient multi-threaded download accelerator and video engine.
            </p>
            <div className="text-[11px] text-muted-foreground font-medium mt-1">
              {appLicenseData.copyright || 'Copyright (c) 2026 Showayeb Ahamed'}
            </div>
          </div>
        </div>

        {/* Tabs & Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden gap-0">
          <div className="px-5 py-2.5 border-b border-border/70 bg-card/40 shrink-0">
            <TabsList className="bg-muted/60 p-1 rounded-xl h-9 inline-flex gap-1 border border-border/40">
              <TabsTrigger
                value="about"
                className="text-xs font-medium px-3.5 py-1.5 rounded-lg data-active:bg-background data-active:text-foreground data-active:shadow-sm"
              >
                Overview & Details
              </TabsTrigger>
              <TabsTrigger
                value="license"
                className="text-xs font-medium px-3.5 py-1.5 gap-1.5 rounded-lg data-active:bg-background data-active:text-foreground data-active:shadow-sm"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                <span>App License ({appLicenseData.licenseType})</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="p-5 flex-1 overflow-y-auto space-y-3.5 custom-scrollbar">
            <TabsContent value="about" className="m-0 space-y-3 focus-visible:outline-none">
              {/* Quick Specs */}
              <Card className="bg-muted/30 border-border p-3.5 grid grid-cols-2 gap-3 text-[11.5px]">
                <div>
                  <span className="text-muted-foreground block text-[10.5px]">Software License:</span>
                  <span className="font-semibold text-foreground">
                    {appLicenseData.licenseType || 'MIT License'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10.5px]">Author / Developer:</span>
                  <span className="font-semibold text-foreground">
                    {appLicenseData.author || 'Showayeb Ahamed'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10.5px]">Architecture & Engine:</span>
                  <span className="font-semibold text-foreground">Go + Wails v3 + React</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10.5px]">License File Source:</span>
                  <span className="font-mono text-emerald-500 dark:text-emerald-400 text-[10.5px]">
                    Auto-synced from LICENSE
                  </span>
                </div>
              </Card>

              {/* Action Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* View Open Source Licenses */}
                <button
                  type="button"
                  onClick={handleOpenOpenSourceLicenses}
                  className="p-3.5 bg-card hover:bg-accent/60 border border-border hover:border-primary/40 rounded-xl text-left transition-all group cursor-pointer shadow-xs"
                >
                  <div className="flex items-center space-x-2 text-primary font-semibold mb-1">
                    <Scale className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    <span>Open-Source Licenses</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    View 24+ third-party libraries and frameworks used in ThunderDM.
                  </p>
                </button>

                {/* GitHub Repository */}
                <button
                  type="button"
                  onClick={handleOpenGitHub}
                  className="p-3.5 bg-card hover:bg-accent/60 border border-border hover:border-primary/40 rounded-xl text-left transition-all group cursor-pointer shadow-xs"
                >
                  <div className="flex items-center space-x-2 text-primary font-semibold mb-1">
                    <svg
                      className="w-4 h-4 text-primary group-hover:scale-110 transition-transform fill-current shrink-0"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                    </svg>
                    <span>GitHub Repository</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Source code, bug reports, issue tracker, and community support.
                  </p>
                </button>
              </div>
            </TabsContent>

            <TabsContent value="license" className="m-0 space-y-2.5 focus-visible:outline-none">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  Directly fetched from project{' '}
                  <code className="text-primary font-mono font-medium">LICENSE</code> file:
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCopyLicense}
                  className="h-7 text-xs flex items-center space-x-1.5"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-emerald-500">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                      <span>Copy License Text</span>
                    </>
                  )}
                </Button>
              </div>

              <pre className="p-4 bg-background border border-border rounded-xl text-[11px] font-mono text-muted-foreground max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed select-text custom-scrollbar">
                {appLicenseData.fullText || 'No license text found in LICENSE file.'}
              </pre>
            </TabsContent>
          </div>
        </Tabs>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-border/70 bg-card/60 flex flex-row items-center justify-between gap-3 shrink-0 select-none">
          <span className="text-xs text-muted-foreground font-medium">
            ThunderDM © {new Date().getFullYear()}
          </span>
          <Button variant="outline" size="sm" onClick={onClose} className="rounded-lg px-5 text-xs">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
