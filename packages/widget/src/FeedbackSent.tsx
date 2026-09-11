/** The screen after Send: the tracker reference, and where to follow it. */
import { Icon } from './icons.js';
import { ModalShell } from './ModalShell.js';
import { formatString } from './strings.js';
import { useWidgetStrings } from './strings-context.js';
import type { FeedbackSubmitResult } from './submit.js';
import type { WidgetTheme } from './theme.js';

/** The code can arrive later than the report — the bridge to the tracker is async. */
export function sentHeadline(
  result: FeedbackSubmitResult,
  headingTemplate: string,
  pending: string,
): string {
  return formatString(headingTemplate, { code: result.code ?? pending });
}

export interface FeedbackSentProps {
  zIndex: number;
  theme: WidgetTheme;
  accent?: string;
  result: FeedbackSubmitResult;
  myReportsHref: string;
  onClose: () => void;
}

export function FeedbackSent({
  zIndex,
  theme,
  accent,
  result,
  myReportsHref,
  onClose,
}: FeedbackSentProps) {
  const strings = useWidgetStrings();
  const headline = sentHeadline(result, strings.sentHeading, strings.codePending);
  return (
    <ModalShell
      zIndex={zIndex}
      theme={theme}
      accent={accent}
      heading={headline}
      onDismiss={onClose}
      dismissLabel={strings.close}
      footer={
        <div className="bd-foot">
          <div className="bd-foot-start">
            <a className="bd-link" href={myReportsHref}>
              {strings.myReports}
            </a>
          </div>
          <button type="button" className="bd-btn bd-btn--primary" onClick={onClose}>
            {strings.close}
          </button>
        </div>
      }
    >
      <div className="bd-sent">
        <span className="bd-sent-mark">
          <Icon name="check" size={20} />
        </span>
        <p className="bd-sent-code">{headline}</p>
        <p className="bd-sent-body">{strings.sentBody}</p>
      </div>
    </ModalShell>
  );
}
