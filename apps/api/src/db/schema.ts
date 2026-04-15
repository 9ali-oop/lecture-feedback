import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['admin', 'lecturer', 'student']);

// Emoji feedback states - intentionally kept to four so students can respond quickly
export const emojiEnum = pgEnum('emoji', ['got_it', 'neutral', 'confused', 'lost']);
export const sessionStatusEnum = pgEnum('session_status', ['scheduled', 'live', 'ended']);
export const englishProficiencyEnum = pgEnum('english_proficiency', [
  'native',
  'fluent',
  'intermediate',
  'beginner',
]);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  role: roleEnum('role').notNull(),
  totpSecret: text('totp_secret').notNull(),
  totpVerified: boolean('totp_verified').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const studentProfiles = pgTable('student_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  studentNumber: text('student_number').notNull().unique(),
  englishProficiency: englishProficiencyEnum('english_proficiency').notNull().default('native'),
});

export const modules = pgTable('modules', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#1e3a5f'),
  lecturerId: uuid('lecturer_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const moduleEnrollments = pgTable('module_enrollments', {
  studentId: uuid('student_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  moduleId: uuid('module_id')
    .notNull()
    .references(() => modules.id, { onDelete: 'cascade' }),
  enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('module_enrollments_student_module').on(t.studentId, t.moduleId),
]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  moduleId: uuid('module_id')
    .notNull()
    .references(() => modules.id),
  title: text('title').notNull(),
  status: sessionStatusEnum('status').notNull().default('scheduled'),
  currentSlideIndex: integer('current_slide_index').notNull().default(0),
  totalSlides: integer('total_slides').notNull().default(0),
  pdfPath: text('pdf_path'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const sessionParticipants = pgTable('session_participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id),
  studentId: uuid('student_id')
    .notNull()
    .references(() => users.id),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  leftAt: timestamp('left_at', { withTimezone: true }),
}, (t) => [
  index('session_participants_session_idx').on(t.sessionId),
  unique('session_participants_session_student').on(t.sessionId, t.studentId),
]);

export const feedbackEvents = pgTable('feedback_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id),
  studentId: uuid('student_id')
    .notNull()
    .references(() => users.id),
  slideIndex: integer('slide_index').notNull(),
  emoji: emojiEnum('emoji').notNull(),
  selectedAt: timestamp('selected_at', { withTimezone: true }).notNull().defaultNow(),
  durationMs: integer('duration_ms'),
}, (t) => [
  index('feedback_events_session_idx').on(t.sessionId),
]);

export const questions = pgTable('questions', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id),
  studentId: uuid('student_id')
    .notNull()
    .references(() => users.id),
  content: text('content').notNull(),
  slideIndex: integer('slide_index'),          // which slide was shown when asked
  askedAt: timestamp('asked_at', { withTimezone: true }).notNull().defaultNow(),
  answered: boolean('answered').notNull().default(false),
  answeredAt: timestamp('answered_at', { withTimezone: true }),
}, (t) => [
  index('questions_session_idx').on(t.sessionId),
]);

export const slideTimings = pgTable('slide_timings', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id),
  slideIndex: integer('slide_index').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),              // null = currently active
}, (t) => [
  index('slide_timings_session_idx').on(t.sessionId),
]);

export const slideWhiteboards = pgTable('slide_whiteboards', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id),
  slideIndex: integer('slide_index').notNull(),
  imagePath: text('image_path').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const slideAnnotations = pgTable('slide_annotations', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id),
  slideIndex: integer('slide_index').notNull(),
  imagePath: text('image_path').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const confusionContexts = pgTable('confusion_contexts', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id),
  studentId: uuid('student_id')
    .notNull()
    .references(() => users.id),
  slideIndex: integer('slide_index').notNull(),
  emoji: emojiEnum('emoji').notNull(),
  highlightData: jsonb('highlight_data'),
  explanation: text('explanation'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Quick Polls ──────────────────────────────────────────────────────────────

export const pollStatusEnum = pgEnum('poll_status', ['active', 'closed']);

export const polls = pgTable('polls', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id),
  slideIndex: integer('slide_index').notNull(),
  question: text('question').notNull(),
  options: jsonb('options').notNull(), // string[]
  isTrueFalse: boolean('is_true_false').notNull().default(false),
  status: pollStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
});

export const pollResponses = pgTable('poll_responses', {
  id: uuid('id').primaryKey().defaultRandom(),
  pollId: uuid('poll_id')
    .notNull()
    .references(() => polls.id),
  studentId: uuid('student_id')
    .notNull()
    .references(() => users.id),
  optionIndex: integer('option_index').notNull(),
  respondedAt: timestamp('responded_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('poll_responses_poll_student').on(t.pollId, t.studentId),
]);

// ── Question Upvotes ────────────────────────────────────────────────────────

export const questionUpvotes = pgTable('question_upvotes', {
  id: uuid('id').primaryKey().defaultRandom(),
  questionId: uuid('question_id')
    .notNull()
    .references(() => questions.id, { onDelete: 'cascade' }),
  studentId: uuid('student_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('question_upvotes_question_student').on(t.questionId, t.studentId),
]);

// ── Pace Feedback ───────────────────────────────────────────────────────────

export const paceEnum = pgEnum('pace', ['slow', 'ok', 'fast']);

export const paceFeedback = pgTable('pace_feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id),
  studentId: uuid('student_id')
    .notNull()
    .references(() => users.id),
  value: paceEnum('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('pace_feedback_session_student').on(t.sessionId, t.studentId),
]);

// ── Post-Lecture Reflections ─────────────────────────────────────────────────

export const reflections = pgTable('reflections', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id),
  studentId: uuid('student_id')
    .notNull()
    .references(() => users.id),
  mostImportant: text('most_important').notNull().default(''),
  stillUnclear: text('still_unclear').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique('reflections_session_student').on(t.sessionId, t.studentId),
]);

export const slideNotes = pgTable('slide_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id')
    .notNull()
    .references(() => sessions.id),
  studentId: uuid('student_id')
    .notNull()
    .references(() => users.id),
  slideIndex: integer('slide_index').notNull(),
  content: text('content').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('slide_notes_session_student_idx').on(t.sessionId, t.studentId),
]);
