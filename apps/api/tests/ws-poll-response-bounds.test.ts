/**
 * Source-level guard: the WS POLL_RESPONSE handler must bound optionIndex.
 *
 * The REST route (/polls/:id/respond) was fixed in an earlier round to
 * reject optionIndex >= options.length — but the WS fast path (case
 * 'POLL_RESPONSE' in index.ts) was still persisting msg.optionIndex raw,
 * letting a student forge a phantom vote via the socket that bypasses all
 * REST validation. The fix mirrors the REST check before the upsert.
 *
 * Verifying this end-to-end would require a live session, a poll, a
 * student WS, and DB inspection. A source-level assertion is cheap and
 * catches any future refactor that drops the guard.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('WS POLL_RESPONSE optionIndex bounds', () => {
  const src = readFileSync(resolve(__dirname, '../src/index.ts'), 'utf8');

  // Extract the POLL_RESPONSE case body so our assertions don't accidentally
  // match a similarly-named guard elsewhere in the file.
  const caseStart = src.indexOf(`case 'POLL_RESPONSE':`);
  const caseEnd = src.indexOf(`case '`, caseStart + 1);
  const block = src.slice(caseStart, caseEnd);

  it('rejects non-integer optionIndex before DB write', () => {
    expect(block).toMatch(/typeof msg\.optionIndex\s*!==\s*['"]number['"]/);
    expect(block).toMatch(/Number\.isInteger\(msg\.optionIndex\)/);
  });

  it('rejects optionIndex outside [0, options.length) range', () => {
    expect(block).toMatch(/msg\.optionIndex\s*<\s*0/);
    expect(block).toMatch(/msg\.optionIndex\s*>=\s*options\.length/);
  });

  it('the guard runs BEFORE the poll_responses INSERT', () => {
    const guardIdx = block.search(/msg\.optionIndex\s*>=\s*options\.length/);
    const insertIdx = block.search(/INSERT INTO poll_responses/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(insertIdx);
  });

  it('still verifies the poll exists, is active, and matches the ws session', () => {
    // Preserve the cross-session safety check that was there before.
    expect(block).toMatch(/respondPoll\.status\s*===\s*['"]active['"]/);
    expect(block).toMatch(/respondPoll\.sessionId\s*===\s*sessionId/);
  });
});
