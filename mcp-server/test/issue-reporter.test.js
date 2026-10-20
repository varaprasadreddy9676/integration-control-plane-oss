import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubIssueClient, IssueReporter } from '../src/issue-reporter.js';

function fakeGitHubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: url.toString(), options });
    for (const [matcher, respond] of routes) {
      if (matcher(url.toString(), options)) {
        return respond(url.toString(), options);
      }
    }
    throw new Error(`No fake route matched: ${options.method} ${url}`);
  };
  return { fetchImpl, calls };
}

test('GitHubIssueClient.configured is false without a token or repo', () => {
  assert.equal(new GitHubIssueClient({ token: undefined, repo: undefined }).configured, false);
  assert.equal(new GitHubIssueClient({ token: 't', repo: undefined }).configured, false);
  assert.equal(new GitHubIssueClient({ token: undefined, repo: 'o/r' }).configured, false);
  assert.equal(new GitHubIssueClient({ token: 't', repo: 'o/r' }).configured, true);
});

test('IssueReporter.file returns filed:false with a reason when not configured', async () => {
  const reporter = new IssueReporter({ githubClient: new GitHubIssueClient({ token: undefined, repo: undefined }) });

  const result = await reporter.file({ kind: 'bug', title: 'Something broke', body: 'details' });

  assert.equal(result.filed, false);
  assert.equal(result.duplicate, false);
  assert.match(result.reason, /not configured/);
});

test('IssueReporter.file creates a new issue when no duplicate is open', async () => {
  const { fetchImpl, calls } = fakeGitHubFetch([
    [
      (url, opts) => url.includes('/search/issues') && opts.method === 'GET',
      () => new Response(JSON.stringify({ items: [] }), { status: 200 }),
    ],
    [
      (url, opts) => url.endsWith('/repos/acme/widgets/issues') && opts.method === 'POST',
      (url, opts) => {
        const body = JSON.parse(opts.body);
        assert.equal(body.title, 'Something broke');
        assert.ok(body.body.includes('icp-mcp:dedupe:'));
        assert.deepEqual(body.labels, ['mcp-server', 'bug', 'severity:high']);
        return new Response(
          JSON.stringify({ number: 42, html_url: 'https://github.com/acme/widgets/issues/42' }),
          { status: 201 }
        );
      },
    ],
  ]);

  const client = new GitHubIssueClient({ token: 't', repo: 'acme/widgets', fetchImpl });
  const reporter = new IssueReporter({ githubClient: client });

  const result = await reporter.file({
    kind: 'bug',
    title: 'Something broke',
    body: 'It broke because X',
    labels: ['mcp-server', 'bug', 'severity:high'],
  });

  assert.equal(result.filed, true);
  assert.equal(result.duplicate, false);
  assert.equal(result.issueNumber, 42);
  assert.equal(result.issueUrl, 'https://github.com/acme/widgets/issues/42');
  assert.equal(calls.length, 2);
});

test('IssueReporter.file adds a comment instead of creating a duplicate when one is already open', async () => {
  const { fetchImpl, calls } = fakeGitHubFetch([
    [
      (url, opts) => url.includes('/search/issues') && opts.method === 'GET',
      () =>
        new Response(
          JSON.stringify({
            items: [{ number: 7, html_url: 'https://github.com/acme/widgets/issues/7' }],
          }),
          { status: 200 }
        ),
    ],
    [
      (url, opts) => url.endsWith('/repos/acme/widgets/issues/7/comments') && opts.method === 'POST',
      () => new Response(JSON.stringify({ id: 1 }), { status: 201 }),
    ],
  ]);

  const client = new GitHubIssueClient({ token: 't', repo: 'acme/widgets', fetchImpl });
  const reporter = new IssueReporter({ githubClient: client });

  const result = await reporter.file({ kind: 'bug', title: 'Same problem again', body: 'still happening' });

  assert.equal(result.filed, false);
  assert.equal(result.duplicate, true);
  assert.equal(result.issueNumber, 7);
  assert.equal(result.issueUrl, 'https://github.com/acme/widgets/issues/7');
  // Only the search + comment calls — no issue-create call should have happened.
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.includes('/issues/7/comments'));
});

test('two calls with the same dedupKey use the same marker regardless of title wording', async () => {
  const seenQueries = [];
  const { fetchImpl } = fakeGitHubFetch([
    [
      (url, opts) => url.includes('/search/issues') && opts.method === 'GET',
      (url) => {
        seenQueries.push(url);
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      },
    ],
    [
      (url, opts) => url.includes('/issues') && opts.method === 'POST',
      () => new Response(JSON.stringify({ number: 1, html_url: 'https://github.com/acme/widgets/issues/1' }), { status: 201 }),
    ],
  ]);

  const client = new GitHubIssueClient({ token: 't', repo: 'acme/widgets', fetchImpl });
  const reporter = new IssueReporter({ githubClient: client });

  await reporter.file({ kind: 'bug', title: 'First wording', body: 'x', dedupKey: 'stable-key' });
  await reporter.file({ kind: 'bug', title: 'Totally different wording', body: 'y', dedupKey: 'stable-key' });

  assert.equal(seenQueries.length, 2);
  assert.equal(seenQueries[0], seenQueries[1]);
});

test('GitHubIssueClient.request throws with status and payload on a non-2xx response', async () => {
  const client = new GitHubIssueClient({
    token: 't',
    repo: 'acme/widgets',
    fetchImpl: async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }),
  });

  await assert.rejects(
    () => client.createIssue({ title: 'x', body: 'y' }),
    (error) => {
      assert.equal(error.status, 401);
      assert.equal(error.message, 'Bad credentials');
      return true;
    }
  );
});
