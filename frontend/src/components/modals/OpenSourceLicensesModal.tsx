import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  ExternalLink,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Scale,
  BookOpen,
  X,
} from 'lucide-react';
import { BrowserOpenURL, invoke } from '../../utils/tauriBridge';
import { useAppearance } from '../../context/AppearanceContext';
import generatedLicenses from '../../data/openSourceLicenses.json';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

export interface OpenSourcePackage {
  id: string;
  name: string;
  packageId: string;
  version?: string;
  author: string;
  license: string;
  url: string;
  description: string;
  category?: 'media' | 'frontend' | 'backend' | 'tooling';
}

const INITIAL_PACKAGES: OpenSourcePackage[] = generatedLicenses as OpenSourcePackage[];

type SortField = 'name' | 'author' | 'license';
type SortDirection = 'asc' | 'desc';

interface OpenSourceLicensesModalProps {
  onClose: () => void;
}

export const OpenSourceLicensesModal: React.FC<OpenSourceLicensesModalProps> = ({ onClose }) => {
  const { t } = useAppearance();
  const [packages, setPackages] = useState<OpenSourcePackage[]>(INITIAL_PACKAGES);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Automatically fetch live versions from backend (go.mod, Go runtime, yt-dlp, FFmpeg)
  useEffect(() => {
    let isMounted = true;

    async function loadDynamicVersions() {
      // 1. Fetch Go backend dependencies & Go runtime version
      try {
        const backendRes: any = await invoke('get_open_source_backend_info');
        if (isMounted && backendRes) {
          const goVer = backendRes.goVersion;
          const deps = backendRes.dependencies || {};

          setPackages((prev) =>
            prev.map((pkg) => {
              if (pkg.id === 'go-runtime' && goVer) {
                return { ...pkg, version: goVer.startsWith('v') ? goVer : `v${goVer}` };
              }
              if (deps[pkg.packageId]) {
                const dv = deps[pkg.packageId];
                return { ...pkg, version: dv.startsWith('v') ? dv : `v${dv}` };
              }
              return pkg;
            })
          );
        }
      } catch (e) {
        console.warn('Could not retrieve Go backend version info:', e);
      }

      // 2. Fetch local installed yt-dlp and FFmpeg versions
      try {
        const mediaTools: any = await invoke('check_media_tools');
        if (isMounted && mediaTools) {
          const ytdlpVer = mediaTools.ytdlpVersion || mediaTools.version;
          const ffmpegVer = mediaTools.ffmpegVersion;

          setPackages((prev) =>
            prev.map((pkg) => {
              if (pkg.id === 'yt-dlp') {
                return {
                  ...pkg,
                  version: ytdlpVer
                    ? ytdlpVer.startsWith('v')
                      ? ytdlpVer
                      : `v${ytdlpVer}`
                    : mediaTools.ytdlpInstalled
                    ? 'installed'
                    : 'latest',
                };
              }
              if (pkg.id === 'ffmpeg') {
                return {
                  ...pkg,
                  version: ffmpegVer
                    ? ffmpegVer.startsWith('v')
                      ? ffmpegVer
                      : `v${ffmpegVer}`
                    : mediaTools.ffmpegInstalled
                    ? 'installed'
                    : 'latest',
                };
              }
              return pkg;
            })
          );
        }
      } catch (e) {
        if (isMounted) {
          setPackages((prev) =>
            prev.map((pkg) => {
              if (pkg.id === 'yt-dlp' || pkg.id === 'ffmpeg') {
                return { ...pkg, version: 'latest' };
              }
              return pkg;
            })
          );
        }
      }
    }

    loadDynamicVersions();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const filteredAndSorted = useMemo(() => {
    let list = packages.filter((item) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        item.name.toLowerCase().includes(q) ||
        item.packageId.toLowerCase().includes(q) ||
        item.author.toLowerCase().includes(q) ||
        item.license.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      let valA = a[sortField].toLowerCase();
      let valB = b[sortField].toLowerCase();
      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [packages, searchQuery, sortField, sortDir]);

  const handleCopyLink = (pkg: OpenSourcePackage, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(pkg.url);
    setCopiedId(pkg.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleOpenLink = (url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    BrowserOpenURL(url);
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-3xl sm:max-w-4xl w-full h-[85vh] max-h-[700px] p-0 gap-0 overflow-hidden flex flex-col bg-background border border-border/80 rounded-2xl shadow-2xl">
        {/* Title Bar */}
        <div className="flex flex-row items-center justify-between px-5 py-3.5 border-b border-border/70 bg-card/60 shrink-0 select-none">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <Scale className="w-4 h-4" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold text-foreground tracking-tight">
                {t('licenses.title') || 'Open Source Software'}
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Third-party licenses, libraries, and runtime dependencies
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

        {/* Search & Counter Bar */}
        <div className="px-5 py-3 bg-muted/20 border-b border-border flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="relative w-full sm:w-80">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('licenses.searchPlaceholder') || 'Search open source libraries...'}
              className="w-full bg-background border-border pl-9 pr-8 h-8 text-xs placeholder:text-muted-foreground"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex items-center space-x-2 text-[11px] text-muted-foreground self-end sm:self-auto">
            <Badge variant="outline" className="px-2.5 py-0.5 font-medium">
              {filteredAndSorted.length} {filteredAndSorted.length === 1 ? 'package' : 'packages'}
            </Badge>
          </div>
        </div>

        {/* Table Header Bar */}
        <div className="bg-muted/40 border-b border-border px-5 py-2.5 grid grid-cols-12 gap-3 text-[11px] font-semibold text-muted-foreground shrink-0 select-none">
          <button
            type="button"
            onClick={() => handleSort('name')}
            className="col-span-6 sm:col-span-5 flex items-center space-x-1.5 hover:text-foreground text-left transition-colors cursor-pointer group"
          >
            <span>{t('licenses.colName') || 'Name'}</span>
            <span className="text-muted-foreground group-hover:text-foreground">
              {sortField === 'name' ? (
                sortDir === 'asc' ? (
                  <ArrowUp className="w-3 h-3 text-primary" />
                ) : (
                  <ArrowDown className="w-3 h-3 text-primary" />
                )
              ) : (
                <ArrowUpDown className="w-3 h-3 opacity-60" />
              )}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleSort('author')}
            className="col-span-3 sm:col-span-4 flex items-center space-x-1.5 hover:text-foreground text-left transition-colors cursor-pointer group"
          >
            <span>{t('licenses.colAuthor') || 'Author'}</span>
            <span className="text-muted-foreground group-hover:text-foreground">
              {sortField === 'author' ? (
                sortDir === 'asc' ? (
                  <ArrowUp className="w-3 h-3 text-primary" />
                ) : (
                  <ArrowDown className="w-3 h-3 text-primary" />
                )
              ) : (
                <ArrowUpDown className="w-3 h-3 opacity-60" />
              )}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleSort('license')}
            className="col-span-3 sm:col-span-3 flex items-center space-x-1.5 hover:text-foreground text-left transition-colors cursor-pointer group"
          >
            <span>{t('licenses.colLicense') || 'License'}</span>
            <span className="text-muted-foreground group-hover:text-foreground">
              {sortField === 'license' ? (
                sortDir === 'asc' ? (
                  <ArrowUp className="w-3 h-3 text-primary" />
                ) : (
                  <ArrowDown className="w-3 h-3 text-primary" />
                )
              ) : (
                <ArrowUpDown className="w-3 h-3 opacity-60" />
              )}
            </span>
          </button>
        </div>

        {/* Table Body / Package List */}
        <div className="flex-1 overflow-y-auto divide-y divide-border p-2 custom-scrollbar">
          {filteredAndSorted.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground flex flex-col items-center justify-center space-y-2">
              <BookOpen className="w-8 h-8 opacity-40" />
              <p className="text-xs">No matching open-source packages found.</p>
            </div>
          ) : (
            filteredAndSorted.map((pkg) => {
              const isExpanded = expandedId === pkg.id;

              return (
                <div
                  key={pkg.id}
                  className={`rounded-xl transition-all ${
                    isExpanded ? 'bg-muted/50 border border-primary/30 my-1 shadow-sm' : 'hover:bg-accent/40'
                  }`}
                >
                  {/* Row content */}
                  <div
                    onClick={() => toggleExpand(pkg.id)}
                    className="px-3.5 py-2.5 grid grid-cols-12 gap-3 items-center cursor-pointer select-none"
                  >
                    {/* Name & Package */}
                    <div className="col-span-6 sm:col-span-5 flex items-start space-x-2.5 min-w-0">
                      <div className="mt-0.5 shrink-0 text-muted-foreground">
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-primary" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0 pr-1">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-semibold text-foreground text-[12.5px] truncate">
                            {pkg.name}
                          </span>
                          {pkg.version && (
                            <Badge variant="secondary" className="text-[10px] font-mono px-1.5 py-0">
                              {pkg.version}
                            </Badge>
                          )}
                        </div>
                        <div className="text-[10.5px] text-muted-foreground font-mono truncate mt-0.5">
                          {pkg.packageId}
                        </div>
                      </div>
                    </div>

                    {/* Author */}
                    <div className="col-span-3 sm:col-span-4 text-foreground/80 text-[11.5px] truncate pr-2">
                      {pkg.author}
                    </div>

                    {/* License Badge */}
                    <div className="col-span-3 sm:col-span-3 flex items-center justify-between min-w-0">
                      <span className="font-medium text-foreground text-[11.5px] truncate">
                        {pkg.license}
                      </span>
                    </div>
                  </div>

                  {/* Expanded Accordion Details */}
                  {isExpanded && (
                    <div className="px-4 pb-3.5 pt-1 border-t border-border space-y-2.5 bg-card/60 rounded-b-xl animate-in fade-in duration-100">
                      <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                        {pkg.description}
                      </p>

                      {/* Website Link and Copy actions */}
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        <Button
                          size="sm"
                          onClick={(e) => handleOpenLink(pkg.url, e)}
                          className="h-7 text-xs flex items-center space-x-1.5"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Visit Website</span>
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => handleCopyLink(pkg, e)}
                          className="h-7 text-xs flex items-center space-x-1.5"
                        >
                          {copiedId === pkg.id ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                              <span className="text-emerald-500">Link Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                              <span>Copy Link</span>
                            </>
                          )}
                        </Button>

                        <span className="text-[11px] font-mono text-muted-foreground truncate max-w-xs sm:max-w-md ml-1 select-all">
                          {pkg.url}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-border/70 bg-card/60 flex flex-row items-center justify-between gap-3 shrink-0 select-none">
          <span className="text-xs text-muted-foreground hidden sm:inline">
            All open source libraries are utilized in full compliance with their respective licenses.
          </span>
          <Button variant="outline" size="sm" onClick={onClose} className="rounded-lg px-5 ml-auto text-xs">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
