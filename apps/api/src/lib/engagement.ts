/**
 * Multi-Signal Engagement Scoring Engine
 *
 * Fuses 5 signals into a 0-100 composite engagement score using
 * an explainable weighted average. Missing signals have their
 * weight redistributed proportionally.
 *
 * Research question: "Does fusing 5 signals outperform any single
 * signal alone?"
 */

import type {
  FeedbackDistribution,
  PaceDistribution,
  EngagementSignals,
  EngagementScore,
  SignalComparison,
  ProficiencyEngagement,
  EnglishProficiency,
} from '@lecture-feedback/shared';

// ── Signal weights (must sum to 1.0) ────────────────────────────────────────

export const SIGNAL_WEIGHTS = {
  emoji: 0.30,
  pace: 0.20,
  questions: 0.20,
  confusion: 0.15,
  notes: 0.15,
} as const;

// ── Emoji sentiment values ──────────────────────────────────────────────────

const EMOJI_VALUES: Record<string, number> = {
  got_it: 100,
  neutral: 60,
  confused: 25,
  lost: 0,
};

// ── Per-signal scoring functions ────────────────────────────────────────────

/**
 * Emoji sentiment score: weighted average of emoji values.
 * got_it=100, neutral=60, confused=25, lost=0.
 * Returns null if no responses.
 */
export function computeEmojiScore(dist: FeedbackDistribution): number | null {
  if (dist.total === 0) return null;
  const weighted =
    dist.got_it * EMOJI_VALUES.got_it +
    dist.neutral * EMOJI_VALUES.neutral +
    dist.confused * EMOJI_VALUES.confused +
    dist.lost * EMOJI_VALUES.lost;
  return Math.round(weighted / dist.total);
}

/**
 * Pace satisfaction score: % of students saying "ok".
 * 100 = everyone comfortable, 0 = everyone uncomfortable.
 * Returns null if no pace feedback.
 */
export function computePaceScore(dist: PaceDistribution): number | null {
  if (dist.total === 0) return null;
  return Math.round((dist.ok / dist.total) * 100);
}

/**
 * Question engagement score: questions indicate active participation.
 * Scales linearly: each question adds 25 points, capped at 100.
 * Returns null if no participants.
 */
export function computeQuestionScore(
  questionCount: number,
  participantCount: number,
): number | null {
  if (participantCount === 0) return null;
  const perStudent = questionCount / participantCount;
  return Math.round(Math.min(100, perStudent * 80));
}

/**
 * Confusion density score (inverted): lower confusion = higher score.
 * 0% confusion = 100, 50%+ confusion = 0.
 * Returns null if no participants.
 */
export function computeConfusionScore(
  confusionReports: number,
  participantCount: number,
): number | null {
  if (participantCount === 0) return null;
  const ratio = confusionReports / participantCount;
  return Math.round(Math.max(0, 100 - ratio * 200));
}

/**
 * Note activity score: % of students who took notes on this slide.
 * 100 = everyone took notes, 0 = nobody.
 * Returns null if no participants.
 */
export function computeNoteScore(
  studentsWithNotes: number,
  participantCount: number,
): number | null {
  if (participantCount === 0) return null;
  return Math.round(Math.min(100, (studentsWithNotes / participantCount) * 100));
}

// ── Composite scoring ───────────────────────────────────────────────────────

/**
 * Compute weighted composite engagement score from individual signals.
 * Missing signals (null) have their weight redistributed proportionally.
 * Returns 50 (neutral) if all signals are null.
 */
export function computeEngagementScore(signals: EngagementSignals): number {
  const entries: [keyof typeof SIGNAL_WEIGHTS, number | null][] = [
    ['emoji', signals.emoji],
    ['pace', signals.pace],
    ['questions', signals.questions],
    ['confusion', signals.confusion],
    ['notes', signals.notes],
  ];

  let totalWeight = 0;
  let weightedSum = 0;

  for (const [key, value] of entries) {
    if (value !== null) {
      totalWeight += SIGNAL_WEIGHTS[key];
      weightedSum += SIGNAL_WEIGHTS[key] * value;
    }
  }

  return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 50;
}

/**
 * Build a complete EngagementScore from raw data for a single slide.
 */
export function computeSlideEngagement(data: {
  distribution: FeedbackDistribution;
  paceDistribution: PaceDistribution;
  questionCount: number;
  confusionReports: number;
  studentsWithNotes: number;
  participantCount: number;
}): EngagementScore {
  const signals: EngagementSignals = {
    emoji: computeEmojiScore(data.distribution),
    pace: computePaceScore(data.paceDistribution),
    questions: computeQuestionScore(data.questionCount, data.participantCount),
    confusion: computeConfusionScore(data.confusionReports, data.participantCount),
    notes: computeNoteScore(data.studentsWithNotes, data.participantCount),
  };

  return {
    overall: computeEngagementScore(signals),
    signals,
    participantCount: data.participantCount,
  };
}

/**
 * Compute session-level engagement by averaging slide scores,
 * weighted by participant count per slide.
 */
export function computeSessionEngagement(
  slideEngagements: EngagementScore[],
): EngagementScore {
  if (slideEngagements.length === 0) {
    return {
      overall: 50,
      signals: { emoji: null, pace: null, questions: null, confusion: null, notes: null },
      participantCount: 0,
    };
  }

  // Weight by participation: slides with more participants matter more
  let totalWeight = 0;
  let weightedOverall = 0;
  const signalSums: Record<keyof EngagementSignals, { sum: number; count: number }> = {
    emoji: { sum: 0, count: 0 },
    pace: { sum: 0, count: 0 },
    questions: { sum: 0, count: 0 },
    confusion: { sum: 0, count: 0 },
    notes: { sum: 0, count: 0 },
  };

  for (const se of slideEngagements) {
    const w = Math.max(se.participantCount, 1);
    totalWeight += w;
    weightedOverall += se.overall * w;

    for (const key of Object.keys(signalSums) as (keyof EngagementSignals)[]) {
      const v = se.signals[key];
      if (v !== null) {
        signalSums[key].sum += v * w;
        signalSums[key].count += w;
      }
    }
  }

  const avgSignals: EngagementSignals = {
    emoji: signalSums.emoji.count > 0 ? Math.round(signalSums.emoji.sum / signalSums.emoji.count) : null,
    pace: signalSums.pace.count > 0 ? Math.round(signalSums.pace.sum / signalSums.pace.count) : null,
    questions: signalSums.questions.count > 0 ? Math.round(signalSums.questions.sum / signalSums.questions.count) : null,
    confusion: signalSums.confusion.count > 0 ? Math.round(signalSums.confusion.sum / signalSums.confusion.count) : null,
    notes: signalSums.notes.count > 0 ? Math.round(signalSums.notes.sum / signalSums.notes.count) : null,
  };

  const maxParticipants = Math.max(...slideEngagements.map(s => s.participantCount));

  return {
    overall: totalWeight > 0 ? Math.round(weightedOverall / totalWeight) : 50,
    signals: avgSignals,
    participantCount: maxParticipants,
  };
}

// ── Research: signal comparison ─────────────────────────────────────────────

/**
 * Pearson correlation coefficient between two arrays.
 * Returns 0 if insufficient data or zero variance.
 */
export function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return 0;

  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sumXY += dx * dy;
    sumX2 += dx * dx;
    sumY2 += dy * dy;
  }

  const denom = Math.sqrt(sumX2 * sumY2);
  return denom === 0 ? 0 : Math.round((sumXY / denom) * 100) / 100;
}

/**
 * Compare each signal's solo score against the multi-signal composite.
 * Answers: "Does fusing 5 signals outperform any single signal alone?"
 */
export function computeSignalComparisons(
  slideData: Array<{ signals: EngagementSignals; composite: number }>,
): SignalComparison[] {
  const signalNames: (keyof EngagementSignals)[] = ['emoji', 'pace', 'questions', 'confusion', 'notes'];
  const labels: Record<string, string> = {
    emoji: 'Emoji Feedback',
    pace: 'Pace Feedback',
    questions: 'Question Activity',
    confusion: 'Confusion Density',
    notes: 'Note Activity',
  };

  return signalNames.map((key) => {
    // Solo scores: what if we only used this signal?
    const soloScores: number[] = [];
    const compositeScores: number[] = [];
    const signalValues: number[] = [];

    for (const sd of slideData) {
      const val = sd.signals[key];
      if (val !== null) {
        // Solo = use only this signal (weight 1.0)
        soloScores.push(val);
        compositeScores.push(sd.composite);
        signalValues.push(val);
      }
    }

    const avgSolo = soloScores.length > 0
      ? Math.round(soloScores.reduce((a, b) => a + b, 0) / soloScores.length)
      : 0;

    const avgContribution = signalValues.length > 0
      ? Math.round(SIGNAL_WEIGHTS[key] * signalValues.reduce((a, b) => a + b, 0) / signalValues.length)
      : 0;

    const r = pearsonCorrelation(signalValues, compositeScores);

    return {
      signalName: labels[key],
      weight: SIGNAL_WEIGHTS[key],
      soloScore: avgSolo,
      contribution: avgContribution,
      correlation: r,
    };
  });
}

// ── Proficiency segmentation ────────────────────────────────────────────────

/**
 * Segment engagement scores by English proficiency level.
 */
export function segmentByProficiency(
  studentData: Array<{
    studentId: string;
    proficiency: EnglishProficiency;
    signals: EngagementSignals;
    score: number;
  }>,
): ProficiencyEngagement[] {
  const groups = new Map<EnglishProficiency, typeof studentData>();

  for (const s of studentData) {
    if (!groups.has(s.proficiency)) groups.set(s.proficiency, []);
    groups.get(s.proficiency)!.push(s);
  }

  const result: ProficiencyEngagement[] = [];

  for (const [proficiency, students] of groups) {
    const avgScore = Math.round(
      students.reduce((sum, s) => sum + s.score, 0) / students.length,
    );

    const avgSignals: EngagementSignals = { emoji: null, pace: null, questions: null, confusion: null, notes: null };
    for (const key of ['emoji', 'pace', 'questions', 'confusion', 'notes'] as (keyof EngagementSignals)[]) {
      const values = students.map(s => s.signals[key]).filter((v): v is number => v !== null);
      if (values.length > 0) {
        avgSignals[key] = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
      }
    }

    result.push({
      proficiency,
      studentCount: students.length,
      averageScore: avgScore,
      signals: avgSignals,
    });
  }

  // Sort by proficiency level for consistent display
  const order: EnglishProficiency[] = ['native', 'fluent', 'intermediate', 'beginner'];
  result.sort((a, b) => order.indexOf(a.proficiency) - order.indexOf(b.proficiency));

  return result;
}
