import { Modal, Badge } from 'antd';
import { SearchOutlined, EnterOutlined } from '@ant-design/icons';
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

const dark = {
  bg: '#16181d',
  border: 'rgba(255,255,255,0.08)',
  inputText: 'rgba(255,255,255,0.88)',
  placeholder: 'rgba(255,255,255,0.3)',
  accent: '#6366f1',
  accentBg: 'rgba(99,102,241,0.14)',
  accentBorder: 'rgba(99,102,241,0.28)',
  itemText: 'rgba(255,255,255,0.78)',
  itemSub: 'rgba(255,255,255,0.35)',
  sectionLabel: 'rgba(255,255,255,0.28)',
  footerBorder: 'rgba(255,255,255,0.06)',
};

export function CommandPalette({ open, onClose, navGroups, failedCount }: CommandPaletteProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const allItems: NavItem[] = useMemo(
    () =>
      navGroups.flatMap((group) =>
        group.items.map((item) => ({ ...item, groupLabel: group.label }))
      ),
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
      styles={{
        content: {
          padding: 0,
          borderRadius: 14,
          overflow: 'hidden',
          background: dark.bg,
          border: `1px solid ${dark.border}`,
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        },
        mask: {
          backdropFilter: 'blur(6px)',
          background: 'rgba(0,0,0,0.55)',
        },
      }}
      style={{ top: '16vh' }}
    >
      {/* Search row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 16px',
          borderBottom: `1px solid ${dark.border}`,
        }}
      >
        <SearchOutlined style={{ fontSize: 17, color: dark.placeholder, flexShrink: 0 }} />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search pages…"
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            fontSize: 15,
            fontWeight: 400,
            color: dark.inputText,
            caretColor: dark.accent,
          }}
          autoComplete="off"
          spellCheck={false}
        />
        <kbd style={kbdStyle}>ESC</kbd>
      </div>

      {/* Results */}
      <div ref={listRef} style={{ maxHeight: 368, overflowY: 'auto', padding: '6px 8px 8px' }}>
        {displayItems.length === 0 && (
          <div style={{ textAlign: 'center', padding: '36px 16px' }}>
            <SearchOutlined style={{ fontSize: 26, color: dark.sectionLabel, marginBottom: 8, display: 'block' }} />
            <span style={{ fontSize: 13, color: dark.sectionLabel }}>
              {query.trim() ? `No results for "${query}"` : 'Start typing to search pages'}
            </span>
          </div>
        )}

        {displayItems.length > 0 && (
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: dark.sectionLabel,
              padding: '6px 8px 4px',
            }}
          >
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
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 10px',
                borderRadius: 8,
                cursor: 'pointer',
                background: isActive ? dark.accentBg : 'transparent',
                border: `1px solid ${isActive ? dark.accentBorder : 'transparent'}`,
                marginBottom: 2,
                transition: 'background 0.1s, border-color 0.1s',
              }}
            >
              {/* Icon */}
              <span
                style={{
                  fontSize: 15,
                  color: isActive ? dark.accent : dark.itemSub,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  width: 20,
                  justifyContent: 'center',
                  transition: 'color 0.1s',
                }}
              >
                {item.icon}
              </span>

              {/* Text */}
              <span style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 14,
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? '#fff' : dark.itemText,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    transition: 'color 0.1s',
                  }}
                >
                  {item.label}
                  {item.key === '/logs' && !!failedCount && failedCount > 0 && (
                    <Badge
                      count={failedCount}
                      size="small"
                      style={{ marginLeft: 8, fontSize: 10, background: '#ef4444' }}
                    />
                  )}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: dark.itemSub,
                    display: 'block',
                    marginTop: 1,
                  }}
                >
                  {item.groupLabel}
                </span>
              </span>

              {/* Enter hint */}
              {isActive && (
                <EnterOutlined style={{ fontSize: 13, color: dark.accent, flexShrink: 0, opacity: 0.7 }} />
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div
        style={{
          borderTop: `1px solid ${dark.footerBorder}`,
          padding: '8px 14px',
          display: 'flex',
          gap: 14,
          background: 'rgba(0,0,0,0.15)',
        }}
      >
        {([['↑↓', 'navigate'], ['↵', 'select'], ['esc', 'close']] as const).map(([key, desc]) => (
          <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <kbd style={{ ...kbdStyle, fontSize: 10 }}>{key}</kbd>
            <span style={{ fontSize: 11, color: dark.sectionLabel }}>{desc}</span>
          </span>
        ))}
      </div>
    </Modal>
  );
}

const kbdStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'rgba(255,255,255,0.35)',
  background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 5,
  padding: '2px 6px',
  fontFamily: 'monospace',
  lineHeight: 1.6,
};
