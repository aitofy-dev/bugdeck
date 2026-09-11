/**
 * The floating report button and what happens after Send.
 *
 * Everything about BUILDING a report — blocks, the image queue, capture, the
 * element picker, annotation — lives in `FeedbackEditor`, because a report page
 * reuses all of it for "Edit" and "Comment". What is left here is the part only
 * the launcher has: opening, filing a NEW report, and the confirmation with its
 * tracker reference.
 */
import { useCallback, useEffect, useState } from 'react';
import { collectContext, readBrowserEnv } from './context.js';
import { draftSlug, loadDraft } from './draft-store.js';
import { FeedbackEditor, type FeedbackEditorPayload } from './FeedbackEditor.js';
import { FeedbackSent } from './FeedbackModal.js';
import { formatString, mergeStrings, type WidgetStrings } from './strings.js';
import { WidgetStringsProvider } from './strings-context.js';
import * as s from './styles.js';
import { submitFeedback, type FeedbackSubmitResult } from './submit.js';
import type { ToPng } from './capture.js';

export interface FeedbackWidgetProps {
  /** Base of the bugdeck server surface, e.g. `/api` or `http://localhost:3131`. */
  apiBase: string;
  /** Auth headers for the write routes; awaited on every send so tokens stay fresh. */
  fetchAuthHeaders?: () => Record<string, string> | Promise<Record<string, string>>;
  /** Commit the running bundle was built from — the single most useful context field. */
  buildCommit?: string;
  /** Where "My reports" points in the host app. */
  myReportsHref?: string;
  /** What gets photographed. Defaults to `document.body`. */
  captureTarget?: () => HTMLElement | null;
  zIndex?: number;
  /** Launcher label. Prefer `strings` when translating the whole widget. */
  label?: string;
  /** Override any of the widget's words; the rest fall back to English. */
  strings?: Partial<WidgetStrings>;
  /** Test seam; production uses the lazily imported `html-to-image`. */
  toPng?: ToPng;
}

type Phase = 'closed' | 'open' | 'sent';

/** SSR/test safe — the widget is also imported by node test runs. */
const currentHref = (): string => (typeof location === 'undefined' ? '/' : location.href);

export function FeedbackWidget({
  apiBase,
  fetchAuthHeaders,
  buildCommit,
  myReportsHref = '/reports',
  captureTarget,
  zIndex = 2_147_483_000,
  label,
  strings: overrides,
  toPng,
}: FeedbackWidgetProps) {
  const strings = mergeStrings(overrides);
  const [phase, setPhase] = useState<Phase>('closed');
  const [result, setResult] = useState<FeedbackSubmitResult | null>(null);
  const [hasDraft, setHasDraft] = useState(false);

  /**
   * A draft nobody can see is a draft nobody comes back to, so the launcher
   * says so. Re-checked whenever the widget closes: that is exactly when a
   * draft is created (the user closed mid-sentence) or destroyed (they sent it).
   */
  useEffect(() => {
    if (phase !== 'closed') return;
    setHasDraft(Boolean(loadDraft(draftSlug(currentHref()))));
  }, [phase]);

  /**
   * Opening does NOT shoot anything: capturing on open surprises people and
   * costs a capture nobody asked for. The screenshot happens only when they
   * press the capture button.
   */
  const open = useCallback(() => setPhase('open'), []);

  const send = useCallback(
    async (payload: FeedbackEditorPayload) => {
      // Throwing is how the editor learns to show the message; it also keeps
      // the user's text on screen, which is the whole point of failing here.
      const submitted = await submitFeedback({
        apiBase,
        description: payload.description,
        blocks: payload.blocks,
        context: collectContext(readBrowserEnv(), { buildCommit }),
        images: payload.images,
        headers: (await fetchAuthHeaders?.()) ?? undefined,
      });
      setResult(submitted);
      setPhase('sent');
    },
    [apiBase, buildCommit, fetchAuthHeaders],
  );

  const launcherLabel = label ?? strings.launcherLabel;

  return (
    <WidgetStringsProvider strings={overrides}>
      {phase === 'closed' && (
        <button
          type="button"
          style={s.launcher(zIndex)}
          onClick={open}
          title={hasDraft ? strings.launcherDraftTitle : undefined}
        >
          {hasDraft
            ? formatString(strings.launcherLabelWithDraft, { label: launcherLabel })
            : launcherLabel}
        </button>
      )}

      {phase === 'open' && (
        <FeedbackEditor
          zIndex={zIndex}
          strings={overrides}
          captureTarget={captureTarget}
          toPng={toPng}
          // ONE DRAFT PER PAGE. Hit a different bug on a different screen and it
          // is a new report — a single global draft would merge two unrelated
          // bugs into one issue, and whoever reads it only reads the first one.
          draftSlug={draftSlug(currentHref())}
          draftUrl={currentHref()}
          onSubmit={send}
          onClose={() => setPhase('closed')}
        />
      )}

      {phase === 'sent' && result && (
        <FeedbackSent
          zIndex={zIndex}
          result={result}
          myReportsHref={myReportsHref}
          onClose={() => {
            setResult(null);
            setPhase('closed');
          }}
        />
      )}
    </WidgetStringsProvider>
  );
}
