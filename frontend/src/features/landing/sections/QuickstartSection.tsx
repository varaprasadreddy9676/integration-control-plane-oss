import { useState } from 'react';
import { GITHUB_URL } from '../landing-config';
import { copyTextToClipboard } from '../../../utils/clipboard';

const repoName = GITHUB_URL.replace(/\/+$/, '').split('/').pop() || 'integration-control-plane';

// Mirrors "Run With Docker" in the README.
const STEPS = [
  { title: 'Clone the repository', code: `git clone ${GITHUB_URL}.git\ncd ${repoName}` },
  { title: 'Generate secrets', code: './scripts/init-env.sh' },
  { title: 'Start the stack', code: 'docker compose up -d --build' },
  {
    title: 'Create your first admin',
    code: "docker compose exec backend node scripts/create-user.js \\\n  --email you@example.com \\\n  --password 'ChangeMe123!' \\\n  --role SUPER_ADMIN",
  },
  { title: 'Open the console', code: 'http://localhost/integration-gateway/' },
];

const CodeBlock = ({ code }: { code: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <pre className="qs-code">
      {code}
      <button
        type="button"
        className="qs-copy"
        onClick={async () => {
          if (await copyTextToClipboard(code)) {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
          }
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </pre>
  );
};

export default function QuickstartSection() {
  return (
    <section id="quickstart" className="pl-section">
      <div className="pl-wrap qs">
        <div className="pl-head" style={{ marginBottom: 0 }}>
          <h2>Running on your machine in five minutes.</h2>
          <p className="pl-lead">
            Docker Compose brings up MongoDB, the backend and the console together. No account, no license key, no phone
            call.
          </p>
          <p className="qs-needs">
            You need Docker with Compose. Running without Docker needs Node.js 24 or later and MongoDB 7.0 or later;
            MySQL and Kafka only if you use them as event sources.
          </p>
        </div>
        <ol className="qs-steps">
          {STEPS.map((s) => (
            <li key={s.title} className="qs-step">
              <div style={{ minWidth: 0 }}>
                <h3>{s.title}</h3>
                <CodeBlock code={s.code} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
