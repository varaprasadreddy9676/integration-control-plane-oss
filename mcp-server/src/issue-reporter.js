import crypto from 'node:crypto';

const GITHUB_API_BASE = 'https://api.github.com';

/**
 * Thin GitHub Issues client. Every method throws if fetch fails or the API
 * returns non-2xx — callers (IssueReporter) check `.configured` up front so
 * "no token set" is a clean early return, not a thrown error.
 */
export class GitHubIssueClient {
  constructor({
    token = process.env.GITHUB_TOKEN,
    repo = process.env.GITHUB_REPO,
    fetchImpl = globalThis.fetch,
    timeoutMs = Number(process.env.GITHUB_REQUEST_TIMEOUT_MS) || 15_000,
  } = {}) {
    this.token = token;
    this.repo = repo;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  /** True once both a token and an "owner/repo" target are set. */
  get configured() {
    return Boolean(this.token && this.repo);
  }

  async request(method, path, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response;
    try {
      response = await this.fetch(`${GITHUB_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        const timeoutError = new Error(`GitHub API request to ${path} timed out after ${this.timeoutMs}ms`);
        timeoutError.status = 'TIMEOUT';
        throw timeoutError;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      const parseError = new Error(
        `GitHub API returned non-JSON response (HTTP ${response.status}): ${text.slice(0, 200)}`
      );
      parseError.status = response.status;
      throw parseError;
    }

    if (!response.ok) {
      const message = payload?.message || `GitHub API returned HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  /** Finds an open issue whose body contains the given dedup marker, if any. */
  async findOpenIssueByMarker(marker) {
    const q = `repo:${this.repo} is:issue is:open in:body "${marker}"`;
    const result = await this.request('GET', `/search/issues?q=${encodeURIComponent(q)}`);
    return result?.items?.[0] ?? null;
  }

  createIssue({ title, body, labels = [] }) {
    return this.request('POST', `/repos/${this.repo}/issues`, { title, body, labels });
  }

  addComment(issueNumber, body) {
    return this.request('POST', `/repos/${this.repo}/issues/${issueNumber}/comments`, { body });
  }
}

/** Short, stable marker embedded in issue bodies so recurrences of the same
 * underlying problem attach a comment instead of creating a duplicate issue. */
function dedupMarker(kind, key) {
  const hash = crypto.createHash('sha256').update(`${kind}:${key}`).digest('hex').slice(0, 12);
  return `<!-- icp-mcp:dedupe:${hash} -->`;
}

/**
 * Files GitHub issues for bug reports and feature requests raised while using
 * the MCP tools, deduplicating against anything already open for the same
 * underlying problem.
 */
export class IssueReporter {
  constructor({ githubClient = new GitHubIssueClient() } = {}) {
    this.githubClient = githubClient;
  }

  get configured() {
    return this.githubClient.configured;
  }

  /**
   * @param {'bug'|'feature'} kind
   * @param {string} title
   * @param {string} body
   * @param {string[]} [labels]
   * @param {string} [dedupKey] Stable identifier for the underlying problem;
   *   defaults to `title`. Two calls with the same kind+dedupKey never create
   *   two open issues — the second attaches a "recurred again" comment.
   */
  async file({ kind, title, body, labels = [], dedupKey }) {
    if (!this.configured) {
      return {
        filed: false,
        duplicate: false,
        reason:
          'GitHub issue reporting is not configured — set GITHUB_TOKEN and GITHUB_REPO ("owner/repo") in the MCP server environment.',
      };
    }

    const marker = dedupMarker(kind, dedupKey || title);
    const fullBody = `${body}\n\n${marker}`;

    const existing = await this.githubClient.findOpenIssueByMarker(marker);
    if (existing) {
      await this.githubClient.addComment(existing.number, `Recurred again at ${new Date().toISOString()} (via icp-mcp).`);
      return { filed: false, duplicate: true, issueUrl: existing.html_url, issueNumber: existing.number };
    }

    const issue = await this.githubClient.createIssue({ title, body: fullBody, labels });
    return { filed: true, duplicate: false, issueUrl: issue.html_url, issueNumber: issue.number };
  }
}

export function createIssueReporterFromEnv() {
  return new IssueReporter();
}
