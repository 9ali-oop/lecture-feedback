/**
 * Verifies that routes/polls.ts keeps an upper bound on optionIndex.
 *
 * The zod validator only enforces `min(0)`. Without a max check in the
 * handler, a student could POST `{ optionIndex: 9999 }` — stored in the
 * DB, rendered as 0-count by computeResults (because the bounds check is
 * there). But if the poll's options are ever edited to include more than
 * 9999 choices, those rows retroactively become valid and silently spike
 * a phantom option.
 *
 * Like the auth test, this is a source-level guard so a future refactor
 * can't remove the check without lighting up CI.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('polls optionIndex upper bound', () => {
  const src = readFileSync(
    resolve(__dirname, '../src/routes/polls.ts'),
    'utf8',
  );

  it('handler rejects optionIndex outside poll.options range', () => {
    // Look for the guard shape: `if (optionIndex >= options.length) return ... 400`
    expect(src).toMatch(/optionIndex\s*>=\s*options\.length/);
    expect(src).toMatch(/Invalid option index/);
  });

  it('the guard runs AFTER the poll is loaded (so options.length is known)', () => {
    const guardIdx = src.search(/optionIndex\s*>=\s*options\.length/);
    const pollLoadIdx = src.search(/targetPoll\s*=\s*\(await db\.select\(\)\.from\(polls\)/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(pollLoadIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeGreaterThan(pollLoadIdx);
  });
});
