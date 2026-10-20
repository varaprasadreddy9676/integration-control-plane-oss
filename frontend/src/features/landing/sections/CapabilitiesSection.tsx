import { Link } from 'react-router-dom';

interface Capability {
  name: string;
  desc: string;
  doc?: string;
}

interface Group {
  title: string;
  lead: string;
  items: Capability[];
}

const GROUPS: Group[] = [
  {
    title: 'Deliver',
    lead: 'Messages arrive, or you know exactly why not.',
    items: [
      { name: 'Retries with backoff', desc: 'Transient failures recover on their own.', doc: 'outbound-delivery' },
      {
        name: 'Dead-letter queue',
        desc: 'Replay one message or a thousand from the console.',
        doc: 'dead-letter-queue',
      },
      {
        name: 'Delayed and recurring',
        desc: 'Send in an hour, every day, or not at all if plans change.',
        doc: 'outbound-lifecycle',
      },
      {
        name: 'Hold for approval',
        desc: 'Park a delivery until a later event releases or discards it.',
        doc: 'outbound-lifecycle',
      },
      { name: 'Bulk operations', desc: 'Update, retry or delete in batches.', doc: 'bulk-operations' },
    ],
  },
  {
    title: 'Transform',
    lead: 'Every system gets the shape it expects.',
    items: [
      { name: 'Visual field mapping', desc: 'Map fields with dot notation, no code.', doc: 'data-transformation' },
      { name: 'JavaScript transforms', desc: 'Run your own logic in a sandboxed VM.', doc: 'data-transformation' },
      { name: 'Lookup tables', desc: 'Translate codes and enrich values on the way through.', doc: 'lookup-tables' },
      { name: 'Templates', desc: 'Start new integrations from proven ones.', doc: 'versioning' },
      { name: 'Version history', desc: 'See every change and roll back.', doc: 'versioning' },
    ],
  },
  {
    title: 'Observe',
    lead: 'Answer “what happened?” without reading server logs.',
    items: [
      { name: 'Execution traces', desc: 'Each step of each run, with timings and payloads.' },
      { name: 'Event audit', desc: 'Every event received, and why it was or wasn’t sent.' },
      { name: 'Alert center', desc: 'Failure thresholds per organization, with trends.', doc: 'alert-center' },
      { name: 'Analytics', desc: 'Success rates and p50, p95, p99 latency.', doc: 'analytics-reports' },
      { name: 'Daily reports', desc: 'A summary in your inbox, plus Slack alerts.', doc: 'email-notifications' },
    ],
  },
  {
    title: 'Govern',
    lead: 'Safe to hand to many teams and many customers.',
    items: [
      { name: 'Organizations', desc: 'Isolated data, credentials and configuration.' },
      { name: 'Role-based access', desc: 'Seven built-in roles, permissions per feature.', doc: 'rbac' },
      { name: 'Encrypted credentials', desc: 'Secrets encrypted at rest and masked in the console.' },
      { name: 'Audit trail', desc: 'Who changed what, and when.' },
      { name: 'SSRF protection', desc: 'Private networks blocked for outbound targets.', doc: 'webhook-security' },
      { name: 'API keys', desc: 'Personal tokens, hashed at rest and revocable.', doc: 'api-keys' },
    ],
  },
];

export default function CapabilitiesSection() {
  return (
    <section id="features" className="pl-section">
      <div className="pl-wrap">
        <div className="pl-head">
          <h2>The parts you would otherwise build yourself.</h2>
          <p className="pl-lead">
            Retries, dead-letter queues, mapping, tracing, tenancy, access control. Each one is a project on its own;
            here they come working together.
          </p>
        </div>

        <div className="caps">
          {GROUPS.map((g) => (
            <div key={g.title} className="caps-group">
              <h3>{g.title}</h3>
              <p>{g.lead}</p>
              <ul>
                {g.items.map((c) => (
                  <li key={c.name}>
                    {c.doc ? (
                      <Link
                        to={`/docs/${c.doc}`}
                        className="caps-name pl-link"
                        style={{ color: 'var(--text-primary)' }}
                      >
                        {c.name}
                      </Link>
                    ) : (
                      <span className="caps-name">{c.name}</span>
                    )}
                    <span className="caps-desc">{c.desc}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
