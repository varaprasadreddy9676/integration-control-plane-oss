import { Segmented, Select, Typography } from 'antd';

interface DashboardToolbarProps {
  days: number;
  setDays: (value: number) => void;
  direction: 'ALL' | 'OUTBOUND' | 'INBOUND' | 'SCHEDULED';
  setDirection: (value: 'ALL' | 'OUTBOUND' | 'INBOUND' | 'SCHEDULED') => void;
  provider?: string;
  setProvider: (value: string | undefined) => void;
  providerOptions?: Array<{ label: string; value: string }>;
  integrationId?: string;
  setIntegrationId: (value: string | undefined) => void;
  integrationOptions?: Array<{ label: string; value: string; direction?: string; provider?: string }>;
  statusText: string;
}

export const DashboardToolbar = ({
  days,
  setDays,
  direction,
  setDirection,
  provider,
  setProvider,
  providerOptions = [],
  integrationId,
  setIntegrationId,
  integrationOptions = [],
  statusText
}: DashboardToolbarProps) => {
  return (
    <section className="dashboard-toolbar">
      <div className="dashboard-filters" role="toolbar" aria-label="Dashboard filters">
        <Select
          value={days}
          onChange={setDays}
          options={[
            { label: 'Today', value: 1 },
            { label: '7 days', value: 7 },
            { label: '30 days', value: 30 },
            { label: '90 days', value: 90 }
          ]}
          style={{ width: 120 }}
        />
        <Segmented
          value={direction}
          onChange={(value) => setDirection(value as typeof direction)}
          options={[
            { label: 'All', value: 'ALL' },
            { label: 'Outbound', value: 'OUTBOUND' },
            { label: 'Inbound', value: 'INBOUND' },
            { label: 'Scheduled', value: 'SCHEDULED' }
          ]}
        />
        <Select
          placeholder="Provider"
          allowClear
          value={provider}
          onChange={setProvider}
          options={providerOptions}
          style={{ width: 180 }}
          optionFilterProp="label"
          showSearch
          disabled={providerOptions.length === 0}
        />
        <Select
          placeholder="Integration"
          allowClear
          value={integrationId}
          onChange={(value, option: any) => {
            setIntegrationId(value);
            if (value && option?.direction && direction === 'ALL') {
              setDirection(option.direction as typeof direction);
            }
          }}
          options={integrationOptions}
          style={{ width: 220 }}
          optionFilterProp="label"
          showSearch
        />
      </div>
      <div className="dashboard-status" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: '#94A3B8',
            display: 'inline-block',
          }}
        />
        <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }}>
          {statusText}
        </Typography.Text>
      </div>
    </section>
  );
};
