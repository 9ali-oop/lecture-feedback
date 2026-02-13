import { Hono } from 'hono';
import { eq, count, and, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  modules, moduleEnrollments, sessions, sessionParticipants,
  feedbackEvents, questions, confusionContexts, reflections,
  users, studentProfiles,
} from '../db/schema.js';
import { requireAuth } from '../middleware/auth.js';
import type { StudentEngagement, ModuleAnalytics } from '@lecture-feedback/shared';

const router = new Hono();
router.use('*', requireAuth('lecturer', 'admin'));

router.get('/module/:moduleId', async (c) => {
  const { moduleId } = c.req.param();

  // All sessions for this module
  const allSessions = await db.select().from(sessions).where(eq(sessions.moduleId, moduleId));
  const sessionIds = allSessions.map((s) => s.id);
  const totalSessions = allSessions.filter((s) => s.status === 'ended').length;

  if (sessionIds.length === 0) {
    return c.json({ moduleId, totalStudents: 0, totalSessions: 0, classAverageEngagement: 0, students: [] });
  }

  // All enrolled students
  const enrollments = await db
    .select({
      studentId: moduleEnrollments.studentId,
      name: users.name,
      studentNumber: studentProfiles.studentNumber,
    })
    .from(moduleEnrollments)
    .innerJoin(users, eq(moduleEnrollments.studentId, users.id))
    .leftJoin(studentProfiles, eq(moduleEnrollments.studentId, studentProfiles.userId))
    .where(eq(moduleEnrollments.moduleId, moduleId));

  const sessionIdSet = new Set(sessionIds);

  // Per-student metrics (batch queries)
  const participationRows = await db.select().from(sessionParticipants)
    .where(sql`${sessionParticipants.sessionId} = ANY(${sql`ARRAY[${sql.join(sessionIds.map(id => sql`${id}::uuid`), sql`, `)}]`})`);

  const feedbackRows = await db.select().from(feedbackEvents)
    .where(sql`${feedbackEvents.sessionId} = ANY(${sql`ARRAY[${sql.join(sessionIds.map(id => sql`${id}::uuid`), sql`, `)}]`})`);

  const questionRows = await db.select().from(questions)
    .where(sql`${questions.sessionId} = ANY(${sql`ARRAY[${sql.join(sessionIds.map(id => sql`${id}::uuid`), sql`, `)}]`})`);

  const confusionRows = await db.select().from(confusionContexts)
    .where(sql`${confusionContexts.sessionId} = ANY(${sql`ARRAY[${sql.join(sessionIds.map(id => sql`${id}::uuid`), sql`, `)}]`})`);

  const reflectionRows = await db.select().from(reflections)
    .where(sql`${reflections.sessionId} = ANY(${sql`ARRAY[${sql.join(sessionIds.map(id => sql`${id}::uuid`), sql`, `)}]`})`);

  // Aggregate per student
  const students: StudentEngagement[] = enrollments.map((e) => {
    const sid = e.studentId;
    const attended = new Set(participationRows.filter((p) => p.studentId === sid).map((p) => p.sessionId)).size;
    const feedback = feedbackRows.filter((f) => f.studentId === sid).length;
    const questionsCount = questionRows.filter((q) => q.studentId === sid).length;
    const confusion = confusionRows.filter((cc) => cc.studentId === sid).length;
    const reflectionCount = reflectionRows.filter((r) => r.studentId === sid).length;

    // Engagement score: weighted combination
    const attendanceScore = totalSessions > 0 ? (attended / totalSessions) * 40 : 0;
    const feedbackScore = Math.min(feedback / Math.max(totalSessions * 3, 1), 1) * 25;
    const questionScore = Math.min(questionsCount / Math.max(totalSessions, 1), 1) * 20;
    const reflectionScore = totalSessions > 0 ? (reflectionCount / totalSessions) * 15 : 0;
    const score = Math.round(attendanceScore + feedbackScore + questionScore + reflectionScore);

    return {
      studentId: sid,
      studentName: e.name,
      studentNumber: e.studentNumber ?? '',
      sessionsAttended: attended,
      totalSessions,
      feedbackGiven: feedback,
      questionsAsked: questionsCount,
      confusionReports: confusion,
      reflectionsSubmitted: reflectionCount,
      engagementScore: Math.min(100, score),
    };
  });

  const avgEngagement = students.length > 0
    ? Math.round(students.reduce((sum, s) => sum + s.engagementScore, 0) / students.length)
    : 0;

  return c.json({
    moduleId,
    totalStudents: students.length,
    totalSessions,
    classAverageEngagement: avgEngagement,
    students: students.sort((a, b) => a.engagementScore - b.engagementScore), // lowest first to highlight disengaged
  });
});

export default router;
