/**
 * Resets all sample students to sc0001–sc0025@leeds.ac.uk,
 * creates a completed MATH201 session with the 20-slide PDF,
 * and seeds realistic random feedback data for the post-lecture report.
 */
import { config } from 'dotenv';
config({ override: true });

import { db } from './index.js';
import {
  users, studentProfiles, modules, moduleEnrollments,
  sessions, sessionParticipants, feedbackEvents, questions,
} from './schema.js';
import { generateTotpSecret } from '../lib/totp.js';
import { eq, inArray } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';

// ── Helpers ───────────────────────────────────────────────────────────────────

function rng(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function weightedEmoji(weights: { got_it: number; neutral: number; confused: number; lost: number }) {
  const total = weights.got_it + weights.neutral + weights.confused + weights.lost;
  const r = Math.random() * total;
  let acc = 0;
  for (const [k, w] of Object.entries(weights) as [string, number][]) {
    acc += w;
    if (r < acc) return k as 'got_it' | 'neutral' | 'confused' | 'lost';
  }
  return 'neutral' as const;
}

// ── Student definitions ───────────────────────────────────────────────────────

const NAMES = [
  'Aisha Rahman', 'Ben Whitfield', 'Chloe Davies', 'Daniel Okafor', 'Emma Johnson',
  'Faisal Al-Amin', 'Grace Kim', 'Harry Singh', 'Isabel Torres', 'James Nguyen',
  'Kiran Patel', 'Laura Martinez', 'Marcus Brown', 'Nadia Kowalski', 'Oliver Hughes',
  'Priya Sharma', 'Qasim Ali', 'Rosa Fernandez', 'Sam Fletcher', 'Tanya Ivanova',
  'Usman Chaudhry', 'Victoria Chen', 'William Park', 'Xinyu Zhang', 'Yasmin El-Sayed',
];

const PROFICIENCIES = [
  'native', 'native', 'native', 'fluent', 'native',
  'intermediate', 'fluent', 'native', 'intermediate', 'fluent',
  'native', 'intermediate', 'native', 'intermediate', 'native',
  'fluent', 'fluent', 'intermediate', 'native', 'beginner',
  'fluent', 'native', 'native', 'intermediate', 'fluent',
] as const;

// ── Slide weights (20 slides) — simulates a realistic lecture ─────────────────

const SLIDE_WEIGHTS = [
  { got_it: 75, neutral: 18, confused:  5, lost: 2  }, // 1  — easy intro
  { got_it: 70, neutral: 20, confused:  8, lost: 2  }, // 2
  { got_it: 65, neutral: 22, confused: 10, lost: 3  }, // 3
  { got_it: 60, neutral: 20, confused: 15, lost: 5  }, // 4  — getting harder
  { got_it: 55, neutral: 22, confused: 17, lost: 6  }, // 5
  { got_it: 72, neutral: 18, confused:  8, lost: 2  }, // 6  — example slide, easy
  { got_it: 50, neutral: 20, confused: 22, lost: 8  }, // 7  — new concept
  { got_it: 30, neutral: 18, confused: 30, lost: 22 }, // 8  — hard concept
  { got_it: 28, neutral: 15, confused: 33, lost: 24 }, // 9  — hardest slide
  { got_it: 45, neutral: 22, confused: 22, lost: 11 }, // 10 — slight recovery
  { got_it: 60, neutral: 20, confused: 14, lost: 6  }, // 11 — recap
  { got_it: 65, neutral: 20, confused: 12, lost: 3  }, // 12
  { got_it: 55, neutral: 22, confused: 18, lost: 5  }, // 13
  { got_it: 48, neutral: 20, confused: 24, lost: 8  }, // 14
  { got_it: 50, neutral: 20, confused: 22, lost: 8  }, // 15
  { got_it: 68, neutral: 20, confused: 10, lost: 2  }, // 16 — worked example
  { got_it: 72, neutral: 18, confused:  8, lost: 2  }, // 17
  { got_it: 78, neutral: 15, confused:  6, lost: 1  }, // 18 — summary
  { got_it: 80, neutral: 14, confused:  5, lost: 1  }, // 19
  { got_it: 97, neutral:  2, confused:  1, lost: 0  }, // 20 — wrap-up
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  // 1. Remove old sample students (sc23xx@leeds.ac.uk)
  const oldStudents = await db.select().from(users).where(eq(users.role, 'student'));
  if (oldStudents.length) {
    const ids = oldStudents.map((u) => u.id);
    await db.delete(users).where(inArray(users.id, ids));
    console.log(`Removed ${oldStudents.length} old student accounts`);
  }

  // 2. Create new students sc0001–sc0025@leeds.ac.uk
  const createdStudents: { id: string; name: string; email: string }[] = [];

  for (let i = 1; i <= 25; i++) {
    const num = String(i).padStart(4, '0');
    const email = `sc${num}@leeds.ac.uk`;
    const name = NAMES[i - 1];
    const secret = generateTotpSecret();
    const proficiency = PROFICIENCIES[i - 1];

    const [user] = await db
      .insert(users)
      .values({ email, name, role: 'student', totpSecret: secret, totpVerified: true })
      .returning();

    await db.insert(studentProfiles).values({
      userId: user.id,
      studentNumber: `20190${String(i).padStart(4, '0')}`,
      englishProficiency: proficiency,
    });

    createdStudents.push({ id: user.id, name, email });
    process.stdout.write(`  created: ${email} (${name})\n`);
  }

  // 3. Ensure both modules exist
  const lecturer = (await db.select().from(users).where(eq(users.role, 'lecturer')))[0];
  if (!lecturer) { console.error('No lecturer found'); process.exit(1); }

  let comp101 = (await db.select().from(modules).where(eq(modules.code, 'COMP101')))[0];
  if (!comp101) {
    [comp101] = await db.insert(modules).values({ code: 'COMP101', name: 'Introduction to Computing', lecturerId: lecturer.id }).returning();
  }
  let math201 = (await db.select().from(modules).where(eq(modules.code, 'MATH201')))[0];
  if (!math201) {
    [math201] = await db.insert(modules).values({ code: 'MATH201', name: 'Linear Algebra & Applications', lecturerId: lecturer.id }).returning();
  }

  // 4. Enrol all students in both modules
  for (const student of createdStudents) {
    for (const mod of [comp101, math201]) {
      await db.insert(moduleEnrollments).values({ studentId: student.id, moduleId: mod.id }).onConflictDoNothing();
    }
  }
  console.log(`\nEnrolled 25 students in COMP101 + MATH201`);

  // 5. Create a completed MATH201 session using the 20-slide PDF
  const uploadsDir = process.env.UPLOADS_DIR ?? './uploads';
  const allSessions = await db.select().from(sessions);
  const twentySlideSession = allSessions.find((s) => s.totalSlides === 20);
  if (!twentySlideSession?.pdfPath) {
    console.log('\nNo 20-slide PDF found — skipping feedback seeding.');
    process.exit(0);
  }

  // Copy PDF to new session
  const newSessionId = crypto.randomUUID();
  const srcPdf = twentySlideSession.pdfPath;
  const destPdf = path.join(uploadsDir, `session-${newSessionId}.pdf`);
  fs.copyFileSync(srcPdf, destPdf);

  const sessionStart = new Date(Date.now() - 90 * 60 * 1000); // 90 min ago
  const sessionEnd   = new Date(Date.now() - 5 * 60 * 1000);  // 5 min ago

  await db.insert(sessions).values({
    id: newSessionId,
    moduleId: math201.id,
    title: 'Week 1 — Vectors & Matrices',
    status: 'ended',
    currentSlideIndex: 19,
    totalSlides: 20,
    pdfPath: destPdf,
    startedAt: sessionStart,
    endedAt: sessionEnd,
  });
  console.log(`\nCreated completed session: Week 1 — Vectors & Matrices (MATH201)`);

  // 6. Seed session participants (all 25 students attended)
  for (const student of createdStudents) {
    await db.insert(sessionParticipants).values({
      sessionId: newSessionId,
      studentId: student.id,
      joinedAt: new Date(sessionStart.getTime() + rng(0, 5 * 60 * 1000)),
      leftAt: sessionEnd,
    });
  }

  // 7. Seed feedback events per slide per student
  let totalEvents = 0;
  for (let slideIdx = 0; slideIdx < 20; slideIdx++) {
    const weights = SLIDE_WEIGHTS[slideIdx];
    // ~85% of students respond on each slide
    const respondingStudents = createdStudents.filter(() => Math.random() < 0.85);

    for (const student of respondingStudents) {
      const emoji = weightedEmoji(weights);
      const slideTime = new Date(sessionStart.getTime() + (slideIdx + 1) * 4 * 60 * 1000);

      await db.insert(feedbackEvents).values({
        sessionId: newSessionId,
        studentId: student.id,
        slideIndex: slideIdx,
        emoji,
        selectedAt: slideTime,
        durationMs: rng(15_000, 4 * 60_000),
      });
      totalEvents++;
    }
  }
  console.log(`Seeded ${totalEvents} feedback events across 20 slides`);

  // 8. Seed a few sample questions
  const sampleQuestions = [
    { studentIdx: 2,  slide: 8,  content: 'Could you go over the dot product formula again? I got confused when the dimensions changed.' },
    { studentIdx: 7,  slide: 9,  content: 'Is there a visual way to think about eigenvectors?' },
    { studentIdx: 14, slide: 8,  content: 'Why does the order of multiplication matter for matrices but not scalars?' },
    { studentIdx: 19, slide: 14, content: 'Will this be in the exam?' },
    { studentIdx: 4,  slide: 11, content: 'Can you recommend any extra reading on linear transformations?' },
  ];

  for (const q of sampleQuestions) {
    const student = createdStudents[q.studentIdx];
    const askedAt = new Date(sessionStart.getTime() + q.slide * 4 * 60 * 1000 + rng(30_000, 120_000));
    await db.insert(questions).values({
      sessionId: newSessionId,
      studentId: student.id,
      content: q.content,
      askedAt,
      answered: Math.random() > 0.4,
    });
  }
  console.log('Seeded 5 sample questions');

  // 9. Also create a COMP101 completed session using the 4-slide PDF
  const fourSlideSession = allSessions.find((s) => s.totalSlides === 4);
  if (fourSlideSession?.pdfPath) {
    const newId2 = crypto.randomUUID();
    const dest2  = path.join(uploadsDir, `session-${newId2}.pdf`);
    fs.copyFileSync(fourSlideSession.pdfPath, dest2);
    const s2Start = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const s2End   = new Date(s2Start.getTime() + 50 * 60 * 1000);

    await db.insert(sessions).values({
      id: newId2,
      moduleId: comp101.id,
      title: 'Week 1 — Introduction & Foundations',
      status: 'ended',
      currentSlideIndex: 3,
      totalSlides: 4,
      pdfPath: dest2,
      startedAt: s2Start,
      endedAt: s2End,
    });

    for (const student of createdStudents) {
      await db.insert(sessionParticipants).values({
        sessionId: newId2, studentId: student.id,
        joinedAt: new Date(s2Start.getTime() + rng(0, 3 * 60_000)),
        leftAt: s2End,
      });
    }

    for (let slideIdx = 0; slideIdx < 4; slideIdx++) {
      for (const student of createdStudents.filter(() => Math.random() < 0.9)) {
        const w = { got_it: 70, neutral: 18, confused: 9, lost: 3 };
        await db.insert(feedbackEvents).values({
          sessionId: newId2, studentId: student.id, slideIndex: slideIdx,
          emoji: weightedEmoji(w),
          selectedAt: new Date(s2Start.getTime() + (slideIdx + 1) * 12 * 60_000),
          durationMs: rng(20_000, 12 * 60_000),
        });
      }
    }
    console.log('Created completed COMP101 session with feedback');
  }

  console.log('\n✓ Done. Login with sc0001–sc0025@leeds.ac.uk, code: 123456');
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
