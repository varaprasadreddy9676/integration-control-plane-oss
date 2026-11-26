import { Tab, TabList } from '@astryxdesign/core/TabList';
import { cssVar } from '../../../design-system/utils';

interface DashboardDetailsTabsProps {
  activeKey: string;
  onChange: (key: string) => void;
  items: { key: string; label: string }[];
}

export const DashboardDetailsTabs = ({ activeKey, onChange, items }: DashboardDetailsTabsProps) => {
  return (
    <div className="dashboard-details-tabs">
      <div
        className="dashboard-details-tabs-main ui-extracted-c5d0a8e036"

      >
        <span className="dashboard-section-title">Details</span>
        <TabList
          aria-label="Dashboard details"
          className="dashboard-details-tab-list"
          hasDivider={false}
          onChange={onChange}
          overflow="scroll"
          role="tablist"
          size="sm"
          value={activeKey}
        >
          {items.map(({ key, label }) => (
            <Tab id={`dashboard-tab-${key}`} key={key} label={label} panelId={`dashboard-panel-${key}`} value={key} />
          ))}
        </TabList>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--spacing-4)',
          fontSize: 'var(--console-type-caption)',
          color: cssVar.text.secondary,
        }}
      >
        <span className="console-inline-flex-center-gap-1">
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: cssVar.success.text }} />
          Successful
        </span>
        <span className="console-inline-flex-center-gap-1">
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: cssVar.error.text }} />
          Failed
        </span>
        <span className="console-inline-flex-center-gap-1">
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: cssVar.warning.text }} />
          Skipped
        </span>
      </div>
    </div>
  );
};
