import { useEffect, useState, type ReactNode } from 'react';
import { Tab, TabList } from '@astryxdesign/core/TabList';

export interface RetainedTabItem {
  key: string;
  label: string;
  children: ReactNode;
  icon?: ReactNode;
  endContent?: ReactNode;
  disabled?: boolean;
  forceRender?: boolean;
}

interface RetainedTabsProps {
  items: RetainedTabItem[];
  initialKey: string;
  ariaLabel: string;
  idPrefix: string;
  className?: string;
  wrap?: boolean;
}

export function RetainedTabs({
  items,
  initialKey,
  ariaLabel,
  idPrefix,
  className,
  wrap = false,
}: RetainedTabsProps) {
  const [activeKey, setActiveKey] = useState(initialKey);
  const [visitedKeys, setVisitedKeys] = useState(() => new Set([initialKey]));
  const selectedItem =
    items.find((item) => item.key === activeKey && !item.disabled) ??
    items.find((item) => item.key === initialKey && !item.disabled) ??
    items.find((item) => !item.disabled);
  const selectedKey = selectedItem?.key ?? '';
  const safePrefix = idPrefix.replace(/[^A-Za-z0-9_-]/g, '-');

  useEffect(() => {
    if (selectedKey && selectedKey !== activeKey) setActiveKey(selectedKey);
    if (selectedKey) setVisitedKeys((current) => new Set(current).add(selectedKey));
  }, [activeKey, selectedKey]);

  const selectTab = (key: string) => {
    setActiveKey(key);
    setVisitedKeys((current) => new Set(current).add(key));
  };

  return (
    <div className={className}>
      <TabList
        aria-label={ariaLabel}
        className={wrap ? 'retained-tab-list retained-tab-list--wrap' : 'retained-tab-list'}
        hasDivider
        onChange={selectTab}
        overflow={wrap ? 'visible' : 'scroll'}
        role="tablist"
        size="md"
        value={selectedKey}
      >
        {items.map((item) => {
          const tabId = `${safePrefix}-tab-${item.key}`;
          const panelId = `${safePrefix}-panel-${item.key}`;
          return (
            <Tab
              aria-disabled={item.disabled}
              aria-label={item.label}
              endContent={item.endContent}
              icon={item.icon}
              id={tabId}
              key={item.key}
              label={item.label}
              panelId={panelId}
              value={item.key}
            />
          );
        })}
      </TabList>
      <div className="retained-tab-panels">
        {items.map((item) => {
          const tabId = `${safePrefix}-tab-${item.key}`;
          const panelId = `${safePrefix}-panel-${item.key}`;
          const isActive = item.key === selectedKey;
          const shouldRender = isActive || item.forceRender || visitedKeys.has(item.key);
          return (
            <section
              aria-labelledby={tabId}
              className="retained-tab-panel"
              hidden={!isActive}
              id={panelId}
              key={item.key}
              role="tabpanel"
              tabIndex={isActive ? 0 : -1}
            >
              {shouldRender ? item.children : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
