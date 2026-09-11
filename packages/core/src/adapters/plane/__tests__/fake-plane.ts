/**
 * A Plane that answers from a routing table instead of a network.
 *
 * Endpoint shapes are the ones measured against a real Plane: create answers
 * 201 with `sequence_id`, a duplicate `external_id` answers 409 carrying the
 * existing `id`, the attachment list answers a BARE array, and both attachment
 * PATCHes answer 204 with no body at all.
 */
import type { PlaneConfig } from '../client.js';

export const CONFIG: PlaneConfig = {
  baseUrl: 'https://plane.example.com/',
  apiKey: 'plane_api_test',
  workspaceSlug: 'demo',
  projectId: 'proj-1',
  publicUrl: 'https://app.example',
};

export interface Call {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}

export type Route = () => [number, unknown] | Promise<[number, unknown]>;

/**
 * Routes by `"METHOD path-suffix"`, matched on the path with the query string
 * removed — `?per_page=100` is on every list URL, and `endsWith` on the raw URL
 * would never match.
 */
export function fakePlane(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const impl = async (input: unknown, init?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
    const url = String(input);
    const method = init?.method || 'GET';
    let body: unknown = init?.body;
    // Only JSON bodies parse — the storage upload step sends FormData.
    if (typeof init?.body === 'string') body = JSON.parse(init.body);
    calls.push({ url, method, body, headers: init?.headers ?? {} });

    const path = url.split('?')[0];
    const key = Object.keys(routes).find((candidate) => {
      const [routeMethod, suffix] = candidate.split(' ');
      // endsWith, not includes: ".../issues/i1/issue-attachments/" contains
      // "/issues/" too, and a substring match would post the attachment to the
      // create route.
      return routeMethod === method && path.endsWith(suffix);
    });
    if (!key) throw new Error(`unrouted ${method} ${url}`);

    const [status, payload] = await routes[key]();
    // 204 must carry no body — `new Response('{}', {status: 204})` throws.
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

/** Read, never hardcoded: pointing at another project must change the prefix. */
export const OK_PROJECT: Route = () => [200, { identifier: 'DEMO' }];

export const OK_STATES: Route = () => [
  200,
  {
    results: [
      { id: 's-todo', name: 'Todo', group: 'unstarted' },
      { id: 's-doing', name: 'Doing', group: 'started' },
      { id: 's-done', name: 'Done', group: 'completed' },
      { id: 's-fail', name: 'Cancelled', group: 'cancelled' },
    ],
    next_page_results: false,
  },
];

export const png = (bytes: number[]) => ({
  name: `feedback-a${bytes[0]}.png`,
  mime: 'image/png',
  bytes: new Uint8Array(bytes),
});
