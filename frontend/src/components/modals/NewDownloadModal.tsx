import React, { useState, useEffect, useRef } from 'react';
import {
  Link2,
  Clipboard,
  Sparkles,
  Globe,
  Radio,
  Video,
  Magnet,
  FolderOpen,
  Upload,
  ChevronDown,
  Check,
  X,
  FileCode,
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
  const [protocol, setProtocol] = useState<'Auto' | 'HTTP' | 'HLS' | 'Yt-DLP' | 'Torrent'>('Auto');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const detectProtocolFromUrl = (targetUrl: string): 'HLS' | 'Yt-DLP' | 'Torrent' | null => {
    const lower = targetUrl.toLowerCase();
    if (lower.startsWith('magnet:') || lower.endsWith('.torrent') || lower.includes('.torrent?') || lower.includes('.torrent#')) {
      return 'Torrent';
    }
    if (lower.includes('.m3u8')) return 'HLS';
    const ytDlpHosts = [
      'youtube.com', 'youtu.be', 'music.youtube.com',
      'vimeo.com', 'dailymotion.com', 'dai.ly',
      'tiktok.com', 'douyin.com', 'kuaishou.com',
      'instagram.com', 'threads.net',
      'facebook.com', 'fb.watch', 'fb.com',
      'twitter.com', 'x.com',
      'twitch.tv', 'soundcloud.com', 'bandcamp.com', 'mixcloud.com',
      'bilibili.com', 'bilibili.tv', 'bilibili.co', 'bili.im', 'bilibili.to', 'bilibili.global',
      'reddit.com', 'streamable.com', 'loom.com',
      'pinterest.com', 'pin.it',
      'vk.com', 'ok.ru', 'rumble.com', 'odysee.com', 'bitchute.com',
      'weibo.com', 'nicovideo.jp', 'coub.com', 'patreon.com',
      'vlive.tv', 'ted.com', 'archive.org',
    ];
    if (ytDlpHosts.some((h) => lower.includes(h))) return 'Yt-DLP';
    if (
      lower.includes('/video/') ||
      lower.includes('/videos/') ||
      lower.includes('/shorts/') ||
      lower.includes('/reel/') ||
      lower.includes('/reels/') ||
      lower.includes('/bangumi/') ||
      (lower.includes('/watch') && (lower.includes('stream') || lower.includes('media') || lower.includes('tv')))
    ) {
      return 'Yt-DLP';
    }
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
          if (text) {
            const clean = text.trim();
            if (clean.startsWith('http://') || clean.startsWith('https://') || clean.startsWith('magnet:') || clean.endsWith('.torrent')) {
              setUrl(clean);
              const detected = detectProtocolFromUrl(clean);
              if (detected) setProtocol(detected);
            }
          }
        }).catch(() => { });
      }
    }
  }, [extensionPayload]);

  const handleUrlChange = (newUrl: string) => {
    setUrl(newUrl);
    if (protocol === 'Auto' || protocol === 'Torrent') {
      const detected = detectProtocolFromUrl(newUrl);
      if (detected) {
        setProtocol(detected);
      } else if (protocol === 'Torrent' && !newUrl.toLowerCase().startsWith('magnet:') && !newUrl.toLowerCase().includes('.torrent')) {
        setProtocol('Auto');
      }
    }
  };

  const handlePasteClipboard = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text) {
          const clean = text.trim();
          setUrl(clean);
          const detected = detectProtocolFromUrl(clean);
          if (detected) setProtocol(detected);
        }
      }
    } catch { }
  };

  const handlePickTorrentFile = async () => {
    try {
      const filePath = await invoke<string>('pick_torrent_file');
      if (filePath && filePath.trim()) {
        const cleanPath = filePath.trim();
        setUrl(cleanPath);
        setProtocol('Torrent');
        try {
          await invoke('process_new_download', cleanPath);
          setUrl('');
          closeModal();
          return;
        } catch (err) {
          console.error("Failed to process torrent file:", err);
        }
      }
    } catch (e) {
      console.warn("Native file picker unavailable, falling back to input:", e);
      if (fileInputRef.current) {
        fileInputRef.current.click();
      }
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const filePath = (file as any).path || file.name;
    setUrl(filePath);
    setProtocol('Torrent');

    try {
      if ((file as any).path) {
        await invoke('process_new_download', (file as any).path);
        setUrl('');
        closeModal();
      }
    } catch (err) {
      console.error("Failed to process torrent file input:", err);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const filePath = (file as any).path || file.name;
      if (filePath) {
        setUrl(filePath);
        setProtocol('Torrent');
        try {
          if ((file as any).path) {
            await invoke('process_new_download', (file as any).path);
            setUrl('');
            closeModal();
          }
        } catch (err) {
          console.error("Failed to process dropped torrent file:", err);
        }
      }
    }
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
    id: 'Auto' | 'HTTP' | 'HLS' | 'Yt-DLP' | 'Torrent';
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
      id: 'Torrent',
      label: 'Torrent',
      desc: 'BitTorrent & Magnet links',
      icon: <Magnet className="w-3.5 h-3.5 text-amber-400" />,
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
          {/* Hidden File Input for .torrent */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileInputChange}
            accept=".torrent"
            style={{ display: 'none' }}
          />

          <div
            className={`p-5 space-y-3 transition-colors ${
              isDragging ? 'bg-primary/5 border-2 border-dashed border-primary rounded-xl m-2' : ''
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="relative flex items-center">
              <div className="absolute left-3 text-muted-foreground pointer-events-none">
                {protocol === 'Torrent' ? (
                  <Magnet className="w-4 h-4 text-amber-400" />
                ) : (
                  <Link2 className="w-4 h-4" />
                )}
              </div>
              <Input
                type="text"
                required
                autoFocus
                value={url}
                onChange={(e) => handleUrlChange(e.target.value)}
                placeholder="Paste URL, magnet link, or import .torrent..."
                className="pl-9 pr-16 py-2 text-xs font-mono h-9"
              />
              <div className="absolute right-1.5 flex items-center gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handlePickTorrentFile}
                      className="h-7 w-7 text-muted-foreground hover:text-amber-400 transition-colors"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">Import .torrent file from PC</TooltipContent>
                </Tooltip>

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
                  <TooltipContent side="top">Paste from clipboard</TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Quick helper badge / file drop hint */}
            <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
              <span className="flex items-center gap-1.5">
                <FileCode className="w-3 h-3 text-primary/70" />
                <span>Supports HTTP, HLS, Yt-DLP & <b>BitTorrent</b></span>
              </span>
              <button
                type="button"
                onClick={handlePickTorrentFile}
                className="text-primary hover:underline flex items-center gap-1 font-medium transition-colors"
              >
                <Upload className="w-3 h-3" />
                <span>Import .torrent</span>
              </button>
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
