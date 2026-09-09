import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, Check, Search, X } from 'lucide-react';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { cn } from 'cn';

interface FontSelectProps {
  value: string;
  options: string[];
  onChange: (font: string) => void;
  className?: string;
  placeholder?: string;
}

const getFontFamily = (fontName: string): string => {
  if (!fontName || fontName === 'Default') {
    return "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  }
  const cleanName = fontName.replace(/["\\]/g, '');
  return `"${cleanName}", system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
};

export const FontSelect: React.FC<FontSelectProps> = ({
  value,
  options,
  onChange,
  className = '',
}) => {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const selectedItemRef = useRef<HTMLButtonElement>(null);

  // Focus search input and scroll selected font into view when opened
  useEffect(() => {
    if (open) {
      setSearchQuery('');
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
        if (selectedItemRef.current) {
          selectedItemRef.current.scrollIntoView({ block: 'nearest' });
        }
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // Process and sort font options: 'Default' at the top, others alphabetical
  const sortedFonts = useMemo(() => {
    const unique = Array.from(new Set(options.filter(Boolean)));
    const hasDefault = unique.includes('Default');
    const others = unique
      .filter((f) => f !== 'Default')
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return hasDefault ? ['Default', ...others] : ['Default', ...others];
  }, [options]);

  // Filter fonts by search query
  const filteredFonts = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return sortedFonts;
    return sortedFonts.filter((f) => {
      const displayName = f === 'Default' ? 'Default (System UI)' : f;
      return displayName.toLowerCase().includes(query);
    });
  }, [sortedFonts, searchQuery]);

  const selectedDisplay = value === 'Default' || !value ? 'Default (System UI)' : value;
  const selectedFontCss = getFontFamily(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8.5 w-44 items-center justify-between gap-1.5 rounded-lg border border-input bg-card px-3 py-1 text-xs font-medium text-foreground transition-colors outline-none select-none hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 cursor-pointer shadow-xs",
            className
          )}
          aria-expanded={open}
        >
          <span
            className="truncate text-left flex-1 font-preview-item"
            data-font-preview="true"
            style={{
              '--font-preview-family': selectedFontCss,
              fontFamily: selectedFontCss,
            } as React.CSSProperties}
          >
            {selectedDisplay}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={6}
        className="w-72 sm:w-80 rounded-xl border border-border bg-popover p-0 shadow-2xl overflow-hidden flex flex-col z-50 text-xs"
      >
        {/* Pinned Search Bar */}
        <div className="p-2 border-b border-border bg-muted/40 flex items-center gap-2 shrink-0">
          <Search className="w-3.5 h-3.5 text-muted-foreground shrink-0 ml-1" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search fonts..."
            className="w-full bg-background border border-border rounded-lg px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-primary"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors cursor-pointer shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Font Options List */}
        <div className="max-h-64 overflow-y-auto p-1.5 space-y-1 custom-scrollbar">
          {filteredFonts.length === 0 ? (
            <div className="px-3 py-6 text-center text-muted-foreground text-xs">
              No matching fonts found
            </div>
          ) : (
            filteredFonts.map((fName) => {
              const isSelected = fName === value || (!value && fName === 'Default');
              const displayName = fName === 'Default' ? 'Default (System UI)' : fName;
              const fontCss = getFontFamily(fName);

              return (
                <button
                  key={fName}
                  ref={isSelected ? selectedItemRef : null}
                  type="button"
                  data-font-preview="true"
                  onClick={() => {
                    onChange(fName);
                    setOpen(false);
                  }}
                  className={cn(
                    "w-full px-3 py-2 rounded-lg flex items-center justify-between text-left transition-colors cursor-pointer group font-preview-item",
                    isSelected
                      ? "bg-primary/15 text-primary font-medium border border-primary/30"
                      : "hover:bg-accent text-foreground hover:text-accent-foreground border border-transparent"
                  )}
                  style={{
                    '--font-preview-family': fontCss,
                    fontFamily: fontCss,
                  } as React.CSSProperties}
                >
                  <div className="flex flex-col min-w-0 pr-2 font-preview-item" data-font-preview="true">
                    <span
                      className="text-xs font-semibold truncate leading-snug font-preview-item"
                      data-font-preview="true"
                      style={{
                        '--font-preview-family': fontCss,
                        fontFamily: fontCss,
                      } as React.CSSProperties}
                    >
                      {displayName}
                    </span>
                    {fName !== 'Default' && (
                      <span
                        className="text-[11px] text-muted-foreground group-hover:text-foreground/80 truncate mt-0.5 font-preview-item"
                        data-font-preview="true"
                        style={{
                          '--font-preview-family': fontCss,
                          fontFamily: fontCss,
                        } as React.CSSProperties}
                      >
                        The quick brown fox jumps over the lazy dog
                      </span>
                    )}
                  </div>
                  {isSelected && (
                    <Check className="w-4 h-4 text-primary shrink-0 ml-2" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
