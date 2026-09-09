import React, { useState, useEffect } from 'react';
import { ShieldCheck, Copy, Check, AlertCircle, X } from 'lucide-react';
import { invoke } from '../../utils/tauriBridge';
import { loadFromThunderDB } from '../../utils/thunderDB';
import { Tooltip, HelpTooltip } from '../common/Tooltip';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';

interface ChecksumModalProps {
  filePath: string;
  fileName: string;
  taskId?: string;
  givenCheckSum?: string;
  onClose: () => void;
}

const detectAlgo = (hash?: string): 'sha256' | 'md5' => {
  if (!hash) return 'sha256';
  const clean = hash.trim().toLowerCase().replace(/^(sha256|sha-256|md5):\s*/i, '');
  if (hash.toLowerCase().startsWith('md5:') || clean.length === 32) return 'md5';
  return 'sha256';
};

export const ChecksumModal: React.FC<ChecksumModalProps> = ({
  filePath,
  fileName,
  taskId,
  givenCheckSum,
  onClose,
}) => {
  const [algorithm, setAlgorithm] = useState<'sha256' | 'md5'>(() => detectAlgo(givenCheckSum));
  const [calculatedHash, setCalculatedHash] = useState<string>('');
  const [expectedHash, setExpectedHash] = useState<string>(givenCheckSum || '');
  const [isCalculating, setIsCalculating] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    async function loadGivenChecksumFromJson() {
      // Check direct prop
      if (givenCheckSum && givenCheckSum.trim()) {
        setExpectedHash(givenCheckSum.trim());
        setAlgorithm(detectAlgo(givenCheckSum.trim()));
        return;
      }

      // Look up in downloads metadata
      try {
        const downloadsJsonList = await loadFromThunderDB<any[]>('downloads', []);
        const combined = Array.isArray(downloadsJsonList) ? downloadsJsonList : [];

        const matched = combined.find((item) => {
          if (!item) return false;
          if (taskId && item.id === taskId) return true;
          if (item.name && item.name === fileName) return true;
          if (item.filename && item.filename === fileName) return true;
          if (
            item.savePath &&
            filePath &&
            `${item.savePath.replace(/[/\\]+$/, '')}\\${item.name || item.filename}` === filePath
          )
            return true;
          return false;
        });

        if (isMounted && matched) {
          const code =
            matched.givenCheckSum ||
            matched.given_checksum ||
            matched.expectedChecksum ||
            matched.expected_checksum;
          if (code && typeof code === 'string' && code.trim()) {
            setExpectedHash(code.trim());
            setAlgorithm(detectAlgo(code.trim()));
            return;
          }
        }
      } catch (err) {
        console.error('Failed to load givenCheckSum from json:', err);
      }

      // Fall back to backend task state
      if (taskId) {
        try {
          const st = await invoke<any>('get_task_status', { id: taskId });
          if (isMounted && st) {
            const code =
              st.given_checksum ||
              st.givenCheckSum ||
              st.expected_checksum ||
              st.expectedChecksum;
            if (code && typeof code === 'string' && code.trim()) {
              setExpectedHash(code.trim());
              setAlgorithm(detectAlgo(code.trim()));
            }
          }
        } catch {}
      }
    }

    loadGivenChecksumFromJson();

    return () => {
      isMounted = false;
    };
  }, [taskId, fileName, filePath, givenCheckSum]);

  useEffect(() => {
    let isMounted = true;
    async function calculate() {
      if (!filePath) return;
      setIsCalculating(true);
      setCalculatedHash('');
      try {
        const hash = await invoke<string>('calculate_checksum_command', {
          filePath,
          path: filePath,
          algorithm,
          algo: algorithm,
        });
        if (isMounted) {
          setCalculatedHash(hash || '');
        }
      } catch (err) {
        console.error('Failed to calculate checksum:', err);
        if (isMounted) {
          setCalculatedHash('');
        }
      } finally {
        if (isMounted) setIsCalculating(false);
      }
    }

    calculate();

    return () => {
      isMounted = false;
    };
  }, [filePath, algorithm]);

  const handleCopy = () => {
    if (calculatedHash) {
      navigator.clipboard.writeText(calculatedHash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const normalizedExpected = expectedHash
    .trim()
    .toLowerCase()
    .replace(/^(sha256|sha-256|md5):\s*/i, '');
  const isMatched =
    normalizedExpected !== '' && calculatedHash.toLowerCase() === normalizedExpected;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false} className="max-w-xl w-full p-0 gap-0 overflow-hidden flex flex-col bg-background border border-border/80 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex flex-row items-center justify-between px-5 py-3.5 border-b border-border/70 bg-card/60 shrink-0 select-none">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold text-foreground tracking-tight">
                File Checksum Verification
              </DialogTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Verify cryptographic file integrity and match hashes
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

        {/* Modal body */}
        <div className="p-5 space-y-4 text-xs">
          <Card className="bg-muted/40 border-border p-3 rounded-xl">
            <div className="text-[11px] text-muted-foreground font-medium">File Name:</div>
            <div className="font-semibold text-foreground truncate mt-0.5">{fileName}</div>
          </Card>

          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1 font-medium text-foreground">
              <span>Algorithm:</span>
              <HelpTooltip description="Cryptographic hashing algorithm (SHA-256 or MD5) used for checksum calculation." />
            </div>
            <div className="flex items-center space-x-1.5 bg-muted/60 p-1 rounded-xl border border-border">
              <Button
                variant={algorithm === 'sha256' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setAlgorithm('sha256')}
                className="h-7 text-xs font-medium px-3 rounded-lg"
              >
                SHA-256
              </Button>
              <Button
                variant={algorithm === 'md5' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setAlgorithm('md5')}
                className="h-7 text-xs font-medium px-3 rounded-lg"
              >
                MD5
              </Button>
            </div>
          </div>

          {/* Computed hash */}
          <div className="space-y-1.5">
            <div className="flex items-center space-x-1 text-muted-foreground font-medium text-[11px]">
              <span>Calculated {algorithm.toUpperCase()} Hash:</span>
              <HelpTooltip description="Digest computed from the local downloaded file." />
            </div>
            <div className="relative flex items-center">
              <Input
                type="text"
                readOnly
                value={isCalculating ? 'Calculating hash...' : calculatedHash}
                className="w-full bg-background border-border text-foreground font-mono text-[11px] pr-9 h-9"
              />
              <Tooltip text={copied ? 'Copied!' : 'Copy calculated hash'} position="left">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={handleCopy}
                  disabled={isCalculating || !calculatedHash}
                  className="absolute right-1 text-muted-foreground hover:text-foreground h-7 w-7"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </Button>
              </Tooltip>
            </div>
          </div>

          {/* Expected hash input */}
          <div className="space-y-1.5">
            <div className="flex items-center space-x-1 text-muted-foreground font-medium text-[11px]">
              <span>Compare Expected Hash (Optional):</span>
              <HelpTooltip description="Paste original hash provided by the author/distributor to verify file integrity." />
            </div>
            <Input
              type="text"
              value={expectedHash}
              onChange={(e) => setExpectedHash(e.target.value)}
              placeholder="Paste expected checksum to verify"
              className="w-full bg-background border-border text-foreground font-mono text-[11px] h-9"
            />
          </div>

          {/* Match indicator */}
          {expectedHash.trim() && (
            <div
              className={`p-3 rounded-xl flex items-center space-x-2 border transition-colors ${
                isMatched
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
              }`}
            >
              {isMatched ? (
                <Check className="w-4 h-4 text-emerald-500" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-500" />
              )}
              <span className="font-semibold text-xs">
                {isMatched ? 'Checksum Verified Match!' : 'Checksum Mismatch!'}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-border/70 bg-card/60 flex flex-row items-center justify-end gap-2.5 shrink-0 select-none">
          <Button variant="outline" size="sm" onClick={onClose} className="rounded-lg px-5 text-xs">
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
