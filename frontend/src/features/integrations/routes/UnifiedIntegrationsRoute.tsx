import { useEffect, useState } from 'react';
import { Grid } from "@/components/common/LegacyAntdControls";
import { Button } from '@astryxdesign/core/Button';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { useLocation } from 'react-router-dom';
import { PageHeader } from '../../../components/common/PageHeader';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { useDesignTokens } from '../../../design-system/utils';
import { useNavigateWithParams } from '../../../utils/navigation';
import { IntegrationsRoute } from './IntegrationsRoute';
import { InboundIntegrationsRoute } from '../../inbound-integrations/routes/InboundIntegrationsRoute';
import { ScheduledJobsRoute } from '../../scheduled-jobs/routes/ScheduledJobsRoute';

type IntegrationTab = 'event-rules' | 'api-integrations' | 'scheduled-integrations';

const TAB_QUERY_VALUE: Record<IntegrationTab, string> = {
  'event-rules': 'outbound',
  'api-integrations': 'inbound',
  'scheduled-integrations': 'scheduled',
};

const TAB_SUMMARY: Record<IntegrationTab, string> = {
  'event-rules': 'Send application events to external systems.',
  'api-integrations': 'Proxy inbound requests with authentication and transformation.',
  'scheduled-integrations': 'Run database queries and scripts on a schedule.',
};

const normalizeTab = (value: string | null): IntegrationTab | undefined => {
  if (value === 'inbound' || value === 'api') return 'api-integrations';
  if (value === 'outbound' || value === 'event') return 'event-rules';
  if (value === 'scheduled') return 'scheduled-integrations';
  if (value === 'api-integrations' || value === 'event-rules' || value === 'scheduled-integrations') return value;
  return undefined;
};

export const UnifiedIntegrationsRoute = () => {
  const navigate = useNavigateWithParams();
  const location = useLocation();
  const { spacing } = useDesignTokens();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;
  const [activeTab, setActiveTab] = useState<IntegrationTab>('event-rules');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const nextTab = normalizeTab(params.get('tab'));
    if (nextTab) setActiveTab(nextTab);
  }, [location.search]);

  const selectTab = (nextTab: string) => {
    if (nextTab !== 'event-rules' && nextTab !== 'api-integrations' && nextTab !== 'scheduled-integrations') return;
    setActiveTab(nextTab);
    navigate(`/integrations?tab=${TAB_QUERY_VALUE[nextTab]}`);
  };

  const startNewIntegration = () => {
    if (activeTab === 'event-rules') navigate('/integrations/new');
    else if (activeTab === 'api-integrations') navigate('/inbound-integrations/new');
    else navigate('/scheduled-jobs/new');
  };

  return (
    <PageTemplate
      as="main"
      className="unified-integrations-template"
      contentClassName="unified-integrations-template__content"
      header={
        <PageHeader
          title="Integrations"
          description="Manage outbound, inbound, and scheduled integrations"
          breadcrumb={[{ label: 'Configuration' }, { label: 'Integrations' }]}
          actions={
            <Button
              label="New Integration"
              variant="primary"
              size="md"
              icon={<GatewayIcon name="PlusOutlined" aria-hidden="true" />}
              width={isNarrow ? '100%' : undefined}
              onClick={startNewIntegration}
            />
          }
          compact
        />
      }
    >
      <div style={{ padding: `0 ${spacing[4]} ${spacing[4]}` }}>
        <TabList
          value={activeTab}
          onChange={selectTab}
          size="md"
          layout={isNarrow ? 'hug' : 'fill'}
          role="tablist"
          aria-label="Integration types"
          hasDivider
          overflow="scroll"
        >
          <Tab
            value="event-rules"
            label="Outbound"
            icon={<GatewayIcon name="ThunderboltOutlined" aria-hidden="true" />}
            panelId="outbound-integrations-panel"
            id="outbound-integrations-tab"
          />
          <Tab
            value="api-integrations"
            label="Inbound"
            icon={<GatewayIcon name="ApiOutlined" aria-hidden="true" />}
            panelId="inbound-integrations-panel"
            id="inbound-integrations-tab"
          />
          <Tab
            value="scheduled-integrations"
            label="Scheduled"
            icon={<GatewayIcon name="ClockCircleOutlined" aria-hidden="true" />}
            panelId="scheduled-integrations-panel"
            id="scheduled-integrations-tab"
          />
        </TabList>

        <Text
          type="supporting"
          as="p"
          style={{ display: 'block', margin: `${spacing[2]} 0 ${spacing[3]}`, fontSize: 'var(--console-type-caption)' }}
        >
          {TAB_SUMMARY[activeTab]}
        </Text>

        <section
          id="outbound-integrations-panel"
          role="tabpanel"
          aria-labelledby="outbound-integrations-tab"
          hidden={activeTab !== 'event-rules'}
          tabIndex={0}
        >
          <IntegrationsRoute hideHeader isActive={activeTab === 'event-rules'} />
        </section>
        <section
          id="inbound-integrations-panel"
          role="tabpanel"
          aria-labelledby="inbound-integrations-tab"
          hidden={activeTab !== 'api-integrations'}
          tabIndex={0}
        >
          <InboundIntegrationsRoute hideHeader isActive={activeTab === 'api-integrations'} />
        </section>
        <section
          id="scheduled-integrations-panel"
          role="tabpanel"
          aria-labelledby="scheduled-integrations-tab"
          hidden={activeTab !== 'scheduled-integrations'}
          tabIndex={0}
        >
          <ScheduledJobsRoute hideHeader isActive={activeTab === 'scheduled-integrations'} />
        </section>
      </div>
    </PageTemplate>
  );
};
