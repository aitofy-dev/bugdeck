/**
 * The default store: SQLite for the report, the filesystem for the pixels.
 *
 * Screenshots are the reason for the split. A 10 MB blob per row turns every
 * `SELECT *` into a file copy and makes the database impossible to back up
 * casually; on disk they are ordinary files an operator can count, rsync and
 * delete. The database stays the index and keeps the ownership answer.
 *
 * WAL because a poll worker reads while a request writes, and the default
 * rollback journal makes those two block each other.
 */
import { mkdirSync } from 'node:fs';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import type { FeedbackThreadEntry } from '@aitofy/bugdeck-core';
import { appendThreadEntries, applyReportUpdate, newReportRecord } from './report-record.js';
import { rowToReport, reportToRow, type ReportRow } from './sqlite-rows.js';
import type {
  FeedbackStore,
  NewAsset,
  NewReport,
  ReportUpdate,
  StoredAsset,
  StoredReport,
} from './store.js';

export interface SqliteStoreOptions {
  /** Directory that holds `reports.db` and `assets/`. Created if absent. */
  storagePath: string;
}

/** Closing matters in tests and on shutdown: WAL leaves `-wal`/`-shm` behind. */
export interface SqliteFeedbackStore extends FeedbackStore {
  close(): void;
}

const SCHEMA = `
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  owner_email TEXT,
  code TEXT,
  external_id TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  state TEXT NOT NULL,
  context TEXT NOT NULL,
  asset_ids TEXT NOT NULL,
  blocks TEXT,
  thread TEXT,
  appends TEXT,
  public_reply TEXT,
  public_reply_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX reports_by_owner ON reports (owner_id, created_at DESC);
CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  byte_length INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX assets_by_report ON assets (report_id);
`;

/**
 * Migrations are numbered by `user_version` and applied in order, so opening an
 * old database upgrades it and opening a new one is a no-op. One entry today;
 * the next schema change appends to this array and never edits `SCHEMA`.
 */
const MIGRATIONS: readonly string[] = [SCHEMA];

function migrate(db: SqliteDatabase): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let step = version; step < MIGRATIONS.length; step++) {
    db.exec(MIGRATIONS[step] as string);
    db.pragma(`user_version = ${step + 1}`);
  }
}

const COLUMNS =
  'id, owner_id, owner_email, code, external_id, title, description, state, context, asset_ids, blocks, ' +
  'thread, appends, public_reply, public_reply_at, created_at, updated_at';

const PLACEHOLDERS = COLUMNS.split(', ')
  .map((column) => `@${column}`)
  .join(', ');

export function createSqliteStore(options: SqliteStoreOptions): SqliteFeedbackStore {
  const assetsPath = join(options.storagePath, 'assets');
  mkdirSync(assetsPath, { recursive: true });
  const db = new Database(join(options.storagePath, 'reports.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);

  const upsert = db.prepare(
    `INSERT INTO reports (${COLUMNS}) VALUES (${PLACEHOLDERS})
     ON CONFLICT(id) DO UPDATE SET ${COLUMNS.split(', ')
       .filter((column) => column !== 'id')
       .map((column) => `${column} = excluded.${column}`)
       .join(', ')}`,
  );
  const selectOne = db.prepare(`SELECT ${COLUMNS} FROM reports WHERE id = ?`);
  const selectByOwner = db.prepare(
    `SELECT ${COLUMNS} FROM reports WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?`,
  );
  const insertAsset = db.prepare(
    `INSERT INTO assets (id, report_id, mime, width, height, byte_length, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const selectAsset = db.prepare(
    'SELECT id, report_id, mime, width, height FROM assets WHERE id = ?',
  );

  const save = (report: StoredReport): StoredReport => {
    upsert.run(reportToRow(report));
    return report;
  };

  const read = (id: string): StoredReport | null => {
    const row = selectOne.get(id) as ReportRow | undefined;
    return row ? rowToReport(row) : null;
  };

  const assetFile = (id: string): string => join(assetsPath, `${id}.png`);

  return {
    async createReport(input: NewReport): Promise<StoredReport> {
      return save(newReportRecord(input, new Date().toISOString()));
    },

    async getReport(id: string): Promise<StoredReport | null> {
      return read(id);
    },

    async listReportsByUser(ownerId: string, limit: number): Promise<StoredReport[]> {
      return (selectByOwner.all(ownerId, limit) as ReportRow[]).map(rowToReport);
    },

    async updateReport(id: string, update: ReportUpdate): Promise<void> {
      const found = read(id);
      if (found) save(applyReportUpdate(found, update, new Date().toISOString()));
    },

    async appendThread(id: string, entries: readonly FeedbackThreadEntry[]): Promise<void> {
      const found = read(id);
      if (found) save(appendThreadEntries(found, entries, new Date().toISOString()));
    },

    async putAsset(reportId: string, asset: NewAsset): Promise<string> {
      const id = crypto.randomUUID();
      // Bytes first: a row with no file is a broken image, a file with no row is
      // garbage nobody can reach.
      await writeFile(assetFile(id), asset.bytes);
      try {
        insertAsset.run(
          id,
          reportId,
          asset.mime,
          asset.width,
          asset.height,
          asset.bytes.byteLength,
          new Date().toISOString(),
        );
      } catch (err) {
        await unlink(assetFile(id)).catch(() => {});
        throw err;
      }
      return id;
    },

    async getAsset(id: string): Promise<StoredAsset | null> {
      const row = selectAsset.get(id) as
        | { id: string; report_id: string; mime: string; width: number; height: number }
        | undefined;
      if (!row) return null;
      try {
        const bytes = await readFile(assetFile(id));
        return {
          id: row.id,
          reportId: row.report_id,
          mime: row.mime,
          width: row.width,
          height: row.height,
          bytes,
        };
      } catch {
        // The row outlived its file. A 404 is the honest answer; throwing here
        // would turn one lost screenshot into a 500 on the whole report page.
        return null;
      }
    },

    close(): void {
      db.close();
    },
  };
}
