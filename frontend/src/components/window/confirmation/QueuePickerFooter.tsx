/**
 * Bottom action buttons and Queue Selection Popover Menu for DownloadStartConfirmation.
 */

import React from 'react';
import { ChevronUp, Ban, Folder } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { QueueItem } from './types';

interface QueuePickerFooterProps {
  showQueuePicker: boolean;
  onToggleQueuePicker: () => void;
  onSelectQueueAndAdd: (queueName: string) => void;
  availableQueues: QueueItem[];
  queueCounts: { [key: string]: number };
  onDownloadNow: () => void;
  onClose: () => void;
  isFetchingInfo: boolean;
  url: string;
  protocol: string;
  isYtdlpInstalled: boolean;
}

export const QueuePickerFooter: React.FC<QueuePickerFooterProps> = ({
  showQueuePicker,
  onToggleQueuePicker,
  onSelectQueueAndAdd,
  availableQueues,
  queueCounts,
  onDownloadNow,
  onClose,
  isFetchingInfo,
  url,
  protocol,
  isYtdlpInstalled,
}) => {
  const isActionDisabled =
    isFetchingInfo || !url.trim() || (protocol === 'Yt-DLP' && !isYtdlpInstalled);

  return (
    <div className="flex items-center justify-between pt-2 border-t border-border min-w-0">
      <div className="flex items-center space-x-2">
        <div className="relative">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onToggleQueuePicker();
            }}
            disabled={isActionDisabled}
            className="rounded-xl font-medium text-xs flex items-center space-x-1.5"
          >
            <span>Add</span>
            <ChevronUp
              className={`w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 ${
                showQueuePicker ? 'rotate-180 text-primary' : ''
              }`}
            />
          </Button>

          {/* Queue Selection Popover Menu */}
          {showQueuePicker && (
            <div
              className="absolute bottom-full left-0 mb-2 w-56 bg-popover border border-border rounded-2xl shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-100"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-2.5 py-1.5 text-[10.5px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border flex items-center justify-between">
                <span>Select Queue</span>
                <span className="text-primary font-normal">{availableQueues.length} Queues</span>
              </div>
              <div className="py-1 max-h-48 overflow-y-auto space-y-0.5 custom-scrollbar">
                {/* Without Queue Option */}
                <button
                  type="button"
                  onClick={() => onSelectQueueAndAdd('')}
                  className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-accent text-xs font-medium text-foreground hover:text-accent-foreground transition-colors cursor-pointer text-left group"
                >
                  <div className="flex items-center space-x-2 min-w-0">
                    <Ban className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">Without queue</span>
                  </div>
                </button>

                {availableQueues.length > 0 && <div className="my-1 border-t border-border" />}

                {availableQueues.map((q) => {
                  const qName = q.name || q.id;
                  const count = queueCounts[qName] || 0;
                  return (
                    <button
                      key={q.id || q.name}
                      type="button"
                      onClick={() => onSelectQueueAndAdd(qName)}
                      className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl hover:bg-accent text-xs font-medium text-foreground hover:text-accent-foreground transition-colors cursor-pointer text-left group"
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <Folder className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="truncate">{qName}</span>
                      </div>
                      <span className="text-[10px] bg-muted group-hover:bg-accent text-muted-foreground group-hover:text-foreground px-2 py-0.5 rounded-full ml-2 shrink-0 font-mono transition-colors">
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <Button
          type="button"
          onClick={onDownloadNow}
          disabled={isActionDisabled}
          size="sm"
          className="rounded-xl px-6 font-medium text-xs shadow-md"
        >
          {protocol === 'Yt-DLP' && !isYtdlpInstalled
            ? 'Media Tools Required'
            : isFetchingInfo
            ? 'Checking...'
            : 'Download'}
        </Button>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onClose}
        className="rounded-xl px-5 font-medium text-xs"
      >
        Cancel
      </Button>
    </div>
  );
};
