/**
 * Text / Bulk URL List tab for the BatchDownloadModal.
 */
import React, { useRef } from 'react';
import { Upload } from 'lucide-react';
import { TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';

interface BatchTextListTabProps {
  textList: string;
  setTextList: React.Dispatch<React.SetStateAction<string>>;
  parsedTextUrls: string[];
}

export const BatchTextListTab: React.FC<BatchTextListTabProps> = ({
  textList,
  setTextList,
  parsedTextUrls,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  return (
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
  );
};
