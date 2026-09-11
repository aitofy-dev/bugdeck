/**
 * One report as SQLite holds it, and the two functions that convert.
 *
 * Columns for what is queried or shown in a `sqlite3` session, JSON for what is
 * genuinely nested. Splitting `context` or `blocks` into tables would buy a
 * join and nothing else — nothing ever queries inside them.
 *
 * Pure and separate from the store so the mapping can be tested without opening
 * a database, and so the store file stays about storage.
 */
import type { FeedbackBlock, FeedbackContext, FeedbackState } from '@aitofy/bugdeck-core';
import type { FeedbackAppend } from '@aitofy/bugdeck-core';
import type { StoredReport, StoredThreadEntry } from './store.js';

export interface ReportRow {
  id: string;
  owner_id: string;
  owner_email: string | null;
  code: string | null;
  external_id: string | null;
  title: string;
  description: string;
  state: string;
  context: string;
  asset_ids: string;
  blocks: string | null;
  thread: string | null;
  appends: string | null;
  public_reply: string | null;
  public_reply_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A column we wrote ourselves, so a parse failure is a bug, not user input. */
function readJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function reportToRow(report: StoredReport): ReportRow {
  return {
    id: report.id,
    owner_id: report.ownerId,
    owner_email: report.ownerEmail ?? null,
    code: report.code ?? null,
    external_id: report.externalId ?? null,
    title: report.title,
    description: report.description,
    state: report.state,
    context: JSON.stringify(report.context),
    asset_ids: JSON.stringify(report.assetIds),
    blocks: report.blocks?.length ? JSON.stringify(report.blocks) : null,
    thread: report.thread?.length ? JSON.stringify(report.thread) : null,
    appends: report.appends?.length ? JSON.stringify(report.appends) : null,
    public_reply: report.publicReply ?? null,
    public_reply_at: report.publicReplyAt ?? null,
    created_at: report.createdAt,
    updated_at: report.updatedAt,
  };
}

const EMPTY_CONTEXT: FeedbackContext = {
  url: '',
  viewport: { width: 0, height: 0 },
  userAgent: '',
};

export function rowToReport(row: ReportRow): StoredReport {
  const blocks = readJson<FeedbackBlock[]>(row.blocks, []);
  const thread = readJson<StoredThreadEntry[]>(row.thread, []);
  const appends = readJson<FeedbackAppend[]>(row.appends, []);
  return {
    id: row.id,
    ownerId: row.owner_id,
    ...(row.owner_email ? { ownerEmail: row.owner_email } : {}),
    ...(row.code ? { code: row.code } : {}),
    ...(row.external_id ? { externalId: row.external_id } : {}),
    title: row.title,
    description: row.description,
    state: row.state as FeedbackState,
    context: readJson<FeedbackContext>(row.context, EMPTY_CONTEXT),
    assetIds: readJson<string[]>(row.asset_ids, []),
    ...(blocks.length ? { blocks } : {}),
    ...(thread.length ? { thread } : {}),
    ...(appends.length ? { appends } : {}),
    ...(row.public_reply ? { publicReply: row.public_reply } : {}),
    ...(row.public_reply_at ? { publicReplyAt: row.public_reply_at } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
