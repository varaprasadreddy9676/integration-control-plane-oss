import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

type Line = { kind: 'you' | 'agent'; text: string } | { kind: 'call'; name: string; args: string; result: string };

// Tool names are the gateway MCP server's real tools.
const LINES: Line[] = [
  { kind: 'you', text: 'Orders stopped reaching the ERP this morning. What happened?' },
  {
    kind: 'call',
    name: 'search_delivery_logs',
    args: 'status: FAILED, since: 09:00',
    result: '38 failures, all from ERP order sync',
  },
  {
    kind: 'call',
    name: 'get_execution_trace',
    args: 'one of the failed runs',
    result: 'Sent to ERP: 503 Service Unavailable, retries exhausted',
  },
  {
    kind: 'agent',
    text: 'The ERP returned 503 for 38 orders between 09:12 and 09:40. It has answered normally since 09:41. Shall I replay them?',
  },
  { kind: 'you', text: 'Yes, replay them.' },
  { kind: 'call', name: 'replay_delivery', args: '38 deliveries', result: '38 delivered, 0 failed' },
];

const STEP_MS = 900;

export default function McpSection() {
  const logRef = useRef<HTMLDivElement>(null);
  const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const [shown, setShown] = useState(reduceMotion ? LINES.length : 0);

  // Plays once, the first time the conversation scrolls into view.
  useEffect(() => {
    if (reduceMotion || !logRef.current) return undefined;
    let timer = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        let n = 0;
        const next = () => {
          n += 1;
          setShown(n);
          if (n < LINES.length) timer = window.setTimeout(next, STEP_MS);
        };
        timer = window.setTimeout(next, 300);
      },
      { threshold: 0.35 }
    );
    observer.observe(logRef.current);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [reduceMotion]);

  return (
    <section id="mcp" className="pl-section">
      <div className="pl-wrap split">
        <div>
          <div className="pl-head">
            <h2>Operate it from your AI agent.</h2>
            <p className="pl-lead">
              The built-in MCP server lets an agent in Claude, Cursor or any MCP client inspect logs, read traces, fix
              configuration and replay failures, all through the same API the console uses.
            </p>
          </div>
          <ul className="split-points">
            <li>
              <strong>Same permissions as a person.</strong> The agent signs in with an API key and gets that role’s
              access, nothing more.
            </li>
            <li>
              <strong>Every action audited.</strong> Changes made by an agent show up in the audit trail like anyone
              else’s.
            </li>
            <li>
              <strong>No model inside the gateway.</strong> Bring your own client; the gateway only exposes tools.
            </li>
          </ul>
          <Link to="/docs/mcp-server" className="pl-link">
            Set up the MCP server
          </Link>
        </div>

        <div ref={logRef} className="mcp-log" aria-label="Example conversation with an AI agent using the MCP server">
          {LINES.slice(0, shown).map((line, i) =>
            line.kind === 'call' ? (
              <div key={i} className="mcp-call">
                <span className="mcp-call-name">{line.name}</span> <span className="mcp-call-args">({line.args})</span>
                <span className="mcp-call-result">{line.result}</span>
              </div>
            ) : (
              <div key={i} className="mcp-turn">
                <span className="mcp-who">{line.kind === 'you' ? 'You' : 'Agent'}</span>
                <p className="mcp-text">{line.text}</p>
              </div>
            )
          )}
        </div>
      </div>
    </section>
  );
}
