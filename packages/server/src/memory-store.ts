/**
 * A `FeedbackStore` that keeps everything in two Maps.
 *
 * Ships rather than lives in the tests: it is the fastest way for a host to try
 * the API before deciding where reports should really live, and it is what the
 * route tests run against so a route failure is never a database failure.
 */
import {
  appendThreadEntries,
  applyReportUpdate,
  markThreadEntryMirrored,
  newReportRecord,
} from './report-record.js';
import type {
  FeedbackStore,
  NewAsset,
  NewReport,
  ReportUpdate,
  StoredAsset,
  StoredReport,
  StoredThreadEntry,
} from './store.js';

/** Everything is cloned on the way out: a caller holding a live row can edit it. */
const clone = <T>(value: T): T => structuredClone(value);

export function createMemoryStore(): FeedbackStore {
  const reports = new Map<string, StoredReport>();
  const assets = new Map<string, StoredAsset>();

  return {
    async createReport(input: NewReport): Promise<StoredReport> {
      const record = newReportRecord(input, new Date().toISOString());
      reports.set(record.id, record);
      return clone(record);
    },

    async getReport(id: string): Promise<StoredReport | null> {
      const found = reports.get(id);
      return found ? clone(found) : null;
    },

    async listReportsByUser(ownerId: string, limit: number): Promise<StoredReport[]> {
      return [...reports.values()]
        .filter((report) => report.ownerId === ownerId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map(clone);
    },

    async updateReport(id: string, update: ReportUpdate): Promise<void> {
      const found = reports.get(id);
      if (found) reports.set(id, applyReportUpdate(found, update, new Date().toISOString()));
    },

    async appendThread(id: string, entries: readonly StoredThreadEntry[]): Promise<void> {
      const found = reports.get(id);
      if (found) reports.set(id, appendThreadEntries(found, entries, new Date().toISOString()));
    },

    async markThreadMirrored(id: string, index: number, commentId: string): Promise<void> {
      const found = reports.get(id);
      if (found) reports.set(id, markThreadEntryMirrored(found, index, commentId));
    },

    async putAsset(reportId: string, asset: NewAsset): Promise<string> {
      const id = crypto.randomUUID();
      assets.set(id, { ...asset, id, reportId, bytes: new Uint8Array(asset.bytes) });
      return id;
    },

    async getAsset(id: string): Promise<StoredAsset | null> {
      const found = assets.get(id);
      return found ? { ...found, bytes: new Uint8Array(found.bytes) } : null;
    },
  };
}
