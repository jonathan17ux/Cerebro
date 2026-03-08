import { useState, useMemo } from 'react';
import { X, Search, Plus } from 'lucide-react';
import {
  ACTION_META,
  ACTION_CATEGORIES,
  type ActionMeta,
  type ActionCategory,
} from '../../../utils/step-defaults';
import ActionCategoryGroup from './ActionCategoryGroup';

interface ActionSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onOpen: () => void;
}

export default function ActionSidebar({ isOpen, onClose, onOpen }: ActionSidebarProps) {
  const [search, setSearch] = useState('');

  const filteredCategories = useMemo(() => {
    const query = search.toLowerCase().trim();

    return ACTION_CATEGORIES.map((category) => {
      const actions = Object.entries(ACTION_META).filter(([, meta]) => {
        if (meta.category !== category.id) return false;
        // Don't show triggers in sidebar — they're managed via toolbar
        if (meta.category === 'triggers') return false;
        if (!query) return true;
        return (
          meta.name.toLowerCase().includes(query) ||
          meta.description.toLowerCase().includes(query) ||
          meta.keywords.some((kw) => kw.includes(query))
        );
      });
      return { category, actions } as { category: ActionCategory; actions: [string, ActionMeta][] };
    }).filter((group) => group.actions.length > 0);
  }, [search]);

  if (!isOpen) {
    return (
      <div className="absolute bottom-4 left-4 z-20">
        <button
          onClick={onOpen}
          className="w-9 h-9 rounded-lg bg-bg-surface border border-border-subtle flex items-center justify-center text-text-tertiary hover:text-accent hover:border-accent/30 transition-colors shadow-lg"
          aria-label="Add action"
        >
          <Plus size={18} />
        </button>
      </div>
    );
  }

  return (
    <div className="absolute top-0 right-0 bottom-0 w-[320px] z-20 bg-bg-surface border-l border-border-subtle shadow-xl flex flex-col animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
        <span className="text-sm font-semibold text-text-primary">Add Node</span>
        <button
          onClick={onClose}
          className="p-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-hover transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-border-subtle">
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full h-8 pl-8 pr-3 text-xs bg-bg-base border border-border-subtle rounded-md text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent/50"
            autoFocus
          />
        </div>
      </div>

      {/* Category groups */}
      <div className="flex-1 overflow-y-auto py-1">
        {filteredCategories.length > 0 ? (
          filteredCategories.map(({ category, actions }) => (
            <ActionCategoryGroup
              key={category.id}
              category={category}
              actions={actions}
            />
          ))
        ) : (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-text-tertiary">No actions match "{search}"</p>
          </div>
        )}
      </div>
    </div>
  );
}
