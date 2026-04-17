/**
 * One-off cleanup: wipes all test data, keeps only admin@leeds.ac.uk.
 * Run: pnpm --filter @lecture-feedback/api exec tsx src/db/cleanup-testing.ts
 */
import { config } from 'dotenv';
config({ override: true });

import { sql } from 'drizzle-orm';
import { db } from './index.js';

async function run() {
  const before = await db.execute(sql`SELECT COUNT(*)::int AS n FROM users`);
  console.log(`Users before: ${before.rows[0].n}`);

  // Order matters because most FKs are not ON DELETE CASCADE.
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM poll_responses`);
    await tx.execute(sql`DELETE FROM polls`);
    await tx.execute(sql`DELETE FROM question_upvotes`);
    await tx.execute(sql`DELETE FROM questions`);
    await tx.execute(sql`DELETE FROM feedback_events`);
    await tx.execute(sql`DELETE FROM pace_feedback`);
    await tx.execute(sql`DELETE FROM reflections`);
    await tx.execute(sql`DELETE FROM slide_notes`);
    await tx.execute(sql`DELETE FROM slide_timings`);
    await tx.execute(sql`DELETE FROM slide_whiteboards`);
    await tx.execute(sql`DELETE FROM slide_annotations`);
    await tx.execute(sql`DELETE FROM confusion_contexts`);
    await tx.execute(sql`DELETE FROM session_participants`);
    await tx.execute(sql`DELETE FROM sessions`);
    await tx.execute(sql`DELETE FROM module_enrollments`);
    await tx.execute(sql`DELETE FROM modules`);
    await tx.execute(sql`DELETE FROM blobs`);
    // student_profiles cascades from users
    await tx.execute(sql`DELETE FROM users WHERE email NOT IN ('admin@leeds.ac.uk')`);
  });

  const after = await db.execute(sql`SELECT email, role FROM users ORDER BY role, email`);
  console.log(`Users after: ${after.rows.length}`);
  for (const r of after.rows as { role: string; email: string }[]) {
    console.log(`  ${r.role.padEnd(8)} ${r.email}`);
  }
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
