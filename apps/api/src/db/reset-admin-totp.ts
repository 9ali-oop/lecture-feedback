/**
 * Rotate the admin user's TOTP secret and save a fresh QR to ./admin-qr.png.
 * Run with: pnpm --filter @lecture-feedback/api exec tsx src/db/reset-admin-totp.ts
 *
 * Reads DATABASE_URL from the environment — point it at prod (Neon) to reset
 * prod's admin, or leave it on the local .env to reset dev.
 */
import { config } from 'dotenv';
// Env-var DATABASE_URL wins — only load .env when nothing was passed in.
// Without this, a passed prod URL gets clobbered by the local .env file.
if (!process.env.DATABASE_URL) config();
import path from 'node:path';
import QRCode from 'qrcode';
import { eq } from 'drizzle-orm';
import { db } from './index.js';
import { users } from './schema.js';
import { generateTotpSecret, createTotp } from '../lib/totp.js';

const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@leeds.ac.uk';

async function reset() {
  const target = process.env.DATABASE_URL ?? '';
  const isLocal = /localhost|127\.0\.0\.1/i.test(target);
  console.log(`Target DB: ${isLocal ? 'LOCAL' : 'REMOTE'} (${target.replace(/:[^@/]+@/, ':***@')})`);

  const secret = generateTotpSecret();
  const updated = await db
    .update(users)
    .set({ totpSecret: secret, totpVerified: false })
    .where(eq(users.email, adminEmail))
    .returning();

  if (updated.length === 0) {
    console.error(`No admin with email ${adminEmail} found. Run pnpm db:seed first.`);
    process.exit(1);
  }

  const totp = createTotp(secret, 'LectureFlow Admin', adminEmail);
  const uri = totp.toString();

  const pngPath = path.resolve(process.cwd(), '../../admin-qr.png');
  await QRCode.toFile(pngPath, uri, { width: 512 });

  console.log('\n=== Admin TOTP reset ===');
  console.log(`Email:  ${adminEmail}`);
  console.log(`Secret: ${secret}`);
  console.log(`QR:     ${pngPath}`);
  console.log('\nDelete the old admin entry from your authenticator, then scan the new QR.');
  process.exit(0);
}

reset().catch((err) => {
  console.error(err);
  process.exit(1);
});
