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
