/**
 * Webpage Link Sniffer / Site Crawler tab for the BatchDownloadModal.
 */
import React from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrapedLink } from './types';
import { BatchLinksTable } from './BatchLinksTable';

interface BatchCrawlerTabProps {
  crawlUrl: string;
  setCrawlUrl: (url: string) => void;
  includeSubfolders: boolean;
  setIncludeSubfolders: (val: boolean) => void;
  crawlMaxDepth: number;
  setCrawlMaxDepth: (depth: number) => void;
  recreateSubfoldersOnDisk: boolean;
  setRecreateSubfoldersOnDisk: (val: boolean) => void;
  isCrawling: boolean;
  crawlError: string | null;
  crawledLinks: ScrapedLink[];
  setCrawledLinks: React.Dispatch<React.SetStateAction<ScrapedLink[]>>;
  filteredCrawledLinks: ScrapedLink[];
  discoveredSubfolders: string[];
  crawlerFilterCat: string;
  setCrawlerFilterCat: (cat: string) => void;
  crawlerFilterFolder: string;
  setCrawlerFilterFolder: (folder: string) => void;
  crawlerSearch: string;
  setCrawlerSearch: (search: string) => void;
  isProbingSizes: boolean;
  onScanCrawlerLinks: () => void;
  onProbeFileSizes: () => void;
  onToggleSelectLink: (url: string) => void;
  onToggleSelectAllCrawler: () => void;
}

export const BatchCrawlerTab: React.FC<BatchCrawlerTabProps> = ({
  crawlUrl,
  setCrawlUrl,
  includeSubfolders,
  setIncludeSubfolders,
  crawlMaxDepth,
  setCrawlMaxDepth,
  recreateSubfoldersOnDisk,
  setRecreateSubfoldersOnDisk,
  isCrawling,
  crawlError,
  crawledLinks,
  setCrawledLinks,
  filteredCrawledLinks,
  discoveredSubfolders,
  crawlerFilterCat,
  setCrawlerFilterCat,
  crawlerFilterFolder,
  setCrawlerFilterFolder,
  crawlerSearch,
  setCrawlerSearch,
  isProbingSizes,
  onScanCrawlerLinks,
  onProbeFileSizes,
  onToggleSelectLink,
  onToggleSelectAllCrawler,
}) => {
  return (
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
                onScanCrawlerLinks();
              }
            }}
            placeholder="http://localhost:3000/ or http://172.16.50.12/..."
            className="flex-1 bg-background border-border text-foreground font-mono text-xs"
          />
          <Button
            type="button"
            disabled={isCrawling || !crawlUrl.trim()}
            onClick={onScanCrawlerLinks}
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
        <BatchLinksTable
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
          onProbeFileSizes={onProbeFileSizes}
          onToggleSelectLink={onToggleSelectLink}
          onToggleSelectAllCrawler={onToggleSelectAllCrawler}
        />
      )}
    </TabsContent>
  );
};
