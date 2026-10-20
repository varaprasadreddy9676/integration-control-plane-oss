import { Tabs, Typography } from 'antd';

interface DashboardDetailsTabsProps {
  activeKey: string;
  onChange: (key: string) => void;
  items: { key: string; label: string }[];
}

export const DashboardDetailsTabs = ({ activeKey, onChange, items }: DashboardDetailsTabsProps) => {
  return (
    <div className="dashboard-details-tabs">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
        <Typography.Text className="dashboard-section-title">Details</Typography.Text>
        {/* minWidth 0 lets the tab bar shrink, so on narrow screens extra tabs
            fold into AntD's "more" menu instead of pushing the page sideways. */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Tabs
            activeKey={activeKey}
            onChange={onChange}
            items={items}
            tabBarGutter={8}
            tabBarStyle={{ marginBottom: 0 }}
          />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 12, color: '#64748B' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10B981' }} />
          Successful
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F43F5E' }} />
          Failed
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#F59E0B' }} />
          Skipped
        </span>
      </div>
    </div>
  );
};
