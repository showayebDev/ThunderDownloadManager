/**
 * Pattern / Sequence Generator tab for the BatchDownloadModal.
 */
import React from 'react';
import { Sliders } from 'lucide-react';
import { TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { WildcardConfig, DEFAULT_WILDCARD_CONFIG } from './types';

interface BatchPatternTabProps {
  patternUrl: string;
  setPatternUrl: (url: string) => void;
  asteriskCount: number;
  wildcardConfigs: WildcardConfig[];
  currentWildcardIdx: number;
  setActiveWildcardIdx: (idx: number) => void;
  currentConfig: WildcardConfig;
  updateCurrentConfig: (patch: Partial<WildcardConfig>) => void;
  currentSampleValues: string[];
  currentSampleTotal: number;
  generatedPatternUrls: string[];
}

export const BatchPatternTab: React.FC<BatchPatternTabProps> = ({
  patternUrl,
  setPatternUrl,
  asteriskCount,
  wildcardConfigs,
  currentWildcardIdx,
  setActiveWildcardIdx,
  currentConfig,
  updateCurrentConfig,
  currentSampleValues,
  currentSampleTotal,
  generatedPatternUrls,
}) => {
  return (
    <TabsContent value="pattern" className="m-0 space-y-4 focus-visible:outline-none">
      <div className="space-y-1.5">
        <Label className="text-[11px] font-semibold text-foreground flex items-center justify-between">
          <span>
            URL Template (use{' '}
            <code className="text-primary bg-muted px-1.5 py-0.5 rounded font-mono">*</code> or{' '}
            <code className="text-primary bg-muted px-1.5 py-0.5 rounded font-mono">
              [01-50:2]
            </code>{' '}
            for wildcards):
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">Multiple * supported</span>
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
              <code className="text-primary bg-muted px-1 py-0.5 rounded font-mono">*</code>)
            </span>
            <span className="text-[10.5px] text-muted-foreground">
              Click a wildcard to configure:
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: asteriskCount }).map((_, idx) => {
              const isSelected = currentWildcardIdx === idx;
              const cfg = wildcardConfigs[idx] || DEFAULT_WILDCARD_CONFIG;
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
            <Label className="text-[11px] font-semibold text-foreground">Sequence Type:</Label>
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
                  value={currentConfig.numFrom !== undefined ? String(currentConfig.numFrom) : ''}
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
                  value={currentConfig.numTo !== undefined ? String(currentConfig.numTo) : ''}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, '');
                    updateCurrentConfig({ numTo: val });
                  }}
                  placeholder="10"
                  className="bg-background text-center text-xs font-mono h-8"
                />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground block mb-1">Interval:</Label>
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
                  <Label className="text-[10px] text-muted-foreground block mb-1">From:</Label>
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
                  <Label className="text-[10px] text-muted-foreground block mb-1">To:</Label>
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
                  <Label className="text-[10px] text-muted-foreground block mb-1">Interval:</Label>
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
            {asteriskCount > 1 ? `Wildcard #${currentWildcardIdx + 1}` : 'Wildcard'} Sample
            Sequence:
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
  );
};
