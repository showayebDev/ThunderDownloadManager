import React, { useState, useEffect } from 'react';
import {
  Link2,
  Clipboard,
  Sparkles,
  Globe,
  Radio,
  Video,
  ChevronDown,
  Check,
  X,
} from 'lucide-react';
import { useDownloadContext } from '../../context/DownloadContext';
import { invoke } from '../../utils/tauriBridge';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '../ui/dialog';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '../ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '../ui/tooltip';

export const NewDownloadModal: React.FC = () => {
  const { closeModal, extensionPayload } = useDownloadContext();

  const [url, setUrl] = useState<string>(extensionPayload?.url || '');
  const [protocol, setProtocol] = useState<'Auto' | 'HTTP' | 'HLS' | 'Yt-DLP'>('Auto');

  const detectProtocolFromUrl = (targetUrl: string): 'HLS' | 'Yt-DLP' | null => {
    const lower = targetUrl.toLowerCase();
    if (lower.includes('.m3u8')) return 'HLS';
    const ytDlpHosts = [
      'youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com', 
      'instagram.com', 'facebook.com', 'fb.watch', 'twitter.com', 
      'x.com', 'dailymotion.com', 'bilibili.com', 'soundcloud.com', 'twitch.tv'
    ];
    if (ytDlpHosts.some((h) => lower.includes(h))) return 'Yt-DLP';
    return null;
  };

  useEffect(() => {
    if (extensionPayload?.url) {
      setUrl(extensionPayload.url);
      const detected = detectProtocolFromUrl(extensionPayload.url);
      if (detected) setProtocol(detected);
    } else {
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then((text) => {
          if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
            setUrl(text.trim());
            const detected = detectProtocolFromUrl(text.trim());
            if (detected) setProtocol(detected);
          }
        }).catch(() => { });
      }
    }
  }, [extensionPayload]);

  const handleUrlChange = (newUrl: string) => {
    setUrl(newUrl);
    if (protocol === 'Auto') {
      const detected = detectProtocolFromUrl(newUrl);
      if (detected) setProtocol(detected);
    }
  };

  const handlePasteClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          setUrl(text);
          const detected = detectProtocolFromUrl(text);
          if (detected) setProtocol(detected);
        }
      }
    } catch { }
  };

  const handleOk = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!url.trim()) return;

    try {
      await invoke('process_new_download', url.trim());
    } catch (err) {
      console.error("Failed to process new download:", err);
    }

    setUrl('');
    closeModal();
  };

  const handleCancel = () => {
    setUrl('');
    closeModal();
  };

  const PROTOCOL_OPTIONS: {
    id: 'Auto' | 'HTTP' | 'HLS' | 'Yt-DLP';
    label: string;
    desc: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: 'Auto',
      label: 'Auto',
      desc: 'Smart protocol detection',
      icon: <Sparkles className="w-3.5 h-3.5 text-primary" />,
    },
    {
      id: 'HTTP',
      label: 'HTTP',
      desc: 'Direct multi-threaded download',
      icon: <Globe className="w-3.5 h-3.5 text-sky-400" />,
    },
    {
      id: 'HLS',
      label: 'HLS',
      desc: 'Live M3U8 video stream',
      icon: <Radio className="w-3.5 h-3.5 text-emerald-400" />,
    },
    {
      id: 'Yt-DLP',
      label: 'Yt-DLP',
      desc: 'Media stream extractor',
      icon: <Video className="w-3.5 h-3.5 text-rose-400" />,
    },
  ];

  const currentOption = PROTOCOL_OPTIONS.find((p) => p.id === protocol) || PROTOCOL_OPTIONS[0];

  return (
    <Dialog open={true} onOpenChange={(open) => !open && handleCancel()}>
      <DialogContent showCloseButton={false} className="max-w-md w-full p-0 gap-0 overflow-hidden flex flex-col bg-background border border-border/80 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="flex flex-row items-center justify-between px-5 py-3.5 border-b border-border/70 bg-card/60 shrink-0 select-none">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <img src="/icon.svg" alt="Logo" className="w-4 h-4 object-contain" />
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold text-foreground tracking-tight">
                New Download
              </DialogTitle>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleCancel}
            className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-red-500 hover:text-white dark:hover:bg-red-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <form onSubmit={handleOk} className="flex flex-col flex-1">
          <div className="p-5 space-y-3">
            <div className="relative flex items-center">
              <div className="absolute left-3 text-muted-foreground pointer-events-none">
                <Link2 className="w-4 h-4" />
              </div>
              <Input
                type="url"
                required
                autoFocus
                value={url}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="Paste download link here (e.g. https://...)"
                className="pl-9 pr-9 py-2 text-xs font-mono h-9"
              />
              <div className="absolute right-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handlePasteClipboard}
                      className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    >
                      <Clipboard className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="left">Paste download link from clipboard</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>

          <div className="px-5 py-3.5 border-t border-border/70 bg-card/60 flex flex-row items-center justify-between gap-3 shrink-0 select-none">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 text-xs h-8">
                  {currentOption.icon}
                  <span className="font-semibold">{protocol}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                <DropdownMenuLabel className="text-[10px] uppercase text-muted-foreground">
                  Engine Protocol
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {PROTOCOL_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt.id}
                    onClick={() => setProtocol(opt.id)}
                    className="flex items-center justify-between py-2 cursor-pointer"
                  >
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <div className="p-1 rounded bg-muted shrink-0">
                        {opt.icon}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-xs leading-tight">{opt.label}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{opt.desc}</div>
                      </div>
                    </div>
                    {protocol === opt.id && <Check className="w-4 h-4 text-primary shrink-0 ml-2" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={handleCancel} className="text-xs h-8 px-4 rounded-lg">
                Cancel
              </Button>
              <Button type="submit" size="sm" className="text-xs h-8 px-5 rounded-lg shadow-sm">
                OK
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
