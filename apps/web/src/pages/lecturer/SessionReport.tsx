import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout.tsx';
import FeedbackPieChart from '../../components/FeedbackPieChart.tsx';
import SlideViewerModal from '../../components/SlideViewerModal.tsx';
import { useAuth } from '../../contexts/AuthContext.tsx';
import { api } from '../../lib/api.ts';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import EngagementGauge from '../../components/EngagementGauge.tsx';
import type { SessionReport as Report, SlideReport, SlideNote, ConfusionHighlight, TimelineBucket, ReflectionSummary, SmartRecommendation, EngagementAnalytics } from '@lecture-feedback/shared';

// ── Sub-components ──────────────────────────────────────────────────────────

function SlideWhiteboard({ sessionId, slideIndex }: { sessionId: string; slideIndex: number }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const token = localStorage.getItem('token');
  const url = api.whiteboardUrl(sessionId, slideIndex);
  return (
    <div className="mt-3 border-t border-gray-100 dark:border-gray-800 pt-3">
      <button onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300">
        <ChevronIcon open={open} /> Whiteboard notes
      </button>
      {open && (
        <div className="mt-2 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
          {error ? (
            <p className="p-4 text-center text-xs text-gray-400">No whiteboard saved for this slide</p>
          ) : (
            <img
              src={`${url}${token ? `?token=${token}` : ''}`}
              alt={`Whiteboard for slide ${slideIndex + 1}`}
              className="w-full"
              onError={() => setError(true)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SlideQA({ slide }: { slide: SlideReport }) {
  const [open, setOpen] = useState(false);
  if (slide.questions.length === 0) return null;
  return (
    <div className="mt-3 border-t border-gray-100 dark:border-gray-800 pt-3">
      <button onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300">
        <ChevronIcon open={open} />
        {slide.questions.length} question{slide.questions.length !== 1 ? 's' : ''}
      </button>
      {open && (
        <ul className="mt-2 space-y-2">
          {slide.questions.map((q) => (
            <li key={q.id} className="rounded-lg bg-gray-50 dark:bg-gray-800 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs text-gray-800 dark:text-gray-200">{q.content}</p>
                {q.answered
                  ? <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">Answered</span>
                  : <span className="shrink-0 rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-700">Unanswered</span>}
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
    <div className="mt-3 border-t border-gray-100 dark:border-gray-800 pt-3">
      <button onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300">
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
                <li key={cc.id} className="rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs text-gray-800 dark:text-gray-200">{cc.explanation}</p>
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
    <div className="relative h-40 w-full overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
      <div className="absolute inset-0 text-center flex items-center justify-center text-[10px] text-gray-300 dark:text-gray-600 font-medium">
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

  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionId) return;
    api.getReport(sessionId)
      .then((r) => { setReport(r); })
      .catch((err) => { setError(err instanceof Error ? err.message : 'Failed to load report'); })
      .finally(() => { setLoading(false); });
  }, [sessionId]);

  // Only fetch lecturer-only data when the user is a lecturer/admin
  useEffect(() => {
    if (!sessionId || !user) return;
    if (user.role === 'lecturer' || user.role === 'admin') {
      api.getTimeline(sessionId).then(setTimeline).catch(() => {});
      api.getReflections(sessionId).then(setReflections).catch(() => {});
    }
  }, [sessionId, user]);

  useEffect(() => {
    if (!sessionId || !user) return;
    if (user.role === 'student') {
      api.listNotes(sessionId).then(setReportNotes).catch(() => {});
    } else {
      api.getAllNotes(sessionId).then(setReportNotes).catch(() => {});
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
    const fallbackBack = backUrl ?? (user?.role === 'student' ? '/student' : '/lecturer');
    return (
      <Layout title="Session report" back={fallbackBack}>
        <div className="flex h-64 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
        </div>
      </Layout>
    );
  }

  if (error) {
    const fallbackBack = backUrl ?? (user?.role === 'student' ? '/student' : '/lecturer');
    return (
      <Layout title="Session report" back={fallbackBack}>
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>
      </Layout>
    );
  }

  if (!report) return null;

  const { session, totalEnrolled, peakParticipants, slides, overallDistribution, engagement } = report;

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
        <div className="mb-1 text-sm text-gray-400">{session.moduleCode} · {session.moduleName}</div>
        <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">{session.title}</h1>
        <div className="mt-3 flex flex-wrap gap-2">
          {isLecturer && (
            <>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-400">
                <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                {totalEnrolled} enrolled
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-400">
                <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                {peakParticipants} attended
              </span>
            </>
          )}
          {session.startedAt && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 dark:bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-400">
              <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
              {new Date(session.startedAt).toLocaleDateString('en-GB', { dateStyle: 'medium' })}
            </span>
          )}
        </div>
      </div>

      {/* Overall */}
      {isLecturer && (
      <div className="mb-8 rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-sm ring-1 ring-gray-100 dark:ring-gray-800">
        <h2 className="mb-4 font-semibold text-gray-900 dark:text-gray-100">Overall understanding</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <FeedbackPieChart distribution={overallDistribution} emptyLabel="No feedback recorded" />
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
                    <span className="text-gray-600 dark:text-gray-400">{labels[k]}</span>
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div className={`h-full rounded-full transition-all ${colors[k]}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      )}

      {/* Engagement Score (lecturer only) */}
      {isLecturer && engagement && (
        <div className="mb-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-sm ring-1 ring-gray-100 dark:ring-gray-800">
            <h2 className="mb-4 font-semibold text-gray-900 dark:text-gray-100">Engagement score</h2>
            <EngagementGauge score={engagement.overallScore} />
          </div>

          {/* Signal comparison - research question */}
          <div className="rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-sm ring-1 ring-gray-100 dark:ring-gray-800">
            <h2 className="mb-4 font-semibold text-gray-900 dark:text-gray-100">Signal analysis</h2>
            <div className="space-y-2">
              {engagement.signalComparison.map((sc) => (
                <div key={sc.signalName} className="flex items-center gap-2">
                  <span className="w-20 text-[11px] text-gray-500 dark:text-gray-400">{sc.signalName}</span>
                  <div className="flex-1 flex items-center gap-1.5">
                    <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                      <div className="h-full rounded-full bg-blue-500" style={{ width: `${sc.soloScore}%` }} />
                    </div>
                    <span className="w-8 text-right text-[10px] font-medium text-gray-600 dark:text-gray-300 tabular-nums">{sc.soloScore}</span>
                  </div>
                  <span className="w-10 text-right text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">r={sc.correlation}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 px-3 py-2">
              <p className="text-[11px] text-blue-700 dark:text-blue-300">
                Multi-signal composite ({engagement.overallScore.overall}) vs best single signal (
                {Math.max(...engagement.signalComparison.map(s => s.soloScore))}
                ): {engagement.overallScore.overall > Math.max(...engagement.signalComparison.map(s => s.soloScore))
                  ? `+${engagement.overallScore.overall - Math.max(...engagement.signalComparison.map(s => s.soloScore))} points improvement`
                  : 'comparable'
                }
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Proficiency Breakdown (lecturer only) */}
      {isLecturer && engagement && engagement.proficiencyBreakdown.length > 1 && (
        <div className="mb-8 rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-sm ring-1 ring-gray-100 dark:ring-gray-800">
          <h2 className="mb-4 font-semibold text-gray-900 dark:text-gray-100">Engagement by English proficiency</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {engagement.proficiencyBreakdown.map((p) => (
              <div key={p.proficiency} className="rounded-xl bg-gray-50 dark:bg-gray-800 p-3 text-center">
                <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-gray-100">{p.averageScore}</div>
                <div className="mt-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 capitalize">{p.proficiency}</div>
                <div className="text-[10px] text-gray-400 dark:text-gray-500">{p.studentCount} student{p.studentCount !== 1 ? 's' : ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Engagement Timeline */}
      {isLecturer && timeline.length > 0 && (
        <div className="mb-8 rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-sm ring-1 ring-gray-100 dark:ring-gray-800">
          <button onClick={() => setShowTimeline((v) => !v)}
            className="flex w-full items-center justify-between">
            <h2 className="font-semibold text-gray-900 dark:text-gray-100">Engagement timeline</h2>
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
                  engagement: b.engagementScore,
                  slide: b.slideIndex,
                }))}>
                  <XAxis dataKey="time" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v: number, name: string) =>
                    [name === 'confusion' ? `${v}%` : name === 'engagement' ? `${v}/100` : v,
                     name === 'confusion' ? 'Confused/Lost %' : name === 'engagement' ? 'Engagement' : name === 'responses' ? 'Responses' : 'Questions']
                  } />
                  <Area type="monotone" dataKey="engagement" stroke="#10b981" fill="#a7f3d0" strokeWidth={2} />
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
              <div className="mt-2 flex flex-wrap justify-center gap-3 text-[10px] text-gray-500">
                <span className="flex items-center gap-1"><span className="inline-block h-2 w-4 rounded bg-emerald-200 ring-1 ring-emerald-400" /> Engagement</span>
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
        <div className="mb-8 rounded-2xl bg-white dark:bg-gray-900 p-6 shadow-sm ring-1 ring-gray-100 dark:ring-gray-800">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100">Student reflections</h2>
          <p className="mt-1 text-xs text-gray-500">{reflections.totalResponses} student{reflections.totalResponses !== 1 ? 's' : ''} submitted reflections</p>

          <div className="mt-4 grid grid-cols-2 gap-4">
            {/* Top learnings */}
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-green-600">Key learnings</h3>
              {reflections.topLearnings.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {reflections.topLearnings.map((phrase, i) => (
                    <span key={i} className="rounded-full bg-green-50 dark:bg-green-900/30 px-2.5 py-1 text-xs text-green-700 dark:text-green-300 ring-1 ring-green-200 dark:ring-green-700">{phrase}</span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">No common themes detected</p>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">View all responses</summary>
                <ul className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                  {reflections.reflections.filter((r) => r.mostImportant).map((r) => (
                    <li key={r.id} className="rounded-lg bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300">{r.mostImportant}</li>
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
                    <span key={i} className="rounded-full bg-red-50 dark:bg-red-900/30 px-2.5 py-1 text-xs text-red-700 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-700">{phrase}</span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">No common themes detected</p>
              )}
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">View all responses</summary>
                <ul className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                  {reflections.reflections.filter((r) => r.stillUnclear).map((r) => (
                    <li key={r.id} className="rounded-lg bg-gray-50 dark:bg-gray-800 px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300">{r.stillUnclear}</li>
                  ))}
                </ul>
              </details>
            </div>
          </div>
        </div>
      )}

      {/* Sort/filter controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h2 className="font-semibold text-gray-900 dark:text-gray-100">Slide-by-slide breakdown</h2>
        <div className="flex-1" />

        {/* Sort */}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-gray-500">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortKey)}
            className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-xs text-gray-700 dark:text-gray-300 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 dark:focus:ring-blue-800"
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
                  ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 ring-1 ring-red-300 dark:ring-red-700'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
            >
              Has confusion
            </button>
            <button
              onClick={() => setFilterQuestions((v) => !v)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
                filterQuestions
                  ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 ring-1 ring-blue-300 dark:ring-blue-700'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'
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

          let borderColor = 'border-gray-100 dark:border-gray-800';
          if (hasData && cp >= 10) borderColor = 'border-yellow-300 dark:border-yellow-700';
          if (hasData && gp >= 97.5) borderColor = 'border-green-300 dark:border-green-700';

          return (
            <div key={slide.slideIndex}
              className={`rounded-2xl border bg-white dark:bg-gray-900 p-5 shadow-sm ${borderColor}`}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-400 dark:text-gray-500">Slide {slide.slideIndex + 1}</span>
                    {isLecturer && slide.engagement && (
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                        slide.engagement.overall >= 75 ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
                        slide.engagement.overall >= 50 ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' :
                        slide.engagement.overall >= 30 ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
                        'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                      }`}>
                        {slide.engagement.overall}
                      </span>
                    )}
                    {confusionAreaCount > 0 && (
                      <span className="rounded-full bg-red-100 dark:bg-red-900/30 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 dark:text-red-300">
                        {confusionAreaCount} area{confusionAreaCount !== 1 ? 's' : ''}
                      </span>
                    )}
                  </div>
                  {hasData && (
                    <div className="mt-1 flex gap-3 text-sm">
                      <span className={`font-semibold ${gp >= 60 ? 'text-green-600 dark:text-green-400' : gp >= 30 ? 'text-yellow-600 dark:text-yellow-400' : 'text-red-500 dark:text-red-400'}`}>{gp}% got it</span>
                      {cp > 0 && <span className="font-semibold text-red-500 dark:text-red-400">{cp}% confused/lost</span>}
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
                    className="rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-400 transition hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
                  >
                    View slide
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
                  {/* Smart recommendations (lecturer only) */}
                  {isLecturer && slide.smartRecommendations && slide.smartRecommendations.length > 0 ? (
                    <div className="mt-3 space-y-1.5">
                      {slide.smartRecommendations.map((rec, i) => {
                        const colors = {
                          critical: 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-300',
                          warning: 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300',
                          info: 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300',
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
                  ) : isLecturer ? (
                    <p className="mt-3 text-xs text-gray-500">{slide.recommendation}</p>
                  ) : null}
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

      <div className="mt-10 flex justify-center">
        <button
          onClick={() => navigate(backUrl ?? `/lecturer/module/${session.moduleId}`)}
          className="rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-600/20 transition hover:bg-blue-700 hover:shadow-md hover:shadow-blue-600/25"
        >
          Back to sessions
        </button>
      </div>

      {viewerSlide !== null && report && (
        <SlideViewerModal
          sessionId={sessionId!}
          totalSlides={Math.max(report.session.totalSlides, report.slides.length)}
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
