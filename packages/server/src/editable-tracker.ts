/**
 * The tracker seam plus the one verb `IssueTracker` does not carry yet.
 *
 * Rewriting an issue is OPTIONAL by nature: only a report nobody has read is
 * editable, so a tracker with no update API is not broken — it simply leaves
 * the issue holding the text the report was filed with. Making it required
 * would force every future adapter to stub a method it has no answer for.
 *
 * It lives here rather than in core because core's `IssueTracker` is published
 * and this release does not change it. A host whose tracker can edit wraps its
 * adapter once, the way `serve` wraps the Plane one.
 */
import type { CreateIssueJob, IssueTracker, Result } from '@aitofy/bugdeck-core';

/**
 * What an edit sends: the same three fields a create does, minus the identity —
 * the issue already exists, and `externalId` addresses it.
 */
export type IssueUpdateInput = Pick<CreateIssueJob, 'title' | 'descriptionHtml' | 'images'>;

export interface EditableTracker extends IssueTracker {
  /** Absent on trackers that cannot rewrite an issue; the edit stays local. */
  updateIssue?(externalId: string, input: IssueUpdateInput): Promise<Result<void>>;
}
