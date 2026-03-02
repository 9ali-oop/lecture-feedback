import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout.tsx';
import FeedbackPieChart from '../../components/FeedbackPieChart.tsx';
import SlideViewerModal from '../../components/SlideViewerModal.tsx';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { api } from '../../lib/api.ts';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { SessionReport as Report, SlideReport, SlideNote, ConfusionHighlight, TimelineBucket, ReflectionSummary, SmartRecommendation } from '@lecture-feedback/shared';

// ── Sub-components ──────────────────────────────────────────────────────────

function SlideWhiteboard({ sessionId, slideIndex }: { sessionId: string; slideIndex: number }) {
  const [open, setOpen] = useState(false);
  const token = localStorage.getItem('token');
  const url = api.whiteboardUrl(sessionId, slideIndex);
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <button onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-amber-600 hover:text-amber-700">
        <ChevronIcon open={open} /> Whiteboard notes
      </button>
      {open && (
        <div className="mt-2 overflow-hidden rounded-lg border border-gray-200">
          <img src={`${url}${token ? `?token=${token}` : ''}`} alt={`Whiteboard for slide ${slideIndex + 1}`} className="w-full" />
        </div>
      )}
    </div>
  );
}

function SlideQA({ slide }: { slide: SlideReport }) {
  const [open, setOpen] = useState(false);
  if (slide.questions.length === 0) return null;
  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <button onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700">
        <ChevronIcon open={open} />
        {slide.questions.length} question{slide.questions.length !== 1 ? 's' : ''}
      </button>
      {open && (
        <ul className="mt-2 space-y-2">
          {slide.questions.map((q) => (
            <li key={q.id} className="rounded-lg bg-gray-50 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-gray-800">{q.content}</p>
                {q.answered
                  ? <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">Answered</span>
                  : <span className="shrink-0 rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-700">Open</span>}
              </div>
              <p className="mt-0.5 text-[10px] text-gray-400">{q.studentName}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SlideConfusionSection({ slide }: { slide: SlideReport }) {
  const [open, setOpen] = useState(false);
  const contexts = slide.confusionContexts ?? [];
  if (contexts.length === 0) return null;
  const withExplanation = contexts.filter((c) => c.explanation);

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <button onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-red-600 hover:text-red-700">
        <ChevronIcon open={open} />
        {contexts.length} confusion report{contexts.length !== 1 ? 's' : ''}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {/* Heatmap visualization */}
          <ConfusionHeatmap highlights={contexts.flatMap((c) => c.highlights)} />
          {/* Text explanations */}
          {withExplanation.length > 0 && (
            <ul className="space-y-1.5">
              {withExplanation.map((cc) => (
                <li key={cc.id} className="rounded-lg bg-red-50 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-gray-800">{cc.explanation}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      cc.emoji === 'lost' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {cc.emoji === 'lost' ? 'Lost' : 'Confused'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-gray-400">{cc.studentName}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Renders overlapping confusion highlights as a density heatmap */
function ConfusionHeatmap({ highlights }: { highlights: ConfusionHighlight[] }) {
  if (highlights.length === 0) return null;
  return (
    <div className="relative h-40 w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
      <div className="absolute inset-0 text-center flex items-center justify-center text-[10px] text-gray-300 font-medium">
        Confusion heatmap — darker = more students
      </div>
      {highlights.map((hl, i) => {
        // Each overlay adds opacity — overlapping areas become darker
        const opacity = Math.min(0.15, 0.6 / highlights.length + 0.05);
        const style: React.CSSProperties = hl.shape === 'rect'
          ? {
              position: 'absolute',
              left: `${hl.x * 100}%`, top: `${hl.y * 100}%`,
              width: `${hl.width * 100}%`, height: `${hl.height * 100}%`,
              background: `rgba(239, 68, 68, ${opacity})`,
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '3px',
            }
          : {
              position: 'absolute',
              left: `${(hl.x - hl.width) * 100}%`, top: `${(hl.y - hl.height) * 100}%`,
              width: `${hl.width * 2 * 100}%`, height: `${hl.height * 2 * 100}%`,
              background: `rgba(239, 68, 68, ${opacity})`,
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '50%',
            };
        return <div key={i} style={style} />;
      })}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Sort/filter types ───────────────────────────────────────────────────────

type SortKey = 'slide' | 'confusion_pct' | 'got_it_pct' | 'questions' | 'time' | 'confusion_areas' | 'responses';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'slide', label: 'Slide order' },
  { key: 'confusion_pct', label: 'Most confused' },
  { key: 'confusion_areas', label: 'Confusion areas' },
  { key: 'got_it_pct', label: 'Least understood' },
  { key: 'questions', label: 'Most questions' },
  { key: 'responses', label: 'Most responses' },
  { key: 'time', label: 'Longest time' },
];

// ── Main component ──────────────────────────────────────────────────────────

export default function SessionReport({ backUrl }: { backUrl?: string }) {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewerSlide, setViewerSlide] = useState<number | null>(null);
  const [reportNotes, setReportNotes] = useState<SlideNote[]>([]);
  const { user } = useAuth();

  // Sort/filter state
  const [sortBy, setSortBy] = useState<SortKey>('slide');
  const [filterConfusion, setFilterConfusion] = useState(false);
  const [filterQuestions, setFilterQuestions] = useState(false);

  // Timeline
  const [timeline, setTimeline] = useState<TimelineBucket[]>([]);
  const [showTimeline, setShowTimeline] = useState(true);

  // Reflections
  const [reflections, setReflections] = useState<ReflectionSummary | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    api.getReport(sessionId).then((r) => { setReport(r); setLoading(false); });
    api.getTimeline(sessionId).then(setTimeline).catch(() => {});
    api.getReflections(sessionId).then(setReflections).catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !user) return;
    if (user.role === 'student') {
      api.listNotes(sessionId).then(setReportNotes);
    } else {
      api.getAllNotes(sessionId).then(setReportNotes);
    }
  }, [sessionId, user]);

  const isLecturer = user?.role === 'lecturer' || user?.role === 'admin';

  // Computed sorted + filtered slides
  const processedSlides = useMemo(() => {
    if (!report) return [];
    let result = [...report.slides];

    // Filters
    if (filterConfusion) {
      result = result.filter((s) => (s.confusionContexts?.length ?? 0) > 0);
    }
    if (filterQuestions) {
      result = result.filter((s) => s.questions.length > 0);
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case 'confusion_pct': {
          const aPct = a.distribution.total > 0 ? (a.distribution.confused + a.distribution.lost) / a.distribution.total : 0;
          const bPct = b.distribution.total > 0 ? (b.distribution.confused + b.distribution.lost) / b.distribution.total : 0;
          return bPct - aPct;
        }
        case 'confusion_areas':
          return (b.confusionContexts?.length ?? 0) - (a.confusionContexts?.length ?? 0);
        case 'got_it_pct': {
          const aGot = a.distribution.total > 0 ? a.distribution.got_it / a.distribution.total : 1;
          const bGot = b.distribution.total > 0 ? b.distribution.got_it / b.distribution.total : 1;
          return aGot - bGot; // lowest first
        }
        case 'questions':
          return b.questions.length - a.questions.length;
        case 'responses':
          return b.distribution.total - a.distribution.total;
        case 'time':
          return (b.timeSeconds ?? 0) - (a.timeSeconds ?? 0);
        default:
          return a.slideIndex - b.slideIndex;
      }
    });

    return result;
  }, [report, sortBy, filterConfusion, filterQuestions]);

  if (loading) {
    return (
      <Layout title="Session report" back={backUrl}>
        <div className="flex h-64 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (!report) return null;

  const { session, totalEnrolled, peakParticipants, slides, overallDistribution } = report;

  const annotatedSlides = new Set(
    slides.filter((s) => s.hasAnnotation).map((s) => s.slideIndex),
  );

  function confusionPct(slide: SlideReport): number {
    const { confused, lost, total } = slide.distribution;
    return total > 0 ? Math.round(((confused + lost) / total) * 100) : 0;
  }

  function gotItPct(slide: SlideReport): number {
    const { got_it, total } = slide.distribution;
    return total > 0 ? Math.round((got_it / total) * 100) : 0;
  }

  return (
    <Layout title="Session report" back={backUrl ?? `/lecturer/module/${session.moduleId}`}>
      {/* Header */}
      <div className="mb-8">
        <div className="mb-1 text-sm text-gray-500">{session.moduleCode} · {session.moduleName}</div>
        <h1 className="text-2xl font-bold text-gray-900">{session.title}</h1>
        <div className="mt-2 flex gap-6 text-sm text-gray-500">
          <span>{totalEnrolled} enrolled</span>
          <span>{peakParticipants} attended</span>
          {session.startedAt && (
            <span>{new Date(session.startedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}</span>
          )}
        </div>
      </div>

      {/* Overall */}
      <div className="mb-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
        <h2 className="mb-4 font-semibold text-gray-900">Overall understanding</h2>
        <div className="grid grid-cols-2 gap-6">
          <FeedbackPieChart distribution={overallDistribution} />
          <div className="flex flex-col justify-center space-y-3">
            {(['got_it', 'neutral', 'confused', 'lost'] as const).map((k) => {
              const pct = overallDistribution.total > 0
                ? Math.round((overallDistribution[k] / overallDistribution.total) * 100)
                : 0;
              const colors: Record<string, string> = {
                got_it: 'bg-green-500', neutral: 'bg-blue-500',
                confused: 'bg-yellow-500', lost: 'bg-red-500',
              };
              const labels: Record<string, string> = {
                got_it: 'Got it', neutral: 'Neutral',
                confused: 'Confused', lost: 'Lost',
              };
              return (
                <div key={k}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="text-gray-600">{labels[k]}</span>
                    <span className="font-semibold text-gray-900">{pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                    <div className={`h-full rounded-full transition-all ${colors[k]}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Engagement Timeline */}
      {isLecturer && timeline.length > 0 && (
        <div className="mb-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <button onClick={() => setShowTimeline((v) => !v)}
            className="flex w-full items-center justify-between">
            <h2 className="font-semibold text-gray-900">Engagement timeline</h2>
            <span className="text-xs text-gray-400">{showTimeline ? 'Hide' : 'Show'}</span>
          </button>
          {showTimeline && (
            <div className="mt-4">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={timeline.map((b, i) => ({
                  idx: i,
                  time: new Date(b.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
                  confusion: b.confusedPct,
                  responses: b.responseCount,
                  questions: b.questionCount,
                  slide: b.slideIndex,
                }))}>
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number, name: string) =>
                    [name === 'confusion' ? `${v}%` : v, name === 'confusion' ? 'Confused/Lost %' : name === 'responses' ? 'Responses' : 'Questions']
                  } />
                  <Area type="monotone" dataKey="confusion" stroke="#ef4444" fill="#fecaca" strokeWidth={2} />
                  <Area type="monotone" dataKey="responses" stroke="#3b82f6" fill="#bfdbfe" strokeWidth={1} />
                  <Area type="monotone" dataKey="questions" stroke="#8b5cf6" fill="#ddd6fe" strokeWidth={1} />
                  {/* Slide transition markers */}
                  {timeline.reduce<number[]>((acc, b, i) => {
                    if (i > 0 && b.slideIndex !== timeline[i - 1].slideIndex) acc.push(i);
                    return acc;
                  }, []).map((i) => (
                    <ReferenceLine key={i} x={timeline[i] ? new Date(timeline[i].timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''} stroke="#d1d5db" strokeDasharray="3 3" />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
              <div className="mt-2 flex justify-center gap-4 text-[10px] text-gray-500">
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded bg-red-200 ring-1 ring-red-400" /> Confusion %</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded bg-blue-200 ring-1 ring-blue-400" /> Responses</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded bg-purple-200 ring-1 ring-purple-400" /> Questions</span>
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-0.5 bg-gray-300" /> Slide change</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Student Reflections */}
      {isLecturer && reflections && reflections.totalResponses > 0 && (
        <div className="mb-8 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-100">
          <h2 className="font-semibold text-gray-900">Student reflections</h2>
          <p className="mt-1 text-xs text-gray-500">{reflections.totalResponses} student{reflections.totalResponses !== 1 ? 's' : ''} submitted reflections</p>

          <div className="mt-4 grid grid-cols-2 gap-4">
            {/* Top learnings */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-green-600">Key learnings</h3>
              {reflections.topLearnings.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {reflections.topLearnings.map((phrase, i) => (
                    <span key={i} className="rounded-full bg-green-50 px-2.5 py-1 text-xs text-green-700 ring-1 ring-green-200">{phrase}</span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">No common themes detected</p>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">View all responses</summary>
                <ul className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                  {reflections.reflections.filter((r) => r.mostImportant).map((r) => (
                    <li key={r.id} className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-700">{r.mostImportant}</li>
                  ))}
                </ul>
              </details>
            </div>

            {/* Still unclear */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-600">Still unclear</h3>
              {reflections.topUnclear.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {reflections.topUnclear.map((phrase, i) => (
                    <span key={i} className="rounded-full bg-red-50 px-2.5 py-1 text-xs text-red-700 ring-1 ring-red-200">{phrase}</span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">No common themes detected</p>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">View all responses</summary>
                <ul className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                  {reflections.reflections.filter((r) => r.stillUnclear).map((r) => (
                    <li key={r.id} className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs text-gray-700">{r.stillUnclear}</li>
                  ))}
                </ul>
              </details>
            </div>
          </div>
        </div>
      )}

      {/* Sort/filter controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="font-semibold text-gray-900">Slide-by-slide breakdown</h2>
        <div className="flex-1" />

        {/* Sort */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Filters */}
        {isLecturer && (
          <>
            <button
              onClick={() => setFilterConfusion((v) => !v)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                filterConfusion
                  ? 'bg-red-100 text-red-700 ring-1 ring-red-300'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              Has confusion
            </button>
            <button
              onClick={() => setFilterQuestions((v) => !v)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                filterQuestions
                  ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-300'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              Has questions
            </button>
          </>
        )}

        <span className="text-xs text-gray-400">{processedSlides.length} / {slides.length} slides</span>
      </div>

      {/* Slides */}
      <div className="space-y-3">
        {processedSlides.map((slide) => {
          const cp = confusionPct(slide);
          const gp = gotItPct(slide);
          const hasData = slide.distribution.total > 0;
          const confusionAreaCount = slide.confusionContexts?.length ?? 0;

          let borderColor = 'border-gray-100';
          if (hasData && cp >= 10) borderColor = 'border-yellow-300';
          if (hasData && gp >= 97.5) borderColor = 'border-green-300';

          return (
            <div key={slide.slideIndex}
              className={`rounded-2xl border bg-white p-5 shadow-sm ${borderColor}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-400">Slide {slide.slideIndex + 1}</span>
                    {confusionAreaCount > 0 && (
                      <span className="rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">
                        {confusionAreaCount} area{confusionAreaCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  {hasData && (
                    <div className="mt-1 flex gap-3 text-sm">
                      <span className="font-semibold text-green-600">{gp}% got it</span>
                      {cp > 0 && <span className="font-semibold text-red-500">{cp}% confused/lost</span>}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                  {slide.timeSeconds !== null && (
                    <span title="Time spent on slide">⏱ {formatSeconds(slide.timeSeconds)}</span>
                  )}
                  {hasData && <span>{slide.distribution.total} responses</span>}
                  <button
                    onClick={() => setViewerSlide(slide.slideIndex)}
                    className="rounded-lg bg-blue-600/10 px-2.5 py-1 text-xs font-medium text-blue-500 transition hover:bg-blue-600/20 hover:text-blue-400"
                  >
                    View Slide
                  </button>
                </div>
              </div>

              {hasData && (
                <>
                  <div className="mt-3 flex h-2 overflow-hidden rounded-full">
                    {(['got_it', 'neutral', 'confused', 'lost'] as const).map((k) => {
                      const w = slide.distribution.total > 0
                        ? (slide.distribution[k] / slide.distribution.total) * 100 : 0;
                      const bg: Record<string, string> = {
                        got_it: 'bg-green-500', neutral: 'bg-blue-500',
                        confused: 'bg-yellow-500', lost: 'bg-red-500',
                      };
                      return w > 0 ? <div key={k} className={bg[k]} style={{ width: `${w}%` }} /> : null;
                    })}
                  </div>
                  {/* Smart recommendations */}
                  {slide.smartRecommendations && slide.smartRecommendations.length > 0 ? (
                    <div className="mt-3 space-y-1.5">
                      {slide.smartRecommendations.map((rec, i) => {
                        const colors = {
                          critical: 'border-red-200 bg-red-50 text-red-800',
                          warning: 'border-yellow-200 bg-yellow-50 text-yellow-800',
                          info: 'border-blue-200 bg-blue-50 text-blue-800',
                        };
                        const icons = { critical: '!', warning: '!', info: 'i' };
                        const iconBg = { critical: 'bg-red-500', warning: 'bg-yellow-500', info: 'bg-blue-500' };
                        return (
                          <div key={i} className={`rounded-lg border px-3 py-2 ${colors[rec.severity]}`}>
                            <div className="flex items-start gap-2">
                              <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white ${iconBg[rec.severity]}`}>
                                {icons[rec.severity]}
                              </span>
                              <div>
                                <p className="text-xs">{rec.message}</p>
                                <p className="mt-0.5 text-[10px] opacity-60">{rec.evidence}</p>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-3 text-xs text-gray-500">{slide.recommendation}</p>
                  )}
                </>
              )}

              {!hasData && <p className="mt-1 text-xs text-gray-400">No feedback recorded</p>}

              <SlideQA slide={slide} />
              {isLecturer && <SlideConfusionSection slide={slide} />}
              {slide.hasWhiteboard && sessionId && (
                <SlideWhiteboard sessionId={sessionId} slideIndex={slide.slideIndex} />
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 flex justify-center">
        <button
          onClick={() => navigate(backUrl ?? `/lecturer/module/${session.moduleId}`)}
          className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          Back to sessions
        </button>
      </div>

      {viewerSlide !== null && report && (
        <SlideViewerModal
          sessionId={sessionId!}
          totalSlides={report.session.totalSlides}
          initialSlide={viewerSlide}
          annotatedSlides={annotatedSlides}
          notes={reportNotes}
          role={user?.role ?? 'student'}
          onClose={() => setViewerSlide(null)}
        />
      )}
    </Layout>
  );
}
