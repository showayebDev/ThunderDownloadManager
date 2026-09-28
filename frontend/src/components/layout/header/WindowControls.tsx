/**
 * Search input and window titlebar controls (minimize, maximize, close) for Header.tsx.
 */
import React from 'react';
import { Search, Minus, Square, X } from 'lucide-react';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';

interface WindowControlsProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchPlaceholder: string;
  onMinimize: (e: React.MouseEvent) => void;
  onMaximize: (e: React.MouseEvent) => void;
  onClose: (e: React.MouseEvent) => void;
}

export const WindowControls: React.FC<WindowControlsProps> = ({
  searchQuery,
  setSearchQuery,
  searchPlaceholder,
  onMinimize,
  onMaximize,
  onClose,
}) => {
  return (
    <div
      className="flex items-center space-x-2 relative z-10"
      style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
    >
      {/* Search input */}
      <div className="relative" onMouseDown={(e) => e.stopPropagation()}>
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        <Input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={searchPlaceholder}
          className="w-44 h-7 pl-8 pr-2.5 py-0 text-xs bg-muted/60 border-border focus-visible:ring-primary"
        />
      </div>

      {/* Window controls */}
      <div className="flex items-center space-x-0.5 pl-1" onMouseDown={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon"
          onClick={onMinimize}
          className="w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted"
          title="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onMaximize}
          className="w-7 h-7 text-muted-foreground hover:text-foreground hover:bg-muted"
          title="Maximize"
        >
          <Square className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="w-7 h-7 text-muted-foreground hover:bg-red-500 hover:text-white dark:hover:bg-red-600 transition-colors"
          title="Close"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
};
