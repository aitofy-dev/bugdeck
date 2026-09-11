/**
 * Plane's three-step presigned attachment flow, and the bookkeeping that keeps
 * a retry from decorating an issue with duplicate screenshots.
 *
 *   POST /issues/{id}/issue-attachments/  {name, type, size}   → presigned form
 *   POST upload_data.url                  multipart, file LAST → object storage
 *   PATCH .../issue-attachments/{asset}/                        → mark uploaded
 *
 * Skip the third step and the file sits in storage while Plane shows nothing.
 * The presign policy pins content-length, so the declared `size` has to be the
 * exact byte count — which is why a `TrackerFile` carries the bytes rather than
 * a number that could disagree with them.
 */
import type { TrackerFile } from '../../tracker.js';
import { planeApi, PlaneHttpError, type PlaneHttp } from './client.js';

/** Which files the issue is still missing, and where the rest already are. */
export async function assetsMissingFrom(
  http: PlaneHttp,
  issueId: string,
  files: readonly TrackerFile[],
): Promise<{ missing: TrackerFile[]; alreadyUploaded: Map<string, string> }> {
  // A BARE array, not a page — Plane answers this endpoint unpaginated.
  const existing = await planeApi<Array<{ id?: string; attributes?: { name?: string } }>>(
    http,
    `issues/${issueId}/issue-attachments/`,
  );

  // Presence is decided by NAME ALONE. The list's `id` also happens to be the
  // asset id the create step returned — useful for addressing an earlier run's
  // upload inline — but it is a bonus, not the test: treating a listed-but-
  // id-less attachment as absent would re-upload it.
  const names = new Set(
    existing.map((row) => row.attributes?.name).filter((name): name is string => !!name),
  );
  const idByName = new Map<string, string>();
  for (const row of existing) {
    if (row.attributes?.name && row.id) idByName.set(row.attributes.name, row.id);
  }

  const alreadyUploaded = new Map<string, string>();
  const missing: TrackerFile[] = [];
  for (const file of files) {
    if (!names.has(file.name)) {
      missing.push(file);
      continue;
    }
    const planeAssetId = idByName.get(file.name);
    if (planeAssetId) alreadyUploaded.set(file.name, planeAssetId);
  }
  return { missing, alreadyUploaded };
}

/**
 * One file, three steps. Deliberately NOT retried: every attempt mints a new
 * attachment row server-side, so a retry loop decorates the issue with
 * half-uploaded stubs. One try, then the caller falls back to a link.
 */
export async function uploadAttachment(
  http: PlaneHttp,
  issueId: string,
  file: TrackerFile,
): Promise<string> {
  const created = await planeApi<{
    asset_id: string;
    upload_data: { url: string; fields: Record<string, string> };
  }>(http, `issues/${issueId}/issue-attachments/`, {
    method: 'POST',
    body: { name: file.name, type: file.mime, size: file.bytes.byteLength },
  });

  // The presigned policy pins content-length, and S3 form posts require the
  // file part LAST — insertion order into FormData is the wire order.
  const form = new FormData();
  for (const [key, value] of Object.entries(created.upload_data.fields)) form.append(key, value);
  form.append('file', new Blob([file.bytes], { type: file.mime }), file.name);

  // No X-API-Key here: this goes to object storage, not to Plane's API.
  const put = await http.fetchImpl(created.upload_data.url, { method: 'POST', body: form });
  if (!put.ok) throw new PlaneHttpError(put.status, await put.text());

  await planeApi(http, `issues/${issueId}/issue-attachments/${created.asset_id}/`, {
    method: 'PATCH',
    body: {},
  });

  // Doubles as the inline-image handle: see buildBlockDescriptionHtml.
  return created.asset_id;
}

export interface UploadOutcome {
  /** File name → Plane asset id. What turns a layout into inline images. */
  assetIdByFileName: Map<string, string>;
  /** Files Plane refused; the caller renders auth-scoped links for these. */
  failed: string[];
  warnings: string[];
}

/**
 * Put every file on the issue, skipping the ones already there.
 *
 * `known` = the issue may already carry attachments from an earlier run (a
 * retried create, or an edit of a report mirrored days ago). Asking Plane costs
 * one request and is the only way to tell "already uploaded" from "uploaded
 * twice"; a fresh issue skips it because everything is missing by definition.
 *
 * Never throws for a single failed file: a report that reaches the board
 * missing one picture is far better than one that does not reach it at all.
 */
export async function uploadFiles(
  http: PlaneHttp,
  issueId: string,
  files: readonly TrackerFile[],
  known: boolean,
): Promise<UploadOutcome> {
  const out: UploadOutcome = { assetIdByFileName: new Map(), failed: [], warnings: [] };
  if (!files.length) return out;

  let pending = files;
  if (known) {
    try {
      const seen = await assetsMissingFrom(http, issueId, files);
      pending = seen.missing;
      for (const [name, planeAssetId] of seen.alreadyUploaded) {
        out.assetIdByFileName.set(name, planeAssetId);
      }
    } catch (err) {
      // Cannot tell what is already there — uploading again would duplicate,
      // so leave the earlier run's attachments alone and say so.
      pending = [];
      out.warnings.push(`attachment listing: ${(err as Error).message}`);
    }
  }

  for (const file of pending) {
    try {
      out.assetIdByFileName.set(file.name, await uploadAttachment(http, issueId, file));
    } catch (err) {
      out.failed.push(file.name);
      out.warnings.push(`asset ${file.name}: ${(err as Error).message}`);
      http.logger.warn('plane attachment failed, falling back to link', {
        issueId,
        file: file.name,
        err: (err as Error).message,
      });
    }
  }
  return out;
}
