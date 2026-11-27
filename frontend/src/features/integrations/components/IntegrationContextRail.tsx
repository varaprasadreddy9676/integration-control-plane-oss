import { useQuery } from '@tanstack/react-query';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { ContextRail, Panel } from '../../../design-system/primitives';
import { getLogs } from '../../../services/api';
import type { IntegrationConfig } from '../../../mocks/types';
import { formatDateTime } from '../../../utils/format';
import './integration-context-rail.css';

interface IntegrationContextRailProps {
  integration: IntegrationConfig;
  /** Opens the delivery logs filtered to this integration. */
  onOpenLogs: () => void;
}

const hostOf = (url?: string) => {
  if (!url) return '—';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * What this integration is doing right now, beside what is being configured.
 * Configuration pages carry settings only; live state lives here rather than
 * being mixed into the form.
 */
export const IntegrationContextRail = ({ integration, onOpenLogs }: IntegrationContextRailProps) => {
  const { data, isLoading } = useQuery({
    queryKey: ['integration-context-runs', integration.id],
    queryFn: () => getLogs({ integrationId: integration.id, limit: 5 }),
    staleTime: 30_000,
  });

  const runs = data?.data ?? [];

  return (
    <ContextRail label="Integration status">
      <Panel title="Status">
        <dl className="icr-rows">
          <div className="icr-row">
            <dt>State</dt>
            <dd>
              <StatusBadge
                status={integration.isActive ? 'SUCCESS' : 'SKIPPED'}
                label={integration.isActive ? 'Active' : 'Inactive'}
              />
            </dd>
          </div>
          <div className="icr-row">
            <dt>Last updated</dt>
            <dd className="icr-mono">{integration.updatedAt ? formatDateTime(integration.updatedAt) : '—'}</dd>
          </div>
          <div className="icr-row">
            <dt>Event</dt>
            <dd className="icr-mono">{integration.eventType || '—'}</dd>
          </div>
        </dl>
      </Panel>

      <Panel
        title="Recent runs"
        actions={
          <button type="button" className="icr-link" onClick={onOpenLogs}>
            All logs
          </button>
        }
      >
        {isLoading ? (
          <p className="icr-muted">Loading runs…</p>
        ) : runs.length === 0 ? (
          <p className="icr-muted">No deliveries yet. Runs appear here once the integration is active.</p>
        ) : (
          <ul className="icr-runs">
            {runs.map((run) => (
              <li key={run.id} className="icr-run">
                <span className="icr-mono icr-run-time">{formatDateTime(run.createdAt)}</span>
                <StatusBadge status={run.status} />
                <span className="icr-mono icr-run-latency">
                  {run.responseTimeMs ? `${run.responseTimeMs} ms` : (run.responseStatus ?? '—')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Connection">
        <dl className="icr-rows">
          <div className="icr-row">
            <dt>Host</dt>
            <dd className="icr-mono">{hostOf(integration.targetUrl)}</dd>
          </div>
          <div className="icr-row">
            <dt>Method</dt>
            <dd className="icr-mono">{integration.httpMethod || '—'}</dd>
          </div>
          <div className="icr-row">
            <dt>Auth</dt>
            <dd>{String(integration.outgoingAuthType || 'none').replace(/_/g, ' ').toLowerCase()}</dd>
          </div>
        </dl>
      </Panel>
    </ContextRail>
  );
};
