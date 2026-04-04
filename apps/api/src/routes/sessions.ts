import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq, and, count } from 'drizzle-orm';
import { db } from '../db/index.js';
import { sessions, modules, moduleEnrollments, feedbackEvents, sessionParticipants, slideTimings, questions, users, slideWhiteboards, slideAnnotations, slideNotes, confusionContexts, questionUpvotes } from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import { savePdf, readPdf, saveWhiteboard, readWhiteboard, saveAnnotation, readAnnotation } from '../lib/storage.js';
import { sessionManager } from '../ws/session-manager.js';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import type { SlideReport, FeedbackDistribution } from '@lecture-feedback/shared';
import { generateRecommendations } from '../lib/recommendations.js';

const router = new Hono();

router.use('*', requireAuth());

/** Check that the current user may access the given session's module. */
async function requireSessionAccess(
  sessionModuleId: string,
  role: string,
  sub: string,
): Promise<{ ok: true } | { ok: false; status: 403 | 404; message: string }> {
  const mod = (await db.select().from(modules).where(eq(modules.id, sessionModuleId)))[0];
  if (!mod) return { ok: false, status: 404, message: 'Module not found' };
  if (role === 'admin') return { ok: true };
  if (role === 'lecturer') {
    if (mod.lecturerId !== sub) return { ok: false, status: 403, message: 'Forbidden' };
    return { ok: true };
  }
  // student -- must be enrolled
  const enrollment = await db
    .select()
    .from(moduleEnrollments)
    .where(and(eq(moduleEnrollments.moduleId, sessionModuleId), eq(moduleEnrollments.studentId, sub)));
  if (enrollment.length === 0) return { ok: false, status: 403, message: 'Forbidden' };
  return { ok: true };
}

// List sessions for a module
router.get('/module/:moduleId', async (c) => {
  const { sub, role } = c.get('jwtPayload');
  const { moduleId } = c.req.param();

  const access = await requireSessionAccess(moduleId, role, sub);
  if (!access.ok) return c.json({ error: access.message }, access.status);

  const rows = await db
    .select({
      id: sessions.id,
      moduleId: sessions.moduleId,
      title: sessions.title,
      status: sessions.status,
      currentSlideIndex: sessions.currentSlideIndex,
      totalSlides: sessions.totalSlides,
      pdfPath: sessions.pdfPath,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(eq(sessions.moduleId, moduleId));

  const mod = (await db.select().from(modules).where(eq(modules.id, moduleId)))[0];

  return c.json(
    rows.map((s) => ({
      id: s.id,
      moduleId: s.moduleId,
      moduleName: mod?.name ?? '',
      moduleCode: mod?.code ?? '',
      moduleColor: mod?.color ?? '#1e3a5f',
      title: s.title,
      status: s.status,
      currentSlideIndex: s.currentSlideIndex,
      totalSlides: s.totalSlides,
      hasPdf: !!s.pdfPath,
      startedAt: s.startedAt?.toISOString() ?? null,
      endedAt: s.endedAt?.toISOString() ?? null,
      createdAt: s.createdAt.toISOString(),
    })),
  );
});

// Get single session
router.get('/:id', async (c) => {
  const { sub, role } = c.get('jwtPayload');
  const { id } = c.req.param();
  const session = (await db.select().from(sessions).where(eq(sessions.id, id)))[0];
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const access = await requireSessionAccess(session.moduleId, role, sub);
  if (!access.ok) return c.json({ error: access.message }, access.status);

  const mod = (await db.select().from(modules).where(eq(modules.id, session.moduleId)))[0];

  return c.json({
    id: session.id,
    moduleId: session.moduleId,
    moduleName: mod?.name ?? '',
    moduleCode: mod?.code ?? '',
    moduleColor: mod?.color ?? '#1e3a5f',
    title: session.title,
    status: session.status,
    currentSlideIndex: session.currentSlideIndex,
    totalSlides: session.totalSlides,
    hasPdf: !!session.pdfPath,
    startedAt: session.startedAt?.toISOString() ?? null,
    endedAt: session.endedAt?.toISOString() ?? null,
    createdAt: session.createdAt.toISOString(),
  });
});

// Create session (lecturer only)
router.post(
  '/',
  requireAuth('lecturer', 'admin'),
  zValidator('json', z.object({ moduleId: z.string().uuid(), title: z.string().min(1) })),
  async (c) => {
    const { moduleId, title } = c.req.valid('json');
    const { sub } = c.get('jwtPayload');

    const mod = (await db.select().from(modules).where(eq(modules.id, moduleId)))[0];
    if (!mod) return c.json({ error: 'Module not found' }, 404);
    if (mod.lecturerId !== sub) return c.json({ error: 'Forbidden' }, 403);

    const [session] = await db
      .insert(sessions)
      .values({ moduleId, title })
      .returning();

    return c.json({ id: session.id, title: session.title, status: session.status }, 201);
  },
);

// Upload PDF for a session
router.post('/:id/pdf', requireAuth('lecturer', 'admin'), async (c) => {
  const { id } = c.req.param();
  const session = (await db.select().from(sessions).where(eq(sessions.id, id)))[0];
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const body = await c.req.parseBody();
  const file = body['file'];

  if (!file || typeof file === 'string') {
    return c.json({ error: 'No PDF file uploaded' }, 400);
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const filePath = await savePdf(id, buffer);

  await db.update(sessions).set({ pdfPath: filePath }).where(eq(sessions.id, id));

  return c.json({ ok: true });
});

// Serve PDF
router.get('/:id/pdf', async (c) => {
  const { sub, role } = c.get('jwtPayload');
  const { id } = c.req.param();

  const session = (await db.select().from(sessions).where(eq(sessions.id, id)))[0];
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const access = await requireSessionAccess(session.moduleId, role, sub);
  if (!access.ok) return c.json({ error: access.message }, access.status);

  const pdfBuffer = await readPdf(id);
  if (!pdfBuffer) return c.json({ error: 'PDF not found' }, 404);

  return new Response(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline',
    },
  });
});

// Start session (lecturer only)
router.post('/:id/start', requireAuth('lecturer', 'admin'), async (c) => {
  const { sub, role } = c.get('jwtPayload');
  const { id } = c.req.param();
  const session = (await db.select().from(sessions).where(eq(sessions.id, id)))[0];
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const access = await requireSessionAccess(session.moduleId, role, sub);
  if (!access.ok) return c.json({ error: access.message }, access.status);

  if (session.status === 'live') return c.json({ error: 'Already live' }, 409);

  await db.update(sessions).set({ status: 'live', startedAt: new Date() }).where(eq(sessions.id, id));

  sessionManager.scheduleAutoEnd(id, 90);

  return c.json({ ok: true });
});

// End session (lecturer only)
router.post('/:id/end', requireAuth('lecturer', 'admin'), async (c) => {
  const { sub, role } = c.get('jwtPayload');
  const { id } = c.req.param();
  const session = (await db.select().from(sessions).where(eq(sessions.id, id)))[0];
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const access = await requireSessionAccess(session.moduleId, role, sub);
  if (!access.ok) return c.json({ error: access.message }, access.status);

  await sessionManager.endSession(id);
  return c.json({ ok: true });
});

// Update slide count (called when PDF is loaded in browser)
router.patch(
  '/:id/slides',
  requireAuth('lecturer', 'admin'),
  zValidator('json', z.object({ totalSlides: z.number().int().min(1) })),
  async (c) => {
    const { id } = c.req.param();
    const { totalSlides } = c.req.valid('json');
    await db.update(sessions).set({ totalSlides }).where(eq(sessions.id, id));
    sessionManager.setTotalSlides(id, totalSlides);
    return c.json({ ok: true });
  },
);

// Save whiteboards (batch — called when session ends)
router.post(
  '/:id/whiteboards',
  requireAuth('lecturer', 'admin'),
  zValidator('json', z.object({
    slides: z.array(z.object({
      slideIndex: z.number().int().min(0),
      imageData: z.string(), // base64 PNG (data:image/png;base64,...)
    })),
  })),
  async (c) => {
    const { id } = c.req.param();
    const { slides } = c.req.valid('json');

    for (const { slideIndex, imageData } of slides) {
      // Strip data URL prefix
      const base64 = imageData.replace(/^data:image\/png;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const imagePath = await saveWhiteboard(id, slideIndex, buffer);

      // Upsert: delete existing then insert
      await db.delete(slideWhiteboards).where(
        and(eq(slideWhiteboards.sessionId, id), eq(slideWhiteboards.slideIndex, slideIndex)),
      );
      await db.insert(slideWhiteboards).values({ sessionId: id, slideIndex, imagePath });
    }

    return c.json({ ok: true, saved: slides.length });
  },
);

// Serve a whiteboard image
router.get('/:id/whiteboards/:slideIndex', async (c) => {
  const { sub, role } = c.get('jwtPayload');
  const { id, slideIndex } = c.req.param();

  const session = (await db.select().from(sessions).where(eq(sessions.id, id)))[0];
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const access = await requireSessionAccess(session.moduleId, role, sub);
  if (!access.ok) return c.json({ error: access.message }, access.status);

  const buffer = await readWhiteboard(id, parseInt(slideIndex, 10));
  if (!buffer) return c.json({ error: 'Whiteboard not found' }, 404);

  return new Response(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
  });
});

// Save annotations (batch)
router.post(
  '/:id/annotations',
  requireAuth('lecturer', 'admin'),
  zValidator('json', z.object({
    slides: z.array(z.object({
      slideIndex: z.number().int().min(0),
      imageData: z.string(),
    })),
  })),
  async (c) => {
    const { id } = c.req.param();
    const { slides } = c.req.valid('json');
    for (const { slideIndex, imageData } of slides) {
      const base64 = imageData.replace(/^data:image\/png;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');
      const imagePath = await saveAnnotation(id, slideIndex, buffer);
      await db.delete(slideAnnotations).where(
        and(eq(slideAnnotations.sessionId, id), eq(slideAnnotations.slideIndex, slideIndex)),
      );
      await db.insert(slideAnnotations).values({ sessionId: id, slideIndex, imagePath });
    }
    return c.json({ ok: true, saved: slides.length });
  },
);

// Serve an annotation image
router.get('/:id/annotations/:slideIndex', async (c) => {
  const { sub, role } = c.get('jwtPayload');
  const { id, slideIndex } = c.req.param();

  const session = (await db.select().from(sessions).where(eq(sessions.id, id)))[0];
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const access = await requireSessionAccess(session.moduleId, role, sub);
  if (!access.ok) return c.json({ error: access.message }, access.status);

  const buffer = await readAnnotation(id, parseInt(slideIndex, 10));
  if (!buffer) return c.json({ error: 'Annotation not found' }, 404);
  return new Response(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
  });
});

// Download session report as PDF
router.get('/:id/report/pdf', async (c) => {
  const { sub, role } = c.get('jwtPayload');
  const { id } = c.req.param();
  const annotations = c.req.query('annotations') === 'true';
  const session = (await db.select().from(sessions).where(eq(sessions.id, id)))[0];
  if (!session) return c.json({ error: 'Session not found' }, 404);
  if (!session.pdfPath) return c.json({ error: 'No PDF uploaded' }, 404);

  const access = await requireSessionAccess(session.moduleId, role, sub);
  if (!access.ok) return c.json({ error: access.message }, access.status);

  const pdfBuffer = await readPdf(id);
  if (!pdfBuffer) return c.json({ error: 'PDF file not found' }, 404);
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageCount = pdfDoc.getPageCount();
  const annotationImages = new Map<number, Uint8Array>();
  if (annotations) {
    const aRows = await db.select().from(slideAnnotations).where(eq(slideAnnotations.sessionId, id));
    for (const row of aRows) {
      const buf = await readAnnotation(id, row.slideIndex);
      if (buf) annotationImages.set(row.slideIndex, new Uint8Array(buf));
    }
  }
  const notesBySlide = new Map<number, string[]>();
  if (role === 'student') {
    const notes = await db.select().from(slideNotes)
      .where(and(eq(slideNotes.sessionId, id), eq(slideNotes.studentId, sub)));
    for (const n of notes) {
      if (n.content.trim()) {
        if (!notesBySlide.has(n.slideIndex)) notesBySlide.set(n.slideIndex, []);
        notesBySlide.get(n.slideIndex)!.push(n.content);
      }
    }
  } else {
    const notes = await db.select({ slideIndex: slideNotes.slideIndex, content: slideNotes.content })
      .from(slideNotes).where(eq(slideNotes.sessionId, id));
    for (const n of notes) {
      if (n.content.trim()) {
        if (!notesBySlide.has(n.slideIndex)) notesBySlide.set(n.slideIndex, []);
        notesBySlide.get(n.slideIndex)!.push(n.content);
      }
    }
  }
  let insertOffset = 0;
  for (let i = 0; i < pageCount; i++) {
    const pageIdx = i + insertOffset;
    const page = pdfDoc.getPage(pageIdx);
    const { width, height } = page.getSize();
    if (annotations && annotationImages.has(i)) {
      const pngImage = await pdfDoc.embedPng(annotationImages.get(i)!);
      page.drawImage(pngImage, { x: 0, y: 0, width, height });
    }
    const slideNotesList = notesBySlide.get(i);
    if (slideNotesList && slideNotesList.length > 0) {
      const notesPage = pdfDoc.insertPage(pageIdx + 1, [width, height]);
      insertOffset++;
      let y = height - 50;
      const headerText = role === 'student' ? `My Notes — Slide ${i + 1}` : `Student Notes — Slide ${i + 1}`;
      notesPage.drawText(headerText, { x: 50, y, size: 18, font: boldFont, color: rgb(0.1, 0.1, 0.1) });
      y -= 35;
      for (const note of slideNotesList) {
        const bulletText = `• ${note}`;
        const lines: string[] = [];
        const words = bulletText.split(' ');
        let currentLine = '';
        for (const word of words) {
          const test = currentLine ? `${currentLine} ${word}` : word;
          if (font.widthOfTextAtSize(test, 11) > width - 100) {
            if (currentLine) lines.push(currentLine);
            currentLine = `  ${word}`;
          } else { currentLine = test; }
        }
        if (currentLine) lines.push(currentLine);
        for (const line of lines) {
          if (y < 50) break;
          notesPage.drawText(line, { x: 50, y, size: 11, font, color: rgb(0.2, 0.2, 0.2) });
          y -= 18;
        }
        y -= 8;
      }
    }
  }
  const outputBytes = await pdfDoc.save();
  return new Response(Buffer.from(outputBytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="report-${id}.pdf"` },
  });
});

// Session report
router.get('/:id/report', async (c) => {
  const { sub, role } = c.get('jwtPayload');
  const { id } = c.req.param();
  const session = (await db.select().from(sessions).where(eq(sessions.id, id)))[0];
  if (!session) return c.json({ error: 'Session not found' }, 404);

  const access = await requireSessionAccess(session.moduleId, role, sub);
  if (!access.ok) return c.json({ error: access.message }, access.status);

  const mod = (await db.select().from(modules).where(eq(modules.id, session.moduleId)))[0];

  const [{ count: enrolledCount }] = await db
    .select({ count: count() })
    .from(moduleEnrollments)
    .where(eq(moduleEnrollments.moduleId, session.moduleId));

  const [{ count: peakParticipants }] = await db
    .select({ count: count() })
    .from(sessionParticipants)
    .where(eq(sessionParticipants.sessionId, id));

  const events = await db.select().from(feedbackEvents).where(eq(feedbackEvents.sessionId, id));

  // Slide timings
  const timings = await db.select().from(slideTimings).where(eq(slideTimings.sessionId, id));
  const timingMap = new Map<number, number>(); // slideIndex -> total seconds
  for (const t of timings) {
    if (t.startedAt && t.endedAt) {
      const secs = Math.round((t.endedAt.getTime() - t.startedAt.getTime()) / 1000);
      timingMap.set(t.slideIndex, (timingMap.get(t.slideIndex) ?? 0) + secs);
    }
  }

  // Questions with student names, grouped by slideIndex
  const questionRows = await db
    .select({
      id: questions.id,
      sessionId: questions.sessionId,
      studentId: questions.studentId,
      studentName: users.name,
      content: questions.content,
      slideIndex: questions.slideIndex,
      askedAt: questions.askedAt,
      answered: questions.answered,
      answeredAt: questions.answeredAt,
    })
    .from(questions)
    .innerJoin(users, eq(questions.studentId, users.id))
    .where(eq(questions.sessionId, id));

  // For questions without a slideIndex, infer from timing data
  const sessionStart = session.startedAt?.getTime() ?? 0;
  const inferSlide = (askedAt: Date): number | null => {
    if (!sessionStart) return null;
    const elapsed = askedAt.getTime() - sessionStart;
    let best: number | null = null;
    let bestDiff = Infinity;
    for (const t of timings) {
      if (!t.startedAt || !t.endedAt) continue;
      const start = t.startedAt.getTime() - sessionStart;
      const end   = t.endedAt.getTime()   - sessionStart;
      if (elapsed >= start && elapsed <= end) return t.slideIndex;
      const diff = Math.min(Math.abs(elapsed - start), Math.abs(elapsed - end));
      if (diff < bestDiff) { bestDiff = diff; best = t.slideIndex; }
    }
    return best;
  };

  const questionsBySlide = new Map<number, typeof questionRows>();
  const unassigned: typeof questionRows = [];
  for (const q of questionRows) {
    const slide = q.slideIndex ?? inferSlide(q.askedAt);
    if (slide !== null) {
      if (!questionsBySlide.has(slide)) questionsBySlide.set(slide, []);
      questionsBySlide.get(slide)!.push(q);
    } else {
      unassigned.push(q);
    }
  }

  // Whiteboards
  const whiteboardRows = await db.select().from(slideWhiteboards).where(eq(slideWhiteboards.sessionId, id));
  const whiteboardSet = new Set(whiteboardRows.map((w) => w.slideIndex));

  // Annotations
  const annotationRows = await db.select().from(slideAnnotations).where(eq(slideAnnotations.sessionId, id));
  const annotationSet = new Set(annotationRows.map((a) => a.slideIndex));

  // Confusion contexts
  const confusionRows = await db
    .select({
      id: confusionContexts.id,
      sessionId: confusionContexts.sessionId,
      studentId: confusionContexts.studentId,
      studentName: users.name,
      slideIndex: confusionContexts.slideIndex,
      emoji: confusionContexts.emoji,
      highlightData: confusionContexts.highlightData,
      explanation: confusionContexts.explanation,
      createdAt: confusionContexts.createdAt,
    })
    .from(confusionContexts)
    .innerJoin(users, eq(confusionContexts.studentId, users.id))
    .where(eq(confusionContexts.sessionId, id));

  const confusionBySlide = new Map<number, typeof confusionRows>();
  for (const cc of confusionRows) {
    if (!confusionBySlide.has(cc.slideIndex)) confusionBySlide.set(cc.slideIndex, []);
    confusionBySlide.get(cc.slideIndex)!.push(cc);
  }

  // Upvote counts per question
  const upvoteCountMap = new Map<string, number>();
  for (const q of questionRows) {
    const [{ count: c }] = await db.select({ count: count() }).from(questionUpvotes).where(eq(questionUpvotes.questionId, q.id));
    upvoteCountMap.set(q.id, Number(c));
  }

  // Feedback distribution per slide
  const slideDistMap = new Map<number, { got_it: number; neutral: number; confused: number; lost: number }>();
  for (let i = 0; i < session.totalSlides; i++) slideDistMap.set(i, { got_it: 0, neutral: 0, confused: 0, lost: 0 });
  for (const ev of events) {
    const d = slideDistMap.get(ev.slideIndex) ?? { got_it: 0, neutral: 0, confused: 0, lost: 0 };
    d[ev.emoji]++;
    slideDistMap.set(ev.slideIndex, d);
  }

  const overallDist: FeedbackDistribution = { got_it: 0, neutral: 0, confused: 0, lost: 0, total: 0 };

  const slides: SlideReport[] = Array.from(slideDistMap.entries()).map(([slideIndex, dist]) => {
    const total = dist.got_it + dist.neutral + dist.confused + dist.lost;
    overallDist.got_it   += dist.got_it;
    overallDist.neutral  += dist.neutral;
    overallDist.confused += dist.confused;
    overallDist.lost     += dist.lost;

    const distribution: FeedbackDistribution = { ...dist, total };
    const confusedPct = total > 0 ? ((dist.confused + dist.lost) / total) * 100 : 0;
    const gotItPct    = total > 0 ? (dist.got_it / total) * 100 : 0;
    const timeSeconds = timingMap.get(slideIndex) ?? null;

    let recommendation = '';
    if (total === 0) {
      recommendation = 'No feedback recorded for this slide.';
    } else if (gotItPct >= 97.5) {
      recommendation = 'Excellent understanding — consider reducing time on this slide.';
    } else if (confusedPct >= 30) {
      recommendation = 'High confusion — add more examples or additional slides to cover this topic.';
    } else if (confusedPct >= 10) {
      recommendation = 'Some confusion detected — consider revisiting this content with examples.';
    } else {
      recommendation = 'Good understanding overall.';
    }

    const slideQuestions = (questionsBySlide.get(slideIndex) ?? []).map((q) => ({
      id: q.id,
      sessionId: q.sessionId,
      studentId: role === 'student' ? 'anonymous' : q.studentId,
      studentName: role === 'student' ? 'Anonymous' : q.studentName,
      content: q.content,
      slideIndex: q.slideIndex ?? slideIndex,
      askedAt: q.askedAt.toISOString(),
      answered: q.answered,
      answeredAt: q.answeredAt?.toISOString() ?? null,
      upvoteCount: upvoteCountMap.get(q.id) ?? 0,
    }));

    const slideConfusion = (confusionBySlide.get(slideIndex) ?? []).map((cc) => ({
      id: cc.id,
      sessionId: cc.sessionId,
      studentId: role === 'student' ? 'anonymous' : cc.studentId,
      studentName: role === 'student' ? 'Anonymous' : cc.studentName,
      slideIndex: cc.slideIndex,
      emoji: cc.emoji as 'confused' | 'lost',
      highlights: (cc.highlightData as any[]) ?? [],
      explanation: cc.explanation,
      createdAt: cc.createdAt.toISOString(),
    }));

    // Compute average time per slide for recommendations
    const allTimes = Array.from(timingMap.values());
    const avgTimePerSlide = allTimes.length > 0 ? allTimes.reduce((a, b) => a + b, 0) / allTimes.length : null;

    const smartRecommendations = generateRecommendations({
      slideIndex,
      totalSlides: session.totalSlides,
      distribution,
      timeSeconds,
      avgTimePerSlide,
      questions: slideQuestions.map((q) => ({ content: q.content, answered: q.answered })),
      confusionContexts: slideConfusion.map((cc) => ({
        highlights: cc.highlights,
        explanation: cc.explanation,
        emoji: cc.emoji,
      })),
    });

    return { slideIndex, distribution, recommendation, smartRecommendations, timeSeconds, questions: slideQuestions, hasWhiteboard: whiteboardSet.has(slideIndex), hasAnnotation: annotationSet.has(slideIndex), confusionContexts: slideConfusion };
  });

  overallDist.total = overallDist.got_it + overallDist.neutral + overallDist.confused + overallDist.lost;

  return c.json({
    session: {
      id: session.id,
      moduleId: session.moduleId,
      moduleName: mod?.name ?? '',
      moduleCode: mod?.code ?? '',
      moduleColor: mod?.color ?? '#1e3a5f',
      title: session.title,
      status: session.status,
      currentSlideIndex: session.currentSlideIndex,
      totalSlides: session.totalSlides,
      hasPdf: !!session.pdfPath,
      startedAt: session.startedAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
      createdAt: session.createdAt.toISOString(),
    },
    totalEnrolled: Number(enrolledCount),
    peakParticipants: Number(peakParticipants),
    slides,
    overallDistribution: overallDist,
  });
});

// Engagement timeline — 30-second buckets of activity metrics
router.get('/:id/timeline', requireAuth('lecturer', 'admin'), async (c) => {
  const { id } = c.req.param();
  const session = (await db.select().from(sessions).where(eq(sessions.id, id)))[0];
  if (!session || !session.startedAt) return c.json([]);

  const startMs = session.startedAt.getTime();
  const endMs = session.endedAt?.getTime() ?? Date.now();
  const bucketSize = 30_000; // 30 seconds

  // Fetch all data
  const events = await db.select().from(feedbackEvents).where(eq(feedbackEvents.sessionId, id));
  const qRows = await db.select().from(questions).where(eq(questions.sessionId, id));
  const timings = await db.select().from(slideTimings).where(eq(slideTimings.sessionId, id));

  // Build buckets
  const buckets = [];
  for (let t = startMs; t < endMs; t += bucketSize) {
    const bucketEnd = t + bucketSize;

    // Which slide was active during this bucket
    let slideIndex = 0;
    for (const timing of timings) {
      if (timing.startedAt && timing.startedAt.getTime() <= t) {
        slideIndex = timing.slideIndex;
      }
    }

    // Feedback events in this bucket
    const bucketEvents = events.filter((e) => {
      const eTime = e.selectedAt.getTime();
      return eTime >= t && eTime < bucketEnd;
    });
    const confused = bucketEvents.filter((e) => e.emoji === 'confused' || e.emoji === 'lost').length;
    const total = bucketEvents.length;

    // Questions in this bucket
    const bucketQuestions = qRows.filter((q) => {
      const qTime = q.askedAt.getTime();
      return qTime >= t && qTime < bucketEnd;
    });

    buckets.push({
      timestamp: new Date(t).toISOString(),
      slideIndex,
      confusedPct: total > 0 ? Math.round((confused / total) * 100) : 0,
      responseCount: total,
      questionCount: bucketQuestions.length,
      paceSlow: 0,
      paceOk: 0,
      paceFast: 0,
    });
  }

  return c.json(buckets);
});

export default router;
