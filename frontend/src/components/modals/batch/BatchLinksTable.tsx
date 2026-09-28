/**
 * Filterable and searchable table of scraped links for the Webpage Link Sniffer tab.
 */
import React from 'react';
import { FolderOpen, Search, CheckSquare, Square, HardDrive } from 'lucide-react';
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
import { ScrapedLink, formatBatchBytes } from './types';

const CRAWLER_CATEGORIES = [
  'All',
  'Videos',
  'Compressed',
  'Programs',
  'Music',
  'Pictures',
  'Documents',
  'Other',
];

interface BatchLinksTableProps {
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
  onProbeFileSizes: () => void;
  onToggleSelectLink: (url: string) => void;
  onToggleSelectAllCrawler: () => void;
}

export const BatchLinksTable: React.FC<BatchLinksTableProps> = ({
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
  onProbeFileSizes,
  onToggleSelectLink,
  onToggleSelectAllCrawler,
}) => {
  return (
    <div className="space-y-2.5">
      {/* Category Filter Chips & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {CRAWLER_CATEGORIES.map((cat) => (
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
          onClick={onProbeFileSizes}
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
            <span className="text-[10.5px] font-medium text-foreground shrink-0">Subfolder:</span>
            <select
              value={crawlerFilterFolder}
              onChange={(e) => setCrawlerFilterFolder(e.target.value)}
              className="bg-background border border-border text-foreground text-[10.5px] rounded-lg px-2 py-0.5 outline-none flex-1 max-w-[340px] cursor-pointer truncate"
            >
              <option value="All">All Folders ({crawledLinks.length} files)</option>
              <option value="__root__">
                📁 [Root Directory] ({crawledLinks.filter((l) => !l.subfolder).length} files)
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
                    prev.map((l) => (targetUrls.has(l.url) ? { ...l, selected: true } : l))
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
                    prev.map((l) => (targetUrls.has(l.url) ? { ...l, selected: false } : l))
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
          onClick={onToggleSelectAllCrawler}
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
            {crawledLinks.filter((l) => l.selected).length} of {crawledLinks.length} selected
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
                onClick={() => onToggleSelectLink(item.url)}
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
                  <div className="font-medium text-foreground truncate">{item.filename}</div>
                  <div className="flex items-center space-x-1.5 text-[9.5px] truncate">
                    {item.subfolder && (
                      <Badge variant="secondary" className="px-1 py-0 text-[9.5px]">
                        📁 {item.subfolder}
                      </Badge>
                    )}
                    <span className="text-muted-foreground truncate font-mono">{item.url}</span>
                  </div>
                </TableCell>
                <TableCell className="px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                  {item.size_str || formatBatchBytes(item.size)}
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
  );
};
