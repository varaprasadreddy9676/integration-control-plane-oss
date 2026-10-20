import { Button, Typography } from 'antd';
import { CheckCircleFilled } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { getAllEventTypes, getEventSourceConfig } from '../../../services/api';
import { cssVar, useDesignTokens } from '../../../design-system/utils';
import { useDashboardPanelStyle } from './DashboardPrimitives';

interface GettingStartedCardProps {
  orgId: number;
  onNavigate: (path: string) => void;
}

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;

interface Step {
  title: string;
  body: string;
  done: boolean;
  actions: { label: string; path: string }[];
}

/**
 * Shown on the dashboard while an org has no integrations of any kind, in place
 * of a page of empty charts. Each step's tick comes from real data, so it reflects
 * what is actually configured.
 */
export const GettingStartedCard = ({ orgId, onNavigate }: GettingStartedCardProps) => {
  const { spacing } = useDesignTokens();
  const panelStyle = useDashboardPanelStyle();

  const { data: eventSource } = useQuery({
    queryKey: ['eventSourceConfig', orgId],
    queryFn: async () => {
      try {
        return await getEventSourceConfig(orgId);
      } catch (e: any) {
        if (e?.statusCode === 404) return null;
        throw e;
      }
    },
    retry: false,
  });
  const { data: eventTypes = [] } = useQuery({
    queryKey: ['eventTypes', orgId],
    queryFn: getAllEventTypes,
  });

  const steps: Step[] = [
    {
      title: 'Choose where events come from',
      body: 'HTTP push, MySQL, Kafka or HL7. Only outbound integrations need this; inbound APIs and scheduled jobs work without it.',
      done: Boolean(eventSource?.isActive),
      actions: [{ label: 'Set up event source', path: '/settings/event-source' }],
    },
    {
      title: 'Describe your events',
      body: 'Name the events your systems send, such as ORDER_PLACED, so integrations can match and map them.',
      done: eventTypes.length > 0,
      actions: [{ label: 'Open event catalog', path: '/events/catalog' }],
    },
    {
      title: 'Create your first integration',
      body: 'Deliver events to an API, give partners an inbound endpoint, or run a job on a schedule.',
      done: false,
      actions: [
        { label: 'Outbound', path: '/integrations/new' },
        { label: 'Inbound', path: '/inbound-integrations/new' },
        { label: 'Scheduled job', path: '/scheduled-jobs/new' },
      ],
    },
  ];

  return (
    <section aria-labelledby="getting-started-title" style={{ ...panelStyle, marginTop: 12, padding: spacing[6] }}>
      <Typography.Title level={4} id="getting-started-title" style={{ margin: 0 }}>
        Get started
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: spacing[1], marginBottom: spacing[5] }}>
        This organization has no integrations yet. Charts and metrics appear here once the first one runs.
      </Typography.Paragraph>

      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: spacing[4] }}>
        {steps.map((step, index) => (
          <li key={step.title} style={{ display: 'flex', gap: spacing[3], alignItems: 'flex-start' }}>
            <span
              aria-hidden
              style={{
                flex: '0 0 28px',
                height: 28,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 600,
                fontSize: 13,
                border: `1px solid ${step.done ? cssVar.success.border : cssVar.border.default}`,
                background: step.done ? cssVar.success.bg : 'transparent',
                color: step.done ? cssVar.success.text : cssVar.text.secondary,
              }}
            >
              {step.done ? <CheckCircleFilled /> : index + 1}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Typography.Text strong delete={step.done} type={step.done ? 'secondary' : undefined}>
                {step.title}
              </Typography.Text>
              {step.done && <span style={visuallyHidden}> (done)</span>}
              <Typography.Paragraph type="secondary" style={{ margin: `${spacing[1]} 0 ${spacing[2]}` }}>
                {step.body}
              </Typography.Paragraph>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: spacing[2] }}>
                {step.actions.map((action) => (
                  <Button key={action.path} size="small" onClick={() => onNavigate(action.path)}>
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
};
