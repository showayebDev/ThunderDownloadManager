import React, { useMemo } from 'react';
import { marked } from 'marked';
import { BrowserOpenURL } from '../../utils/tauriBridge';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  const html = useMemo(() => {
    if (!content) return '';
    try {
      // Enable GFM and line breaks
      marked.setOptions({
        gfm: true,
        breaks: true,
      });
      return marked.parse(content) as string;
    } catch (e) {
      console.error('Failed to parse markdown:', e);
      return content;
    }
  }, [content]);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest('a');
    if (anchor && anchor.href) {
      e.preventDefault();
      BrowserOpenURL(anchor.href);
    }
  };

  return (
    <div
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
      className={`markdown-content text-[11.5px] leading-relaxed text-slate-300 select-text ${className}`}
    />
  );
};

export default MarkdownRenderer;
