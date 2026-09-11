/**
 * Turn whatever was thrown into something a user can read and an agent can act
 * on.
 *
 * Written because production once showed a user the sentence "could not capture
 * the screen (undefined)". `(err as Error).message` had been a lie: what
 * `html-to-image` rejects with when an image fails to load is a raw DOM `Event`,
 * which has no `message` — and `String(event)` is only marginally better at
 * "[object Event]". An Event does carry the one fact worth printing, though:
 * which element gave up, so that is what comes out instead.
 */
import { defaultStrings, formatString, type WidgetStrings } from './strings.js';

const trimmed = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** Duck-typed: `instanceof Event` is false across iframes and absent in Node. */
function describeEventTarget(err: Record<string, unknown>): string | undefined {
  const target = err.target as { tagName?: unknown; src?: unknown; href?: unknown } | undefined;
  if (!target || typeof target.tagName !== 'string') return undefined;
  const url = trimmed(target.src) ?? trimmed(target.href);
  const what = target.tagName.toLowerCase();
  return url ? `${what} ${url.slice(0, 120)}` : what;
}

export function describeError(err: unknown, strings: WidgetStrings = defaultStrings): string {
  if (err instanceof Error) return trimmed(err.message) ?? err.name ?? strings.errorUnknown;

  const direct = trimmed(err);
  if (direct) return direct;

  if (typeof err === 'object' && err !== null) {
    const record = err as Record<string, unknown>;
    // A DOM Event (`type: 'error'`) before `message`: the target is the useful half.
    if (trimmed(record.type)) {
      const target = describeEventTarget(record);
      if (target) return formatString(strings.errorResourceFailed, { target });
    }
    const message = trimmed(record.message);
    if (message) return message;
    const type = trimmed(record.type);
    if (type) return formatString(strings.errorEvent, { type });
  }

  return strings.errorUnknown;
}
