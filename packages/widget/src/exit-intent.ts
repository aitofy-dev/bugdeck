/**
 * Three ways out of the dialog, and which of them keeps the words.
 *
 * The button row used to be [Cancel] [Send], and "Cancel" KEPT the draft.
 * One word saying two things: whoever wanted to keep their text was afraid to
 * press it, and whoever wanted it gone pressed it and found the draft again on
 * the next report. So it is split:
 *
 *   Hide     — put it away, KEEP everything. This is also what ✕ · Esc · a
 *              click on the backdrop mean: people press those when they go and
 *              look again at the very bug they were describing.
 *   Discard  — THROW IT AWAY. With text or images on screen, ask exactly once.
 *
 * This function is the only copy of that rule, and it is pure so it can be
 * tested: both ways of getting it wrong are SILENT — discarding by mistake
 * loses what was just typed with nothing said, keeping by mistake leaves a
 * ghost draft alive for a week that surfaces during an unrelated report.
 */

/** What the user did. */
export type ExitGesture =
  /** ✕ · Esc · a click on the backdrop — "get this off my screen". */
  | 'dismiss'
  /** The Hide button. */
  | 'hide'
  /** The Discard button. */
  | 'discard';

export type ExitAction =
  /** Close, leave the draft alone. */
  | 'hide'
  /** Delete the draft, then close. */
  | 'discard'
  /** Ask once before throwing it away. */
  | 'confirm';

export interface ExitContext {
  /**
   * Whether this dialog has a draft to keep.
   *
   * A NEW report does (`draftSlug`); EDITING an existing one does not — its
   * source of truth is the server, and "Hide" there is Discard under a friendly
   * name.
   */
  canHide: boolean;
  /** Text or images are present. Asking about an empty dialog is just noise. */
  hasContent: boolean;
}

export function exitIntent(gesture: ExitGesture, ctx: ExitContext): ExitAction {
  if (gesture === 'hide') return 'hide';

  // ✕ · Esc · backdrop = HIDE whenever there is somewhere to put the work. This
  // is the whole point: the most reflexive gesture must be the one that loses
  // nothing.
  if (gesture === 'dismiss' && ctx.canHide) return 'hide';

  return ctx.hasContent ? 'confirm' : 'discard';
}
