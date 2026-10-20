import { useEffect, useState } from 'react';
import { Tabs, Space, Typography, Button, Popover, Divider, Grid, Tooltip } from 'antd';
import {
  ThunderboltOutlined,
  ApiOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { IntegrationsRoute } from './IntegrationsRoute';
import { InboundIntegrationsRoute } from '../../inbound-integrations/routes/InboundIntegrationsRoute';
import { ScheduledJobsRoute } from '../../scheduled-jobs/routes/ScheduledJobsRoute';
import { PageHeader } from '../../../components/common/PageHeader';
import { useDesignTokens } from '../../../design-system/utils';
import { useNavigateWithParams } from '../../../utils/navigation';
import { useLocation } from 'react-router-dom';

const { Text, Paragraph } = Typography;

// Help content for Outbound Integrations
const OutboundHelpContent = () => (
  <div style={{ maxWidth: 380 }}>
    <Paragraph style={{ marginBottom: 12 }}>
      Outbound integrations automatically send data to external systems when events occur in your application (e.g.,
      appointment created, patient registered, order placed).
    </Paragraph>
    <div style={{ marginBottom: 8 }}>
      <Text strong>Flow:</Text> <Text type="secondary">Your App Event → Gateway → External System</Text>
    </div>
    <div>
      <Text strong>Use cases:</Text> <Text type="secondary">CRM sync, notifications, data pipelines, analytics</Text>
    </div>
  </div>
);

// Help content for Inbound Integrations
const InboundHelpContent = () => (
  <div style={{ maxWidth: 380 }}>
    <Paragraph style={{ marginBottom: 12 }}>
      Inbound integrations act as a real-time proxy between your client app and external APIs. The gateway handles
      authentication, transformation, and forwards requests.
    </Paragraph>
    <div style={{ marginBottom: 8 }}>
      <Text strong>Flow:</Text> <Text type="secondary">Client App → Gateway → External API → Response</Text>
    </div>
    <div>
      <Text strong>Use cases:</Text>{' '}
      <Text type="secondary">Real-time eligibility checks, live data enrichment, synchronous operations</Text>
    </div>
  </div>
);

// Help content for Scheduled Integrations
const ScheduledHelpContent = () => (
  <div style={{ maxWidth: 380 }}>
    <Paragraph style={{ marginBottom: 12 }}>
      Scheduled integrations run on time-based triggers (cron schedules or intervals), fetching data from databases and
      sending batches to external systems.
    </Paragraph>
    <div style={{ marginBottom: 8 }}>
      <Text strong>Flow:</Text> <Text type="secondary">Database Query → Gateway (on schedule) → External System</Text>
    </div>
    <div>
      <Text strong>Use cases:</Text>{' '}
      <Text type="secondary">Daily reports, batch syncs, periodic data exports, scheduled notifications</Text>
    </div>
  </div>
);

export const UnifiedIntegrationsRoute = () => {
  const { spacing, token } = useDesignTokens();
  const navigate = useNavigateWithParams();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('event-rules');
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tabParam = params.get('tab');
    if (!tabParam) return;

    const normalized =
      tabParam === 'inbound' || tabParam === 'api'
        ? 'api-integrations'
        : tabParam === 'outbound' || tabParam === 'event'
          ? 'event-rules'
          : tabParam === 'scheduled'
            ? 'scheduled-integrations'
            : tabParam;

    if (normalized === 'api-integrations' || normalized === 'event-rules' || normalized === 'scheduled-integrations') {
      setActiveTab(normalized);
    }
  }, [location.search]);

  // AntD's Tabs "more" overflow dropdown doesn't reliably open once the nav list is
  // squeezed tight — confirmed on a 375px viewport: the "..." trigger renders but
  // never opens, making the Inbound and Scheduled tabs completely unreachable on
  // mobile. Icon-only tabs (full name in a Tooltip) on mobile keep all three tabs
  // comfortably under the overflow threshold instead of depending on that dropdown.
  const tabLabel = (icon: React.ReactNode, fullLabel: string, help: React.ReactNode) =>
    isNarrow ? (
      <Tooltip title={fullLabel}>
        <span aria-label={fullLabel} style={{ display: 'flex', alignItems: 'center' }}>
          {icon}
        </span>
      </Tooltip>
    ) : (
      <Space size={6}>
        {icon}
        <span>{fullLabel}</span>
        <Popover content={help} trigger="click" placement="bottom">
          <QuestionCircleOutlined
            style={{ color: token.colorTextSecondary, fontSize: 12 }}
            aria-label={`Learn more about ${fullLabel.toLowerCase()}`}
          />
        </Popover>
      </Space>
    );

  const tabItems = [
    {
      key: 'event-rules',
      label: tabLabel(<ThunderboltOutlined aria-hidden="true" />, 'Outbound Integrations', <OutboundHelpContent />),
      children: <IntegrationsRoute hideHeader isActive={activeTab === 'event-rules'} />,
    },
    {
      key: 'api-integrations',
      label: tabLabel(<ApiOutlined aria-hidden="true" />, 'Inbound Integrations', <InboundHelpContent />),
      children: <InboundIntegrationsRoute hideHeader isActive={activeTab === 'api-integrations'} />,
    },
    {
      key: 'scheduled-integrations',
      label: tabLabel(<ClockCircleOutlined aria-hidden="true" />, 'Scheduled Integrations', <ScheduledHelpContent />),
      children: <ScheduledJobsRoute hideHeader isActive={activeTab === 'scheduled-integrations'} />,
    },
  ];

  const newIntegrationButton = (
    <Button
      type="primary"
      size="middle"
      icon={<PlusOutlined />}
      aria-label="New Integration"
      block={isNarrow}
      onClick={() => {
        if (activeTab === 'event-rules') {
          navigate('/integrations/new');
        } else if (activeTab === 'api-integrations') {
          navigate('/inbound-integrations/new');
        } else {
          navigate('/scheduled-jobs/new');
        }
      }}
    >
      New Integration
    </Button>
  );

  return (
    <div style={{ minHeight: '100vh' }}>
      <PageHeader
        title="Integrations"
        description="Manage outbound, inbound, and scheduled integrations"
        breadcrumb={[{ label: 'Configuration' }, { label: 'Integrations' }]}
        // On mobile the button moves down here, off the tab bar row, so the three
        // tabs (Outbound/Inbound/Scheduled) get the full row width instead of
        // fighting a fixed-width button for space — see the tabItems comment above.
        actions={isNarrow ? newIntegrationButton : undefined}
        compact
      />

      <div style={{ padding: `0 ${spacing[4]} ${spacing[4]}` }}>
        <Tabs
          activeKey={activeTab}
          onChange={(nextTab) => {
            setActiveTab(nextTab);
            const tabValue =
              nextTab === 'api-integrations'
                ? 'inbound'
                : nextTab === 'scheduled-integrations'
                  ? 'scheduled'
                  : 'outbound';
            navigate(`/integrations?tab=${tabValue}`);
          }}
          items={tabItems}
          size="middle"
          aria-label="Integration type tabs"
          tabBarStyle={{
            marginBottom: 0,
            paddingBottom: spacing[2],
            borderBottom: `1px solid ${token.colorBorder}`,
          }}
          tabBarExtraContent={isNarrow ? undefined : newIntegrationButton}
        />
      </div>
    </div>
  );
};
