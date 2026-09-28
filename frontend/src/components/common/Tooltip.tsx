import React, { useState, useRef, useLayoutEffect, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

export type TooltipPosition = 
  | 'top' 
  | 'bottom' 
  | 'left' 
  | 'right' 
  | 'top-left' 
  | 'top-right' 
  | 'bottom-left' 
  | 'bottom-right'
  | 'top-center'
  | 'bottom-center';

export interface TooltipProps {
  children: React.ReactNode;
  text?: React.ReactNode;
  description?: React.ReactNode;
  content?: React.ReactNode;
  title?: string;
  position?: TooltipPosition;
  maxWidth?: string;
  className?: string;
  tooltipClassName?: string;
  delay?: number;
  disabled?: boolean;
  hideOnClick?: boolean;
}

export const Tooltip: React.FC<TooltipProps> = ({
  children,
  text,
  description,
  content,
  title,
  position = 'top',
  maxWidth = 'max-w-[280px]',
  className = '',
  tooltipClassName = '',
  disabled = false,
  hideOnClick = true,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const textContent = text || description || content;

  // Immediately hide if disabled becomes true
  useEffect(() => {
    if (disabled && isVisible) {
      setIsVisible(false);
    }
  }, [disabled, isVisible]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || !tooltipRef.current || typeof window === 'undefined') {
      return;
    }

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const tooltipRect = tooltipRef.current.getBoundingClientRect();
    const padding = 10;
    const gap = 6;

    let targetTop = 0;
    let targetLeft = 0;

    // Determine vertical placement
    const fitsOnTop = triggerRect.top - tooltipRect.height - gap >= padding;
    const fitsOnBottom = triggerRect.bottom + tooltipRect.height + gap <= window.innerHeight - padding;

    let effectivePos = position;
    if (position.startsWith('top') && !fitsOnTop && fitsOnBottom) {
      effectivePos = position.replace('top', 'bottom') as TooltipPosition;
    } else if (position.startsWith('bottom') && !fitsOnBottom && fitsOnTop) {
      effectivePos = position.replace('bottom', 'top') as TooltipPosition;
    }

    switch (effectivePos) {
      case 'top':
      case 'top-center':
        targetTop = triggerRect.top - tooltipRect.height - gap;
        targetLeft = triggerRect.left + (triggerRect.width / 2) - (tooltipRect.width / 2);
        break;
      case 'top-left':
        targetTop = triggerRect.top - tooltipRect.height - gap;
        targetLeft = triggerRect.left;
        break;
      case 'top-right':
        targetTop = triggerRect.top - tooltipRect.height - gap;
        targetLeft = triggerRect.right - tooltipRect.width;
        break;
      case 'bottom':
      case 'bottom-center':
        targetTop = triggerRect.bottom + gap;
        targetLeft = triggerRect.left + (triggerRect.width / 2) - (tooltipRect.width / 2);
        break;
      case 'bottom-left':
        targetTop = triggerRect.bottom + gap;
        targetLeft = triggerRect.left;
        break;
      case 'bottom-right':
        targetTop = triggerRect.bottom + gap;
        targetLeft = triggerRect.right - tooltipRect.width;
        break;
      case 'left':
        targetTop = triggerRect.top + (triggerRect.height / 2) - (tooltipRect.height / 2);
        targetLeft = triggerRect.left - tooltipRect.width - gap;
        break;
      case 'right':
        targetTop = triggerRect.top + (triggerRect.height / 2) - (tooltipRect.height / 2);
        targetLeft = triggerRect.right + gap;
        break;
      default:
        targetTop = triggerRect.top - tooltipRect.height - gap;
        targetLeft = triggerRect.left + (triggerRect.width / 2) - (tooltipRect.width / 2);
    }

    // Horizontal viewport clamping so tooltip never clips outside screen margins
    if (targetLeft < padding) {
      targetLeft = padding;
    } else if (targetLeft + tooltipRect.width > window.innerWidth - padding) {
      targetLeft = window.innerWidth - padding - tooltipRect.width;
    }

    // Vertical viewport clamping
    if (targetTop < padding) {
      targetTop = padding;
    } else if (targetTop + tooltipRect.height > window.innerHeight - padding) {
      targetTop = window.innerHeight - padding - tooltipRect.height;
    }

    setCoords({ top: targetTop, left: targetLeft });
  }, [position]);

  useLayoutEffect(() => {
    if (isVisible) {
      updatePosition();
    } else {
      setCoords(null);
    }
  }, [isVisible, updatePosition, textContent, title]);

  useEffect(() => {
    if (!isVisible) return;

    const handleScrollOrResize = () => {
      updatePosition();
    };

    window.addEventListener('scroll', handleScrollOrResize, { passive: true, capture: true });
    window.addEventListener('resize', handleScrollOrResize, { passive: true });

    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, { capture: true });
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isVisible, updatePosition]);

  if (!textContent && !title) {
    return <>{children}</>;
  }

  return (
    <div
      ref={triggerRef}
      className={`inline-flex items-center ${className}`}
      onMouseEnter={() => {
        if (!disabled) setIsVisible(true);
      }}
      onMouseLeave={() => setIsVisible(false)}
      onFocus={() => {
        if (!disabled) setIsVisible(true);
      }}
      onBlur={() => setIsVisible(false)}
      onClick={() => {
        if (hideOnClick) setIsVisible(false);
      }}
    >
      {children}
      {isVisible && !disabled && typeof document !== 'undefined' && createPortal(
        <div
          ref={tooltipRef}
          style={{
            position: 'fixed',
            top: coords ? `${coords.top}px` : '-9999px',
            left: coords ? `${coords.left}px` : '-9999px',
            opacity: coords ? 1 : 0,
          }}
          className={`z-[99999] pointer-events-none transition-opacity duration-150 w-max ${maxWidth}`}
        >
          <div
            className={`bg-popover/95 backdrop-blur-md border border-border text-popover-foreground rounded-lg px-3 py-2 shadow-2xl text-[11.5px] leading-relaxed text-left font-sans select-none whitespace-normal break-words ${tooltipClassName}`}
          >
            {title && (
              <div className="font-semibold text-primary text-[11.5px] pb-1 border-b border-border/80 mb-1">
                {title}
              </div>
            )}
            {textContent && <div>{textContent}</div>}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export interface HelpTooltipProps {
  description: string;
  title?: string;
  position?: TooltipPosition;
  size?: number;
  className?: string;
  iconClassName?: string;
  badge?: boolean;
}

export const HelpTooltip: React.FC<HelpTooltipProps> = ({
  description,
  title,
  position = 'top-left',
  className = '',
  iconClassName = '',
}) => {
  return (
    <Tooltip
      description={description}
      title={title}
      position={position}
      className={className}
    >
      <span
        className={`w-3.5 h-3.5 rounded-full border border-muted-foreground/30 text-muted-foreground/70 hover:text-foreground hover:border-muted-foreground/60 bg-muted/40 flex items-center justify-center text-[10px] font-semibold leading-none cursor-help transition-colors shrink-0 select-none ${iconClassName}`}
      >
        ?
      </span>
    </Tooltip>
  );
};

export default Tooltip;
