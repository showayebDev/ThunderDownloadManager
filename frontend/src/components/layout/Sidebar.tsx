import React, { useState } from 'react';
import { 
  Folder, 
  Archive, 
  Binary, 
  Video, 
  Music, 
  Image as ImageIcon, 
  FileText, 
  CheckCircle2, 
  Clock, 
  ChevronDown, 
  ChevronRight,
  List
} from 'lucide-react';
import { useDownloadContext } from '../../context/DownloadContext';
import { useAppearance } from '../../context/AppearanceContext';
import { Category } from '../../types/download';
import { Badge } from '../ui/badge';
import { Separator } from '../ui/separator';

interface CategoryItem {
  id: Category;
  translationKey: string;
  icon: React.FC<{ className?: string }>;
}

const CATEGORIES: CategoryItem[] = [
  { id: 'Compressed', translationKey: 'category.compressed', icon: Archive },
  { id: 'Programs', translationKey: 'category.programs', icon: Binary },
  { id: 'Videos', translationKey: 'category.videos', icon: Video },
  { id: 'Music', translationKey: 'category.music', icon: Music },
  { id: 'Pictures', translationKey: 'category.pictures', icon: ImageIcon },
  { id: 'Documents', translationKey: 'category.documents', icon: FileText },
];

export const Sidebar: React.FC = () => {
  const { 
    selectedCategory, 
    setSelectedCategory, 
    selectedStatus, 
    setSelectedStatus,
    selectedQueue,
    setSelectedQueue,
    categoryCounts,
    statusCounts,
    queues,
    queueCounts
  } = useDownloadContext();
  const { t } = useAppearance();

  const [allExpanded, setAllExpanded] = useState(true);
  const [queuesExpanded, setQueuesExpanded] = useState(true);

  return (
    <aside className="w-52 bg-card/95 border-r border-border flex flex-col justify-between select-none py-2 px-1.5 overflow-y-auto shrink-0 text-xs">
      <div className="space-y-2.5">
        {/* Category filters */}
        <div>
          {/* All downloads group header */}
          <div className="relative">
            <button
              onClick={() => {
                setSelectedCategory('All');
                setSelectedStatus('All');
                setSelectedQueue('All');
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                selectedCategory === 'All' && selectedStatus === 'All' && selectedQueue === 'All'
                  ? 'bg-accent text-accent-foreground font-semibold shadow-xs'
                  : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Folder className="w-4 h-4 text-primary" />
                <span className="font-semibold">{t('category.all')}</span>
              </div>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setAllExpanded(!allExpanded);
                }}
                className="p-1 hover:bg-background/80 rounded transition-colors"
              >
                {allExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </div>
            </button>

            {/* Subcategories list */}
            {allExpanded && (
              <div className="mt-1 ml-3 pl-2 space-y-0.5 border-l border-border">
                {CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const count = categoryCounts[cat.id] || 0;
                  const isSelected = selectedCategory === cat.id && selectedStatus === 'All' && selectedQueue === 'All';

                  return (
                    <button
                      key={cat.id}
                      onClick={() => {
                        setSelectedCategory(cat.id);
                        setSelectedStatus('All');
                        setSelectedQueue('All');
                      }}
                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-[11.5px] font-medium transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-primary/15 text-primary font-semibold'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                      }`}
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{t(cat.translationKey)}</span>
                      </div>
                      {count > 0 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 min-w-4 flex items-center justify-center">
                          {count}
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <Separator className="my-2" />

          {/* Status filters */}
          <div className="space-y-0.5">
            <button
              onClick={() => {
                setSelectedStatus(selectedStatus === 'Finished' ? 'All' : 'Finished');
                setSelectedQueue('All');
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                selectedStatus === 'Finished'
                  ? 'bg-emerald-500/15 text-emerald-500 font-semibold'
                  : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              }`}
            >
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>{t('sidebar.finished')}</span>
              </div>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                {statusCounts.finished}
              </Badge>
            </button>

            <button
              onClick={() => {
                setSelectedStatus(selectedStatus === 'Unfinished' ? 'All' : 'Unfinished');
                setSelectedQueue('All');
              }}
              className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                selectedStatus === 'Unfinished'
                  ? 'bg-amber-500/15 text-amber-500 font-semibold'
                  : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              }`}
            >
              <div className="flex items-center space-x-2">
                <Clock className="w-4 h-4 text-amber-500" />
                <span>{t('sidebar.unfinished')}</span>
              </div>
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                {statusCounts.unfinished}
              </Badge>
            </button>
          </div>
        </div>

        <Separator className="my-2" />

        {/* Queues group */}
        <div>
          <button
            onClick={() => setQueuesExpanded(!queuesExpanded)}
            className="w-full flex items-center justify-between px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
          >
            <div className="flex items-center space-x-2">
              <List className="w-4 h-4 text-primary" />
              <span>{t('sidebar.queues')}</span>
            </div>
            {queuesExpanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>

          {queuesExpanded && (
            <div className="mt-1 space-y-0.5 ml-2">
              {queues.map((q) => {
                const isSelected = selectedQueue.toLowerCase() === q.name.toLowerCase() && selectedCategory === 'All' && selectedStatus === 'All';
                const count = queueCounts[q.name] || queueCounts[q.id] || 0;
                return (
                  <button
                    key={q.id}
                    onClick={() => {
                      setSelectedQueue(q.name);
                      setSelectedCategory('All');
                      setSelectedStatus('All');
                    }}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-[11.5px] font-medium transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-primary/15 text-primary font-semibold'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    }`}
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      <Folder className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                      <span className="truncate">{q.name}</span>
                    </div>
                    {count > 0 && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 min-w-4 flex items-center justify-center">
                        {count}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};
