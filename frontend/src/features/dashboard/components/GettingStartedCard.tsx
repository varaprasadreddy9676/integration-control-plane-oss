import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { useQuery } from '@tanstack/react-query';
import { getAllEventTypes, getEventSourceConfig } from '../../../services/api';
import { Button } from '../../../components/common/LegacyButton';

interface GettingStartedCardProps {
  orgId: number;
  onNavigate: (path: string) => void;
}

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
    <section aria-labelledby="getting-started-title" className="console-dashboard-panel-getting-started">
      <Heading level={2} id="getting-started-title" className="console-margin-none">
        Get started
      </Heading>
      <Text type="supporting" color="secondary" as="p" className="getting-started-intro">
        This organization has no integrations yet. Charts and metrics appear here once the first one runs.
      </Text>

      <ol className="getting-started-steps">
        {steps.map((step, index) => (
          <li key={step.title} className="getting-started-step">
            <span aria-hidden className="getting-started-step-marker" data-done={step.done}>
              {step.done ? <GatewayIcon name="CheckCircleFilled" /> : index + 1}
            </span>
            <div className="console-flex-min-width-0">
              <Text weight="semibold" color={step.done ? 'secondary' : 'primary'} hasStrikethrough={step.done}>
                {step.title}
              </Text>
              {step.done && <span className="console-visually-hidden"> (done)</span>}
              <Text type="supporting" color="secondary" as="p" className="getting-started-step-body">
                {step.body}
              </Text>
              <div className="getting-started-actions">
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
