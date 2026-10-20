import { GITHUB_URL } from '../landing-config';

const ROWS: Array<[string, string, string, string, string]> = [
  [
    'Outbound, inbound and scheduled',
    'All three',
    'Outbound and ingest',
    'Outbound and inbound',
    'Outbound and inbound',
  ],
  ['Self-hosted', 'Yes, AGPL v3', 'Yes, MIT with reduced features', 'Yes, Elastic License', 'Outpost only'],
  ['Multi-tenant access control', '7 roles, scoped per organization', 'Basic', 'Basic', 'Basic'],
  ['Visual field mapping', 'Yes', 'No', 'No', 'No'],
  ['Dead-letter auto-retry', 'Yes', 'Manual', 'Manual', 'Manual'],
];

export default function CompareSection() {
  return (
    <section id="compare" className="pl-section">
      <div className="pl-wrap">
        <div className="pl-head">
          <h2>How it compares.</h2>
          <p className="pl-lead">
            Webhook services handle one direction, API gateways another. This sits in the middle and covers both, plus
            scheduling.
          </p>
        </div>
        <div className="cmp-scroll">
          <table className="cmp">
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Capability</span>
                </th>
                <th scope="col" className="is-us">
                  Integration Gateway
                </th>
                <th scope="col">Svix</th>
                <th scope="col">Convoy</th>
                <th scope="col">Hookdeck</th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map(([label, us, ...others]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td className="is-us">{us}</td>
                  {others.map((v, i) => (
                    <td key={i}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="cmp-foot">
          Based on each project’s public documentation.{' '}
          <a
            className="pl-link"
            href={`${GITHUB_URL}/blob/main/docs/comparison.md`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Read the full comparison
          </a>
        </p>
      </div>
    </section>
  );
}
