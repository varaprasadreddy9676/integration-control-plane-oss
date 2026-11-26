import { Segmented, Select } from "@/components/common/LegacyAntdControls";
import { Text } from '@astryxdesign/core/Text';
import { cssVar } from '../../../design-system/utils';

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
  statusText,
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
            { label: '90 days', value: 90 },
          ]}
          className="console-width-compact-control"
        />
        <Segmented
          value={direction}
          onChange={(value) => setDirection(value as typeof direction)}
          options={[
            { label: 'All', value: 'ALL' },
            { label: 'Outbound', value: 'OUTBOUND' },
            { label: 'Inbound', value: 'INBOUND' },
            { label: 'Scheduled', value: 'SCHEDULED' },
          ]}
        />
        <Select
          placeholder="Provider"
          allowClear
          value={provider}
          onChange={setProvider}
          options={providerOptions}
          className="ui-extracted-300b5686fc"
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
          className="ui-extracted-14b4ad96c5"
          optionFilterProp="label"
          showSearch
        />
      </div>
      <div className="dashboard-status ui-extracted-2c20ba9c18" >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: cssVar.text.muted,
            display: 'inline-block',
          }}
        />
        <Text type="code" color="secondary">
          {statusText}
        </Text>
      </div>
    </section>
  );
};
