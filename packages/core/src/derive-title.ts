/**
 * The one line someone sees on the board before they open anything.
 *
 * It is derived, never typed: asking a user filing a bug to also write a
 * headline is how you get "broken" as a title. But the first 60 raw characters
 * is not a headline either — it opens on punctuation and ends mid-word. Three
 * rules fix that: drop leading noise, stop at the first sentence, and cut on a
 * word boundary.
 */
import { FEEDBACK_TITLE_MAX } from './contract.js';

/**
 * Unicode-aware on purpose: `\w` would eat any non-Latin script alive and leave
 * a title starting mid-word. Anything that is not a letter or a digit in ANY
 * script is leading noise here.
 */
const LEADING_NOISE = /^[^\p{L}\p{N}]+/u;

/** Sentence end: the punctuation, then either a space or the end of the text. */
const SENTENCE_END = /[.!?…]+(\s|$)/u;

export function deriveTitle(description: string, fallbackLabel?: string): string {
  // Line breaks are consumed BEFORE the horizontal whitespace collapse, or the
  // first paragraph and the second would arrive here as one long sentence.
  const lines = description.split(/[\r\n]+/);
  const firstUseful =
    lines.find((line) => line.replace(/\s+/g, ' ').trim().replace(LEADING_NOISE, '')) ?? '';
  const cleaned = firstUseful.replace(/\s+/g, ' ').trim().replace(LEADING_NOISE, '');

  if (!cleaned) {
    return fallbackLabel ? `Bug report from ${fallbackLabel}` : 'Bug report with no description';
  }

  const split = SENTENCE_END.exec(cleaned);
  const sentence = (split ? cleaned.slice(0, split.index) : cleaned).trim() || cleaned;
  if (sentence.length <= FEEDBACK_TITLE_MAX) return sentence;

  // Cut on a word boundary so the ellipsis reads as "there is more", not as a
  // truncation bug. A single unbroken run longer than the cap has no boundary
  // to find, so it is chopped.
  const head = sentence.slice(0, FEEDBACK_TITLE_MAX - 1);
  const lastSpace = head.lastIndexOf(' ');
  const body = lastSpace > FEEDBACK_TITLE_MAX / 2 ? head.slice(0, lastSpace) : head;
  return `${body.trimEnd()}…`;
}
