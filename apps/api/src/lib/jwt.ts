import { SignJWT, jwtVerify } from 'jose';
import type { Role } from '@lecture-feedback/shared';

// JWT_SECRET is the ONLY thing between an attacker and forged admin tokens.
// Previously this silently fell back to a hardcoded public string, so any
// deployment missing the env var would accept attacker-signed tokens for
// any user including admin — worse than the /auth/verify backdoor because
// it bypasses the login endpoint entirely.
//
// Contract:
//   - production: must be set, ≥32 chars, and NOT one of the example
//     defaults from `.env.example` / prior versions. Refuse to boot.
//   - dev/test: warn loudly if weak, fall back to a marker string so
//     the server still starts for local work.
const WEAK_DEFAULTS = new Set([
  'dev-secret-change-in-production',
  'change-this-to-a-long-random-string-in-production',
  'local-dev-secret-change-in-production',
]);
const rawSecret = process.env.JWT_SECRET;
const isWeak = !rawSecret || rawSecret.length < 32 || WEAK_DEFAULTS.has(rawSecret);
if (isWeak && process.env.NODE_ENV === 'production') {
  throw new Error(
    'JWT_SECRET must be set to a long random string (≥32 chars, not an example default) when NODE_ENV=production.',
  );
}
if (isWeak) {
  console.warn(
    '[jwt] WARNING: weak or default JWT_SECRET — tokens issued by this server are trivially forgeable. Set a long random JWT_SECRET in .env before deploying.',
  );
}
const secret = new TextEncoder().encode(
  rawSecret ?? 'dev-only-insecure-secret-do-not-use-in-prod',
);

export interface JwtPayload {
  sub: string;     // user id
  email: string;
  role: Role;
}

export async function signToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JwtPayload> {
  const { payload } = await jwtVerify(token, secret);
  // Shape-check the payload before trusting it. Downstream code assumes
  // sub/email/role are strings; a forged or malformed token (e.g. if the
  // secret ever leaks, or a test helper signs with the wrong shape) would
  // otherwise flow through to DB queries with `undefined` ids.
  if (
    !payload ||
    typeof payload.sub !== 'string' ||
    typeof payload.email !== 'string' ||
    typeof payload.role !== 'string'
  ) {
    throw new Error('Invalid JWT payload shape');
  }
  return { sub: payload.sub, email: payload.email, role: payload.role as Role };
}
