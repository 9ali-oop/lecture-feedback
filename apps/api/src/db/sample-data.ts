import { config } from 'dotenv';
config({ override: true });

import { db } from './index.js';
import { users, studentProfiles, modules, moduleEnrollments } from './schema.js';
import { generateTotpSecret } from '../lib/totp.js';
import { eq } from 'drizzle-orm';

// ── Sample students ───────────────────────────────────────────────────────────

const STUDENTS = [
  { name: 'Aisha Rahman',      email: 'sc23ar@leeds.ac.uk', num: '201823441', prof: 'fluent'       },
  { name: 'Ben Whitfield',     email: 'sc23bw@leeds.ac.uk', num: '201956123', prof: 'native'       },
  { name: 'Chloe Davies',      email: 'sc23cd@leeds.ac.uk', num: '201734892', prof: 'native'       },
  { name: 'Daniel Okafor',     email: 'sc23do@leeds.ac.uk', num: '201845671', prof: 'fluent'       },
  { name: 'Emma Johnson',      email: 'sc23ej@leeds.ac.uk', num: '201923785', prof: 'native'       },
  { name: 'Faisal Al-Amin',    email: 'sc23fa@leeds.ac.uk', num: '201867234', prof: 'intermediate' },
  { name: 'Grace Kim',         email: 'sc23gk@leeds.ac.uk', num: '201978456', prof: 'fluent'       },
  { name: 'Harry Singh',       email: 'sc23hs@leeds.ac.uk', num: '201812345', prof: 'native'       },
  { name: 'Isabel Torres',     email: 'sc23it@leeds.ac.uk', num: '201934567', prof: 'intermediate' },
  { name: 'James Nguyen',      email: 'sc23jn@leeds.ac.uk', num: '201745678', prof: 'fluent'       },
  { name: 'Kiran Patel',       email: 'sc23kp@leeds.ac.uk', num: '201856789', prof: 'native'       },
  { name: 'Laura Martinez',    email: 'sc23lm@leeds.ac.uk', num: '201967890', prof: 'intermediate' },
  { name: 'Marcus Brown',      email: 'sc23mb@leeds.ac.uk', num: '201878901', prof: 'native'       },
  { name: 'Nadia Kowalski',    email: 'sc23nk@leeds.ac.uk', num: '201989012', prof: 'intermediate' },
  { name: 'Oliver Hughes',     email: 'sc23oh@leeds.ac.uk', num: '201890123', prof: 'native'       },
  { name: 'Priya Sharma',      email: 'sc23ps@leeds.ac.uk', num: '201901234', prof: 'fluent'       },
  { name: 'Qasim Ali',         email: 'sc23qa@leeds.ac.uk', num: '201812346', prof: 'fluent'       },
  { name: 'Rosa Fernandez',    email: 'sc23rf@leeds.ac.uk', num: '201923457', prof: 'intermediate' },
  { name: 'Sam Fletcher',      email: 'sc23sf@leeds.ac.uk', num: '201834568', prof: 'native'       },
  { name: 'Tanya Ivanova',     email: 'sc23ti@leeds.ac.uk', num: '201945679', prof: 'beginner'     },
  { name: 'Usman Chaudhry',    email: 'sc23uc@leeds.ac.uk', num: '201856780', prof: 'fluent'       },
  { name: 'Victoria Chen',     email: 'sc23vc@leeds.ac.uk', num: '201967891', prof: 'native'       },
  { name: 'William Park',      email: 'sc23wp@leeds.ac.uk', num: '201878902', prof: 'native'       },
  { name: 'Xinyu Zhang',       email: 'sc23xz@leeds.ac.uk', num: '201989013', prof: 'intermediate' },
  { name: 'Yasmin El-Sayed',   email: 'sc23ye@leeds.ac.uk', num: '201890124', prof: 'fluent'       },
] as const;

async function run() {
  // ── Find lecturer ─────────────────────────────────────────────────────────
  const lecturers = await db.select().from(users).where(eq(users.role, 'lecturer'));
  if (!lecturers.length) {
    console.error('No lecturer account found. Create one via the admin panel first.');
    process.exit(1);
  }
  const lecturer = lecturers[0];
  console.log(`Using lecturer: ${lecturer.name} (${lecturer.email})`);

  // ── Ensure two modules exist ──────────────────────────────────────────────
  const existingMods = await db.select().from(modules);
  const modCodes = existingMods.map((m) => m.code);

  if (!modCodes.includes('COMP101')) {
    await db.insert(modules).values({ code: 'COMP101', name: 'Introduction to Computing', lecturerId: lecturer.id });
    console.log('Created module COMP101');
  }
  if (!modCodes.includes('MATH201')) {
    await db.insert(modules).values({ code: 'MATH201', name: 'Linear Algebra & Applications', lecturerId: lecturer.id });
    console.log('Created module MATH201');
  }

  const allMods = await db.select().from(modules);
  console.log(`Modules: ${allMods.map((m) => m.code).join(', ')}`);

  // ── Create students ───────────────────────────────────────────────────────
  const secrets: { name: string; email: string; secret: string }[] = [];

  for (const s of STUDENTS) {
    const existing = await db.select().from(users).where(eq(users.email, s.email));
    if (existing.length) {
      console.log(`  skip (exists): ${s.email}`);
      continue;
    }

    const secret = generateTotpSecret();
    const [user] = await db
      .insert(users)
      .values({ email: s.email, name: s.name, role: 'student', totpSecret: secret, totpVerified: true })
      .returning();

    await db.insert(studentProfiles).values({
      userId: user.id,
      studentNumber: s.num,
      englishProficiency: s.prof,
    });

    secrets.push({ name: s.name, email: s.email, secret });
    console.log(`  created: ${s.name}`);
  }

  // ── Enrol every student in every module ───────────────────────────────────
  const allStudents = await db.select().from(users).where(eq(users.role, 'student'));
  const allModules  = await db.select().from(modules);

  for (const student of allStudents) {
    for (const mod of allModules) {
      await db
        .insert(moduleEnrollments)
        .values({ studentId: student.id, moduleId: mod.id })
        .onConflictDoNothing();
    }
  }
  console.log(`\nEnrolled ${allStudents.length} students across ${allModules.length} modules.`);

  // ── Print TOTP secrets for new students ───────────────────────────────────
  if (secrets.length) {
    console.log('\n── New student TOTP secrets (share with students to set up authenticator) ──');
    for (const s of secrets) {
      console.log(`  ${s.name.padEnd(22)} ${s.email.padEnd(28)} ${s.secret}`);
    }
  }

  console.log('\nDone.');
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
