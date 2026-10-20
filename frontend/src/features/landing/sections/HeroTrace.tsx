import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { SecondsAgo } from '../../../components/common/RefreshCountdown';

/**
 * The hero's product moment: one integration run, traced live, the way the
 * console's Timeline tab shows it. Every motion is a real gateway behaviour —
 * a step starting, a provider failing, a retry counting down, a rule skipping
 * a message — and the finished run settles into the recent list.
 */

type Outcome = 'ok' | 'fail' | 'skip' | 'wait';

interface Step {
  label: string;
  detail: string | ((remainingMs: number) => string);
  /** What a finished step says, when it differs from the live detail. */
  doneDetail?: string;
  ms: number;
  outcome: Outcome;
  result?: string;
  mono?: boolean;
}

interface Scenario {
  name: string;
  /** Plain-language line under the name: what kind of integration ran, and from where. */
  origin: string;
  target: string;
  final: 'Delivered' | 'Completed' | 'Skipped';
  steps: Step[];
}

// One of each thing the gateway runs: an outbound event delivery, an inbound
// API call it proxies, and a scheduled job — plus a rule doing its job.
const SCENARIOS: Scenario[] = [
  {
    name: 'ORDER_PLACED',
    origin: 'Outbound event from Storefront',
    target: 'ERP',
    final: 'Delivered',
    steps: [
      { label: 'Received', detail: 'Order #48213, 3 items', ms: 420, outcome: 'ok' },
      { label: 'Matched 2 integrations', detail: 'ERP sync, Slack alert', ms: 520, outcome: 'ok' },
      { label: 'Mapped payload', detail: '18 fields into erp_order_v2', ms: 640, outcome: 'ok' },
      {
        label: 'Sent to ERP',
        detail: 'POST /api/orders',
        mono: true,
        ms: 1240,
        outcome: 'fail',
        result: '503 Service Unavailable',
      },
      {
        label: 'Retry scheduled',
        detail: (remaining) => `Retrying in ${Math.max(1, Math.ceil(remaining / 1000))}s`,
        doneDetail: 'Waited 3s with backoff',
        ms: 3000,
        outcome: 'wait',
      },
      { label: 'Sent to ERP', detail: 'POST /api/orders', mono: true, ms: 312, outcome: 'ok', result: '200 OK' },
    ],
  },
  {
    name: 'POST /inbound/contacts',
    origin: 'Inbound request from Partner app',
    target: 'CRM',
    final: 'Completed',
    steps: [
      { label: 'Authenticated caller', detail: 'API key, 42 of 100 requests this minute', ms: 260, outcome: 'ok' },
      { label: 'Transformed request', detail: '9 fields into the CRM contact schema', ms: 340, outcome: 'ok' },
      { label: 'Fetched access token', detail: 'OAuth2 client credentials, cached', ms: 220, outcome: 'ok' },
      {
        label: 'Forwarded to CRM',
        detail: 'POST /v3/contacts',
        mono: true,
        ms: 410,
        outcome: 'ok',
        result: '201 Created',
      },
      { label: 'Responded to caller', detail: 'Mapped response, 201', ms: 140, outcome: 'ok' },
    ],
  },
  {
    name: 'Nightly invoice export',
    origin: 'Scheduled job, every day at 02:00',
    target: 'SFTP',
    final: 'Completed',
    steps: [
      { label: 'Queried data source', detail: 'PostgreSQL, 1,284 rows', ms: 780, outcome: 'ok' },
      { label: 'Transformed records', detail: '1,284 rows into CSV', ms: 520, outcome: 'ok' },
      {
        label: 'Uploaded file',
        detail: 'sftp://exports/invoices.csv',
        mono: true,
        ms: 960,
        outcome: 'ok',
        result: '412 KB written',
      },
      { label: 'Recorded run', detail: 'Next run tomorrow at 02:00', ms: 180, outcome: 'ok' },
    ],
  },
  {
    name: 'USER_SIGNED_UP',
    origin: 'Outbound event from Auth service',
    target: 'Email',
    final: 'Skipped',
    steps: [
      { label: 'Received', detail: 'New account created', ms: 400, outcome: 'ok' },
      { label: 'Matched 1 integration', detail: 'Welcome email', ms: 480, outcome: 'ok' },
      {
        label: 'Rule checked',
        detail: 'Send only to verified addresses',
        ms: 560,
        outcome: 'skip',
        result: 'Email not verified, not sent',
      },
    ],
  },
];

interface RecentItem {
  id: number;
  name: string;
  target: string;
  final: Scenario['final'];
  at: number;
}

const HOLD_MS = 1600;
const EXIT_MS = 360;

const formatMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`);

const initialRecent = (now: number): RecentItem[] => [
  { id: -1, name: 'INVOICE_SENT', target: 'Email', final: 'Delivered', at: now - 14_000 },
  { id: -2, name: 'GET /inbound/orders', target: 'ERP', final: 'Completed', at: now - 41_000 },
  { id: -3, name: 'Hourly stock sync', target: 'Warehouse API', final: 'Completed', at: now - 52_000 },
];

const StepMark = ({ state }: { state: 'pending' | 'running' | Outcome }) => (
  <span className={`ht-mark ht-mark-${state}`} aria-hidden="true">
    {state === 'ok' && (
      <svg viewBox="0 0 12 12">
        <path d="M2.5 6.2l2.2 2.2 4.8-4.9" />
      </svg>
    )}
    {state === 'fail' && (
      <svg viewBox="0 0 12 12">
        <path d="M3.5 3.5l5 5M8.5 3.5l-5 5" />
      </svg>
    )}
    {state === 'skip' && (
      <svg viewBox="0 0 12 12">
        <path d="M3 6h6" />
      </svg>
    )}
  </span>
);

export default function HeroTrace() {
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const [scenarioIndex, setScenarioIndex] = useState(0);
  // Steps before `stepIndex` are finished; `stepIndex === steps.length` means the delivery is done.
  const [stepIndex, setStepIndex] = useState(reduceMotion ? SCENARIOS[0].steps.length : 0);
  const [exiting, setExiting] = useState(false);
  const [recent, setRecent] = useState<RecentItem[]>(() => initialRecent(Date.now()));

  const rootRef = useRef<HTMLDivElement>(null);
  const counterRef = useRef<HTMLSpanElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const detailRef = useRef<HTMLSpanElement>(null);
  const elapsedRef = useRef(0);
  const pausedRef = useRef({ hidden: false, offscreen: false, hovered: false });
  const recentRefs = useRef(new Map<number, HTMLLIElement>());
  const recentTops = useRef(new Map<number, number>());

  const scenario = SCENARIOS[scenarioIndex];
  const done = stepIndex >= scenario.steps.length;
  const totalMs = scenario.steps.reduce((sum, s) => sum + s.ms, 0);

  // Advance the trace on a clock that stops while the hero is hidden, off
  // screen, or being read (hovered).
  useEffect(() => {
    if (reduceMotion) return undefined;
    let raf = 0;
    let last = performance.now();
    const step = scenario.steps[stepIndex];
    elapsedRef.current = 0;

    const tick = (t: number) => {
      const dt = t - last;
      last = t;
      const p = pausedRef.current;
      if (!(p.hidden || p.offscreen || p.hovered)) {
        elapsedRef.current += dt;
      }
      const elapsed = elapsedRef.current;

      if (step) {
        if (counterRef.current) counterRef.current.textContent = formatMs(Math.min(elapsed, step.ms));
        if (barRef.current) barRef.current.style.transform = `scaleX(${Math.min(elapsed / step.ms, 1)})`;
        if (detailRef.current && typeof step.detail === 'function') {
          detailRef.current.textContent = step.detail(step.ms - elapsed);
        }
        if (elapsed >= step.ms) {
          setStepIndex((i) => i + 1);
          return;
        }
      } else if (!exiting && elapsed >= HOLD_MS) {
        setExiting(true);
        return;
      } else if (exiting && elapsed >= EXIT_MS) {
        setRecent((items) =>
          [
            { id: Date.now(), name: scenario.name, target: scenario.target, final: scenario.final, at: Date.now() },
            ...items,
          ].slice(0, 3)
        );
        setExiting(false);
        setStepIndex(0);
        setScenarioIndex((i) => (i + 1) % SCENARIOS.length);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scenarioIndex, stepIndex, exiting, reduceMotion, scenario]);

  // Pause when the tab is hidden or the hero is scrolled away.
  useEffect(() => {
    const onVisibility = () => {
      pausedRef.current.hidden = document.hidden;
    };
    document.addEventListener('visibilitychange', onVisibility);
    const observer = new IntersectionObserver(([entry]) => {
      pausedRef.current.offscreen = !entry.isIntersecting;
    });
    if (rootRef.current) observer.observe(rootRef.current);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
    };
  }, []);

  // Recent rows slide to their new place instead of jumping (FLIP).
  useLayoutEffect(() => {
    recentRefs.current.forEach((el, id) => {
      const top = el.getBoundingClientRect().top;
      const before = recentTops.current.get(id);
      if (before !== undefined && before !== top && !reduceMotion) {
        el.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }], {
          duration: 420,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        });
      }
      recentTops.current.set(id, top);
    });
  }, [recent, reduceMotion]);

  const status = done ? scenario.final : 'Processing';

  return (
    <div
      ref={rootRef}
      className="ht-root"
      onPointerEnter={() => {
        pausedRef.current.hovered = true;
      }}
      onPointerLeave={() => {
        pausedRef.current.hovered = false;
      }}
    >
      <p className="sr-only">
        Live traces from the gateway console: an outbound event retried until delivered, an inbound API call proxied to
        a CRM, a scheduled export, and a message skipped by a rule.
      </p>

      <div className="ht-panel" aria-hidden="true">
        <header className="ht-head">
          <div className="ht-event">
            <span className="ht-event-name">{scenario.name}</span>
            <span className="ht-event-source">{scenario.origin}</span>
          </div>
          <span className={`ht-status ht-status-${status.toLowerCase()}`}>{status}</span>
        </header>

        <ol className={`ht-steps${exiting ? ' is-exiting' : ''}`}>
          {scenario.steps.slice(0, Math.min(stepIndex + 1, scenario.steps.length)).map((step, i) => {
            const running = i === stepIndex;
            const state = running ? 'running' : step.outcome;
            const detail =
              typeof step.detail === 'function' ? (running ? step.detail(step.ms) : step.doneDetail) : step.detail;
            return (
              <li key={`${scenarioIndex}-${i}`} className={`ht-step ht-step-${state}`}>
                <StepMark state={state} />
                <div className="ht-step-body">
                  <span className="ht-step-label">{step.label}</span>
                  <span
                    ref={running ? detailRef : undefined}
                    className={`ht-step-detail${step.mono ? ' is-mono' : ''}`}
                  >
                    {detail}
                  </span>
                  {!running && step.result && (
                    <span className={`ht-step-result ht-result-${step.outcome}`}>{step.result}</span>
                  )}
                </div>
                <span ref={running ? counterRef : undefined} className="ht-step-ms">
                  {running ? '0 ms' : step.outcome === 'wait' ? '' : formatMs(step.ms)}
                </span>
                {running && <span ref={barRef} className="ht-step-bar" />}
              </li>
            );
          })}
        </ol>

        <footer className="ht-foot">
          <span>{done ? `${scenario.steps.length} steps` : `Step ${stepIndex + 1} of ${scenario.steps.length}`}</span>
          <span className="ht-foot-total">{done ? formatMs(totalMs) : ''}</span>
        </footer>
      </div>

      <div className="ht-recent" aria-hidden="true">
        <span className="ht-recent-title">Recent runs</span>
        <ul>
          {recent.map((item) => (
            <li
              key={item.id}
              ref={(el) => {
                if (el) recentRefs.current.set(item.id, el);
                else recentRefs.current.delete(item.id);
              }}
              className={item.id > 0 ? 'is-new' : undefined}
            >
              <span className={`ht-dot ht-dot-${item.final.toLowerCase()}`} />
              <span className="ht-recent-event">{item.name}</span>
              <span className="ht-recent-target">{item.target}</span>
              <span className="ht-recent-age">
                <SecondsAgo since={item.at} prefix="" />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
