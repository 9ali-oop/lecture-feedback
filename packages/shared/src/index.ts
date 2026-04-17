// Shared types between the API and web app - keeps both sides in sync
// ── Enums ────────────────────────────────────────────────────────────────────

export type Role = 'admin' | 'lecturer' | 'student';

// Four-point scale: keeps feedback quick and low-friction for students
export type Emoji = 'got_it' | 'neutral' | 'confused' | 'lost';
export type SessionStatus = 'scheduled' | 'live' | 'ended';
export type EnglishProficiency = 'native' | 'fluent' | 'intermediate' | 'beginner';

// ── Module color palette ─────────────────────────────────────────────────────

export const MODULE_COLORS = [
  { hex: '#1e3a5f', name: 'Navy' },
  { hex: '#6d28d9', name: 'Purple' },
  { hex: '#0f766e', name: 'Teal' },
  { hex: '#b91c1c', name: 'Crimson' },
  { hex: '#ea580c', name: 'Orange' },
  { hex: '#ca8a04', name: 'Yellow' },
  { hex: '#15803d', name: 'Forest' },
  { hex: '#be185d', name: 'Rose' },
  { hex: '#4338ca', name: 'Indigo' },
  { hex: '#475569', name: 'Slate' },
  { hex: '#bfdbfe', name: 'Sky' },
  { hex: '#ddd6fe', name: 'Lilac' },
  { hex: '#99f6e4', name: 'Mint' },
  { hex: '#fecaca', name: 'Blush' },
  { hex: '#fed7aa', name: 'Peach' },
  { hex: '#fef08a', name: 'Lemon' },
  { hex: '#bbf7d0', name: 'Sage' },
  { hex: '#fbcfe8', name: 'Pink' },
  { hex: '#c7d2fe', name: 'Periwinkle' },
  { hex: '#e2e8f0', name: 'Silver' },
] as const;

export function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6;
}

// ── Domain models ─────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  totpVerified: boolean;
  createdAt: string;
}

export interface StudentProfile {
  userId: string;
  studentNumber: string;
  englishProficiency: EnglishProficiency;
}

export interface Module {
  id: string;
  code: string;
  name: string;
  color: string;
  lecturerId: string;
  lecturerName: string;
  enrolledCount: number;
  createdAt: string;
}

export interface Session {
  id: string;
  moduleId: string;
  moduleName: string;
  moduleCode: string;
  moduleColor: string;
  title: string;
  status: SessionStatus;
  currentSlideIndex: number;
  totalSlides: number;
  hasPdf: boolean;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  participated?: boolean;
}

export interface Question {
  id: string;
  sessionId: string;
  studentId: string;
  studentName: string;
  content: string;
  slideIndex: number | null;
  askedAt: string;
  answered: boolean;
  answeredAt: string | null;
  upvoteCount: number;
  upvotedByMe?: boolean; // populated per-student
}

export interface SlideNote {
  id: string;
  sessionId: string;
  studentId: string;
  slideIndex: number;
  content: string;
  updatedAt: string;
}

// ── Quick Polls ──────────────────────────────────────────────────────────────

export type PollStatus = 'active' | 'closed';

export interface Poll {
  id: string;
  sessionId: string;
  slideIndex: number;
  question: string;
  options: string[];
  isTrueFalse: boolean;
  status: PollStatus;
  createdAt: string;
  closedAt: string | null;
}

export interface PollResults {
  pollId: string;
  question: string;
  options: string[];
  counts: number[];      // count per option index
  totalResponses: number;
  status: PollStatus;
}

// ── Pace feedback ───────────────────────────────────────────────────────────

export type PaceValue = 'slow' | 'ok' | 'fast';

export interface PaceDistribution {
  slow: number;
  ok: number;
  fast: number;
  total: number;
}

// ── Engagement timeline ─────────────────────────────────────────────────────

export interface TimelineBucket {
  timestamp: string;      // ISO string, start of the 30-second bucket
  slideIndex: number;
  confusedPct: number;    // 0-100
  responseCount: number;
  questionCount: number;
  paceSlow: number;
  paceOk: number;
  paceFast: number;
  engagementScore: number | null; // 0-100 composite, null if no data in this bucket
}

// ── Post-lecture reflections ─────────────────────────────────────────────────

export interface Reflection {
  id: string;
  sessionId: string;
  studentId: string;
  studentName: string;
  mostImportant: string;
  stillUnclear: string;
  createdAt: string;
}

export interface ReflectionSummary {
  totalResponses: number;
  reflections: Reflection[];
  topLearnings: string[];   // most frequent words/phrases from mostImportant
  topUnclear: string[];     // most frequent words/phrases from stillUnclear
}

// ── Participation analytics ─────────────────────────────────────────────────

export interface StudentEngagement {
  studentId: string;
  studentName: string;
  studentNumber: string;
  sessionsAttended: number;
  totalSessions: number;
  feedbackGiven: number;
  questionsAsked: number;
  confusionReports: number;
  reflectionsSubmitted: number;
  engagementScore: number; // 0-100
}

export interface ModuleAnalytics {
  moduleId: string;
  totalStudents: number;
  totalSessions: number;
  classAverageEngagement: number;
  students: StudentEngagement[];
}

// ── Engagement scoring ──────────────────────────────────────────────────────

/** Individual signal sub-scores (0-100 each, null if no data for that signal) */
export interface EngagementSignals {
  emoji: number | null;
  pace: number | null;
  questions: number | null;
  confusion: number | null;
  notes: number | null;
}

/** Composite engagement score for a slide or session */
export interface EngagementScore {
  overall: number;              // 0-100 weighted composite
  signals: EngagementSignals;
  participantCount: number;
}

/** Engagement segmented by English proficiency level */
export interface ProficiencyEngagement {
  proficiency: EnglishProficiency;
  studentCount: number;
  averageScore: number;
  signals: EngagementSignals;
}

/** Single-signal vs multi-signal comparison (for research question) */
export interface SignalComparison {
  signalName: string;
  weight: number;
  // Engagement if using only this signal. null when the signal is absent from
  // every slide (e.g. a session where nobody took any notes) — otherwise a 0
  // would read as "zero engagement on this dimension", hiding the fact that
  // there was no signal to measure at all.
  soloScore: number | null;
  // Weighted contribution to composite. Also null when the signal is absent.
  contribution: number | null;
  // Pearson r with composite (-1 to 1). null when the signal's variance
  // across slides is zero (e.g. session-wide pace feedback) — correlation is
  // undefined in that case and we show "—" in the UI instead of a misleading 0.
  correlation: number | null;
}

/** Full engagement analytics block for the session report */
export interface EngagementAnalytics {
  overallScore: EngagementScore;
  perSlide: Array<{ slideIndex: number; engagement: EngagementScore }>;
  signalComparison: SignalComparison[];
  proficiencyBreakdown: ProficiencyEngagement[];
}

/** Learning-dynamics block — Markov-chain analysis of emoji trajectories.
 *  Lecturer-only; omitted from student responses. */
export interface LearningDynamicsBlock {
  /** Smoothed 4×4 transition matrix, rows indexed by [got_it, neutral, confused, lost]. */
  transitionMatrix: number[][];
  /** Pre-smoothing raw counts, so the UI can flag low-evidence cells. */
  transitionCounts: number[][];
  /** Expected slides to reach got_it from each state; null if undefined even after smoothing. */
  expectedRecovery: { got_it: number | null; neutral: number | null; confused: number | null; lost: number | null };
  /** Explanatory note if any state's recovery couldn't be estimated, else null. */
  recoveryNote: string | null;
  /** Pooled transitions (pre-smoothing) used to estimate the matrix — signals confidence. */
  sampleSize: number;
  /** Count of students who gave any feedback. */
  activeStudents: number;
  /** Per-student trajectories, sorted by risk score descending. */
  students: Array<{
    studentId: string;
    studentName: string;
    sequence: Emoji[];
    distribution: { got_it: number; neutral: number; confused: number; lost: number };
    entropy: number;
    endingState: Emoji | null;
    tailNonMasteryLength: number;
    riskScore: number;
    recovered: boolean;
  }>;
  /** Subset of students above the at-risk threshold, same sort order. */
  atRisk: Array<{
    studentId: string;
    studentName: string;
    sequence: Emoji[];
    endingState: Emoji | null;
    riskScore: number;
    recovered: boolean;
  }>;
}

// ── Smart recommendations ───────────────────────────────────────────────────

export interface SmartRecommendation {
  type: 'content' | 'pacing' | 'structure' | 'engagement';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  evidence: string;       // what data supports this recommendation
}

export interface SlideAnnotation {
  slideIndex: number;
  imageUrl: string;
}

// ── Confusion context ────────────────────────────────────────────────────────

export interface ConfusionHighlight {
  shape: 'rect' | 'circle';
  x: number;      // normalized 0-1 — left edge (rect) or center (circle)
  y: number;      // normalized 0-1 — top edge (rect) or center (circle)
  width: number;  // normalized 0-1
  height: number; // normalized 0-1
}

export interface ConfusionContext {
  id: string;
  sessionId: string;
  studentId: string;
  studentName: string;
  slideIndex: number;
  emoji: 'confused' | 'lost';
  highlights: ConfusionHighlight[];
  explanation: string | null;
  createdAt: string;
}

// ── Feedback ──────────────────────────────────────────────────────────────────

export interface FeedbackDistribution {
  got_it: number;
  neutral: number;
  confused: number;
  lost: number;
  total: number;
}

export interface SlideReport {
  slideIndex: number;
  distribution: FeedbackDistribution;
  recommendation: string;
  smartRecommendations: SmartRecommendation[];
  timeSeconds: number | null;
  questions: Question[];
  hasWhiteboard: boolean;
  hasAnnotation: boolean;
  confusionContexts: ConfusionContext[];
  engagement?: EngagementScore;
  /** Present only on student-role responses — the requesting student's own
   *  emoji on this slide, carried forward from earlier votes if they didn't
   *  re-vote. Lets the student see their personal answer beside the class %. */
  yourVote?: Emoji;
}

export interface SessionReport {
  session: Session;
  totalEnrolled: number;
  peakParticipants: number;
  slides: SlideReport[];
  overallDistribution: FeedbackDistribution;
  engagement?: EngagementAnalytics;
  /** Present only for lecturer/admin responses. */
  learningDynamics?: LearningDynamicsBlock;
}

// ── Annotation types ─────────────────────────────────────────────────────────

export type {
  Point,
  Annotation,
  AnnotationType,
  DrawToolType,
  DrawStrokeMessage,
  EraseStrokeMessage,
  ClearAnnotationsMessage,
  LaserMoveMessage,
  LaserPauseMessage,
  LaserEndMessage,
  CursorPositionMessage,
  CursorHideMessage,
  AnnotationSyncMessage,
} from './annotations.js';

import type {
  DrawStrokeMessage,
  EraseStrokeMessage,
  ClearAnnotationsMessage,
  LaserMoveMessage,
  LaserPauseMessage,
  LaserEndMessage,
  CursorPositionMessage,
  CursorHideMessage,
  AnnotationSyncMessage,
} from './annotations.js';

// ── WebSocket messages ────────────────────────────────────────────────────────

export type WsClientMessage =
  | { type: 'SLIDE_CHANGE'; slideIndex: number }
  | { type: 'FEEDBACK'; emoji: Emoji; slideIndex: number }
  | { type: 'QUESTION'; content: string }
  | { type: 'QUESTION_ANSWERED'; questionId: string }
  | { type: 'SESSION_END' }
  | { type: 'PING' }
  | DrawStrokeMessage
  | EraseStrokeMessage
  | ClearAnnotationsMessage
  | LaserMoveMessage
  | LaserPauseMessage
  | LaserEndMessage
  | CursorPositionMessage
  | CursorHideMessage
  | { type: 'PACE_FEEDBACK'; value: PaceValue }
  | { type: 'POLL_RESPONSE'; pollId: string; optionIndex: number }
  | { type: 'QUESTION_UPVOTE'; questionId: string }
  | { type: 'ANNOTATION_ACCESS_REQUEST'; reason: string }
  | { type: 'ANNOTATION_ACCESS_CANCEL' }
  | { type: 'ANNOTATION_ACCESS_GRANT'; studentId: string }
  | { type: 'ANNOTATION_ACCESS_DISMISS'; studentId: string }
  | { type: 'ANNOTATION_ACCESS_REVOKE' }
  | { type: 'WHITEBOARD_TOGGLE'; enabled: boolean }
  | { type: 'TEXT_BOX_SYNC'; slideIndex: number; textBoxes: Array<{ id: string; x: number; y: number; width: number; height: number; content: string; fontFamily: string; fontSize: number; color: string }> };

export type WsServerMessage =
  | { type: 'SLIDE_UPDATE'; slideIndex: number; totalSlides: number }
  | { type: 'FEEDBACK_UPDATE'; distribution: FeedbackDistribution }
  | { type: 'NEW_QUESTION'; question: Question }
  | { type: 'QUESTION_ANSWERED'; questionId: string }
  | { type: 'PARTICIPANT_COUNT'; active: number; total: number }
  | { type: 'CONFUSION_AREA'; slideIndex: number; highlight: ConfusionHighlight; emoji: 'confused' | 'lost' }
  | { type: 'POLL_LAUNCHED'; poll: Poll }
  | { type: 'POLL_RESULTS'; results: PollResults }
  | { type: 'POLL_CLOSED'; pollId: string; results: PollResults }
  | { type: 'PACE_UPDATE'; distribution: PaceDistribution }
  | { type: 'ENGAGEMENT_UPDATE'; score: number; signals: EngagementSignals; slideIndex: number }
  | { type: 'QUESTION_UPVOTED'; questionId: string; upvoteCount: number }
  | { type: 'SESSION_ENDED' }
  | { type: 'LECTURER_DISCONNECTED' }
  | { type: 'LECTURER_RECONNECTED' }
  | { type: 'PONG' }
  | { type: 'ERROR'; message: string }
  | DrawStrokeMessage
  | EraseStrokeMessage
  | ClearAnnotationsMessage
  | LaserMoveMessage
  | LaserPauseMessage
  | LaserEndMessage
  | CursorPositionMessage
  | CursorHideMessage
  | AnnotationSyncMessage
  | { type: 'ANNOTATION_ACCESS_REQUESTED'; studentId: string; studentName: string; reason: string }
  | { type: 'ANNOTATION_ACCESS_GRANTED' }
  | { type: 'ANNOTATION_ACCESS_REVOKED'; reason: 'slide_change' | 'lecturer_revoked' | 'session_ended' }
  | { type: 'ANNOTATION_ACCESS_DISMISSED' }
  | { type: 'ANNOTATION_ACCESS_STATE'; grantedStudent: { id: string; name: string } | null; queue: Array<{ studentId: string; studentName: string; reason: string }> }
  | { type: 'STUDENT_DRAW_STROKE'; studentName: string; points: Array<{ x: number; y: number }>; color: string; width: number; slideIndex: number }
  | { type: 'STUDENT_ERASE_STROKE'; studentName: string; points: Array<{ x: number; y: number }>; size: number; slideIndex: number }
  | { type: 'STUDENT_CLEAR_ANNOTATIONS'; slideIndex: number }
  | { type: 'WHITEBOARD_TOGGLE'; enabled: boolean }
  | { type: 'SESSION_LIVE'; sessionId: string; moduleId: string; title: string }
  | { type: 'SESSION_ENDED_DASHBOARD'; sessionId: string }
  | { type: 'TEXT_BOX_SYNC'; slideIndex: number; textBoxes: Array<{ id: string; x: number; y: number; width: number; height: number; content: string; fontFamily: string; fontSize: number; color: string }> };

// ── API request/response shapes ───────────────────────────────────────────────

export interface RegisterVerifyBody {
  email: string;
  code: string;
}

export interface LoginBody {
  email: string;
  code: string;
}

export interface AuthResponse {
  token: string;
  user: User;
  studentProfile?: StudentProfile;
}

export interface ProvisionUserBody {
  email: string;
  name: string;
  role: 'lecturer' | 'student';
  studentNumber?: string;
  englishProficiency?: EnglishProficiency;
}

export interface ProvisionUserResponse {
  user: User;
  qrCodeDataUrl: string;
  totpSecret: string;
}

export interface CreateModuleBody {
  code: string;
  name: string;
  color: string;
}

export interface CreateSessionBody {
  title: string;
}

export interface ApiError {
  error: string;
}
