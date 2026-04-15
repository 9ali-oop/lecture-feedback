/**
 * Blob storage for session PDFs, whiteboard snapshots, and annotation PNGs.
 *
 * Backed by the `blobs` table in Postgres. Previously this lived on the
 * local filesystem, but Render's free tier has an ephemeral disk — every
 * deploy, cold restart, or maintenance event wipes it. In the middle of a
 * usability study that means the lecturer's uploaded slides vanish.
 *
 * Keeping the same public API (savePdf / readPdf / saveWhiteboard / etc.)
 * means callers don't need to change. The returned "path" is now a
 * logical key like `session-<id>.pdf` rather than a filesystem path, but
 * every consumer only uses it as an opaque truthy marker, so the rename
 * is invisible.
 */
import { eq, like } from 'drizzle-orm';
import { db } from '../db/index.js';
import { blobs } from '../db/schema.js';

async function upsertBlob(key: string, buffer: Buffer): Promise<void> {
  await db
    .insert(blobs)
    .values({ key, data: buffer })
    .onConflictDoUpdate({
      target: blobs.key,
      set: { data: buffer, createdAt: new Date() },
    });
}

async function readBlob(key: string): Promise<Buffer | null> {
  const [row] = await db.select({ data: blobs.data }).from(blobs).where(eq(blobs.key, key));
  if (!row) return null;
  // node-postgres returns bytea as Buffer already, but normalise to be safe
  // (older driver versions returned it as a Uint8Array).
  return Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data as unknown as Uint8Array);
}

async function deleteBlobsWithPrefix(prefix: string): Promise<void> {
  // LIKE-escape: the prefix is built from UUIDs and fixed suffixes, no user
  // input, so we don't need to escape % or _. Keeping it simple.
  await db.delete(blobs).where(like(blobs.key, `${prefix}%`));
}

export async function ensureUploadsDir(): Promise<void> {
  // No-op: blobs now live in Postgres. Kept as an export so the existing
  // bootstrap call in src/index.ts doesn't have to change.
}

export async function savePdf(sessionId: string, buffer: Buffer): Promise<string> {
  const key = `session-${sessionId}.pdf`;
  await upsertBlob(key, buffer);
  return key;
}

export async function getPdfPath(sessionId: string): Promise<string | null> {
  const key = `session-${sessionId}.pdf`;
  const [row] = await db.select({ key: blobs.key }).from(blobs).where(eq(blobs.key, key));
  return row ? key : null;
}

export async function readPdf(sessionId: string): Promise<Buffer | null> {
  return readBlob(`session-${sessionId}.pdf`);
}

export async function saveWhiteboard(sessionId: string, slideIndex: number, buffer: Buffer): Promise<string> {
  const key = `whiteboard-${sessionId}-${slideIndex}.png`;
  await upsertBlob(key, buffer);
  return key;
}

export async function readWhiteboard(sessionId: string, slideIndex: number): Promise<Buffer | null> {
  return readBlob(`whiteboard-${sessionId}-${slideIndex}.png`);
}

export async function saveAnnotation(sessionId: string, slideIndex: number, buffer: Buffer): Promise<string> {
  const key = `annotation-${sessionId}-${slideIndex}.png`;
  await upsertBlob(key, buffer);
  return key;
}

export async function readAnnotation(sessionId: string, slideIndex: number): Promise<Buffer | null> {
  return readBlob(`annotation-${sessionId}-${slideIndex}.png`);
}

/**
 * Delete every blob belonging to a session. Idempotent — running on an
 * already-cleaned session is a no-op.
 */
export async function deleteSessionFiles(sessionId: string): Promise<void> {
  await Promise.all([
    // Exact match for the PDF — use `=` rather than LIKE to avoid matching
    // other session ids that happen to be prefixes (UUIDs make this nearly
    // impossible but explicit is cheaper than the bug).
    db.delete(blobs).where(eq(blobs.key, `session-${sessionId}.pdf`)),
    deleteBlobsWithPrefix(`whiteboard-${sessionId}-`),
    deleteBlobsWithPrefix(`annotation-${sessionId}-`),
  ]);
}

