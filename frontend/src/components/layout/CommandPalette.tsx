import { Modal, Badge } from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../common/Icon';
import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

interface NavItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  groupLabel: string;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  navGroups: Array<{
    label: string;
    items: Array<{ key: string; icon: React.ReactNode; label: string }>;
  }>;
  failedCount?: number;
}

const RECENT_KEY = 'cmd-palette-recent';
const MAX_RECENT = 6;

function getRecent(): Array<{ key: string; label: string; groupLabel: string }> {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveRecent(item: { key: string; label: string; groupLabel: string }) {
  try {
    const prev = getRecent().filter((r) => r.key !== item.key);
    localStorage.setItem(RECENT_KEY, JSON.stringify([item, ...prev].slice(0, MAX_RECENT)));
  } catch {
    // ignore
  }
}

export function CommandPalette({ open, onClose, navGroups, failedCount }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allItems: NavItem[] = useMemo(
    () => navGroups.flatMap((group) => group.items.map((item) => ({ ...item, groupLabel: group.label }))),
    [navGroups]
  );

  const recentItems = useMemo(() => {
    if (!open) return [];
    return getRecent()
      .map((r) => allItems.find((item) => item.key === r.key))
      .filter((item): item is NavItem => !!item);
  }, [open, allItems]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return allItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.groupLabel.toLowerCase().includes(q) ||
        item.key.toLowerCase().includes(q)
    );
  }, [query, allItems]);

  const displayItems = query.trim() ? filtered : recentItems;

  const handleNavigate = useCallback(
    (item: NavItem) => {
      saveRecent({ key: item.key, label: item.label, groupLabel: item.groupLabel });
      navigate(item.key);
      onClose();
      setQuery('');
    },
    [navigate, onClose]
  );

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, displayItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
    } else if (e.key === 'Enter') {
      if (displayItems[cursor]) handleNavigate(displayItems[cursor]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      closable={false}
      width={560}
      className="command-palette-modal ui-extracted-47c5867e12"
      styles={{
        mask: {
          background: 'rgba(0,0,0,0.55)',
        },
      }}

    >
      {/* Search row */}
      <div className="command-palette-search-row">
        <GatewayIcon size="md" name="SearchOutlined" className="command-palette-placeholder-icon" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search pages…"
          className="command-palette-search-input"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd className="command-palette-kbd">ESC</kbd>
      </div>

      {/* Results */}
      <div ref={listRef} className="command-palette-results">
        {displayItems.length === 0 && (
          <div className="command-palette-empty">
            <GatewayIcon name="SearchOutlined" className="command-palette-empty-icon" />
            <span className="command-palette-empty-label">
              {query.trim() ? `No results for "${query}"` : 'Start typing to search pages'}
            </span>
          </div>
        )}

        {displayItems.length > 0 && (
          <div className="command-palette-section-label">
            {query.trim() ? `${filtered.length} result${filtered.length !== 1 ? 's' : ''}` : 'Recent'}
          </div>
        )}

        {displayItems.map((item, index) => {
          const isActive = cursor === index;
          return (
            <div
              key={item.key}
              data-idx={index}
              onClick={() => handleNavigate(item)}
              onMouseEnter={() => setCursor(index)}
              className="command-palette-item"
              data-active={isActive}
            >
              {/* Icon */}
              <span className={`command-palette-item-icon${isActive ? ' is-active' : ''}`}>{item.icon}</span>

              {/* Text */}
              <span className="console-flex-min-width-0">
                <span className="command-palette-item-label" data-active={isActive}>
                  {item.label}
                  {item.key === '/logs' && !!failedCount && failedCount > 0 && (
                    <Badge count={failedCount} size="small" className="command-palette-failure-count" />
                  )}
                </span>
                <span className="command-palette-item-group">{item.groupLabel}</span>
              </span>

              {/* Enter hint */}
              {isActive && <GatewayIcon size="xsm" name="EnterOutlined" className="command-palette-enter-icon" />}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="command-palette-footer">
        {(
          [
            ['↑↓', 'navigate'],
            ['↵', 'select'],
            ['esc', 'close'],
          ] as const
        ).map(([key, desc]) => (
          <span key={key} className="command-palette-shortcut">
            <kbd className="command-palette-kbd">{key}</kbd>
            <span className="command-palette-shortcut-label">{desc}</span>
          </span>
        ))}
      </div>
    </Modal>
  );
}
