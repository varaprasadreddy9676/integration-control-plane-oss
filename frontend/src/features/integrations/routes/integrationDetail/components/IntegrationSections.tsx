import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Tab, TabList } from '@astryxdesign/core';

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

export const IntegrationSections = ({ activePanels, onChange, items = [] }: IntegrationSectionsProps) => {
  const activeKey = getActiveKey(items, activePanels);
  const [visited, setVisited] = useState(() => new Set(activeKey ? [activeKey] : []));

  useEffect(() => {
    if (activeKey) {
      setVisited((current) => new Set(current).add(activeKey));
    }
  }, [activeKey]);

  const selectTab = (key: string) => {
    setVisited((current) => new Set(current).add(key));
    onChange([key]);
  };

  if (!activeKey) return null;

  return (
    <div className="integration-sections-tabs">
      <TabList
        aria-label="Integration configuration sections"
        className="integration-sections-tab-list"
        hasDivider
        onChange={selectTab}
        overflow="visible"
        role="tablist"
        size="md"
        value={activeKey}
      >
        {items.map((item) => (
          <Tab
            key={item.key}
            id={`integration-section-${item.key}-tab`}
            value={item.key}
            label={item.label}
            panelId={`integration-section-${item.key}-panel`}
            aria-disabled={item.disabled ? 'true' : undefined}
          />
        ))}
      </TabList>
      {items.map((item) => visited.has(item.key) && (
        <div
          key={item.key}
          id={`integration-section-${item.key}-panel`}
          role="tabpanel"
          aria-labelledby={`integration-section-${item.key}-tab`}
          hidden={activeKey !== item.key}
          tabIndex={0}
        >
          {item.children}
        </div>
      ))}
    </div>
  );
};
