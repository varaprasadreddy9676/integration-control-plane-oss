import { z } from 'zod';

const QUICKSTART_RESOURCE = `# Integration Gateway MCP quickstart

Use the read-only \`gateway_health\` tool first. Confirm the returned \`_env\` value before any mutation.

For an incident, use \`diagnose_org\` -> \`list_integrations\` -> \`get_integration_status\` -> \`search_delivery_logs\` -> \`get_execution_trace\`.

For configuration, discover first, validate transformations, then mutate. Live test tools make real calls and must be treated as production-affecting operations.

All mutation tools require an operational reason where the backend supports audit reasons. Never place credential values in prompts, issue reports, or free-text descriptions.
`;

const SAFETY_RESOURCE = `# Integration Gateway MCP safety

- Every result includes \`_env\` and \`_baseUrl\`.
- Read-only GET requests may retry transient failures; mutations are never retried automatically.
- Credential values are write-only and redacted from errors.
- \`test_outbound_integration\`, \`test_inbound_integration\`, and scheduled execution can cause real side effects.
- Verify organization, integration/job ID, environment, and reason before mutations.
`;

function promptMessage(text) {
  return { role: 'user', content: { type: 'text', text } };
}

export function registerContext(server) {
  server.registerResource(
    'quickstart',
    'icp://docs/quickstart',
    { title: 'Integration Gateway MCP quickstart', description: 'Safe discovery and operating sequence', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: QUICKSTART_RESOURCE }] })
  );

  server.registerResource(
    'safety',
    'icp://docs/safety',
    { title: 'Integration Gateway MCP safety', description: 'Mutation and credential safety rules', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: SAFETY_RESOURCE }] })
  );

  server.registerPrompt(
    'incident_triage',
    {
      title: 'Incident triage',
      description: 'Build a read-only delivery incident investigation for an organization',
      argsSchema: {
        orgId: z.string().describe('Organization ID'),
        hours: z.string().optional().describe('Lookback window in hours'),
      },
    },
    ({ orgId, hours = '24' }) => ({
      description: `Investigate delivery health for organization ${orgId}`,
      messages: [
        promptMessage(
          `Use gateway_health first, then diagnose_org for orgId ${orgId} over ${hours} hours. If failures exist, list integrations, inspect their status, search FAILED delivery logs, and fetch one execution trace. Do not mutate anything unless I explicitly ask.`
        ),
      ],
    })
  );

  server.registerPrompt(
    'integration_change_review',
    {
      title: 'Integration change review',
      description: 'Review an integration before a live configuration change',
      argsSchema: {
        orgId: z.string().describe('Organization ID'),
        integrationId: z.string().describe('Integration ID'),
      },
    },
    ({ orgId, integrationId }) => ({
      description: `Review integration ${integrationId} in organization ${orgId}`,
      messages: [
        promptMessage(
          `Review integration ${integrationId} in org ${orgId}: read its current configuration, identify the exact proposed change, check recent failures and circuit state, and explain the risk. Do not call a live test or mutation until the environment and change are confirmed.`
        ),
      ],
    })
  );
}
