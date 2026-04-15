/**
 * Verifies that the @leeds.ac.uk + "123456" dev login shortcut in
 * routes/auth.ts is gated by NODE_ENV. Without this gate, the seed admin
 * (`admin@leeds.ac.uk`) could be logged into from any deployment using the
 * literal string "123456" — a universal admin backdoor.
 *
 * We can't easily unit-test the handler because it pulls real DB rows.
 * Instead, we test the gate logic directly: the predicate that decides
 * whether to accept the dev code. Kept identical to the production file.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function devBackdoorEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}

function isDevLogin(email: string, code: string): boolean {
  return devBackdoorEnabled() && email.endsWith('@leeds.ac.uk') && code === '123456';
}

describe('auth dev-override gate', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });

  it('accepts 123456 for @leeds.ac.uk when NODE_ENV is not production', () => {
    process.env.NODE_ENV = 'development';
    expect(isDevLogin('admin@leeds.ac.uk', '123456')).toBe(true);
    expect(isDevLogin('oc@leeds.ac.uk', '123456')).toBe(true);
  });

  it('accepts 123456 for @leeds.ac.uk when NODE_ENV is test', () => {
    process.env.NODE_ENV = 'test';
    expect(isDevLogin('oc@leeds.ac.uk', '123456')).toBe(true);
  });

  it('rejects 123456 when NODE_ENV=production (even for @leeds.ac.uk)', () => {
    process.env.NODE_ENV = 'production';
    expect(isDevLogin('admin@leeds.ac.uk', '123456')).toBe(false);
    expect(isDevLogin('bosslecturer@leeds.ac.uk', '123456')).toBe(false);
    expect(isDevLogin('guest-abc@leeds.ac.uk', '123456')).toBe(false);
  });

  it('rejects non-leeds.ac.uk emails regardless of env', () => {
    process.env.NODE_ENV = 'development';
    expect(isDevLogin('admin@gmail.com', '123456')).toBe(false);
  });

  it('rejects wrong code even for @leeds.ac.uk in dev', () => {
    process.env.NODE_ENV = 'development';
    expect(isDevLogin('oc@leeds.ac.uk', '000000')).toBe(false);
  });

  // Guard against the handler losing its NODE_ENV gate in a future refactor.
  // The local predicate in this test is a re-implementation — if someone
  // deletes the guard in auth.ts without updating this test, our other cases
  // would still pass. This check forces the source to keep the guard.
  it('routes/auth.ts still gates the dev override on NODE_ENV', () => {
    const src = readFileSync(
      resolve(__dirname, '../src/routes/auth.ts'),
      'utf8',
    );
    expect(src).toMatch(/NODE_ENV\s*!==\s*['"]production['"]/);
    // The dev code literal must only be accepted when the gate passes.
    // Match the shape `(isDevAccount && code === '123456')` OR equivalent.
    expect(src).toMatch(/isDevAccount\s*&&\s*code\s*===\s*['"]123456['"]/);
  });
});
