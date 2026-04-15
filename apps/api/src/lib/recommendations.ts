/**
 * Rule-based smart recommendation engine.
 * Generates specific, actionable recommendations per slide based on
 * confusion data, Q&A content, timing, and pace feedback.
 */
import type { SmartRecommendation, ConfusionHighlight } from '@lecture-feedback/shared';

interface SlideData {
  slideIndex: number;
  totalSlides: number;
  distribution: { got_it: number; neutral: number; confused: number; lost: number; total: number };
  timeSeconds: number | null;
  avgTimePerSlide: number | null;
  questions: { content: string; answered: boolean }[];
  confusionContexts: { highlights: ConfusionHighlight[]; explanation: string | null; emoji: 'confused' | 'lost' }[];
}

// ── Keyword patterns for explanation analysis ────────────────────────────────

const CONTENT_KEYWORDS: Record<string, string[]> = {
  formula:    ['formula', 'equation', 'calculation', 'math', 'compute', 'derive', 'proof'],
  diagram:    ['diagram', 'figure', 'chart', 'graph', 'image', 'picture', 'visual', 'illustration'],
  example:    ['example', 'instance', 'case', 'demo', 'demonstrate', 'show how', 'practice'],
  code:       ['code', 'syntax', 'function', 'method', 'class', 'variable', 'algorithm', 'program'],
  definition: ['definition', 'define', 'meaning', 'concept', 'term', 'terminology', 'what is'],
  speed:      ['fast', 'quick', 'slow', 'pace', 'rushed', 'hurry', 'speed', 'too quick'],
  text:       ['text', 'read', 'small', 'font', 'tiny', 'can\'t see', 'hard to read'],
  complex:    ['complex', 'complicated', 'confusing', 'hard', 'difficult', 'overwhelming', 'dense'],
};

function detectThemes(texts: string[]): Set<string> {
  const themes = new Set<string>();
  const combined = texts.join(' ').toLowerCase();
  for (const [theme, keywords] of Object.entries(CONTENT_KEYWORDS)) {
    if (keywords.some((kw) => combined.includes(kw))) {
      themes.add(theme);
    }
  }
  return themes;
}

// ── Highlight position analysis ──────────────────────────────────────────────

function analyzeHighlightPositions(highlights: ConfusionHighlight[]): { region: string; count: number }[] {
  const regions = { top: 0, middle: 0, bottom: 0, left: 0, right: 0 };

  for (const hl of highlights) {
    const centerY = hl.shape === 'circle' ? hl.y : hl.y + hl.height / 2;
    const centerX = hl.shape === 'circle' ? hl.x : hl.x + hl.width / 2;

    if (centerY < 0.33) regions.top++;
    else if (centerY < 0.66) regions.middle++;
    else regions.bottom++;

    if (centerX < 0.4) regions.left++;
    else if (centerX > 0.6) regions.right++;
  }

  return Object.entries(regions)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([region, count]) => ({ region, count }));
}

// ── Main recommendation generator ────────────────────────────────────────────

export function generateRecommendations(slide: SlideData): SmartRecommendation[] {
  const recs: SmartRecommendation[] = [];
  const { distribution: dist, timeSeconds, avgTimePerSlide, questions, confusionContexts } = slide;
  const total = dist.total;
  if (total === 0) return recs;

  const confusedPct = ((dist.confused + dist.lost) / total) * 100;
  const lostPct = (dist.lost / total) * 100;
  const gotItPct = (dist.got_it / total) * 100;
  const confusionCount = confusionContexts.length;

  // ── Confusion-based recommendations ────────────────────────────────

  if (confusedPct >= 50) {
    recs.push({
      type: 'content',
      severity: 'critical',
      message: 'Over half the class was confused or lost on this slide. Consider splitting this into multiple slides with a gradual build-up, or adding a prerequisite recap slide before it.',
      evidence: `${Math.round(confusedPct)}% confused/lost (${dist.confused + dist.lost} of ${total} responses)`,
    });
  } else if (confusedPct >= 30) {
    recs.push({
      type: 'content',
      severity: 'warning',
      message: 'Significant confusion detected. Add concrete examples or a worked-through problem to reinforce this concept.',
      evidence: `${Math.round(confusedPct)}% confused/lost`,
    });
  }

  if (lostPct >= 20) {
    recs.push({
      type: 'content',
      severity: 'critical',
      message: `${Math.round(lostPct)}% of students were completely lost — not just confused. This suggests a prerequisite gap. Consider adding a "what you need to know first" mini-review before this content.`,
      evidence: `${dist.lost} students selected "Lost"`,
    });
  }

  // ── Confusion highlight analysis ───────────────────────────────────

  if (confusionCount > 0) {
    const allHighlights = confusionContexts.flatMap((c) => c.highlights);
    if (allHighlights.length > 0) {
      const positions = analyzeHighlightPositions(allHighlights);
      const topRegion = positions[0];
      if (topRegion) {
        const regionLabels: Record<string, string> = {
          top: 'the top section (likely a title, formula, or definition)',
          middle: 'the middle section (the main content area)',
          bottom: 'the bottom section (possibly a summary, footnote, or diagram)',
          left: 'the left side',
          right: 'the right side',
        };
        recs.push({
          type: 'content',
          severity: 'warning',
          message: `Students specifically highlighted ${regionLabels[topRegion.region] ?? topRegion.region} as confusing. Consider adding annotations, enlarging that element, or explaining it step-by-step.`,
          evidence: `${allHighlights.length} highlight mark${allHighlights.length !== 1 ? 's' : ''}, concentrated in ${topRegion.region} (${topRegion.count} mark${topRegion.count !== 1 ? 's' : ''})`,
        });
      }
    }

    // Analyse explanation text
    const explanations = confusionContexts
      .map((c) => c.explanation)
      .filter((e): e is string => !!e);

    if (explanations.length > 0) {
      const themes = detectThemes(explanations);

      if (themes.has('formula')) {
        recs.push({
          type: 'content', severity: 'warning',
          message: 'Students mentioned formulas/equations as a source of confusion. Add a step-by-step derivation or a "what each symbol means" breakdown.',
          evidence: `${explanations.length} student explanation${explanations.length !== 1 ? 's' : ''} referencing formulas`,
        });
      }
      if (themes.has('example')) {
        recs.push({
          type: 'content', severity: 'info',
          message: 'Students are asking for examples. Add a concrete, relatable worked example before the abstract definition.',
          evidence: 'Student explanations request examples',
        });
      }
      if (themes.has('code')) {
        recs.push({
          type: 'content', severity: 'warning',
          message: 'Code on this slide confused students. Consider a live code walkthrough, add inline comments, or highlight the key lines.',
          evidence: 'Student explanations reference code/syntax',
        });
      }
      if (themes.has('text') || themes.has('diagram')) {
        recs.push({
          type: 'structure', severity: 'info',
          message: 'Students mentioned readability issues (small text, unclear diagrams). Increase font size, simplify the visual, or split content across slides.',
          evidence: 'Student explanations mention readability',
        });
      }
      if (themes.has('complex')) {
        recs.push({
          type: 'structure', severity: 'warning',
          message: 'Students describe this slide as too complex or dense. Break it into 2-3 simpler slides with progressive disclosure.',
          evidence: 'Student explanations describe overwhelming complexity',
        });
      }
      if (themes.has('speed')) {
        recs.push({
          type: 'pacing', severity: 'warning',
          message: 'Students felt this was covered too quickly. Spend more time here or add a pause-and-check moment.',
          evidence: 'Student explanations mention pace/speed',
        });
      }
    }
  }

  // ── Timing-based recommendations ───────────────────────────────────

  if (timeSeconds !== null && avgTimePerSlide !== null && avgTimePerSlide > 0) {
    const ratio = timeSeconds / avgTimePerSlide;
    if (ratio < 0.3 && confusedPct > 10) {
      recs.push({
        type: 'pacing', severity: 'warning',
        message: `This slide was shown for only ${formatTime(timeSeconds)} (${Math.round(ratio * 100)}% of the average ${formatTime(Math.round(avgTimePerSlide))}), yet had ${Math.round(confusedPct)}% confusion. Slow down here.`,
        evidence: `${formatTime(timeSeconds)} vs ${formatTime(Math.round(avgTimePerSlide))} average`,
      });
    }
    if (ratio > 3 && gotItPct > 80) {
      recs.push({
        type: 'pacing', severity: 'info',
        message: `You spent ${formatTime(timeSeconds)} here (${Math.round(ratio)}x the average) but 80%+ understood it. You could move faster through this content.`,
        evidence: `${formatTime(timeSeconds)} spent, ${Math.round(gotItPct)}% got it`,
      });
    }
  }

  // ── Q&A-based recommendations ──────────────────────────────────────

  if (questions.length >= 3) {
    const themes = detectThemes(questions.map((q) => q.content));
    recs.push({
      type: 'engagement', severity: 'info',
      message: `${questions.length} questions were asked on this slide, suggesting it needs more explanation or is a natural discussion point. Consider adding an interactive element or dedicated Q&A pause here.`,
      evidence: `${questions.length} questions${themes.size > 0 ? `, themes: ${[...themes].join(', ')}` : ''}`,
    });
  }

  const unanswered = questions.filter((q) => !q.answered).length;
  if (unanswered > 0) {
    recs.push({
      type: 'engagement', severity: 'info',
      message: `${unanswered} question${unanswered !== 1 ? 's' : ''} from this slide ${unanswered !== 1 ? 'were' : 'was'} not addressed during the session. Review and consider addressing in the next lecture.`,
      evidence: `${unanswered}/${questions.length} unanswered`,
    });
  }

  // ── Positive feedback ──────────────────────────────────────────────

  if (gotItPct >= 95 && total >= 5) {
    recs.push({
      type: 'content', severity: 'info',
      message: 'Excellent understanding — this slide works well. Keep it as-is.',
      evidence: `${Math.round(gotItPct)}% got it (${dist.got_it}/${total})`,
    });
  }

  return recs;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
