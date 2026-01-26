/**
 * Creates the admin user on first run.
 * Run with: pnpm db:seed
 */
import { config } from 'dotenv';
config({ override: true });
import { db } from './index.js';
import { users } from './schema.js';
import { generateTotpSecret, generateQrCodeDataUrl } from '../lib/totp.js';
import { eq } from 'drizzle-orm';

const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@leeds.ac.uk';

async function seed() {
  const existing = await db.select().from(users).where(eq(users.email, adminEmail));
  if (existing.length > 0) {
    console.log('Admin user already exists.');
    process.exit(0);
  }

  const secret = generateTotpSecret();
  const [admin] = await db
    .insert(users)
    .values({
      email: adminEmail,
      name: 'Admin',
      role: 'admin',
      totpSecret: secret,
      totpVerified: false,
    })
    .returning();

  const qr = await generateQrCodeDataUrl(secret, adminEmail, 'LectureFlow Admin');

  console.log('\n=== Admin account created ===');
  console.log(`Email: ${adminEmail}`);
  console.log(`TOTP secret: ${secret}`);
  console.log('\nScan the QR code below in your authenticator app:');
  console.log(qr);
  console.log('\nThen visit http://localhost:5173/register to verify your TOTP and activate the account.');
  console.log('=========================================\n');

  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
