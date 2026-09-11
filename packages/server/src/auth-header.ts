/**
 * `AUTH_MODE=header` — the standalone server's only way to learn who is calling.
 *
 * It trusts request headers, which is safe ONLY behind a proxy that
 * authenticates and rewrites them. Exposed directly to the internet, anyone can
 * claim to be anyone by typing a header, and every report becomes readable.
 * That is not a weakness to fix here: a host mounting `createFeedbackApp` in
 * its own app passes its own `resolveUser` and never sees this file.
 */
import type { FeedbackUser } from './store.js';

export const USER_ID_HEADER = 'x-user-id';
export const USER_EMAIL_HEADER = 'x-user-email';
export const USER_NAME_HEADER = 'x-user-name';

export const AUTH_HEADER_WARNING =
  `AUTH_MODE=header trusts the ${USER_ID_HEADER} header. Run this behind your own ` +
  'authenticating proxy — exposed directly, anyone can read anyone\'s reports.';

/** No id, no user: an empty header is a request nobody authenticated. */
export async function headerUser(request: Request): Promise<FeedbackUser | null> {
  const id = (request.headers.get(USER_ID_HEADER) ?? '').trim();
  if (!id) return null;
  const email = (request.headers.get(USER_EMAIL_HEADER) ?? '').trim();
  const name = (request.headers.get(USER_NAME_HEADER) ?? '').trim();
  return { id, ...(email ? { email } : {}), ...(name ? { name } : {}) };
}
