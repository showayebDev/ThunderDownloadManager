/**
 * Batch Download Modal shell composing Pattern Generator, Bulk URL List,
 * Webpage Link Sniffer tabs, and Shared Download Settings.
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Layers,
  FileText,
  Globe,
  Hash,
  Play,
  ListPlus,
  Loader2,
  X,
} from 'lucide-react';
import { useDownloadContext } from '../../context/DownloadContext';
import { useAppearance } from '../../context/AppearanceContext';
import { Category } from '../../types/download';
import { invoke } from '../../utils/tauriBridge';
import { detectCategory } from '../../utils/category';
import { matchVaultCredentials } from '../../utils/vault';
import { loadFromThunderDB } from '../../utils/thunderDB';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  BatchTab,
  ScrapedLink,
  WildcardConfig,
  BatchSubmitProgress,
  ActiveBatchItem,
  DEFAULT_WILDCARD_CONFIG,
  formatBatchBytes,
  computeWildcardSampleValues,
  computeWildcardSampleTotal,
  generatePatternUrls,
} from './batch/types';
import { BatchPatternTab } from './batch/BatchPatternTab';
import { BatchTextListTab } from './batch/BatchTextListTab';
import { BatchCrawlerTab } from './batch/BatchCrawlerTab';
import {
  BatchSharedSettingsCard,
  BatchIngestionOverlay,
} from './batch/BatchSharedSettingsCard';

export const BatchDownloadModal: React.FC = () => {
  const { closeModal, globalSettings, queues, addBatchDownloads } = useDownloadContext();
  const { t } = useAppearance();

  const [activeTab, setActiveTab] = useState<BatchTab>('pattern');

  // --- Shared Settings State ---
  const [defaultEngineThreads, setDefaultEngineThreads] = useState<number>(
    () => globalSettings.defaultThreadCount || 8
  );
  const [savePath, setSavePath] = useState<string>(globalSettings.downloadPath || '');
  const [selectedCategory, setSelectedCategory] = useState<Category>('All');
  const [useCategory, setUseCategory] = useState<boolean>(
    () => globalSettings.useCategoryByDefault ?? true
  );
  const [showRealTimeProgress, setShowRealTimeProgress] = useState<boolean>(false);
  const [showCompletionWindow, setShowCompletionWindow] = useState<boolean>(false);
  const [selectedQueue, setSelectedQueue] = useState<string>('');
  const [threadCount, setThreadCount] = useState<number>(
    () => globalSettings.defaultThreadCount || 8
  );
  const [speedLimitKB, setSpeedLimitKB] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitProgress, setSubmitProgress] = useState<BatchSubmitProgress>({
    current: 0,
    total: 0,
    percent: 0,
    currentName: '',
  });

  useEffect(() => {
    async function loadEngineData() {
      try {
        const engine = await loadFromThunderDB<any>('download_engine', null);
        if (engine) {
          const defThreads =
            engine.defaultThreadCount || engine.threadCount || globalSettings.defaultThreadCount || 8;
          setDefaultEngineThreads(defThreads);
          setThreadCount((prev) => (prev === 8 || prev === 0 ? defThreads : prev));
          if (engine.downloadPath && !savePath) {
            setSavePath(engine.downloadPath);
          }
          if (engine.useCategoryByDefault !== undefined) {
            setUseCategory(Boolean(engine.useCategoryByDefault));
          }
        }
      } catch {}
    }
    loadEngineData();
  }, []);

  // --- Tab 1: Pattern / Sequence State ---
  const [patternUrl, setPatternUrl] = useState<string>(
    'http://example.com/files/document_*.pdf'
  );
  const [wildcardConfigs, setWildcardConfigs] = useState<WildcardConfig[]>([
    { ...DEFAULT_WILDCARD_CONFIG },
  ]);
  const [activeWildcardIdx, setActiveWildcardIdx] = useState<number>(0);

  // Count asterisks in the URL template
  const asteriskCount = useMemo(() => {
    return (patternUrl.match(/\*/g) || []).length;
  }, [patternUrl]);

  // Ensure enough wildcard configs exist for all asterisks
  useEffect(() => {
    if (asteriskCount > wildcardConfigs.length) {
      setWildcardConfigs((prev) => {
        const next = [...prev];
        while (next.length < asteriskCount) {
          next.push({ ...DEFAULT_WILDCARD_CONFIG });
        }
        return next;
      });
    }
  }, [asteriskCount, wildcardConfigs.length]);

  const currentWildcardIdx = Math.min(activeWildcardIdx, Math.max(0, asteriskCount - 1));
  const currentConfig = wildcardConfigs[currentWildcardIdx] || DEFAULT_WILDCARD_CONFIG;

  const updateCurrentConfig = (patch: Partial<WildcardConfig>) => {
    setWildcardConfigs((prev) => {
      const next = [...prev];
      while (next.length <= currentWildcardIdx) {
        next.push({ ...DEFAULT_WILDCARD_CONFIG });
      }
      next[currentWildcardIdx] = { ...next[currentWildcardIdx], ...patch };
      return next;
    });
  };

  const currentSampleValues = useMemo(
    () => computeWildcardSampleValues(currentConfig),
    [currentConfig]
  );

  const currentSampleTotal = useMemo(
    () => computeWildcardSampleTotal(currentConfig),
    [currentConfig]
  );

  // --- Tab 2: Text / URL List State ---
  const [textList, setTextList] = useState<string>('');

  // --- Tab 3: Webpage Sniffer / Crawler State ---
  const [crawlUrl, setCrawlUrl] = useState<string>('http://localhost:3000/');
  const [includeSubfolders, setIncludeSubfolders] = useState<boolean>(true);
  const [crawlMaxDepth, setCrawlMaxDepth] = useState<number>(3);
  const [recreateSubfoldersOnDisk, setRecreateSubfoldersOnDisk] = useState<boolean>(true);
  const [crawlerFilterFolder, setCrawlerFilterFolder] = useState<string>('All');
  const [crawledLinks, setCrawledLinks] = useState<ScrapedLink[]>([]);
  const [isCrawling, setIsCrawling] = useState<boolean>(false);
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const [crawlerFilterCat, setCrawlerFilterCat] = useState<string>('All');
  const [crawlerSearch, setCrawlerSearch] = useState<string>('');
  const [isProbingSizes, setIsProbingSizes] = useState<boolean>(false);

  const discoveredSubfolders = useMemo(() => {
    const set = new Set<string>();
    crawledLinks.forEach((l) => {
      if (l.subfolder && l.subfolder.trim()) {
        set.add(l.subfolder.trim());
      }
    });
    return Array.from(set).sort();
  }, [crawledLinks]);

  // Sample URL for detecting Vault credentials in Batch modal
  const sampleUrlForVault = useMemo(() => {
    if (activeTab === 'pattern') return patternUrl.trim();
    if (activeTab === 'text') {
      const lines = textList
        .split(/[\r\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return lines[0] || '';
    }
    if (activeTab === 'crawler') return crawlUrl.trim();
    return '';
  }, [activeTab, patternUrl, textList, crawlUrl]);

  const matchedVaultItem = useMemo(() => {
    if (!sampleUrlForVault) return null;
    return matchVaultCredentials(sampleUrlForVault, globalSettings.vaultItems || []);
  }, [sampleUrlForVault, globalSettings.vaultItems]);

  // Initialize download path if empty
  useEffect(() => {
    if (!savePath) {
      invoke<string>('get_default_download_dir')
        .then((dir) => {
          if (dir) setSavePath(dir);
        })
        .catch(() => {});
    }
  }, [savePath]);

  // Handle Pick Folder
  const handlePickFolder = async () => {
    try {
      const selected = await invoke<string>('pick_folder_command');
      if (selected && typeof selected === 'string' && selected.trim() !== '') {
        setSavePath(selected.trim());
      }
    } catch (err) {
      console.error('Failed to pick folder:', err);
    }
  };

  // --- Generate URLs from Pattern ---
  const generatedPatternUrls = useMemo(
    () => generatePatternUrls(patternUrl, wildcardConfigs),
    [patternUrl, wildcardConfigs]
  );

  // --- Parse URLs from Text Area ---
  const parsedTextUrls = useMemo(() => {
    const lines = textList.split(/\r?\n/);
    const valid: string[] = [];
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (
        trimmed.startsWith('http://') ||
        trimmed.startsWith('https://') ||
        trimmed.startsWith('ftp://') ||
        trimmed.startsWith('magnet:')
      ) {
        valid.push(trimmed);
      }
    });
    return valid;
  }, [textList]);

  // --- Crawler Link Scanning ---
  const handleScanCrawlerLinks = async () => {
    if (!crawlUrl.trim()) return;
    setIsCrawling(true);
    setCrawlError(null);
    setCrawlerFilterFolder('All');

    try {
      const payload = {
        url: crawlUrl.trim(),
        recursive: includeSubfolders,
        maxDepth: crawlMaxDepth,
      };
      const links = await invoke<ScrapedLink[]>('crawl_page_links_command', payload);
      if (links && Array.isArray(links) && links.length > 0) {
        setCrawledLinks(links.map((l) => ({ ...l, selected: true })));
      } else {
        setCrawlError('No downloadable file links were discovered on this page.');
        setCrawledLinks([]);
      }
    } catch (err: any) {
      console.error('Crawler failed:', err);
      setCrawlError(err?.message || 'Failed to scan webpage. Please check the URL.');
      setCrawledLinks([]);
    } finally {
      setIsCrawling(false);
    }
  };

  // Probe file sizes for crawled links
  const handleProbeFileSizes = async () => {
    if (crawledLinks.length === 0 || isProbingSizes) return;
    setIsProbingSizes(true);

    try {
      const urlsToProbe = crawledLinks.map((l) => l.url);
      const sizeMap = await invoke<Record<string, number>>('probe_file_sizes_command', urlsToProbe);
      if (sizeMap && typeof sizeMap === 'object') {
        setCrawledLinks((prev) =>
          prev.map((item) => {
            const sz = sizeMap[item.url];
            if (sz && sz > 0) {
              return {
                ...item,
                size: sz,
                size_str: formatBatchBytes(sz),
              };
            }
            return item;
          })
        );
      }
    } catch (err) {
      console.error('Failed to probe file sizes:', err);
    } finally {
      setIsProbingSizes(false);
    }
  };

  // Filter crawled links
  const filteredCrawledLinks = useMemo(() => {
    return crawledLinks.filter((item) => {
      if (crawlerFilterCat !== 'All' && item.category !== crawlerFilterCat) {
        return false;
      }
      if (crawlerFilterFolder !== 'All') {
        if (crawlerFilterFolder === '__root__') {
          if (item.subfolder && item.subfolder.trim() !== '') return false;
        } else if (item.subfolder !== crawlerFilterFolder) {
          return false;
        }
      }
      if (crawlerSearch.trim()) {
        const q = crawlerSearch.toLowerCase();
        return (
          item.filename.toLowerCase().includes(q) ||
          item.url.toLowerCase().includes(q) ||
          (item.subfolder && item.subfolder.toLowerCase().includes(q)) ||
          (item.ext && item.ext.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [crawledLinks, crawlerFilterCat, crawlerFilterFolder, crawlerSearch]);

  const toggleSelectLink = (u: string) => {
    setCrawledLinks((prev) =>
      prev.map((l) => (l.url === u ? { ...l, selected: !l.selected } : l))
    );
  };

  const toggleSelectAllCrawler = () => {
    const allSelected = filteredCrawledLinks.every((l) => l.selected);
    const targetUrls = new Set(filteredCrawledLinks.map((l) => l.url));
    setCrawledLinks((prev) =>
      prev.map((l) => (targetUrls.has(l.url) ? { ...l, selected: !allSelected } : l))
    );
  };

  // --- Calculate Selected Links to Ingest ---
  const activeItemsToAdd = useMemo<ActiveBatchItem[]>(() => {
    if (activeTab === 'pattern') {
      return generatedPatternUrls.map((u) => {
        let fname = '';
        try {
          const parsed = new URL(u);
          fname = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
        } catch {
          fname = u.split('/').pop() || '';
        }
        return {
          url: u,
          filename: fname,
        };
      });
    } else if (activeTab === 'text') {
      return parsedTextUrls.map((u) => {
        let fname = '';
        try {
          const parsed = new URL(u);
          fname = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
        } catch {
          fname = u.split('/').pop() || '';
        }
        return {
          url: u,
          filename: fname,
        };
      });
    } else {
      return crawledLinks
        .filter((l) => l.selected)
        .map((l) => ({
          url: l.url,
          filename: l.filename,
          subfolder: l.subfolder,
          category: (l.category as Category) || undefined,
        }));
    }
  }, [activeTab, generatedPatternUrls, parsedTextUrls, crawledLinks]);

  // --- Execute Ingestion ---
  const handleExecuteBatch = async (startImmediately: boolean) => {
    if (activeItemsToAdd.length === 0 || isSubmitting) return;
    setIsSubmitting(true);
    setSubmitProgress({
      current: 0,
      total: activeItemsToAdd.length,
      percent: 0,
      currentName: activeItemsToAdd[0]?.filename || '',
    });

    try {
      const speedLimitBytes =
        speedLimitKB && Number(speedLimitKB) > 0 ? Number(speedLimitKB) * 1024 : null;

      const preparedItems = activeItemsToAdd.map((entry) => {
        let itemSavePath = savePath || globalSettings.downloadPath || '';
        if (recreateSubfoldersOnDisk && entry.subfolder) {
          const sep = itemSavePath.includes('\\') ? '\\' : '/';
          const cleanSub = entry.subfolder.replace(/[\/\\]+/g, sep);
          itemSavePath = itemSavePath.endsWith(sep)
            ? `${itemSavePath}${cleanSub}`
            : `${itemSavePath}${sep}${cleanSub}`;
        }

        const matchedVault = matchVaultCredentials(entry.url, globalSettings.vaultItems || []);
        const itemThreadCount =
          matchedVault && matchedVault.threadCount && matchedVault.threadCount > 0
            ? matchedVault.threadCount
            : threadCount > 0
            ? threadCount
            : defaultEngineThreads || globalSettings.defaultThreadCount || 8;
        const itemSpeedLimit =
          matchedVault && matchedVault.speedLimit && matchedVault.speedLimit > 0
            ? matchedVault.speedLimit * 1024
            : speedLimitBytes;

        const resolvedCategory: Category =
          selectedCategory !== 'All'
            ? selectedCategory
            : entry.category || detectCategory(entry.filename || entry.url);

        return {
          url: entry.url,
          filename: entry.filename,
          category: resolvedCategory,
          savePath: itemSavePath,
          queue: selectedQueue || '',
          useCategory: useCategory,
          options: {
            threadCount: itemThreadCount,
            speedLimit: itemSpeedLimit,
            protocol: entry.url.toLowerCase().includes('.m3u8') ? 'HLS' : 'HTTP',
            showRealTimeProgress: showRealTimeProgress,
            showCompletionWindow: showCompletionWindow,
            useCategory: useCategory,
            username: matchedVault?.username || undefined,
            password: matchedVault?.password || undefined,
            userAgent: matchedVault?.userAgent || undefined,
          },
        };
      });

      await addBatchDownloads(
        preparedItems,
        startImmediately,
        (current, total, currentItemName) => {
          setSubmitProgress({
            current,
            total,
            percent: Math.min(100, Math.round((current / (total || 1)) * 100)),
            currentName: currentItemName || '',
          });
        }
      );

      // Brief delay upon reaching 100% so user sees completion before modal closes
      await new Promise((resolve) => setTimeout(resolve, 350));
      closeModal();
    } catch (err) {
      console.error('Failed to submit batch downloads:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && closeModal()}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[700px] w-[70%] h-[88vh] max-h-[740px] p-0 gap-0 overflow-hidden flex flex-col bg-background border border-border/80 rounded-2xl shadow-2xl"
      >
        {/* Header */}
        <div className="flex flex-row items-center justify-between px-5 py-3.5 border-b border-border/70 bg-card/60 shrink-0 select-none">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold text-foreground tracking-tight">
                {t('menu.batchDownload') || 'Batch Download'}
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Generate sequential links, paste bulk URLs, or crawl web pages
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={closeModal}
            className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-red-500 hover:text-white dark:hover:bg-red-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Tab Navigation & Body */}
        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as BatchTab)}
          className="flex-1 flex flex-col overflow-hidden gap-0"
        >
          <div className="px-5 py-2.5 border-b border-border/70 bg-card/40 shrink-0">
            <TabsList className="bg-muted/60 p-1 rounded-xl h-9 inline-flex gap-1 border border-border/40">
              <TabsTrigger
                value="pattern"
                className="text-xs font-medium px-3.5 py-1.5 gap-2 rounded-lg data-active:bg-background data-active:text-foreground data-active:shadow-sm"
              >
                <Hash className="w-3.5 h-3.5 text-primary" />
                <span>Pattern / Sequence</span>
              </TabsTrigger>
              <TabsTrigger
                value="text"
                className="text-xs font-medium px-3.5 py-1.5 gap-2 rounded-lg data-active:bg-background data-active:text-foreground data-active:shadow-sm"
              >
                <FileText className="w-3.5 h-3.5 text-primary" />
                <span>Text / URL List</span>
              </TabsTrigger>
              <TabsTrigger
                value="crawler"
                className="text-xs font-medium px-3.5 py-1.5 gap-2 rounded-lg data-active:bg-background data-active:text-foreground data-active:shadow-sm"
              >
                <Globe className="w-3.5 h-3.5 text-primary" />
                <span>Webpage Link Sniffer</span>
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Tab Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar text-xs">
            <BatchPatternTab
              patternUrl={patternUrl}
              setPatternUrl={setPatternUrl}
              asteriskCount={asteriskCount}
              wildcardConfigs={wildcardConfigs}
              currentWildcardIdx={currentWildcardIdx}
              setActiveWildcardIdx={setActiveWildcardIdx}
              currentConfig={currentConfig}
              updateCurrentConfig={updateCurrentConfig}
              currentSampleValues={currentSampleValues}
              currentSampleTotal={currentSampleTotal}
              generatedPatternUrls={generatedPatternUrls}
            />

            <BatchTextListTab
              textList={textList}
              setTextList={setTextList}
              parsedTextUrls={parsedTextUrls}
            />

            <BatchCrawlerTab
              crawlUrl={crawlUrl}
              setCrawlUrl={setCrawlUrl}
              includeSubfolders={includeSubfolders}
              setIncludeSubfolders={setIncludeSubfolders}
              crawlMaxDepth={crawlMaxDepth}
              setCrawlMaxDepth={setCrawlMaxDepth}
              recreateSubfoldersOnDisk={recreateSubfoldersOnDisk}
              setRecreateSubfoldersOnDisk={setRecreateSubfoldersOnDisk}
              isCrawling={isCrawling}
              crawlError={crawlError}
              crawledLinks={crawledLinks}
              setCrawledLinks={setCrawledLinks}
              filteredCrawledLinks={filteredCrawledLinks}
              discoveredSubfolders={discoveredSubfolders}
              crawlerFilterCat={crawlerFilterCat}
              setCrawlerFilterCat={setCrawlerFilterCat}
              crawlerFilterFolder={crawlerFilterFolder}
              setCrawlerFilterFolder={setCrawlerFilterFolder}
              crawlerSearch={crawlerSearch}
              setCrawlerSearch={setCrawlerSearch}
              isProbingSizes={isProbingSizes}
              onScanCrawlerLinks={handleScanCrawlerLinks}
              onProbeFileSizes={handleProbeFileSizes}
              onToggleSelectLink={toggleSelectLink}
              onToggleSelectAllCrawler={toggleSelectAllCrawler}
            />

            <BatchSharedSettingsCard
              savePath={savePath}
              setSavePath={setSavePath}
              onPickFolder={handlePickFolder}
              selectedQueue={selectedQueue}
              setSelectedQueue={setSelectedQueue}
              queues={queues}
              selectedCategory={selectedCategory}
              setSelectedCategory={setSelectedCategory}
              useCategory={useCategory}
              setUseCategory={setUseCategory}
              threadCount={threadCount}
              setThreadCount={setThreadCount}
              defaultEngineThreads={defaultEngineThreads}
              speedLimitKB={speedLimitKB}
              setSpeedLimitKB={setSpeedLimitKB}
              showRealTimeProgress={showRealTimeProgress}
              setShowRealTimeProgress={setShowRealTimeProgress}
              showCompletionWindow={showCompletionWindow}
              setShowCompletionWindow={setShowCompletionWindow}
              matchedVaultItem={matchedVaultItem}
            />
          </div>
        </Tabs>

        {/* Footer Actions */}
        <div className="px-5 py-3.5 border-t border-border/70 bg-card/60 flex flex-row items-center justify-between gap-3 shrink-0 select-none">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Total to ingest:</span>
            <Badge variant="secondary" className="font-mono text-primary font-bold text-xs">
              {activeItemsToAdd.length} files
            </Badge>
          </div>

          <div className="flex items-center gap-2.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={closeModal}
              disabled={isSubmitting}
              className="text-xs rounded-lg px-4"
            >
              Cancel
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={activeItemsToAdd.length === 0 || isSubmitting || !selectedQueue}
              onClick={() => handleExecuteBatch(false)}
              className="text-xs rounded-lg px-4 flex items-center gap-1.5"
            >
              {isSubmitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ListPlus className="w-3.5 h-3.5" />
              )}
              <span>Add to Queue</span>
            </Button>

            <Button
              type="button"
              disabled={activeItemsToAdd.length === 0 || isSubmitting}
              onClick={() => handleExecuteBatch(true)}
              size="sm"
              className="text-xs rounded-lg px-5 flex items-center gap-1.5 shadow-sm"
            >
              {isSubmitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span>{isSubmitting ? 'Ingesting...' : 'Download Now'}</span>
            </Button>
          </div>
        </div>

        {/* Loading Overlay */}
        {isSubmitting && (
          <BatchIngestionOverlay
            submitProgress={submitProgress}
            fallbackTotal={activeItemsToAdd.length}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};
