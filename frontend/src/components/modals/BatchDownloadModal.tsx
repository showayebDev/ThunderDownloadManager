import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Layers,
  FileText,
  Globe,
  Hash,
  Upload,
  FolderOpen,
  Search,
  Play,
  ListPlus,
  RefreshCw,
  CheckSquare,
  Square,
  AlertCircle,
  HardDrive,
  Cpu,
  Gauge,
  Sliders,
  Filter,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useDownloadContext } from '../../context/DownloadContext';
import { useAppearance } from '../../context/AppearanceContext';
import { Category } from '../../types/download';
import { invoke } from '../../utils/tauriBridge';
import { detectCategory } from '../../utils/category';
import { matchVaultCredentials } from '../../utils/vault';
import { loadFromThunderDB } from '../../utils/thunderDB';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

type BatchTab = 'pattern' | 'text' | 'crawler';

interface ScrapedLink {
  filename: string;
  url: string;
  subfolder?: string;
  size?: number;
  size_str?: string;
  ext?: string;
  category?: string;
  selected?: boolean;
}

export const BatchDownloadModal: React.FC = () => {
  const { closeModal, globalSettings, queues, addBatchDownloads } = useDownloadContext();
  const { t } = useAppearance();

  const [activeTab, setActiveTab] = useState<BatchTab>('pattern');

  // --- Shared Settings State ---
  const [defaultEngineThreads, setDefaultEngineThreads] = useState<number>(() => globalSettings.defaultThreadCount || 8);
  const [savePath, setSavePath] = useState<string>(globalSettings.downloadPath || '');
  const [selectedCategory, setSelectedCategory] = useState<Category>('All');
  const [useCategory, setUseCategory] = useState<boolean>(() => globalSettings.useCategoryByDefault ?? true);
  const [showRealTimeProgress, setShowRealTimeProgress] = useState<boolean>(false);
  const [showCompletionWindow, setShowCompletionWindow] = useState<boolean>(false);
  const [selectedQueue, setSelectedQueue] = useState<string>('');
  const [threadCount, setThreadCount] = useState<number>(() => globalSettings.defaultThreadCount || 8);
  const [speedLimitKB, setSpeedLimitKB] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitProgress, setSubmitProgress] = useState<{
    current: number;
    total: number;
    percent: number;
    currentName: string;
  }>({
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
          const defThreads = engine.defaultThreadCount || engine.threadCount || globalSettings.defaultThreadCount || 8;
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
  const [patternUrl, setPatternUrl] = useState<string>('http://example.com/files/document_*.pdf');
  const [wildcardConfigs, setWildcardConfigs] = useState<Array<{
    seqType: 'numeric' | 'alpha';
    numFrom: string | number;
    numTo: string | number;
    numStep: number;
    alphaFrom: string;
    alphaTo: string;
    alphaStep: number;
  }>>([
    {
      seqType: 'numeric',
      numFrom: '1',
      numTo: '10',
      numStep: 1,
      alphaFrom: 'a',
      alphaTo: 'j',
      alphaStep: 1,
    },
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
          next.push({
            seqType: 'numeric',
            numFrom: '1',
            numTo: '10',
            numStep: 1,
            alphaFrom: 'a',
            alphaTo: 'j',
            alphaStep: 1,
          });
        }
        return next;
      });
    }
  }, [asteriskCount, wildcardConfigs.length]);

  const currentWildcardIdx = Math.min(activeWildcardIdx, Math.max(0, asteriskCount - 1));
  const currentConfig = wildcardConfigs[currentWildcardIdx] || {
    seqType: 'numeric',
    numFrom: '1',
    numTo: '10',
    numStep: 1,
    alphaFrom: 'a',
    alphaTo: 'j',
    alphaStep: 1,
  };

  const updateCurrentConfig = (patch: Partial<typeof currentConfig>) => {
    setWildcardConfigs((prev) => {
      const next = [...prev];
      while (next.length <= currentWildcardIdx) {
        next.push({
          seqType: 'numeric',
          numFrom: '1',
          numTo: '10',
          numStep: 1,
          alphaFrom: 'a',
          alphaTo: 'j',
          alphaStep: 1,
        });
      }
      next[currentWildcardIdx] = { ...next[currentWildcardIdx], ...patch };
      return next;
    });
  };

  const currentSampleValues = useMemo(() => {
    const vals: string[] = [];
    if (currentConfig.seqType === 'numeric') {
      const fromStr = String(currentConfig.numFrom ?? '1').trim();
      const toStr = String(currentConfig.numTo ?? '10').trim();
      const from = parseInt(fromStr, 10) || 0;
      const to = parseInt(toStr, 10) || 0;
      const step = Math.max(1, Math.abs(currentConfig.numStep || 1));
      const padLen =
        fromStr.startsWith('0') && fromStr.length > 1
          ? fromStr.length
          : toStr.startsWith('0') && toStr.length > 1
          ? toStr.length
          : 0;

      if (from <= to) {
        for (let v = from; v <= to && vals.length < 6; v += step) {
          vals.push(padLen > 0 ? String(v).padStart(padLen, '0') : String(v));
        }
      } else {
        for (let v = from; v >= to && vals.length < 6; v -= step) {
          vals.push(padLen > 0 ? String(v).padStart(padLen, '0') : String(v));
        }
      }
    } else {
      const fromRaw = (currentConfig.alphaFrom || '').trim();
      const toRaw = (currentConfig.alphaTo || '').trim();
      const fromChar = fromRaw ? fromRaw[0] : 'a';
      const toChar = toRaw ? toRaw[0] : fromChar >= 'A' && fromChar <= 'Z' ? 'Z' : 'z';
      const startCode = fromChar.charCodeAt(0);
      const endCode = toChar.charCodeAt(0);
      const step = Math.max(1, Math.abs(currentConfig.alphaStep || 1));

      if (startCode <= endCode) {
        for (let c = startCode; c <= endCode && vals.length < 6; c += step) {
          vals.push(String.fromCharCode(c));
        }
      } else {
        for (let c = startCode; c >= endCode && vals.length < 6; c -= step) {
          vals.push(String.fromCharCode(c));
        }
      }
    }
    return vals;
  }, [currentConfig]);

  const currentSampleTotal = useMemo(() => {
    if (currentConfig.seqType === 'numeric') {
      const fromStr = String(currentConfig.numFrom ?? '1').trim();
      const toStr = String(currentConfig.numTo ?? '10').trim();
      const from = parseInt(fromStr, 10) || 0;
      const to = parseInt(toStr, 10) || 0;
      const diff = Math.abs(to - from);
      const step = Math.max(1, Math.abs(currentConfig.numStep || 1));
      return Math.floor(diff / step) + 1;
    } else {
      const fromRaw = (currentConfig.alphaFrom || '').trim();
      const toRaw = (currentConfig.alphaTo || '').trim();
      const fromChar = fromRaw ? fromRaw[0] : 'a';
      const toChar = toRaw ? toRaw[0] : fromChar >= 'A' && fromChar <= 'Z' ? 'Z' : 'z';
      const startCode = fromChar.charCodeAt(0);
      const endCode = toChar.charCodeAt(0);
      const diff = Math.abs(endCode - startCode);
      const step = Math.max(1, Math.abs(currentConfig.alphaStep || 1));
      return Math.floor(diff / step) + 1;
    }
  }, [currentConfig]);

  // --- Tab 2: Text / URL List State ---
  const [textList, setTextList] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const lines = textList.split(/[\r\n]+/).map((s) => s.trim()).filter(Boolean);
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
  const generatedPatternUrls = useMemo(() => {
    const rawTemplate = patternUrl.trim();
    if (!rawTemplate) return [];

    let templateWithTokens = rawTemplate;
    const tokens: string[] = [];
    const varValueSets: string[][] = [];

    // 1. Check for bracket ranges: [01-20], [01-20:2], [a-z], [a-z:2]
    const bracketRegex = /\[(?:([0-9]+)-([0-9]+)(?::([0-9]+))?|([a-zA-Z])-([a-zA-Z])(?::([0-9]+))?)\]/g;
    let bMatch: RegExpExecArray | null;
    let bracketIndex = 0;

    const bracketMatches: Array<{ matchStr: string; values: string[] }> = [];
    while ((bMatch = bracketRegex.exec(rawTemplate)) !== null) {
      const matchStr = bMatch[0];
      const vals: string[] = [];
      if (bMatch[1] !== undefined && bMatch[2] !== undefined) {
        // Numeric bracket
        const start = parseInt(bMatch[1], 10);
        const end = parseInt(bMatch[2], 10);
        const step = bMatch[3] ? Math.max(1, parseInt(bMatch[3], 10)) : 1;
        const padLen = bMatch[1].length;
        if (start <= end) {
          for (let v = start; v <= end && vals.length < 1000; v += step) {
            vals.push(String(v).padStart(padLen, '0'));
          }
        } else {
          for (let v = start; v >= end && vals.length < 1000; v -= step) {
            vals.push(String(v).padStart(padLen, '0'));
          }
        }
      } else if (bMatch[4] !== undefined && bMatch[5] !== undefined) {
        // Alpha bracket
        const startCode = bMatch[4].charCodeAt(0);
        const endCode = bMatch[5].charCodeAt(0);
        const step = bMatch[6] ? Math.max(1, parseInt(bMatch[6], 10)) : 1;
        if (startCode <= endCode) {
          for (let c = startCode; c <= endCode && vals.length < 52; c += step) {
            vals.push(String.fromCharCode(c));
          }
        } else {
          for (let c = startCode; c >= endCode && vals.length < 52; c -= step) {
            vals.push(String.fromCharCode(c));
          }
        }
      }
      bracketMatches.push({ matchStr, values: vals });
    }

    bracketMatches.forEach((bm) => {
      const token = `__BRACKET_${bracketIndex++}__`;
      templateWithTokens = templateWithTokens.replace(bm.matchStr, token);
      tokens.push(token);
      varValueSets.push(bm.values);
    });

    // 2. Replace each asterisk '*' sequentially
    let astIndex = 0;
    while (templateWithTokens.includes('*')) {
      const token = `__AST_${astIndex}__`;
      templateWithTokens = templateWithTokens.replace('*', token);
      tokens.push(token);

      const cfg = wildcardConfigs[astIndex] || {
        seqType: 'numeric',
        numFrom: '1',
        numTo: '10',
        numStep: 1,
        alphaFrom: 'a',
        alphaTo: 'j',
        alphaStep: 1,
      };

      const vals: string[] = [];
      if (cfg.seqType === 'numeric') {
        const fromStr = String(cfg.numFrom ?? '1').trim();
        const toStr = String(cfg.numTo ?? '10').trim();
        const from = parseInt(fromStr, 10) || 0;
        const to = parseInt(toStr, 10) || 0;
        const step = Math.max(1, Math.abs(cfg.numStep || 1));
        const padLen =
          fromStr.startsWith('0') && fromStr.length > 1
            ? fromStr.length
            : toStr.startsWith('0') && toStr.length > 1
            ? toStr.length
            : 0;

        if (from <= to) {
          for (let v = from; v <= to && vals.length < 1000; v += step) {
            vals.push(padLen > 0 ? String(v).padStart(padLen, '0') : String(v));
          }
        } else {
          for (let v = from; v >= to && vals.length < 1000; v -= step) {
            vals.push(padLen > 0 ? String(v).padStart(padLen, '0') : String(v));
          }
        }
      } else {
        const fromRaw = (cfg.alphaFrom || '').trim();
        const toRaw = (cfg.alphaTo || '').trim();
        const fromChar = fromRaw ? fromRaw[0] : 'a';
        const toChar = toRaw ? toRaw[0] : fromChar >= 'A' && fromChar <= 'Z' ? 'Z' : 'z';
        const startCode = fromChar.charCodeAt(0);
        const endCode = toChar.charCodeAt(0);
        const step = Math.max(1, Math.abs(cfg.alphaStep || 1));
        if (startCode <= endCode) {
          for (let c = startCode; c <= endCode && vals.length < 52; c += step) {
            vals.push(String.fromCharCode(c));
          }
        } else {
          for (let c = startCode; c >= endCode && vals.length < 52; c -= step) {
            vals.push(String.fromCharCode(c));
          }
        }
      }
      varValueSets.push(vals.length > 0 ? vals : ['']);
      astIndex++;
    }

    if (tokens.length === 0) {
      return [rawTemplate];
    }

    // 3. Compute Cartesian product across all tokens
    let combinations: string[] = [''];
    for (let i = 0; i < varValueSets.length; i++) {
      const nextCombos: string[] = [];
      const set = varValueSets[i];
      for (const combo of combinations) {
        for (const val of set) {
          nextCombos.push(combo ? `${combo}§§§${val}` : val);
          if (nextCombos.length >= 2000) break;
        }
        if (nextCombos.length >= 2000) break;
      }
      combinations = nextCombos;
    }

    // 4. Map combinations back into URLs
    return combinations.slice(0, 2000).map((comb) => {
      const parts = comb.split('§§§');
      let u = templateWithTokens;
      tokens.forEach((tok, idx) => {
        u = u.replace(tok, parts[idx] ?? '');
      });
      return u;
    });
  }, [patternUrl, wildcardConfigs]);

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

  // Handle Import from .txt file
  const handleImportTxtFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = (event.target?.result as string) || '';
      if (content) {
        setTextList((prev) => (prev ? `${prev.trim()}\n${content}` : content));
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

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
                size_str: formatBytes(sz),
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

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes <= 0) return 'Unknown';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
  const activeItemsToAdd = useMemo<
    Array<{ url: string; filename: string; subfolder?: string; category?: Category }>
  >(() => {
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
            : (threadCount > 0 ? threadCount : defaultEngineThreads || globalSettings.defaultThreadCount || 8);
        const itemSpeedLimit =
          matchedVault && matchedVault.speedLimit && matchedVault.speedLimit > 0
            ? matchedVault.speedLimit * 1024
            : speedLimitBytes;

        const resolvedCategory: Category = selectedCategory !== 'All'
          ? selectedCategory
          : (entry.category || detectCategory(entry.filename || entry.url));

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

      await addBatchDownloads(preparedItems, startImmediately, (current, total, currentItemName) => {
        setSubmitProgress({
          current,
          total,
          percent: Math.min(100, Math.round((current / (total || 1)) * 100)),
          currentName: currentItemName || '',
        });
      });

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
      <DialogContent showCloseButton={false} className="max-w-[700px] w-[70%] h-[88vh] max-h-[740px] p-0 gap-0 overflow-hidden flex flex-col bg-background border border-border/80 rounded-2xl shadow-2xl">
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
            {/* TAB 1: Pattern / Sequence */}
            <TabsContent value="pattern" className="m-0 space-y-4 focus-visible:outline-none">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold text-foreground flex items-center justify-between">
                  <span>
                    URL Template (use{' '}
                    <code className="text-primary bg-muted px-1.5 py-0.5 rounded font-mono">*</code>{' '}
                    or{' '}
                    <code className="text-primary bg-muted px-1.5 py-0.5 rounded font-mono">
                      [01-50:2]
                    </code>{' '}
                    for wildcards):
                  </span>
                  <span className="text-[10px] text-muted-foreground font-mono">
                    Multiple * supported
                  </span>
                </Label>
                <Input
                  type="text"
                  value={patternUrl}
                  onChange={(e) => setPatternUrl(e.target.value)}
                  placeholder="http://example.com/files/season_*_episode_*.mp4"
                  className="w-full bg-background border-border text-foreground font-mono text-xs"
                />
              </div>

              {/* Multi-Wildcard Selector (shown when there are 2 or more asterisks) */}
              {asteriskCount > 1 && (
                <Card className="bg-muted/30 border-border p-3 space-y-2 rounded-xl">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-primary flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-primary" />
                      Detected {asteriskCount} Wildcards (
                      <code className="text-primary bg-muted px-1 py-0.5 rounded font-mono">*</code>
                      )
                    </span>
                    <span className="text-[10.5px] text-muted-foreground">
                      Click a wildcard to configure:
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: asteriskCount }).map((_, idx) => {
                      const isSelected = currentWildcardIdx === idx;
                      const cfg = wildcardConfigs[idx] || {
                        seqType: 'numeric',
                        numFrom: 1,
                        numTo: 10,
                        numStep: 1,
                        alphaFrom: 'a',
                        alphaTo: 'j',
                        alphaStep: 1,
                      };
                      const summary =
                        cfg.seqType === 'numeric'
                          ? `${cfg.numFrom}..${cfg.numTo} (step ${cfg.numStep || 1})`
                          : `${cfg.alphaFrom}..${cfg.alphaTo} (step ${cfg.alphaStep || 1})`;
                      return (
                        <Button
                          key={idx}
                          type="button"
                          variant={isSelected ? 'default' : 'outline'}
                          size="sm"
                          onClick={() => setActiveWildcardIdx(idx)}
                          className="h-8 text-xs font-medium space-x-1.5"
                        >
                          <span className="font-mono font-bold">Wildcard #{idx + 1} (*)</span>
                          <span className="text-[10px] opacity-75 font-mono">[{summary}]</span>
                        </Button>
                      );
                    })}
                  </div>
                </Card>
              )}

              {/* Range and Interval Settings for Active Wildcard */}
              <Card className="bg-muted/30 border-border p-4 space-y-3 rounded-xl">
                {asteriskCount > 1 && (
                  <div className="text-[11px] font-bold text-primary flex items-center justify-between border-b border-border pb-2">
                    <span>Configuring Wildcard #{currentWildcardIdx + 1} (*)</span>
                    <span className="text-[10px] text-muted-foreground font-normal">
                      All wildcard combinations will be downloaded
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-[11px] font-semibold text-foreground">
                      Sequence Type:
                    </Label>
                    <div className="flex space-x-2">
                      <Button
                        type="button"
                        variant={currentConfig.seqType === 'numeric' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => updateCurrentConfig({ seqType: 'numeric' })}
                        className="flex-1 text-xs"
                      >
                        Numeric (1..50)
                      </Button>
                      <Button
                        type="button"
                        variant={currentConfig.seqType === 'alpha' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => updateCurrentConfig({ seqType: 'alpha' })}
                        className="flex-1 text-xs"
                      >
                        Alphabetical (a..z)
                      </Button>
                    </div>
                  </div>

                  {currentConfig.seqType === 'numeric' ? (
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-[10px] text-muted-foreground block mb-1">From:</Label>
                        <Input
                          type="text"
                          value={
                            currentConfig.numFrom !== undefined ? String(currentConfig.numFrom) : ''
                          }
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, '');
                            updateCurrentConfig({ numFrom: val });
                          }}
                          placeholder="1"
                          className="bg-background text-center text-xs font-mono h-8"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground block mb-1">To:</Label>
                        <Input
                          type="text"
                          value={
                            currentConfig.numTo !== undefined ? String(currentConfig.numTo) : ''
                          }
                          onChange={(e) => {
                            const val = e.target.value.replace(/[^0-9]/g, '');
                            updateCurrentConfig({ numTo: val });
                          }}
                          placeholder="10"
                          className="bg-background text-center text-xs font-mono h-8"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground block mb-1">
                          Interval:
                        </Label>
                        <Input
                          type="number"
                          min={1}
                          max={1000}
                          value={currentConfig.numStep || 1}
                          onChange={(e) =>
                            updateCurrentConfig({
                              numStep: Math.max(1, Number(e.target.value) || 1),
                            })
                          }
                          placeholder="1"
                          className="bg-background text-center text-xs font-mono font-bold text-primary h-8"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <Label className="text-[10px] text-muted-foreground block mb-1">
                            From:
                          </Label>
                          <Input
                            type="text"
                            value={currentConfig.alphaFrom || ''}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^a-zA-Z]/g, '');
                              const char = raw.length > 0 ? raw[raw.length - 1] : '';
                              updateCurrentConfig({ alphaFrom: char });
                            }}
                            placeholder="a"
                            className="bg-background text-center text-xs font-mono font-bold h-8"
                          />
                        </div>
                        <div>
                          <Label className="text-[10px] text-muted-foreground block mb-1">
                            To:
                          </Label>
                          <Input
                            type="text"
                            value={currentConfig.alphaTo || ''}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^a-zA-Z]/g, '');
                              const char = raw.length > 0 ? raw[raw.length - 1] : '';
                              updateCurrentConfig({ alphaTo: char });
                            }}
                            placeholder="z"
                            className="bg-background text-center text-xs font-mono font-bold h-8"
                          />
                        </div>
                        <div>
                          <Label className="text-[10px] text-muted-foreground block mb-1">
                            Interval:
                          </Label>
                          <Input
                            type="number"
                            min={1}
                            max={25}
                            value={currentConfig.alphaStep || 1}
                            onChange={(e) =>
                              updateCurrentConfig({
                                alphaStep: Math.max(1, Number(e.target.value) || 1),
                              })
                            }
                            placeholder="1"
                            className="bg-background text-center text-xs font-mono font-bold text-primary h-8"
                          />
                        </div>
                      </div>
                      {/* Quick Case Switcher */}
                      <div className="flex items-center justify-end space-x-1.5 pt-0.5">
                        <span className="text-[9.5px] text-muted-foreground">Presets:</span>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => updateCurrentConfig({ alphaFrom: 'a', alphaTo: 'z' })}
                          className="h-6 px-2 text-[9.5px] font-mono"
                        >
                          a..z (lower)
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => updateCurrentConfig({ alphaFrom: 'A', alphaTo: 'Z' })}
                          className="h-6 px-2 text-[9.5px] font-mono text-primary"
                        >
                          A..Z (upper)
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Sample Values Preview for this Wildcard */}
                <div className="pt-2 border-t border-border flex items-center justify-between text-[10.5px]">
                  <span className="text-muted-foreground">
                    {asteriskCount > 1
                      ? `Wildcard #${currentWildcardIdx + 1}`
                      : 'Wildcard'}{' '}
                    Sample Sequence:
                  </span>
                  <Badge variant="secondary" className="font-mono text-primary truncate max-w-[360px]">
                    {currentSampleValues.join(', ')}
                    {currentSampleTotal > 6 ? `... (${currentSampleTotal} items)` : ''}
                  </Badge>
                </div>
              </Card>

              {/* Generated list preview */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-foreground font-semibold">
                  <span>Generated URLs Preview:</span>
                  <Badge variant="outline" className="font-mono text-primary font-medium">
                    {generatedPatternUrls.length} links generated
                  </Badge>
                </div>
                <div className="w-full h-32 bg-background border border-border rounded-xl p-2.5 overflow-y-auto font-mono text-[10.5px] text-foreground space-y-1 select-text custom-scrollbar">
                  {generatedPatternUrls.map((u, i) => (
                    <div key={i} className="truncate hover:text-primary">
                      <span className="text-muted-foreground mr-2">{i + 1}.</span>
                      {u}
                    </div>
                  ))}
                  {generatedPatternUrls.length === 0 && (
                    <div className="text-muted-foreground italic p-2 text-center">
                      No URLs generated yet. Enter a valid pattern above.
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            {/* TAB 2: Text / URL List */}
            <TabsContent value="text" className="m-0 space-y-3 focus-visible:outline-none">
              <div className="flex items-center justify-between">
                <Label className="text-[11px] font-semibold text-foreground">
                  Paste URLs (one link per line):
                </Label>
                <div className="flex items-center space-x-2">
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleImportTxtFile}
                    accept=".txt"
                    className="hidden"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-7 text-xs flex items-center space-x-1.5"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Import from .txt</span>
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      const unique = Array.from(new Set(parsedTextUrls));
                      setTextList(unique.join('\n'));
                    }}
                    className="h-7 text-xs"
                  >
                    Deduplicate
                  </Button>
                </div>
              </div>

              <textarea
                value={textList}
                onChange={(e) => setTextList(e.target.value)}
                placeholder="https://example.com/file1.zip&#10;https://example.com/file2.zip&#10;https://example.com/file3.zip"
                rows={7}
                className="w-full bg-background border border-border focus:border-primary text-foreground font-mono text-[11px] rounded-xl p-3 outline-none transition-all resize-y select-text"
              />

              <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
                <span>Direct URLs, FTP, or Magnet links supported</span>
                <Badge variant="outline" className="font-mono text-primary font-medium">
                  {parsedTextUrls.length} valid links detected
                </Badge>
              </div>
            </TabsContent>

            {/* TAB 3: Webpage Link Sniffer / Site Crawler */}
            <TabsContent value="crawler" className="m-0 space-y-3.5 focus-visible:outline-none">
              <div className="space-y-2">
                <Label className="text-[11px] font-semibold text-foreground">
                  Webpage or Server URL to scan:
                </Label>
                <div className="flex space-x-2">
                  <Input
                    type="text"
                    value={crawlUrl}
                    onChange={(e) => setCrawlUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleScanCrawlerLinks();
                      }
                    }}
                    placeholder="http://localhost:3000/ or http://172.16.50.12/..."
                    className="flex-1 bg-background border-border text-foreground font-mono text-xs"
                  />
                  <Button
                    type="button"
                    disabled={isCrawling || !crawlUrl.trim()}
                    onClick={handleScanCrawlerLinks}
                    size="sm"
                    className="flex items-center space-x-1.5 px-4"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isCrawling ? 'animate-spin' : ''}`} />
                    <span>{isCrawling ? 'Scanning...' : 'Scan Links'}</span>
                  </Button>
                </div>

                {/* Subfolder & Recursion Controls */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground pt-0.5">
                  <div className="flex items-center space-x-3.5">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="crawl-subfolders"
                        checked={includeSubfolders}
                        onCheckedChange={(c) => setIncludeSubfolders(Boolean(c))}
                      />
                      <Label htmlFor="crawl-subfolders" className="text-xs cursor-pointer">
                        Include Subfolders (Recursive)
                      </Label>
                    </div>

                    {includeSubfolders && (
                      <div className="flex items-center space-x-1.5">
                        <span className="text-muted-foreground text-[10.5px]">Depth:</span>
                        <select
                          value={crawlMaxDepth}
                          onChange={(e) => setCrawlMaxDepth(Number(e.target.value))}
                          className="bg-background border border-border text-foreground text-[10.5px] rounded-lg px-2 py-0.5 outline-none cursor-pointer"
                        >
                          <option value={1}>1 Level</option>
                          <option value={2}>2 Levels</option>
                          <option value={3}>3 Levels (Recommended)</option>
                          <option value={4}>4 Levels</option>
                          <option value={5}>5 Levels</option>
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="recreate-subfolders"
                      checked={recreateSubfoldersOnDisk}
                      onCheckedChange={(c) => setRecreateSubfoldersOnDisk(Boolean(c))}
                    />
                    <Label htmlFor="recreate-subfolders" className="text-xs cursor-pointer">
                      Recreate Subfolders on Disk
                    </Label>
                  </div>
                </div>
              </div>

              {crawlError && (
                <div className="flex items-center space-x-2 p-2.5 bg-destructive/10 border border-destructive/30 rounded-xl text-destructive text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{crawlError}</span>
                </div>
              )}

              {crawledLinks.length > 0 && (
                <div className="space-y-2.5">
                  {/* Category Filter Chips & Controls */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[
                        'All',
                        'Videos',
                        'Compressed',
                        'Programs',
                        'Music',
                        'Pictures',
                        'Documents',
                        'Other',
                      ].map((cat) => (
                        <Button
                          key={cat}
                          type="button"
                          variant={crawlerFilterCat === cat ? 'default' : 'secondary'}
                          size="sm"
                          onClick={() => setCrawlerFilterCat(cat)}
                          className="h-6 text-[10.5px] px-2.5 rounded-lg"
                        >
                          {cat}
                        </Button>
                      ))}
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isProbingSizes}
                      onClick={handleProbeFileSizes}
                      className="h-7 text-[10.5px] flex items-center space-x-1.5"
                    >
                      <HardDrive className="w-3 h-3" />
                      <span>{isProbingSizes ? 'Probing sizes...' : 'Probe Sizes'}</span>
                    </Button>
                  </div>

                  {/* Subfolder Filter Bar */}
                  {discoveredSubfolders.length > 0 && (
                    <Card className="flex items-center justify-between bg-muted/30 border-border rounded-xl px-3 py-1.5 gap-2">
                      <div className="flex items-center space-x-2 flex-1 min-w-0">
                        <FolderOpen className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="text-[10.5px] font-medium text-foreground shrink-0">
                          Subfolder:
                        </span>
                        <select
                          value={crawlerFilterFolder}
                          onChange={(e) => setCrawlerFilterFolder(e.target.value)}
                          className="bg-background border border-border text-foreground text-[10.5px] rounded-lg px-2 py-0.5 outline-none flex-1 max-w-[340px] cursor-pointer truncate"
                        >
                          <option value="All">All Folders ({crawledLinks.length} files)</option>
                          <option value="__root__">
                            📁 [Root Directory] (
                            {crawledLinks.filter((l) => !l.subfolder).length} files)
                          </option>
                          {discoveredSubfolders.map((f) => (
                            <option key={f} value={f}>
                              📁 {f} ({crawledLinks.filter((l) => l.subfolder === f).length} files)
                            </option>
                          ))}
                        </select>
                      </div>

                      {crawlerFilterFolder !== 'All' && (
                        <div className="flex items-center space-x-1.5">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              const targetUrls = new Set(filteredCrawledLinks.map((l) => l.url));
                              setCrawledLinks((prev) =>
                                prev.map((l) =>
                                  targetUrls.has(l.url) ? { ...l, selected: true } : l
                                )
                              );
                            }}
                            className="h-6 text-[10px] px-2"
                          >
                            Select Folder
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              const targetUrls = new Set(filteredCrawledLinks.map((l) => l.url));
                              setCrawledLinks((prev) =>
                                prev.map((l) =>
                                  targetUrls.has(l.url) ? { ...l, selected: false } : l
                                )
                              );
                            }}
                            className="h-6 text-[10px] px-2"
                          >
                            Deselect Folder
                          </Button>
                        </div>
                      )}
                    </Card>
                  )}

                  {/* Search and Selection Summary */}
                  <div className="flex items-center justify-between bg-muted/20 border border-border rounded-xl px-3 py-1.5 gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={toggleSelectAllCrawler}
                      className="h-7 text-xs flex items-center space-x-1.5 px-2"
                    >
                      {filteredCrawledLinks.every((l) => l.selected) ? (
                        <CheckSquare className="w-4 h-4 text-primary" />
                      ) : (
                        <Square className="w-4 h-4 text-muted-foreground" />
                      )}
                      <span>Select All ({filteredCrawledLinks.length})</span>
                    </Button>

                    <div className="flex-1 max-w-[220px] relative">
                      <Search className="w-3 h-3 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <Input
                        type="text"
                        value={crawlerSearch}
                        onChange={(e) => setCrawlerSearch(e.target.value)}
                        placeholder="Search scraped links..."
                        className="w-full bg-background border-border pl-7 pr-2 py-1 h-7 text-[10.5px]"
                      />
                    </div>

                    <div className="flex items-center space-x-2">
                      <Badge variant="outline" className="text-[10.5px] font-mono text-primary">
                        {crawledLinks.filter((l) => l.selected).length} of {crawledLinks.length}{' '}
                        selected
                      </Badge>
                    </div>
                  </div>

                  {/* Scraped Links Table */}
                  <div className="max-h-52 overflow-y-auto border border-border rounded-xl bg-background custom-scrollbar">
                    <Table>
                      <TableHeader className="bg-muted/40 sticky top-0 border-b border-border">
                        <TableRow>
                          <TableHead className="w-8 px-3 py-1.5"></TableHead>
                          <TableHead className="px-2 py-1.5">Filename</TableHead>
                          <TableHead className="w-20 px-2 py-1.5">Size</TableHead>
                          <TableHead className="w-24 px-2 py-1.5">Category</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredCrawledLinks.map((item, idx) => (
                          <TableRow
                            key={idx}
                            onClick={() => toggleSelectLink(item.url)}
                            className={`cursor-pointer transition-colors ${
                              item.selected ? 'bg-primary/10' : ''
                            }`}
                          >
                            <TableCell className="px-3 py-1.5">
                              {item.selected ? (
                                <CheckSquare className="w-3.5 h-3.5 text-primary" />
                              ) : (
                                <Square className="w-3.5 h-3.5 text-muted-foreground" />
                              )}
                            </TableCell>
                            <TableCell className="px-2 py-1.5 truncate max-w-[300px]">
                              <div className="font-medium text-foreground truncate">
                                {item.filename}
                              </div>
                              <div className="flex items-center space-x-1.5 text-[9.5px] truncate">
                                {item.subfolder && (
                                  <Badge variant="secondary" className="px-1 py-0 text-[9.5px]">
                                    📁 {item.subfolder}
                                  </Badge>
                                )}
                                <span className="text-muted-foreground truncate font-mono">
                                  {item.url}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                              {item.size_str || formatBytes(item.size)}
                            </TableCell>
                            <TableCell className="px-2 py-1.5">
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {item.category || 'Other'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* SHARED SETTINGS CARD */}
            <Card className="bg-muted/30 border-border rounded-xl p-4 space-y-3 mt-4">
              <div className="flex items-center justify-between border-b border-border pb-2">
                <div className="flex items-center space-x-1.5 text-foreground text-[11px] font-semibold">
                  <Sliders className="w-3.5 h-3.5 text-primary" />
                  <span>Shared Download Settings</span>
                </div>
                {matchedVaultItem && (
                  <Badge variant="outline" className="text-primary space-x-1 text-[10px]">
                    <ShieldCheck className="w-3 h-3" />
                    <span>
                      Site Vault: <strong>{matchedVaultItem.host}</strong>
                    </span>
                  </Badge>
                )}
              </div>

              {/* Row 1: Save Location + Assign to Queue */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10.5px] font-medium text-muted-foreground flex items-center space-x-1">
                    <FolderOpen className="w-3 h-3" />
                    <span>Save Location:</span>
                  </Label>
                  <div className="flex space-x-1.5">
                    <Input
                      type="text"
                      value={savePath}
                      onChange={(e) => setSavePath(e.target.value)}
                      className="flex-1 bg-background border-border text-foreground text-xs font-mono h-8"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handlePickFolder}
                      className="h-8 text-xs px-3"
                    >
                      Browse
                    </Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10.5px] font-medium text-muted-foreground flex items-center space-x-1">
                    <ListPlus className="w-3 h-3" />
                    <span>Assign to Queue:</span>
                  </Label>
                  <select
                    value={selectedQueue}
                    onChange={(e) => setSelectedQueue(e.target.value)}
                    className="w-full bg-background border border-border text-foreground text-xs rounded-lg px-2.5 py-1.5 outline-none cursor-pointer h-8"
                  >
                    <option value="">None (General)</option>
                    {queues.map((q) => (
                      <option key={q.id} value={q.name}>
                        {q.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Row 2: Category + Threads + Speed Limit */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                <div className="sm:col-span-6 space-y-1">
                  <Label className="text-[10.5px] font-medium text-muted-foreground flex items-center space-x-1">
                    <Filter className="w-3 h-3" />
                    <span>Category:</span>
                  </Label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value as Category)}
                    disabled={!useCategory}
                    className={`w-full bg-background border border-border text-foreground text-xs rounded-lg px-2.5 py-1.5 outline-none cursor-pointer h-8 transition-opacity ${
                      !useCategory ? 'opacity-40 cursor-not-allowed' : ''
                    }`}
                  >
                    <option value="All">All (Auto-detect from file extension)</option>
                    <option value="Videos">Videos</option>
                    <option value="Compressed">Compressed</option>
                    <option value="Programs">Programs</option>
                    <option value="Music">Music</option>
                    <option value="Pictures">Pictures</option>
                    <option value="Documents">Documents</option>
                  </select>
                </div>

                <div className="sm:col-span-3 space-y-1">
                  <Label className="text-[10.5px] font-medium text-muted-foreground flex items-center space-x-1">
                    <Cpu className="w-3 h-3" />
                    <span>Threads:</span>
                  </Label>
                  <select
                    value={threadCount}
                    onChange={(e) => setThreadCount(Number(e.target.value))}
                    className="w-full bg-background border border-border text-foreground text-xs rounded-lg px-2.5 py-1.5 outline-none cursor-pointer font-mono h-8"
                  >
                    {[1, 2, 4, 6, 8, 10, 12, 16, 24, 32, 64]
                      .concat(defaultEngineThreads ? [defaultEngineThreads] : [])
                      .filter((v, i, a) => a.indexOf(v) === i)
                      .sort((a, b) => a - b)
                      .map((val) => (
                        <option key={val} value={val}>
                          {val} {val === 1 ? 'Part' : 'Parts'} {val === defaultEngineThreads ? '(Default)' : ''}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="sm:col-span-3 space-y-1">
                  <Label className="text-[10.5px] font-medium text-muted-foreground flex items-center space-x-1">
                    <Gauge className="w-3 h-3" />
                    <span>Speed Limit (KB/s):</span>
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    value={speedLimitKB}
                    onChange={(e) => setSpeedLimitKB(e.target.value)}
                    placeholder="Unlimited"
                    className="w-full bg-background border-border text-foreground text-xs font-mono h-8"
                  />
                </div>
              </div>

              {/* Row 3: Option Toggles */}
              <div className="pt-2 border-t border-border/40 grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {/* Category Toggle */}
                <div className="flex items-center justify-between p-2 rounded-lg bg-background/50 border border-border/40">
                  <div className="space-y-0.5 pr-2">
                    <Label
                      htmlFor="batch-use-category"
                      className="text-[11px] font-medium text-foreground cursor-pointer block"
                    >
                      Category
                    </Label>
                    <p className="text-[9.5px] text-muted-foreground">
                      Save by file category
                    </p>
                  </div>
                  <Switch
                    id="batch-use-category"
                    checked={useCategory}
                    onCheckedChange={setUseCategory}
                    size="sm"
                  />
                </div>

                {/* Show Real Time Progress Window Toggle */}
                <div className="flex items-center justify-between p-2 rounded-lg bg-background/50 border border-border/40">
                  <div className="space-y-0.5 pr-2">
                    <Label
                      htmlFor="batch-show-progress"
                      className="text-[11px] font-medium text-foreground cursor-pointer block"
                    >
                      Show real time progress window
                    </Label>
                    <p className="text-[9.5px] text-muted-foreground">
                      Popup live progress window
                    </p>
                  </div>
                  <Switch
                    id="batch-show-progress"
                    checked={showRealTimeProgress}
                    onCheckedChange={setShowRealTimeProgress}
                    size="sm"
                  />
                </div>

                {/* Show Completion Window Toggle */}
                <div className="flex items-center justify-between p-2 rounded-lg bg-background/50 border border-border/40">
                  <div className="space-y-0.5 pr-2">
                    <Label
                      htmlFor="batch-show-completion"
                      className="text-[11px] font-medium text-foreground cursor-pointer block"
                    >
                      Show completion window
                    </Label>
                    <p className="text-[9.5px] text-muted-foreground">
                      Popup dialog on complete
                    </p>
                  </div>
                  <Switch
                    id="batch-show-completion"
                    checked={showCompletionWindow}
                    onCheckedChange={setShowCompletionWindow}
                    size="sm"
                  />
                </div>
              </div>
            </Card>
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
          <div className="absolute inset-0 z-50 bg-background/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-200 select-none">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/30 flex items-center justify-center mb-4 shadow-lg relative">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
            <h3 className="text-base font-semibold text-foreground mb-1">
              {submitProgress.percent >= 100
                ? 'Downloads Registered Successfully!'
                : `Adding ${submitProgress.total || activeItemsToAdd.length} Downloads to Database...`}
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm mb-4 truncate">
              {submitProgress.percent >= 100
                ? 'Synchronized with SQLite. Opening main downloads view...'
                : submitProgress.currentName
                ? `Registering: ${submitProgress.currentName}`
                : 'Configuring download settings and initializing database...'}
            </p>

            {/* Progress Bar Container */}
            <div className="w-full max-w-xs space-y-1.5">
              <div className="h-2.5 w-full bg-muted rounded-full overflow-hidden border border-border/60">
                <div
                  className="h-full bg-primary transition-all duration-150 rounded-full"
                  style={{ width: `${Math.max(2, submitProgress.percent)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                <span>
                  {submitProgress.current} / {submitProgress.total || activeItemsToAdd.length} files
                </span>
                <span className="font-semibold text-primary">{submitProgress.percent}%</span>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
