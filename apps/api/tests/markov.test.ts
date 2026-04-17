import { describe, it, expect } from 'vitest';
import {
  STATES,
  computeLearningDynamics,
  invertMatrix,
  reconstructTrajectories,
  type FeedbackSample,
} from '../src/lib/markov.js';
import type { Emoji } from '@lecture-feedback/shared';

const sample = (studentId: string, slideIndex: number, emoji: Emoji, ms = 0): FeedbackSample => ({
  studentId,
  slideIndex,
  emoji,
  selectedAt: new Date(1_700_000_000_000 + ms),
});

const names = (ids: string[]): Map<string, string> => new Map(ids.map((id) => [id, id.toUpperCase()]));

describe('invertMatrix', () => {
  it('inverts a known 2×2', () => {
    const inv = invertMatrix([
      [4, 7],
      [2, 6],
    ])!;
    expect(inv[0][0]).toBeCloseTo(0.6, 6);
    expect(inv[0][1]).toBeCloseTo(-0.7, 6);
    expect(inv[1][0]).toBeCloseTo(-0.2, 6);
    expect(inv[1][1]).toBeCloseTo(0.4, 6);
  });

  it('inverts the identity to itself', () => {
    const inv = invertMatrix([
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ])!;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        expect(inv[i][j]).toBeCloseTo(i === j ? 1 : 0, 10);
      }
    }
  });

  it('returns null on a singular matrix', () => {
    // Rows are linearly dependent
    expect(invertMatrix([
      [1, 2],
      [2, 4],
    ])).toBeNull();
  });
});

describe('reconstructTrajectories', () => {
  it('carries last-set emoji forward across un-voted slides', () => {
    const samples = [
      sample('s1', 0, 'got_it', 0),
      // no vote on slide 1 — should carry got_it
      sample('s1', 2, 'confused', 2_000),
      sample('s1', 3, 'got_it', 3_000),
    ];
    const out = reconstructTrajectories(samples, 4, names(['s1']));
    expect(out.get('s1')?.sequence).toEqual(['got_it', 'got_it', 'confused', 'got_it']);
  });

  it('skips leading slides with no vote', () => {
    const samples = [sample('s1', 2, 'got_it')];
    const out = reconstructTrajectories(samples, 4, names(['s1']));
    // Slides 0 and 1 have no state → dropped; slides 2,3 carry the got_it
    expect(out.get('s1')?.sequence).toEqual(['got_it', 'got_it']);
  });

  it('uses the latest emoji within a slide when a student switched', () => {
    const samples = [
      sample('s1', 0, 'confused', 0),
      sample('s1', 0, 'got_it', 1_000),
    ];
    const out = reconstructTrajectories(samples, 1, names(['s1']));
    expect(out.get('s1')?.sequence).toEqual(['got_it']);
  });

  it('omits students with no samples', () => {
    const out = reconstructTrajectories([], 3, names(['ghost']));
    expect(out.size).toBe(0);
  });
});

describe('computeLearningDynamics — core pipeline', () => {
  // Three students, 5 slides. Trajectories chosen so the transition matrix is
  // easy to reason about by hand.
  //
  //  s1: got_it  got_it  confused got_it  got_it     (recovered once)
  //  s2: got_it  confused lost    confused got_it    (recovered after a dip)
  //  s3: got_it  got_it  got_it   got_it  got_it     (stable mastery)
  //
  // Raw transitions (unsmoothed):
  //  s1: G→G, G→C, C→G, G→G           → G→G ×2, G→C ×1, C→G ×1
  //  s2: G→C, C→L, L→C, C→G           → G→C ×1, C→L ×1, L→C ×1, C→G ×1
  //  s3: G→G ×4                        → G→G ×4
  //  --- totals ---
  //  G→G = 6, G→C = 2, C→G = 2, C→L = 1, L→C = 1
  //  (every other cell = 0)
  const samples: FeedbackSample[] = [
    // s1
    sample('s1', 0, 'got_it', 100),
    sample('s1', 1, 'got_it', 200),
    sample('s1', 2, 'confused', 300),
    sample('s1', 3, 'got_it', 400),
    sample('s1', 4, 'got_it', 500),
    // s2
    sample('s2', 0, 'got_it', 110),
    sample('s2', 1, 'confused', 210),
    sample('s2', 2, 'lost', 310),
    sample('s2', 3, 'confused', 410),
    sample('s2', 4, 'got_it', 510),
    // s3
    sample('s3', 0, 'got_it', 120),
    sample('s3', 1, 'got_it', 220),
    sample('s3', 2, 'got_it', 320),
    sample('s3', 3, 'got_it', 420),
    sample('s3', 4, 'got_it', 520),
  ];

  const result = computeLearningDynamics({
    samples,
    totalSlides: 5,
    studentNames: new Map([
      ['s1', 'Alice'],
      ['s2', 'Bob'],
      ['s3', 'Cara'],
    ]),
  });

  it('reports 3 active students', () => {
    expect(result.activeStudents).toBe(3);
  });

  it('counts transitions correctly (pre-smoothing)', () => {
    const C = result.transitionCounts;
    const G = STATES.indexOf('got_it');
    const N = STATES.indexOf('neutral');
    const Conf = STATES.indexOf('confused');
    const L = STATES.indexOf('lost');

    expect(C[G][G]).toBe(6);
    expect(C[G][Conf]).toBe(2);
    expect(C[Conf][G]).toBe(2);
    expect(C[Conf][L]).toBe(1);
    expect(C[L][Conf]).toBe(1);
    // No neutral transitions in the fixtures
    expect(C[N][N]).toBe(0);
    expect(C[N][G]).toBe(0);
  });

  it('transition matrix rows each sum to 1 after smoothing', () => {
    for (const row of result.transitionMatrix) {
      const sum = row.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 8);
    }
  });

  it('expected recovery time for got_it itself is 0 and reachable states are finite', () => {
    expect(result.expectedRecovery.got_it).toBe(0);
    for (const s of ['neutral', 'confused', 'lost'] as const) {
      const v = result.expectedRecovery[s];
      expect(v).not.toBeNull();
      expect(Number.isFinite(v as number)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it('confused recovers faster than lost (because C→G exists but L→G does not)', () => {
    const c = result.expectedRecovery.confused as number;
    const l = result.expectedRecovery.lost as number;
    expect(c).toBeLessThan(l);
  });

  it('ranks stable-mastery student (Cara) below the confused ones', () => {
    const cara = result.students.find((s) => s.studentId === 's3')!;
    const alice = result.students.find((s) => s.studentId === 's1')!;
    expect(cara.riskScore).toBeLessThanOrEqual(alice.riskScore);
    expect(cara.entropy).toBe(0);
    expect(cara.endingState).toBe('got_it');
    expect(cara.recovered).toBe(false); // never dipped, so no recovery story
  });

  it('flags recovery for students who hit non-mastery then returned to got_it', () => {
    const alice = result.students.find((s) => s.studentId === 's1')!;
    const bob = result.students.find((s) => s.studentId === 's2')!;
    expect(alice.recovered).toBe(true);
    expect(bob.recovered).toBe(true);
  });

  it('sampleSize matches the raw transition count', () => {
    // 3 students × (5 slides − 1 transition boundary) = 12
    expect(result.sampleSize).toBe(12);
  });
});

describe('computeLearningDynamics — singular Q fallback', () => {
  it('handles all-lost-forever: students never leave lost, smoothing keeps matrix invertible', () => {
    const samples: FeedbackSample[] = [
      sample('s1', 0, 'lost'),
      sample('s1', 1, 'lost'),
      sample('s1', 2, 'lost'),
      sample('s2', 0, 'lost'),
      sample('s2', 1, 'lost'),
      sample('s2', 2, 'lost'),
    ];
    const out = computeLearningDynamics({
      samples, totalSlides: 3, studentNames: names(['s1', 's2']),
    });
    // Smoothing should let us produce SOME finite recovery number even
    // though nobody ever reached got_it in the raw data. The exact value
    // isn't meaningful; we just need it to be non-null and large.
    expect(out.expectedRecovery.lost).not.toBeNull();
    expect(out.recoveryNote).toBeNull(); // smoothing saved us
  });

  it('handles empty feedback gracefully', () => {
    const out = computeLearningDynamics({
      samples: [], totalSlides: 3, studentNames: new Map(),
    });
    expect(out.activeStudents).toBe(0);
    expect(out.sampleSize).toBe(0);
    expect(out.atRisk).toEqual([]);
    // With zero counts + smoothing, every row is uniform → chain is ergodic.
    // Expected recovery should still come out finite.
    expect(out.expectedRecovery.got_it).toBe(0);
  });
});

describe('Shannon entropy via computeLearningDynamics', () => {
  it('uniform 4-state sequence has entropy 2 bits', () => {
    const samples: FeedbackSample[] = [
      sample('s1', 0, 'got_it'),
      sample('s1', 1, 'neutral'),
      sample('s1', 2, 'confused'),
      sample('s1', 3, 'lost'),
    ];
    const out = computeLearningDynamics({
      samples, totalSlides: 4, studentNames: names(['s1']),
    });
    const s = out.students.find((x) => x.studentId === 's1')!;
    expect(s.entropy).toBeCloseTo(2, 3);
  });

  it('always-got_it sequence has entropy 0', () => {
    const samples: FeedbackSample[] = [
      sample('s1', 0, 'got_it'),
      sample('s1', 1, 'got_it'),
      sample('s1', 2, 'got_it'),
    ];
    const out = computeLearningDynamics({
      samples, totalSlides: 3, studentNames: names(['s1']),
    });
    expect(out.students[0].entropy).toBe(0);
  });
});

describe('risk ordering', () => {
  it('a student stuck in lost at session end ranks above a student who recovered', () => {
    const samples: FeedbackSample[] = [
      // recovered student: ends got_it
      sample('rec', 0, 'got_it'),
      sample('rec', 1, 'confused'),
      sample('rec', 2, 'got_it'),
      sample('rec', 3, 'got_it'),
      // stuck student: ends lost
      sample('stuck', 0, 'got_it'),
      sample('stuck', 1, 'confused'),
      sample('stuck', 2, 'lost'),
      sample('stuck', 3, 'lost'),
    ];
    const out = computeLearningDynamics({
      samples, totalSlides: 4, studentNames: names(['rec', 'stuck']),
    });
    const rec = out.students.find((s) => s.studentId === 'rec')!;
    const stuck = out.students.find((s) => s.studentId === 'stuck')!;
    expect(stuck.riskScore).toBeGreaterThan(rec.riskScore);
    expect(out.atRisk[0].studentId).toBe('stuck');
  });
});
