/**
 * Local filesystem storage for PDFs.
 * Swap this module's internals for R2 when deploying to Cloudflare.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const uploadsDir = process.env.UPLOADS_DIR ?? './uploads';

export async function ensureUploadsDir(): Promise<void> {
  await fs.mkdir(uploadsDir, { recursive: true });
}

export async function savePdf(sessionId: string, buffer: Buffer): Promise<string> {
  await ensureUploadsDir();
  const filename = `session-${sessionId}.pdf`;
  const filePath = path.join(uploadsDir, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function getPdfPath(sessionId: string): Promise<string | null> {
  const filename = `session-${sessionId}.pdf`;
  const filePath = path.join(uploadsDir, filename);
  try {
    await fs.access(filePath);
    return filePath;
  } catch {
    return null;
  }
}

export async function readPdf(sessionId: string): Promise<Buffer | null> {
  const filePath = await getPdfPath(sessionId);
  if (!filePath) return null;
  return fs.readFile(filePath);
}

export async function saveWhiteboard(sessionId: string, slideIndex: number, buffer: Buffer): Promise<string> {
  await ensureUploadsDir();
  const filename = `whiteboard-${sessionId}-${slideIndex}.png`;
  const filePath = path.join(uploadsDir, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function readWhiteboard(sessionId: string, slideIndex: number): Promise<Buffer | null> {
  const filename = `whiteboard-${sessionId}-${slideIndex}.png`;
  const filePath = path.join(uploadsDir, filename);
  try {
    await fs.access(filePath);
    return fs.readFile(filePath);
  } catch {
    return null;
  }
}

export async function saveAnnotation(sessionId: string, slideIndex: number, buffer: Buffer): Promise<string> {
  await ensureUploadsDir();
  const filename = `annotation-${sessionId}-${slideIndex}.png`;
  const filePath = path.join(uploadsDir, filename);
  await fs.writeFile(filePath, buffer);
  return filePath;
}

export async function readAnnotation(sessionId: string, slideIndex: number): Promise<Buffer | null> {
  const filename = `annotation-${sessionId}-${slideIndex}.png`;
  const filePath = path.join(uploadsDir, filename);
  try {
    await fs.access(filePath);
    return fs.readFile(filePath);
  } catch {
    return null;
  }
}

/**
 * Remove every file tied to a session: the PDF and all whiteboard /
 * annotation PNGs. Called when a session is deleted so we don't leak
 * files on disk. Filenames are deterministic (prefixed with the sessionId),
 * so we scan the uploads dir once and unlink the matching ones. Missing
 * files are silently ignored — the delete is idempotent.
 */
export async function deleteSessionFiles(sessionId: string): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(uploadsDir);
  } catch {
    return; // uploads dir doesn't exist yet — nothing to clean
  }
  const prefixes = [
    `session-${sessionId}.pdf`,
    `whiteboard-${sessionId}-`,
    `annotation-${sessionId}-`,
  ];
  await Promise.all(
    names
      .filter((n) => prefixes.some((p) => n === p || n.startsWith(p)))
      .map((n) => fs.unlink(path.join(uploadsDir, n)).catch(() => { /* already gone */ })),
  );
}
