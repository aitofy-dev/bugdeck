/**
 * The environment, parsed ONCE into a typed object at the boundary.
 *
 * Everything downstream takes the typed config, never `process.env`: a reach
 * into the environment from a route is how a deployment discovers a missing
 * variable on the first report rather than at startup.
 *
 * A bad environment is a VALUE, not a throw. The caller prints the message and
 * exits 1, which is the only sensible thing a server can do about it — and a
 * message that lists every missing name at once beats four restarts.
 */
import { FEEDBACK_STATES, type FeedbackState, type PlaneConfig } from '@aitofy/bugdeck-core';

/**
 * How the server learns who is calling.
 *
 * `header` trusts `X-User-Id` / `X-User-Email`, which is only safe BEHIND the
 * host's own authenticating proxy: exposed directly, anyone can claim to be
 * anyone. It is the default because every host already has auth and none of
 * them want ours.
 */
export const AUTH_MODES = ['header'] as const;
export type AuthMode = (typeof AUTH_MODES)[number];

export interface ServerConfig {
  port: number;
  /** Where `reports.db` and `assets/` live. */
  storagePath: string;
  /** This server's own base URL, as the outside world reaches it. */
  publicUrl: string;
  /** `null` = no CORS headers; the widget is served from this same origin. */
  corsOrigin: string | null;
  authMode: AuthMode;
  plane: PlaneConfig;
}

export type ConfigResult = { ok: true; value: ServerConfig } | { ok: false; message: string };

export type Environment = Record<string, string | undefined>;

const trimmed = (env: Environment, name: string): string => (env[name] ?? '').trim();

const list = (raw: string): string[] =>
  raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const REQUIRED_PLANE = [
  'PLANE_BASE_URL',
  'PLANE_API_KEY',
  'PLANE_WORKSPACE_SLUG',
  'PLANE_PROJECT_ID',
] as const;

type StateMapResult =
  | { ok: true; value: Partial<Record<FeedbackState, string>> }
  | { ok: false; message: string };

/** `{"pending":"<state id>"}` — the operator saying their board is not conventional. */
function parseStateMap(raw: string): StateMapResult {
  if (!raw) return { ok: true, value: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: 'PLANE_STATE_MAP is not valid JSON. Expected {"done":"<state id>"}.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, message: 'PLANE_STATE_MAP must be a JSON object of state → Plane state id.' };
  }

  const value: Partial<Record<FeedbackState, string>> = {};
  for (const [key, id] of Object.entries(parsed as Record<string, unknown>)) {
    if (!(FEEDBACK_STATES as readonly string[]).includes(key)) {
      return {
        ok: false,
        message: `PLANE_STATE_MAP has an unknown state "${key}". Use one of: ${FEEDBACK_STATES.join(', ')}.`,
      };
    }
    if (typeof id !== 'string' || !id.trim()) {
      return { ok: false, message: `PLANE_STATE_MAP."${key}" must be a Plane state id.` };
    }
    value[key as FeedbackState] = id.trim();
  }
  return { ok: true, value };
}

function parsePort(raw: string): number | null {
  if (!raw) return 3131;
  const port = Number(raw);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

/**
 * Everything that makes an environment unusable, as the first message worth
 * printing. Separate from the assembly below so "is this valid" and "what does
 * it mean" are not the same 50 lines.
 */
function firstProblem(env: Environment): string | null {
  const tracker = trimmed(env, 'TRACKER') || 'plane';
  if (tracker !== 'plane') {
    return `TRACKER=${tracker} is not supported. This release ships one adapter: TRACKER=plane.`;
  }

  const authMode = trimmed(env, 'AUTH_MODE') || 'header';
  if (!(AUTH_MODES as readonly string[]).includes(authMode)) {
    return `AUTH_MODE=${authMode} is not supported. Use one of: ${AUTH_MODES.join(', ')}.`;
  }

  const missing = REQUIRED_PLANE.filter((name) => !trimmed(env, name));
  if (missing.length) {
    return `Missing required environment variables: ${missing.join(', ')}. Copy .env.example and fill them in.`;
  }
  return null;
}

function planeConfig(
  env: Environment,
  publicUrl: string,
  stateMap: Partial<Record<FeedbackState, string>>,
): PlaneConfig {
  const legacyProjectIds = list(trimmed(env, 'PLANE_LEGACY_PROJECT_IDS'));
  return {
    baseUrl: trimmed(env, 'PLANE_BASE_URL').replace(/\/+$/, ''),
    apiKey: trimmed(env, 'PLANE_API_KEY'),
    workspaceSlug: trimmed(env, 'PLANE_WORKSPACE_SLUG'),
    projectId: trimmed(env, 'PLANE_PROJECT_ID'),
    ...(legacyProjectIds.length ? { legacyProjectIds } : {}),
    ...(publicUrl ? { publicUrl } : {}),
    ...(Object.keys(stateMap).length ? { stateMap } : {}),
  };
}

export function readServerConfig(env: Environment): ConfigResult {
  const problem = firstProblem(env);
  if (problem) return { ok: false, message: problem };

  const port = parsePort(trimmed(env, 'PORT'));
  if (port === null) {
    return { ok: false, message: `PORT=${trimmed(env, 'PORT')} is not a port number between 1 and 65535.` };
  }

  const stateMap = parseStateMap(trimmed(env, 'PLANE_STATE_MAP'));
  if (!stateMap.ok) return stateMap;

  const publicUrl = trimmed(env, 'PUBLIC_URL').replace(/\/+$/, '');
  return {
    ok: true,
    value: {
      port,
      storagePath: trimmed(env, 'STORAGE_PATH') || './storage',
      publicUrl,
      corsOrigin: trimmed(env, 'CORS_ORIGIN') || null,
      authMode: (trimmed(env, 'AUTH_MODE') || 'header') as AuthMode,
      plane: planeConfig(env, publicUrl, stateMap.value),
    },
  };
}
