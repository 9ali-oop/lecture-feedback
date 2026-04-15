/**
 * Verifies deleteSessionFiles() removes every PDF + whiteboard/annotation
 * PNG for a session, and leaves files belonging to other sessions alone.
 *
 * Before this helper, DELETE /sessions/:id removed the DB rows but left
 * the files on disk forever — every create/delete cycle leaked to disk.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Point UPLOADS_DIR at a temp dir BEFORE importing the storage module,
// because storage.ts reads process.env.UPLOADS_DIR at module load.
const TMP = path.join(os.tmpdir(), `lectureflow-storage-test-${process.pid}`);
process.env.UPLOADS_DIR = TMP;

const { deleteSessionFiles, ensureUploadsDir } = await import('../src/lib/storage.js');

async function touch(name: string) {
  await fs.writeFile(path.join(TMP, name), 'x');
}

async function list() {
  try { return (await fs.readdir(TMP)).sort(); } catch { return []; }
}

describe('deleteSessionFiles', () => {
  beforeEach(async () => {
    // Clean slate each test
    await fs.rm(TMP, { recursive: true, force: true });
    await ensureUploadsDir();
  });

  afterAll(async () => {
    await fs.rm(TMP, { recursive: true, force: true });
  });

  const sid = '11111111-1111-1111-1111-111111111111';
  const other = '22222222-2222-2222-2222-222222222222';

  it('removes the session PDF, whiteboards, and annotations', async () => {
    await touch(`session-${sid}.pdf`);
    await touch(`whiteboard-${sid}-0.png`);
    await touch(`whiteboard-${sid}-5.png`);
    await touch(`annotation-${sid}-0.png`);
    await touch(`annotation-${sid}-12.png`);

    await deleteSessionFiles(sid);

    expect(await list()).toEqual([]);
  });

  it('leaves files belonging to other sessions untouched', async () => {
    await touch(`session-${sid}.pdf`);
    await touch(`session-${other}.pdf`);
    await touch(`whiteboard-${sid}-0.png`);
    await touch(`whiteboard-${other}-0.png`);

    await deleteSessionFiles(sid);

    expect(await list()).toEqual([
      `session-${other}.pdf`,
      `whiteboard-${other}-0.png`,
    ]);
  });

  it('is idempotent (safe to call twice / on a session with no files)', async () => {
    // No files at all — should not throw.
    await expect(deleteSessionFiles(sid)).resolves.toBeUndefined();

    // Files present, delete, delete again — still fine.
    await touch(`session-${sid}.pdf`);
    await deleteSessionFiles(sid);
    await expect(deleteSessionFiles(sid)).resolves.toBeUndefined();
    expect(await list()).toEqual([]);
  });

  it('does not confuse sessions with overlapping id prefixes', async () => {
    // Classic sessionId substring trap: deleting `11…111` should NOT match
    // `11…1111…` etc. UUIDs are fixed-length, so an exact equality or
    // "startsWith(`session-${id}.pdf`)" must not false-match.
    const prefix = '11111111-1111-1111-1111-111111111111';
    const longer = '11111111-1111-1111-1111-111111111111AA'; // not a real UUID, but tests prefix logic
    await touch(`session-${prefix}.pdf`);
    await touch(`whiteboard-${prefix}-0.png`);
    await touch(`whiteboard-${longer}-0.png`);

    await deleteSessionFiles(prefix);

    // The file for `longer` should survive — we only delete exact PDF and
    // the `whiteboard-${id}-` prefix which starts with a trailing dash,
    // so whiteboard-${longer}-0.png does start with a DIFFERENT prefix.
    const remaining = await list();
    expect(remaining).toContain(`whiteboard-${longer}-0.png`);
    expect(remaining).not.toContain(`session-${prefix}.pdf`);
    expect(remaining).not.toContain(`whiteboard-${prefix}-0.png`);
  });
});
