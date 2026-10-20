import { useState } from 'react';

/**
 * Small, generic recreations of console screens. Real screenshots carry
 * customer data and are unreadable at this size; these stay crisp, follow
 * the theme, and respond to the visitor.
 */

type RowStatus = 'Delivered' | 'Failed' | 'Retrying';

const LOG_ROWS: Array<{ id: number; name: string; target: string; status: RowStatus; time: string }> = [
  { id: 1, name: 'ORDER_PLACED', target: 'ERP order sync', status: 'Delivered', time: '10:42:18' },
  { id: 2, name: 'INVOICE_SENT', target: 'Billing email', status: 'Delivered', time: '10:42:11' },
  { id: 3, name: 'SHIPMENT_UPDATED', target: 'Carrier webhook', status: 'Failed', time: '10:41:57' },
  { id: 4, name: 'USER_SIGNED_UP', target: 'CRM contact sync', status: 'Retrying', time: '10:41:40' },
  { id: 5, name: 'PAYMENT_SUCCEEDED', target: 'Accounting', status: 'Delivered', time: '10:41:22' },
];

export function DeliveryLogVisual() {
  const [replayed, setReplayed] = useState<'idle' | 'sending' | 'done'>('idle');

  const replay = () => {
    if (replayed !== 'idle') return;
    setReplayed('sending');
    window.setTimeout(() => setReplayed('done'), 900);
  };

  return (
    <div className="pv-panel">
      <div className="pv-bar">
        <span className="pv-title">Delivery logs</span>
        <span className="pv-filters">
          <span className="pv-filter is-on">All</span>
          <span className="pv-filter">Failed</span>
          <span className="pv-filter">Skipped</span>
        </span>
      </div>
      <ul className="pv-rows">
        {LOG_ROWS.map((row) => {
          const isFailed = row.status === 'Failed';
          const status: RowStatus | 'Replayed' = isFailed && replayed === 'done' ? 'Replayed' : row.status;
          return (
            <li key={row.id} className={`pv-row${isFailed ? ' is-open' : ''}`}>
              <div className="pv-row-main">
                <span className={`pv-status pv-status-${status.toLowerCase()}`}>{status}</span>
                <span className="pv-name">{row.name}</span>
                <span className="pv-target">{row.target}</span>
                <span className="pv-time">{row.time}</span>
              </div>
              {isFailed && (
                <div className="pv-detail">
                  {replayed === 'done' ? (
                    <p className="pv-detail-text">
                      Replayed. <span className="pv-ok">200 OK in 284 ms</span>, delivered on the next attempt.
                    </p>
                  ) : (
                    <p className="pv-detail-text">
                      <span className="pv-fail">Connection timed out after 30 s.</span> 4 of 4 attempts used; moved to
                      the dead-letter queue.
                    </p>
                  )}
                  <div className="pv-actions">
                    <span className="pv-ghost">View trace</span>
                    <span className="pv-ghost">Source event</span>
                    <button type="button" className="pv-button" onClick={replay} disabled={replayed !== 'idle'}>
                      {replayed === 'sending' ? 'Replaying…' : replayed === 'done' ? 'Replayed' : 'Replay'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const ORGS: Array<{ id: string; name: string; depth: number; integrations: number; people: number }> = [
  { id: 'group', name: 'Northwind Group', depth: 0, integrations: 12, people: 6 },
  { id: 'eu', name: 'Northwind Europe', depth: 1, integrations: 34, people: 18 },
  { id: 'de', name: 'Berlin', depth: 2, integrations: 9, people: 5 },
  { id: 'us', name: 'Northwind Americas', depth: 1, integrations: 41, people: 22 },
  { id: 'acme', name: 'Acme Retail', depth: 0, integrations: 27, people: 11 },
];

const ROLES = ['Org admin', 'Integration editor', 'Viewer', 'API key'];

export function TenancyVisual() {
  const [active, setActive] = useState('eu');
  const org = ORGS.find((o) => o.id === active) ?? ORGS[0];

  return (
    <div className="pv-panel">
      <div className="pv-bar">
        <span className="pv-title">Organizations</span>
        <span className="pv-hint">Select one</span>
      </div>
      <div className="pv-tenancy">
        <ul className="pv-orgs" aria-label="Organizations">
          {ORGS.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className={`pv-org${o.id === active ? ' is-on' : ''}`}
                style={{ paddingLeft: 14 + o.depth * 18 }}
                aria-pressed={o.id === active}
                onClick={() => setActive(o.id)}
              >
                <span className="pv-org-name">{o.name}</span>
                <span className="pv-org-meta">{o.integrations}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="pv-org-card" key={org.id}>
          <span className="pv-org-title">{org.name}</span>
          <dl className="pv-facts">
            <div>
              <dt>Integrations</dt>
              <dd>{org.integrations}</dd>
            </div>
            <div>
              <dt>People</dt>
              <dd>{org.people}</dd>
            </div>
            <div>
              <dt>Credentials</dt>
              <dd>Own, encrypted</dd>
            </div>
            <div>
              <dt>Logs</dt>
              <dd>This organization only</dd>
            </div>
          </dl>
          <span className="pv-roles-title">Roles in use</span>
          <span className="pv-roles">
            {ROLES.map((r) => (
              <span key={r} className="pv-role">
                {r}
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
