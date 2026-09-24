import React, { useState, useEffect } from 'react';
import {
  Folder,
  Plus,
  Trash2,
  Settings,
  ListOrdered,
  ChevronDown,
  ChevronUp,
  Check,
  Video,
  Binary,
  Archive,
  Music,
  Image as ImageIcon,
  FileText,
  Clock,
  X
} from 'lucide-react';
import { useDownloadContext } from '../../context/DownloadContext';
import { loadFromThunderDB } from '../../utils/thunderDB';
import { formatBytes, formatSpeed } from '../../utils/formatters';
import { Category, QueueConfig, DownloadItem } from '../../types/download';

import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '../ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { Separator } from '../ui/separator';
import { ScrollArea } from '../ui/scroll-area';
import { Progress } from '../ui/progress';

const DAYS_OF_WEEK = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday'
];

const getCategoryIcon = (category: Category) => {
  switch (category) {
    case 'Videos':
      return Video;
    case 'Programs':
      return Binary;
    case 'Compressed':
      return Archive;
    case 'Music':
      return Music;
    case 'Pictures':
      return ImageIcon;
    case 'Documents':
      return FileText;
    default:
      return FileText;
  }
};

const parseTime = (timeStr?: string) => {
  if (!timeStr || !timeStr.includes(':')) return { hour: 2, minute: 30 };
  const parts = timeStr.split(':');
  return {
    hour: Math.min(23, Math.max(0, parseInt(parts[0], 10) || 0)),
    minute: Math.min(59, Math.max(0, parseInt(parts[1], 10) || 0))
  };
};

const formatTimeStr = (hour: number, minute: number) => {
  const h = String(hour).padStart(2, '0');
  const m = String(minute).padStart(2, '0');
  return `${h}:${m}`;
};

interface QueueTimePickerProps {
  value: string;
  onChange: (newTime: string) => void;
}

const QueueTimePicker: React.FC<QueueTimePickerProps> = ({ value, onChange }) => {
  const { hour, minute } = parseTime(value);

  const handleHourStep = (delta: number) => {
    const newH = (hour + delta + 24) % 24;
    onChange(formatTimeStr(newH, minute));
  };

  const handleMinuteStep = (delta: number) => {
    const newM = (minute + delta + 60) % 60;
    onChange(formatTimeStr(hour, newM));
  };

  const handleHourInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (raw === '') {
      onChange(formatTimeStr(0, minute));
      return;
    }
    const val = parseInt(raw, 10);
    if (!isNaN(val)) {
      const clamped = Math.max(0, Math.min(23, val));
      onChange(formatTimeStr(clamped, minute));
    }
  };

  const handleMinuteInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, '');
    if (raw === '') {
      onChange(formatTimeStr(hour, 0));
      return;
    }
    const val = parseInt(raw, 10);
    if (!isNaN(val)) {
      const clamped = Math.max(0, Math.min(59, val));
      onChange(formatTimeStr(hour, clamped));
    }
  };

  return (
    <div className="flex items-center space-x-1.5 bg-muted/90 hover:bg-muted border border-border/80 px-2 py-1 rounded-lg text-xs font-mono shadow-xs select-none transition-colors">
      {/* Hours */}
      <div className="flex items-center space-x-0.5">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          value={String(hour).padStart(2, '0')}
          onChange={handleHourInput}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') { e.preventDefault(); handleHourStep(1); }
            if (e.key === 'ArrowDown') { e.preventDefault(); handleHourStep(-1); }
          }}
          className="w-5 text-center font-mono text-xs font-semibold bg-transparent text-foreground outline-none focus:bg-accent/50 rounded py-0.5"
          title="Hour (00 - 23)"
        />
        <div className="flex flex-col -space-y-0.5">
          <button
            type="button"
            onClick={() => handleHourStep(1)}
            className="p-0.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded hover:bg-accent/60"
            title="Increment hour"
          >
            <ChevronUp className="w-2.5 h-2.5" />
          </button>
          <button
            type="button"
            onClick={() => handleHourStep(-1)}
            className="p-0.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded hover:bg-accent/60"
            title="Decrement hour"
          >
            <ChevronDown className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      <span className="font-bold text-muted-foreground select-none">:</span>

      {/* Minutes */}
      <div className="flex items-center space-x-0.5">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={2}
          value={String(minute).padStart(2, '0')}
          onChange={handleMinuteInput}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') { e.preventDefault(); handleMinuteStep(1); }
            if (e.key === 'ArrowDown') { e.preventDefault(); handleMinuteStep(-1); }
          }}
          className="w-5 text-center font-mono text-xs font-semibold bg-transparent text-foreground outline-none focus:bg-accent/50 rounded py-0.5"
          title="Minute (00 - 59)"
        />
        <div className="flex flex-col -space-y-0.5">
          <button
            type="button"
            onClick={() => handleMinuteStep(1)}
            className="p-0.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded hover:bg-accent/60"
            title="Increment minute"
          >
            <ChevronUp className="w-2.5 h-2.5" />
          </button>
          <button
            type="button"
            onClick={() => handleMinuteStep(-1)}
            className="p-0.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer rounded hover:bg-accent/60"
            title="Decrement minute"
          >
            <ChevronDown className="w-2.5 h-2.5" />
          </button>
        </div>
      </div>

      {/* Native Clock Picker Quick Trigger */}
      <div className="relative flex items-center pl-1 border-l border-border/70 ml-0.5">
        <Clock className="w-3.5 h-3.5 text-muted-foreground hover:text-foreground transition-colors cursor-pointer" />
        <input
          type="time"
          value={formatTimeStr(hour, minute)}
          onChange={(e) => {
            if (e.target.value) {
              onChange(e.target.value);
            }
          }}
          className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
          title="Open system time picker"
        />
      </div>
    </div>
  );
};

export const QueueManagerModal: React.FC = () => {
  const {
    closeModal,
    downloads,
    queues,
    globalSettings,
    saveQueues,
    deleteQueue,
    reorderQueueItems,
    removeItemFromQueue,
  } = useDownloadContext();

  const [localQueues, setLocalQueues] = useState<QueueConfig[]>(() => queues);
  const [engineDefaultThreads, setEngineDefaultThreads] = useState<number>(() => globalSettings?.defaultThreadCount || 8);

  useEffect(() => {
    async function loadEngineData() {
      try {
        const engine = await loadFromThunderDB<any>('download_engine', null);
        if (engine) {
          const defTC = engine.defaultThreadCount || engine.threadCount || globalSettings?.defaultThreadCount || 8;
          setEngineDefaultThreads(defTC);
        }
      } catch {}
    }
    loadEngineData();
  }, [globalSettings]);

  const [selectedQueueId, setSelectedQueueId] = useState<string>(() => {
    return queues.length > 0 ? queues[0].id : 'main';
  });

  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newQueueName, setNewQueueName] = useState<string>('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const selectedQueue: QueueConfig =
    localQueues.find((q) => q.id === selectedQueueId || q.name.toLowerCase() === selectedQueueId.toLowerCase()) ||
    localQueues[0] || {
      id: 'main',
      name: 'Main',
      maxConcurrent: 2,
      automaticStop: false,
      shutdownOnComplete: false,
      scheduleEnabled: false,
      activeDays: DAYS_OF_WEEK,
      enableAutoStartTime: false,
      autoStartTime: '02:30',
      enableAutoStopTime: false,
      autoStopTime: '07:30',
      isRunning: false,
      showRealTimeProgress: false,
      showCompletionWindow: false,
    };

  const handleUpdate = (updates: Partial<QueueConfig>) => {
    setLocalQueues((prev) =>
      prev.map((q) =>
        q.id === selectedQueue.id || q.name.toLowerCase() === selectedQueue.id.toLowerCase()
          ? { ...q, ...updates }
          : q
      )
    );
  };

  const handleCreateQueue = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanName = newQueueName.trim();
    if (!cleanName) return;
    const newId = `queue_${Date.now()}`;
    const newQueue: QueueConfig = {
      id: newId,
      name: cleanName,
      maxConcurrent: 2,
      scheduleEnabled: false,
      activeDays: DAYS_OF_WEEK,
      enableAutoStartTime: false,
      autoStartTime: '02:30',
      enableAutoStopTime: false,
      autoStopTime: '07:30',
      isRunning: false,
      showRealTimeProgress: false,
      showCompletionWindow: false,
    };
    setLocalQueues((prev) => [...prev, newQueue]);
    setSelectedQueueId(newId);
    setNewQueueName('');
    setShowAddModal(false);
  };

  const handleDeleteSelectedQueue = async () => {
    if (selectedQueue.id === 'main' || selectedQueue.name.toLowerCase() === 'main') return;
    const currentId = selectedQueue.id;
    setLocalQueues((prev) =>
      prev.filter((q) => q.id !== currentId && q.name.toLowerCase() !== currentId.toLowerCase())
    );
    setSelectedQueueId('main');
  };

  const handleSave = async () => {
    const currentIds = new Set(localQueues.map((q) => q.id));
    const deleted = queues.filter((q) => !currentIds.has(q.id));
    for (const d of deleted) {
      await deleteQueue(d.id);
    }
    await saveQueues(localQueues);
    closeModal();
  };

  const queueDownloads: DownloadItem[] = downloads.filter((d) => {
    if (!d.queue || d.queue.trim() === '') return false;
    const q = d.queue.toLowerCase();
    return q === selectedQueue.name.toLowerCase() || q === selectedQueue.id.toLowerCase();
  });

  const toggleDay = (day: string) => {
    const currentDays = selectedQueue.activeDays || [];
    let updated: string[];
    if (currentDays.includes(day)) {
      updated = currentDays.filter((d) => d !== day);
    } else {
      updated = [...currentDays, day];
    }
    handleUpdate({ activeDays: updated });
  };

  const handleMoveItem = (direction: 'up' | 'down') => {
    if (!selectedItemId) return;
    const currentIndex = queueDownloads.findIndex((d) => d.id === selectedItemId);
    if (currentIndex < 0) return;

    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= queueDownloads.length) return;

    reorderQueueItems(selectedQueue.name, currentIndex, targetIndex);
  };

  const handleDeleteItem = () => {
    if (!selectedItemId) return;
    removeItemFromQueue(selectedItemId);
    setSelectedItemId(null);
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && closeModal()}>
      <DialogContent showCloseButton={false} className="max-w-3xl sm:max-w-4xl w-full h-[88vh] max-h-[720px] p-0 gap-0 overflow-hidden flex flex-col bg-background border border-border/80 rounded-2xl shadow-2xl">
        {/* Title bar */}
        <div className="px-5 py-3.5 border-b border-border/70 bg-card/60 flex flex-row items-center justify-between shrink-0 select-none">
          <div className="flex items-center space-x-2.5">
            <div className="w-6 h-6 rounded-md bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0 shadow-xs">
              <img src="/icon.svg" alt="Queues" className="w-4 h-4 object-contain" />
            </div>
            <DialogTitle className="text-sm font-semibold tracking-tight text-foreground">
              Queue Manager
            </DialogTitle>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md text-muted-foreground hover:bg-red-500 hover:text-white dark:hover:bg-red-600 transition-colors cursor-pointer"
            onClick={closeModal}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Queues Sidebar */}
          <div className="w-56 bg-card/60 border-r border-border p-3 flex flex-col justify-between shrink-0">
            <div className="space-y-1 overflow-y-auto">
              {localQueues.map((q) => {
                const isSelected = selectedQueue.id === q.id || selectedQueue.name === q.name;
                return (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => setSelectedQueueId(q.id)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-accent text-accent-foreground font-semibold shadow-xs'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    }`}
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      <Folder className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                      <span className="truncate">{q.name}</span>
                    </div>

                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        q.isRunning ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/40'
                      }`}
                      title={q.isRunning ? 'Queue is Running' : 'Queue is Idle'}
                    />
                  </button>
                );
              })}
            </div>

            <div className="pt-2 border-t border-border flex items-center space-x-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setNewQueueName('');
                  setShowAddModal(true);
                }}
                className="flex-1 gap-1 text-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Queue</span>
              </Button>

              <Button
                variant="outline"
                size="icon"
                disabled={selectedQueue.id === 'main' || selectedQueue.name.toLowerCase() === 'main'}
                onClick={handleDeleteSelectedQueue}
                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                title="Delete Queue"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* Queue Config & Items Panel */}
          <Tabs defaultValue="config" className="flex-1 flex flex-col overflow-hidden bg-background">
            <div className="px-5 pt-2 border-b border-border bg-card/40 shrink-0">
              <TabsList className="w-60 grid grid-cols-2">
                <TabsTrigger value="config" className="text-xs gap-1.5">
                  <Settings className="w-3.5 h-3.5" />
                  <span>Config</span>
                </TabsTrigger>
                <TabsTrigger value="items" className="text-xs gap-1.5">
                  <ListOrdered className="w-3.5 h-3.5" />
                  <span>Items ({queueDownloads.length})</span>
                </TabsTrigger>
              </TabsList>
            </div>

            <ScrollArea className="flex-1 p-5 overflow-y-auto">
              <TabsContent value="config" className="space-y-5 m-0">
                {/* General config */}
                <div className="space-y-3">
                  <Label className="text-xs font-semibold">General Settings</Label>
                  <div className="grid grid-cols-1 gap-3">
                    <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                      <div>
                        <Label className="text-xs font-semibold">Queue Name</Label>
                        <p className="text-[11px] text-muted-foreground">Unique identifier for this queue</p>
                      </div>
                      <Input
                        type="text"
                        value={selectedQueue.name}
                        disabled={selectedQueue.id === 'main' || selectedQueue.name.toLowerCase() === 'main'}
                        onChange={(e) => handleUpdate({ name: e.target.value })}
                        className="h-8 text-xs w-48 font-medium"
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                      <div>
                        <Label className="text-xs font-semibold">Max Concurrent Downloads</Label>
                        <p className="text-[11px] text-muted-foreground">Simultaneous active tasks allowed in this queue</p>
                      </div>
                      <Input
                        type="number"
                        min="1"
                        max="16"
                        value={selectedQueue.maxConcurrent || 2}
                        onChange={(e) => handleUpdate({ maxConcurrent: Math.max(1, Math.min(16, parseInt(e.target.value) || 1)) })}
                        className="h-8.5 w-20 text-xs font-mono text-center tabular-nums bg-card border-border"
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                      <div>
                        <Label htmlFor="sw-queue-threads" className="text-xs font-semibold cursor-pointer">
                          Default Threads per Download
                        </Label>
                        <p className="text-[11px] text-muted-foreground">
                          {selectedQueue.threadCount && selectedQueue.threadCount > 0
                            ? `${selectedQueue.threadCount} threads for downloads in this queue`
                            : `Using Engine Default (${engineDefaultThreads} threads)`}
                        </p>
                      </div>
                      <select
                        id="sw-queue-threads"
                        value={selectedQueue.threadCount || 0}
                        onChange={(e) => handleUpdate({ threadCount: Number(e.target.value) })}
                        className="h-8.5 text-xs bg-card border border-border rounded-lg px-2.5 outline-none font-medium cursor-pointer"
                      >
                        <option value={0}>Engine Default ({engineDefaultThreads})</option>
                        <option value={1}>1 Thread</option>
                        <option value={2}>2 Threads</option>
                        <option value={4}>4 Threads</option>
                        <option value={8}>8 Threads</option>
                        {engineDefaultThreads && ![1, 2, 4, 8, 16, 32].includes(engineDefaultThreads) && (
                          <option value={engineDefaultThreads}>{engineDefaultThreads} Threads (Engine Default)</option>
                        )}
                        <option value={16}>16 Threads</option>
                        <option value={32}>32 Threads</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                      <div>
                        <Label htmlFor="sw-queue-realtime" className="text-xs font-semibold cursor-pointer">
                          Show real time download process
                        </Label>
                        <p className="text-[11px] text-muted-foreground">
                          Popup live progress window during queue downloads
                        </p>
                      </div>
                      <Switch
                        id="sw-queue-realtime"
                        checked={Boolean(selectedQueue.showRealTimeProgress)}
                        onCheckedChange={(checked) => handleUpdate({ showRealTimeProgress: checked })}
                      />
                    </div>

                    <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                      <div>
                        <Label htmlFor="sw-queue-completion" className="text-xs font-semibold cursor-pointer">
                          Download compression window
                        </Label>
                        <p className="text-[11px] text-muted-foreground">
                          Popup completion dialog when queue download completes
                        </p>
                      </div>
                      <Switch
                        id="sw-queue-completion"
                        checked={Boolean(selectedQueue.showCompletionWindow)}
                        onCheckedChange={(checked) => handleUpdate({ showCompletionWindow: checked })}
                      />
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Scheduler */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 rounded-lg border border-border bg-card">
                    <div>
                      <Label htmlFor="sw-queue-sched" className="text-xs font-semibold cursor-pointer">Enable Queue Scheduler</Label>
                      <p className="text-[11px] text-muted-foreground">Automatically download according to timer rules</p>
                    </div>
                    <Switch
                      id="sw-queue-sched"
                      checked={selectedQueue.scheduleEnabled}
                      onCheckedChange={(checked) => handleUpdate({ scheduleEnabled: checked })}
                    />
                  </div>

                  {selectedQueue.scheduleEnabled && (
                    <div className="space-y-4 pt-1 animate-in fade-in duration-150">
                      {/* Active Days */}
                      <div className="space-y-2">
                        <Label className="text-xs font-semibold">Active Days of the Week</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {DAYS_OF_WEEK.map((day) => {
                            const isActive = (selectedQueue.activeDays || []).includes(day);
                            return (
                              <Button
                                key={day}
                                type="button"
                                variant={isActive ? "default" : "outline"}
                                size="sm"
                                onClick={() => toggleDay(day)}
                                className="h-7 px-2.5 text-xs rounded-full gap-1"
                              >
                                {isActive && <Check className="w-3 h-3" />}
                                <span>{day}</span>
                              </Button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Timers */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                        <div className="p-3 rounded-lg border border-border bg-card space-y-2">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="sw-start-t" className="text-xs font-semibold cursor-pointer">Auto Start Time</Label>
                            <Switch
                              id="sw-start-t"
                              checked={selectedQueue.enableAutoStartTime}
                              onCheckedChange={(checked) => handleUpdate({ enableAutoStartTime: checked })}
                            />
                          </div>
                          {selectedQueue.enableAutoStartTime && (
                            <div className="flex items-center justify-between pt-1 text-xs">
                              <span className="text-muted-foreground font-medium">Start at:</span>
                              <QueueTimePicker
                                value={selectedQueue.autoStartTime || '02:30'}
                                onChange={(val) => handleUpdate({ autoStartTime: val })}
                              />
                            </div>
                          )}
                        </div>

                        <div className="p-3 rounded-lg border border-border bg-card space-y-2">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="sw-stop-t" className="text-xs font-semibold cursor-pointer">Auto Stop Time</Label>
                            <Switch
                              id="sw-stop-t"
                              checked={selectedQueue.enableAutoStopTime}
                              onCheckedChange={(checked) => handleUpdate({ enableAutoStopTime: checked })}
                            />
                          </div>
                          {selectedQueue.enableAutoStopTime && (
                            <div className="flex items-center justify-between pt-1 text-xs">
                              <span className="text-muted-foreground font-medium">Stop at:</span>
                              <QueueTimePicker
                                value={selectedQueue.autoStopTime || '07:30'}
                                onChange={(val) => handleUpdate({ autoStopTime: val })}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* Items tab */}
              <TabsContent value="items" className="space-y-3 m-0">
                <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border min-h-[220px]">
                  {queueDownloads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                      <span>No downloads currently assigned to this queue</span>
                    </div>
                  ) : (
                    queueDownloads.map((item, index) => {
                      const isSelected = selectedItemId === item.id;
                      const CategoryIcon = getCategoryIcon(item.category);
                      const percent =
                        item.size > 0 ? Math.min(100, Math.round((item.downloaded / item.size) * 100)) : 0;

                      return (
                        <div
                          key={item.id}
                          onClick={() => setSelectedItemId(item.id)}
                          className={`p-3 flex items-center justify-between cursor-pointer transition-colors ${
                            isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/40'
                          }`}
                        >
                          <div className="flex items-center space-x-3 min-w-0 flex-1 pr-3">
                            <span className="text-xs text-muted-foreground font-mono w-4">{index + 1}.</span>
                            <div className="p-1.5 bg-muted text-muted-foreground rounded-lg shrink-0">
                              <CategoryIcon className="w-3.5 h-3.5" />
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-foreground truncate text-xs" title={item.name}>
                                {item.name}
                              </div>
                              <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center space-x-2">
                                <span className={item.status === 'Downloading' ? 'text-primary font-semibold' : ''}>
                                  {item.status}
                                </span>
                                <span>•</span>
                                <span>{formatBytes(item.size > 0 ? item.size : (item.downloaded > 0 ? item.downloaded : 0))}</span>
                                {item.status === 'Downloading' && item.speed > 0 && (
                                  <>
                                    <span>•</span>
                                    <span className="font-mono">{formatSpeed(item.speed)}</span>
                                  </>
                                )}
                              </div>

                              {item.status === 'Downloading' && (
                                <Progress value={percent} className="h-1 mt-1.5" />
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="flex items-center justify-between pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!selectedItemId}
                    onClick={handleDeleteItem}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 gap-1 text-xs"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Remove from Queue</span>
                  </Button>

                  <div className="flex items-center space-x-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!selectedItemId || queueDownloads.findIndex((d) => d.id === selectedItemId) === queueDownloads.length - 1}
                      onClick={() => handleMoveItem('down')}
                      className="gap-1 text-xs"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                      <span>Move Down</span>
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!selectedItemId || queueDownloads.findIndex((d) => d.id === selectedItemId) === 0}
                      onClick={() => handleMoveItem('up')}
                      className="gap-1 text-xs"
                    >
                      <ChevronUp className="w-3.5 h-3.5" />
                      <span>Move Up</span>
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </ScrollArea>
          </Tabs>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-border/70 bg-card/60 flex flex-row items-center justify-end gap-2.5 shrink-0 select-none">
          <Button
            variant="outline"
            size="sm"
            onClick={closeModal}
            className="h-9 px-4 text-xs font-medium border-border hover:bg-card text-foreground cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            className="h-9 px-6 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm active:scale-[0.98] cursor-pointer"
          >
            Save
          </Button>
        </div>

        {/* New queue nested modal */}
        {showAddModal && (
          <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
            <DialogContent showCloseButton={false} className="sm:max-w-sm p-0 gap-0 overflow-hidden flex flex-col bg-background border border-border/80 rounded-2xl shadow-2xl">
              <div className="px-4 py-3 border-b border-border/70 bg-card/60 flex items-center justify-between">
                <DialogTitle className="text-sm font-semibold tracking-tight text-foreground">Create New Queue</DialogTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-md text-muted-foreground hover:bg-red-500 hover:text-white dark:hover:bg-red-600 transition-colors"
                  onClick={() => setShowAddModal(false)}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
              <form onSubmit={handleCreateQueue} className="p-4 space-y-4">
                <Input
                  autoFocus
                  required
                  placeholder="Enter queue name (e.g. Night Queue)"
                  value={newQueueName}
                  onChange={(e) => setNewQueueName(e.target.value)}
                  className="h-8.5 text-xs bg-card border-border"
                />
                <div className="flex items-center justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowAddModal(false)} className="h-8 px-3 text-xs">
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" className="h-8 px-4 text-xs font-semibold bg-primary hover:bg-primary/90 text-primary-foreground">
                    Create
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  );
};
