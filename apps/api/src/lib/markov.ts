/**
 * Learning-dynamics engine — Markov-chain analysis of per-student emoji
 * trajectories within a session.
 *
 * Pipeline:
 *   1. Reconstruct each student's emoji sequence in slide order from
 *      feedback_events, carrying the last-set emoji forward across slides
 *      the student didn't re-vote on (that's the student-manager's runtime
 *      semantics, mirrored here so the offline view is consistent).
 *   2. Count transitions pooled across students, apply Laplace smoothing
 *      (add-one, Laplace 1814) so zero-count cells don't make the transient
 *      sub-matrix singular.
 *   3. Partition into absorbing (`got_it`) and transient (the other three
 *      states) blocks, invert (I − Q) via Gauss–Jordan, and multiply by the
 *      ones vector to recover expected slides-to-mastery from each transient
 *      state (Kemeny & Snell 1960, fundamental-matrix theorem).
 *   4. Per student, compute Shannon entropy of their empirical emoji
 *      distribution (Shannon 1948) plus an ending-state term, combine into
 *      a risk score, rank.
 *
 * Not ML. Pure classical probability + numerical linear algebra.
 */

import type { Emoji } from '@lecture-feedback/shared';

// Fixed state order — the matrix rows / cols are indexed by this array.
export const STATES: Emoji[] = ['got_it', 'neutral', 'confused', 'lost'];
const ABSORBING: Emoji = 'got_it';
const TRANSIENT: Emoji[] = STATES.filter((s) => s !== ABSORBING);

/** Weight each ending state contributes to a student's risk score. Higher = more at-risk. */
const ENDING_STATE_RISK: Record<Emoji, number> = {
  got_it: 0,
  neutral: 0.35,
  confused: 0.75,
  lost: 1,
};

/** Laplace smoothing constant. Add-one is the standard choice and matches the
 *  most-cited form of Laplace's rule of succession. */
const LAPLACE_ALPHA = 1;

export interface FeedbackSample {
  studentId: string;
  slideIndex: number;
  emoji: Emoji;
  selectedAt: Date;
}

export interface StudentTrajectory {
  studentId: string;
  studentName: string;
  /** Ordered emoji states, one per slide that existed during the session. */
  sequence: Emoji[];
  /** Empirical emoji frequency (sums to 1 if sequence non-empty). */
  distribution: Record<Emoji, number>;
  entropy: number;        // Shannon, bits (0..2)
  endingState: Emoji | null;
  /** Length of the longest tail in a non-got_it state (confused/lost/neutral). */
  tailNonMasteryLength: number;
  /** 0 = rock solid, 1 = maximally at risk. */
  riskScore: number;
  /** True if the student experienced a confused/lost state and finished at got_it. */
  recovered: boolean;
}

export interface LearningDynamics {
  /** 4×4 smoothed transition matrix. rows = from, cols = to, entries sum to 1 across a row. */
  transitionMatrix: number[][];
  /** Raw (pre-smoothing) counts, useful for the UI to flag low-evidence cells. */
  transitionCounts: number[][];
  /** E[slides to got_it | start=state] for each transient state. +Infinity if unreachable. */
  expectedRecovery: Record<Emoji, number | null>;
  /** Non-null if we had to fall back because the smoothed Q was still effectively absorbing. */
  recoveryNote: string | null;
  /** Every active student's trajectory, sorted by risk score descending. */
  students: StudentTrajectory[];
  /** Top-k students whose risk score exceeds the threshold, already sorted. */
  atRisk: StudentTrajectory[];
  /** Count of unique students who contributed any feedback. */
  activeStudents: number;
  /** Count of pooled transitions used to estimate the matrix (pre-smoothing). */
  sampleSize: number;
}

// ── Trajectory reconstruction ────────────────────────────────────────────────

/**
 * Build per-student emoji sequences in slide order. A student's state on
 * slide `i` is the LATEST emoji they set ≤ slide i (carry-forward). Students
 * with no feedback on any slide are omitted.
 */
export function reconstructTrajectories(
  samples: FeedbackSample[],
  totalSlides: number,
  studentNames: Map<string, string>,
): Map<string, { studentName: string; sequence: Emoji[] }> {
  // Group samples by student
  const byStudent = new Map<string, FeedbackSample[]>();
  for (const s of samples) {
    if (!byStudent.has(s.studentId)) byStudent.set(s.studentId, []);
    byStudent.get(s.studentId)!.push(s);
  }

  const result = new Map<string, { studentName: string; sequence: Emoji[] }>();
  for (const [studentId, rows] of byStudent) {
    // Order by the slide the emoji belongs to, breaking ties by selectedAt
    // so a student who switched emojis mid-slide keeps their latest pick for
    // that slide.
    rows.sort((a, b) =>
      a.slideIndex !== b.slideIndex
        ? a.slideIndex - b.slideIndex
        : a.selectedAt.getTime() - b.selectedAt.getTime(),
    );

    // Per-slide latest emoji
    const latest = new Map<number, Emoji>();
    for (const r of rows) latest.set(r.slideIndex, r.emoji);

    // Carry-forward: for each slide in [0, totalSlides), use the latest emoji
    // set on that slide or any earlier slide; skip leading slides with no vote.
    const sequence: Emoji[] = [];
    let current: Emoji | null = null;
    for (let i = 0; i < totalSlides; i++) {
      if (latest.has(i)) current = latest.get(i)!;
      if (current !== null) sequence.push(current);
    }

    if (sequence.length > 0) {
      result.set(studentId, { studentName: studentNames.get(studentId) ?? 'Unknown', sequence });
    }
  }
  return result;
}

// ── Transition counting + smoothing ──────────────────────────────────────────

function zeroMatrix(n: number): number[][] {
  return Array.from({ length: n }, () => Array(n).fill(0));
}

function countTransitions(trajectories: Iterable<Emoji[]>): number[][] {
  const n = STATES.length;
  const m = zeroMatrix(n);
  for (const seq of trajectories) {
    for (let t = 1; t < seq.length; t++) {
      const i = STATES.indexOf(seq[t - 1]);
      const j = STATES.indexOf(seq[t]);
      if (i >= 0 && j >= 0) m[i][j]++;
    }
  }
  return m;
}

/** Laplace add-alpha smoothing, then row-normalise so each row sums to 1. */
function smoothAndNormalise(counts: number[][], alpha: number): number[][] {
  const n = counts.length;
  const out = zeroMatrix(n);
  for (let i = 0; i < n; i++) {
    let rowTotal = 0;
    for (let j = 0; j < n; j++) rowTotal += counts[i][j] + alpha;
    for (let j = 0; j < n; j++) out[i][j] = (counts[i][j] + alpha) / rowTotal;
  }
  return out;
}

// ── Matrix inversion (Gauss–Jordan) ──────────────────────────────────────────

/**
 * Returns A⁻¹, or null if A is singular to within the given tolerance.
 * Pure Gauss–Jordan with partial pivoting — O(n³), fine for n=3.
 */
export function invertMatrix(A: number[][], eps = 1e-10): number[][] | null {
  const n = A.length;
  if (n === 0) return [];
  // Build [A | I]
  const aug: number[][] = Array.from({ length: n }, (_, i) => {
    const row = Array<number>(2 * n).fill(0);
    for (let j = 0; j < n; j++) row[j] = A[i][j];
    row[n + i] = 1;
    return row;
  });

  for (let col = 0; col < n; col++) {
    // Partial pivot — largest magnitude in this column below row `col`
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r][col]) > Math.abs(aug[pivot][col])) pivot = r;
    }
    if (Math.abs(aug[pivot][col]) < eps) return null; // singular
    if (pivot !== col) [aug[col], aug[pivot]] = [aug[pivot], aug[col]];

    // Normalise pivot row
    const p = aug[col][col];
    for (let j = 0; j < 2 * n; j++) aug[col][j] /= p;

    // Eliminate column in other rows
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = aug[r][col];
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) aug[r][j] -= factor * aug[col][j];
    }
  }

  // Extract right half as the inverse
  const inv: number[][] = Array.from({ length: n }, (_, i) => aug[i].slice(n));
  return inv;
}

// ── Expected recovery time via fundamental matrix ────────────────────────────

/**
 * Given the full smoothed transition matrix P (with STATES ordering),
 * compute E[time to reach got_it | start = t] for every transient state t.
 *
 * Derivation (Kemeny & Snell 1960):
 *   Partition P as [[Q R]; [0 I]] where Q is transient→transient,
 *   R is transient→absorbing, I is the absorbing self-loop block.
 *   Fundamental matrix N = (I − Q)⁻¹.
 *   Expected steps to absorption from transient state i is the sum of
 *   row i of N, i.e. N · 1.
 */
function expectedRecoveryTimes(P: number[][]): {
  values: Record<Emoji, number | null>;
  note: string | null;
} {
  const absorbingIdx = STATES.indexOf(ABSORBING);
  const transientIndices = STATES
    .map((s, i) => ({ s, i }))
    .filter((x) => x.s !== ABSORBING)
    .map((x) => x.i);

  const k = transientIndices.length;
  // Build Q as k×k
  const Q = zeroMatrix(k);
  for (let a = 0; a < k; a++) {
    for (let b = 0; b < k; b++) {
      Q[a][b] = P[transientIndices[a]][transientIndices[b]];
    }
  }

  // I − Q
  const IminusQ = zeroMatrix(k);
  for (let a = 0; a < k; a++) {
    for (let b = 0; b < k; b++) {
      IminusQ[a][b] = (a === b ? 1 : 0) - Q[a][b];
    }
  }

  const N = invertMatrix(IminusQ);
  const values: Record<Emoji, number | null> = { got_it: 0, neutral: null, confused: null, lost: null };
  let note: string | null = null;

  if (!N) {
    note = 'I − Q was singular even after smoothing — likely insufficient data to estimate recovery from at least one state. Reported as null.';
    for (const i of transientIndices) values[STATES[i]] = null;
    return { values, note };
  }

  for (let a = 0; a < k; a++) {
    let rowSum = 0;
    for (let b = 0; b < k; b++) rowSum += N[a][b];
    // Numerical noise can push this very slightly negative / infinite.
    if (!Number.isFinite(rowSum) || rowSum < 0) {
      values[STATES[transientIndices[a]]] = null;
      note = note ?? 'Some transient states had non-finite recovery estimates — reported as null.';
    } else {
      values[STATES[transientIndices[a]]] = rowSum;
    }
  }
  // Row `got_it` = already absorbed, zero steps.
  // The absorbing state's recovery is trivially 0 — leave as set above.
  // Silence the lint about unused var
  void absorbingIdx;

  return { values, note };
}

// ── Per-student entropy + risk ───────────────────────────────────────────────

/** Shannon entropy (bits) of the empirical emoji distribution. 0 = always same emoji. */
function shannonEntropy(seq: Emoji[]): { entropy: number; dist: Record<Emoji, number> } {
  const counts: Record<Emoji, number> = { got_it: 0, neutral: 0, confused: 0, lost: 0 };
  for (const e of seq) counts[e]++;
  const total = seq.length;
  const dist: Record<Emoji, number> = { got_it: 0, neutral: 0, confused: 0, lost: 0 };
  if (total === 0) return { entropy: 0, dist };
  let h = 0;
  for (const s of STATES) {
    dist[s] = counts[s] / total;
    if (dist[s] > 0) h -= dist[s] * Math.log2(dist[s]);
  }
  return { entropy: h, dist };
}

/** Longest trailing run of non-got_it emojis at the end of the sequence. */
function tailNonMasteryLength(seq: Emoji[]): number {
  let t = 0;
  for (let i = seq.length - 1; i >= 0; i--) {
    if (seq[i] === 'got_it') break;
    t++;
  }
  return t;
}

/**
 * Per-student risk ∈ [0,1]. Higher = more at-risk.
 * Blend: ending-state weight (50%) + tail-length normalised (30%) + Shannon
 *        entropy normalised to max=2 bits (20%).
 */
function riskScore(traj: Emoji[], totalSlides: number): { score: number; endingStateWeight: number } {
  if (traj.length === 0) return { score: 0, endingStateWeight: 0 };
  const ending = traj[traj.length - 1];
  const endingStateWeight = ENDING_STATE_RISK[ending];
  const tail = tailNonMasteryLength(traj) / Math.max(totalSlides, 1);
  const { entropy } = shannonEntropy(traj);
  const entropyNorm = entropy / 2; // max entropy with 4 equal states = log2(4) = 2 bits
  const score = 0.5 * endingStateWeight + 0.3 * Math.min(1, tail) + 0.2 * Math.min(1, entropyNorm);
  return { score, endingStateWeight };
}

// ── Top-level entry point ────────────────────────────────────────────────────

export interface ComputeInput {
  samples: FeedbackSample[];
  totalSlides: number;
  studentNames: Map<string, string>;
  atRiskThreshold?: number;     // default 0.3 — surfaces anyone above-zero on ending state
}

export function computeLearningDynamics(input: ComputeInput): LearningDynamics {
  const { samples, totalSlides, studentNames } = input;
  const threshold = input.atRiskThreshold ?? 0.3;

  const trajectories = reconstructTrajectories(samples, totalSlides, studentNames);

  // Class-wide transition matrix from all trajectories
  const seqs = Array.from(trajectories.values()).map((v) => v.sequence);
  const counts = countTransitions(seqs);
  const smoothed = smoothAndNormalise(counts, LAPLACE_ALPHA);
  const { values: expectedRecovery, note: recoveryNote } = expectedRecoveryTimes(smoothed);

  const students: StudentTrajectory[] = [];
  for (const [studentId, v] of trajectories) {
    const { entropy, dist } = shannonEntropy(v.sequence);
    const tail = tailNonMasteryLength(v.sequence);
    const { score } = riskScore(v.sequence, totalSlides);
    const ending = v.sequence[v.sequence.length - 1] ?? null;
    const hadNonMastery = v.sequence.some((e) => e === 'confused' || e === 'lost');
    const recovered = hadNonMastery && ending === 'got_it';

    students.push({
      studentId,
      studentName: v.studentName,
      sequence: v.sequence,
      distribution: dist,
      entropy: Math.round(entropy * 1000) / 1000,
      endingState: ending,
      tailNonMasteryLength: tail,
      riskScore: Math.round(score * 1000) / 1000,
      recovered,
    });
  }

  students.sort((a, b) => b.riskScore - a.riskScore);
  const atRisk = students.filter((s) => s.riskScore >= threshold);

  // Pre-smoothing sample size — how much evidence we actually had
  let sampleSize = 0;
  for (const row of counts) for (const v of row) sampleSize += v;

  return {
    transitionMatrix: smoothed,
    transitionCounts: counts,
    expectedRecovery,
    recoveryNote,
    students,
    atRisk,
    activeStudents: trajectories.size,
    sampleSize,
  };
}
