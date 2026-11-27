import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './integration-sections.css';

export interface IntegrationSectionItem {
  key: string;
  label: string;
  disabled?: boolean;
  children?: ReactNode;
}

interface IntegrationSectionsProps {
  activePanels: string[];
  onChange: (keys: string[]) => void;
  items?: IntegrationSectionItem[];
}

const getActiveKey = (items: IntegrationSectionItem[], activePanels: string[]) => {
  const requestedKey = activePanels[0];
  return items.some((item) => item.key === requestedKey && !item.disabled)
    ? requestedKey
    : items.find((item) => !item.disabled)?.key;
};

const panelId = (key: string) => `integration-section-${key}-panel`;
const tabId = (key: string) => `integration-section-${key}-tab`;

/**
 * The configuration page's sections. A vertical navigator rather than a
 * horizontal strip: nine tab labels do not fit on one line at any sane width,
 * and the strip hid the later sections behind an overflow arrow.
 *
 * The ARIA contract is unchanged — tabs own panels, inactive panels stay
 * mounted so a form keeps its state, and a section that becomes disabled falls
 * back to the first available one.
 */
export const IntegrationSections = ({ activePanels, onChange, items = [] }: IntegrationSectionsProps) => {
  const activeKey = getActiveKey(items, activePanels);
  const [visited, setVisited] = useState(() => new Set(activeKey ? [activeKey] : []));
  const navRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    if (activeKey) {
      setVisited((current) => new Set(current).add(activeKey));
    }
  }, [activeKey]);

  const selectTab = (key: string) => {
    setVisited((current) => new Set(current).add(key));
    onChange([key]);
  };

  const enabledKeys = items.filter((item) => !item.disabled).map((item) => item.key);

  const moveFocus = (from: string, direction: 1 | -1) => {
    const index = enabledKeys.indexOf(from);
    if (index === -1) return;
    const next = enabledKeys[(index + direction + enabledKeys.length) % enabledKeys.length];
    selectTab(next);
    navRefs.current[next]?.focus();
  };

  if (!activeKey) return null;

  return (
    <div className="integration-sections">
      <div
        className="integration-sections__nav"
        role="tablist"
        aria-label="Integration configuration sections"
        aria-orientation="vertical"
      >
        {items.map((item) => (
          <button
            key={item.key}
            ref={(node) => {
              navRefs.current[item.key] = node;
            }}
            type="button"
            role="tab"
            id={tabId(item.key)}
            aria-selected={activeKey === item.key}
            aria-controls={panelId(item.key)}
            aria-disabled={item.disabled ? 'true' : undefined}
            tabIndex={activeKey === item.key ? 0 : -1}
            disabled={item.disabled}
            className="integration-sections__nav-item"
            onClick={() => selectTab(item.key)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                event.preventDefault();
                moveFocus(item.key, 1);
              } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                event.preventDefault();
                moveFocus(item.key, -1);
              } else if (event.key === 'Home') {
                event.preventDefault();
                const first = enabledKeys[0];
                if (first) {
                  selectTab(first);
                  navRefs.current[first]?.focus();
                }
              } else if (event.key === 'End') {
                event.preventDefault();
                const last = enabledKeys[enabledKeys.length - 1];
                if (last) {
                  selectTab(last);
                  navRefs.current[last]?.focus();
                }
              }
            }}
          >
            <span className="integration-sections__nav-label">{item.label}</span>
          </button>
        ))}
      </div>
      <div className="integration-sections__body">
        {items.map(
          (item) =>
            visited.has(item.key) && (
              <div
                key={item.key}
                id={panelId(item.key)}
                role="tabpanel"
                aria-labelledby={tabId(item.key)}
                hidden={activeKey !== item.key}
                tabIndex={0}
              >
                {item.children}
              </div>
            )
        )}
      </div>
    </div>
  );
};
