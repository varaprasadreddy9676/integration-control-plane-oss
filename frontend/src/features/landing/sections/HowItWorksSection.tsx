import { useState } from 'react';

interface Entry {
  item: string;
  note?: string;
}

interface Direction {
  id: string;
  name: string;
  summary: string;
  comesIn: Entry[];
  gateway: Entry[];
  goesOut: Entry[];
}

// Everything listed here is implemented — see the README's code-verified feature set.
const DIRECTIONS: Direction[] = [
  {
    id: 'outbound',
    name: 'Outbound',
    summary: 'Turn events in your systems into reliable deliveries to everyone who needs them.',
    comesIn: [
      { item: 'MySQL', note: 'Polled with checkpoints, no duplicates' },
      { item: 'Kafka', note: 'Per-organization topics' },
      { item: 'HTTP push', note: 'Authenticated, durably queued' },
      { item: 'HL7 v2 over MLLP', note: 'Parsed to JSON, answered with ACK or NACK' },
    ],
    gateway: [
      { item: 'Match rules', note: 'Which integrations care about this event' },
      { item: 'Transform', note: 'Visual field mapping or JavaScript in a sandbox' },
      { item: 'Sign', note: 'HMAC-SHA256, never sent unsigned' },
      { item: 'Retry and dead-letter', note: 'Backoff, then a queue you can replay from' },
      { item: 'Delay or hold', note: 'Send later, or wait for a follow-up event' },
    ],
    goesOut: [
      { item: 'Any HTTP API', note: 'API key, Basic, Bearer, OAuth 1 and 2, custom' },
      { item: 'Email', note: 'Any SMTP server' },
      { item: 'WhatsApp', note: 'Meta Cloud API, text and templates' },
      { item: 'Push notifications', note: 'Firebase Cloud Messaging' },
      { item: 'HL7 v2 over MLLP', note: 'With ACK validation' },
    ],
  },
  {
    id: 'inbound',
    name: 'Inbound',
    summary: 'Give partners one governed endpoint, and route each call to the right system.',
    comesIn: [
      { item: 'Partner and customer apps', note: 'One endpoint per integration' },
      { item: 'Public webhooks', note: 'Verified by HMAC with a replay window' },
      { item: 'Browser clients', note: 'Origin allowlist' },
    ],
    gateway: [
      { item: 'Authenticate', note: 'API key, Bearer, Basic or HMAC' },
      { item: 'Enforce policy', note: 'IP allowlist and per-integration rate limits' },
      { item: 'Transform', note: 'Request in, response out' },
      { item: 'Fetch credentials', note: 'OAuth tokens cached and refreshed' },
    ],
    goesOut: [
      { item: 'Any HTTP API', note: 'Responses can stream straight back' },
      { item: 'Email, SMS, WhatsApp, push', note: 'As first-class actions' },
      { item: 'Routed email', note: 'Sender chosen per request' },
    ],
  },
  {
    id: 'scheduled',
    name: 'Scheduled',
    summary: 'Run jobs on a clock: pull data from where it lives and push it where it’s needed.',
    comesIn: [
      { item: 'Cron or interval', note: 'Or run on demand' },
      { item: 'SQL and MongoDB', note: 'Queries as the data source' },
      { item: 'HTTP APIs', note: 'Fetch, then fan out' },
    ],
    gateway: [
      { item: 'Query', note: 'With safety limits on every pool' },
      { item: 'Transform', note: 'Map fields or run a script job' },
      { item: 'Log every run', note: 'Inputs, outputs and timings' },
    ],
    goesOut: [
      { item: 'Any HTTP API' },
      { item: 'Email and messaging adapters' },
      { item: 'Delayed and recurring webhooks', note: 'Cancelled automatically when plans change' },
    ],
  },
];

const Column = ({ title, entries }: { title: string; entries: Entry[] }) => (
  <div className="hiw-col">
    <p className="hiw-col-title">{title}</p>
    <ul>
      {entries.map((e) => (
        <li key={e.item}>
          <span className="hiw-item">{e.item}</span>
          {e.note && <span className="hiw-note">{e.note}</span>}
        </li>
      ))}
    </ul>
  </div>
);

export default function HowItWorksSection() {
  const [activeId, setActiveId] = useState(DIRECTIONS[0].id);
  const active = DIRECTIONS.find((d) => d.id === activeId) ?? DIRECTIONS[0];

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = DIRECTIONS.findIndex((d) => d.id === activeId);
    const next = DIRECTIONS[(i + (e.key === 'ArrowDown' ? 1 : DIRECTIONS.length - 1)) % DIRECTIONS.length];
    setActiveId(next.id);
    document.getElementById(`hiw-tab-${next.id}`)?.focus();
  };

  return (
    <section id="how-it-works" className="pl-section">
      <div className="pl-wrap">
        <div className="pl-head">
          <h2>One gateway for every direction your data moves.</h2>
          <p className="pl-lead">
            Events going out, requests coming in, and jobs that run on a clock usually live in three different tools.
            Here they share one console, one set of credentials, and one trace for every run.
          </p>
        </div>

        <div className="hiw">
          <div className="hiw-tabs" role="tablist" aria-orientation="vertical" onKeyDown={onKeyDown}>
            {DIRECTIONS.map((d) => (
              <button
                key={d.id}
                id={`hiw-tab-${d.id}`}
                role="tab"
                type="button"
                aria-selected={d.id === activeId}
                aria-controls="hiw-panel"
                tabIndex={d.id === activeId ? 0 : -1}
                className="hiw-tab"
                onClick={() => setActiveId(d.id)}
              >
                <span className="hiw-tab-name">{d.name}</span>
                <span className="hiw-tab-sub">{d.summary}</span>
              </button>
            ))}
          </div>

          <div
            id="hiw-panel"
            role="tabpanel"
            aria-labelledby={`hiw-tab-${active.id}`}
            className="hiw-lane"
            key={active.id}
          >
            <Column title="Comes in" entries={active.comesIn} />
            <Column title="The gateway" entries={active.gateway} />
            <Column title="Goes out" entries={active.goesOut} />
          </div>
        </div>
      </div>
    </section>
  );
}
