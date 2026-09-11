/**
 * A GitHub that answers from a routing table instead of a network.
 *
 * Shapes are the ones the REST API actually returns: create answers 201 with
 * `number`, search answers `{ items: [...] }`, lists page through a `Link`
 * header, and a rate limit is a 403 whose headers say when to come back.
 */
import type { GithubConfig } from '../client.js';
import type { IssueBodyInput } from '../../../tracker.js';

export const CONFIG: GithubConfig = {
  owner: 'acme',
  repo: 'app',
  token: 'ghp_test',
  publicUrl: 'https://app.example',
  labels: ['bugdeck'],
};

export interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

export type Route = () => [number, unknown, Record<string, string>?];

/**
 * Routes by `"METHOD path-suffix"`, matched on the path with the query string
 * removed — `?per_page=100` is on every list URL and `endsWith` on the raw URL
 * would never match.
 */
export function fakeGithub(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const impl = async (
    input: unknown,
    init?: { method?: string; body?: unknown; headers?: Record<string, string> },
  ) => {
    const url = String(input);
    const method = init?.method || 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({ url, method, body, headers: init?.headers ?? {} });

    const path = url.split('?')[0];
    const key = Object.keys(routes)
      .filter((candidate) => {
        const [routeMethod, suffix] = candidate.split(' ');
        // endsWith, not includes: "/issues/7/comments" contains "/issues" too,
        // and a substring match would post the comment to the create route.
        return routeMethod === method && path.endsWith(suffix);
      })
      // Longest suffix wins: "/search/issues" also ends with "/issues".
      .sort((a, b) => b.length - a.length)[0];
    if (!key) throw new Error(`unrouted ${method} ${url}`);

    const [status, payload, headers] = routes[key]();
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    });
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

/** No issue in the repo carries our marker yet. */
export const NO_SEARCH_HIT: Route = () => [200, { items: [] }];
export const NO_RECENT_ISSUES: Route = () => [200, []];

export const linkNext = (url: string): Record<string, string> => ({
  link: `<${url}>; rel="next", <${url}>; rel="last"`,
});

export function bodyInput(over: Partial<IssueBodyInput> = {}): IssueBodyInput {
  return {
    reportId: 'report-1',
    description: 'The Send button does nothing',
    userEmail: 'ada@example.com',
    teamName: null,
    url: 'https://app.example/checkout',
    viewport: { width: 1440, height: 900, dpr: 2 },
    userAgent: 'Mozilla/5.0',
    buildCommit: null,
    lastApiError: null,
    assetIds: [],
    blocks: null,
    ...over,
  };
}
