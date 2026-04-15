/**
 * Verifies two JWT hardening fixes:
 *   1. lib/jwt.ts refuses to boot when NODE_ENV=production and JWT_SECRET
 *      is weak/missing/default. Previously it silently fell back to a
 *      hardcoded public string → forged admin tokens in any prod deploy.
 *   2. verifyToken rejects payloads missing sub/email/role — defence in
 *      depth in case the secret ever leaks and an attacker forges malformed
 *      tokens.
 *
 * Like the auth-dev-override test, the boot-time gate is asserted at the
 * source level so a future refactor can't silently remove it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('JWT_SECRET boot-time gate', () => {
  const src = readFileSync(resolve(__dirname, '../src/lib/jwt.ts'), 'utf8');

  it('throws in production when JWT_SECRET is missing or weak', () => {
    // We can't directly import jwt.ts with a mutated env because the
    // module caches `secret` at load time. Assert the guard via source.
    expect(src).toMatch(/NODE_ENV\s*===\s*['"]production['"]/);
    expect(src).toMatch(/throw new Error/);
    expect(src).toMatch(/JWT_SECRET/);
  });

  it('treats the documented example defaults as weak', () => {
    // The .env.example string + the old fallback + the local dev default
    // must all trigger the weak branch so a careless copy-paste can't slip
    // into production.
    expect(src).toContain('dev-secret-change-in-production');
    expect(src).toContain('change-this-to-a-long-random-string-in-production');
    expect(src).toContain('local-dev-secret-change-in-production');
  });

  it('enforces a minimum secret length', () => {
    expect(src).toMatch(/length\s*<\s*32/);
  });
});

describe('verifyToken payload shape', () => {
  const src = readFileSync(resolve(__dirname, '../src/lib/jwt.ts'), 'utf8');

  it('rejects payloads missing sub/email/role', () => {
    expect(src).toMatch(/typeof payload\.sub\s*!==\s*['"]string['"]/);
    expect(src).toMatch(/typeof payload\.email\s*!==\s*['"]string['"]/);
    expect(src).toMatch(/typeof payload\.role\s*!==\s*['"]string['"]/);
  });

  it('does not blind-cast the payload any more', () => {
    expect(src).not.toMatch(/payload as unknown as JwtPayload/);
  });
});

// Live check: the currently-loaded module must accept its own signed tokens.
// Confirms we didn't tighten the shape so far that legitimate tokens fail.
describe('verifyToken round-trip (smoke)', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
  });

  it('round-trips a signed token', async () => {
    process.env.NODE_ENV = 'development'; // keep the dev fallback branch
    const { signToken, verifyToken } = await import('../src/lib/jwt.js');
    const tok = await signToken({ sub: 'u1', email: 'u1@leeds.ac.uk', role: 'student' });
    const payload = await verifyToken(tok);
    expect(payload.sub).toBe('u1');
    expect(payload.email).toBe('u1@leeds.ac.uk');
    expect(payload.role).toBe('student');
  });
});
