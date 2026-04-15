import type { EngagementScore, EngagementSignals } from '@lecture-feedback/shared';

interface Props {
  score: EngagementScore;
  compact?: boolean;
  dark?: boolean;
}

const SIGNAL_LABELS: Record<keyof EngagementSignals, string> = {
  emoji: 'Sentiment',
  pace: 'Pace',
  questions: 'Questions',
  confusion: 'Clarity',
  notes: 'Notes',
};

const SIGNAL_COLORS: Record<keyof EngagementSignals, string> = {
  emoji: 'bg-green-500',
  pace: 'bg-blue-500',
  questions: 'bg-purple-500',
  confusion: 'bg-amber-500',
  notes: 'bg-cyan-500',
};

function scoreColor(score: number): string {
  if (score >= 75) return 'text-emerald-500';
  if (score >= 50) return 'text-blue-500';
  if (score >= 30) return 'text-amber-500';
  return 'text-red-500';
}

function scoreBg(score: number): string {
  if (score >= 75) return 'bg-emerald-500';
  if (score >= 50) return 'bg-blue-500';
  if (score >= 30) return 'bg-amber-500';
  return 'bg-red-500';
}

function scoreLabel(score: number): string {
  if (score >= 75) return 'High';
  if (score >= 50) return 'Moderate';
  if (score >= 30) return 'Low';
  return 'Critical';
}

/**
 * Compact pill for the top bar - just shows the score number with color.
 */
export function EngagementPill({ score, dark }: { score: number; dark?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${dark ? 'bg-gray-800 ring-1 ring-gray-700' : 'bg-gray-100'}`}>
      <div className={`h-2 w-2 rounded-full ${scoreBg(score)}`} />
      <span className={`text-[10px] font-bold tabular-nums ${dark ? 'text-gray-300' : 'text-gray-600'}`}>
        {score}
      </span>
    </div>
  );
}

/**
 * Full engagement gauge with score and signal breakdown bars.
 */
export default function EngagementGauge({ score, compact, dark }: Props) {
  const signals = score.signals;
  const signalKeys: (keyof EngagementSignals)[] = ['emoji', 'pace', 'questions', 'confusion', 'notes'];

  if (compact) {
    return (
      <div className="flex items-center gap-3">
        <div className={`text-2xl font-bold tabular-nums ${scoreColor(score.overall)}`}>
          {score.overall}
        </div>
        <div className="flex-1">
          <div className={`text-[10px] font-medium ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
            Engagement
          </div>
          <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div className={`rounded-full transition-all ${scoreBg(score.overall)}`} style={{ width: `${score.overall}%` }} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Score display */}
      <div className="flex items-end gap-2 mb-4">
        <span className={`text-4xl font-bold tabular-nums leading-none ${scoreColor(score.overall)}`}>
          {score.overall}
        </span>
        <span className={`text-sm font-medium ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
          / 100
        </span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold text-white ${scoreBg(score.overall)}`}>
          {scoreLabel(score.overall)}
        </span>
      </div>

      {/* Progress bar */}
      <div className="mb-4 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div
          className={`h-full rounded-full transition-all ${scoreBg(score.overall)}`}
          style={{ width: `${score.overall}%` }}
        />
      </div>

      {/* Signal breakdown */}
      <div className="space-y-2">
        {signalKeys.map((key) => {
          const value = signals[key];
          return (
            <div key={key} className="flex items-center gap-2">
              <span className={`w-16 text-[11px] ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
                {SIGNAL_LABELS[key]}
              </span>
              <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                {value !== null && (
                  <div
                    className={`h-full rounded-full ${SIGNAL_COLORS[key]}`}
                    style={{ width: `${value}%` }}
                  />
                )}
              </div>
              <span className={`w-8 text-right text-[11px] font-medium tabular-nums ${dark ? 'text-gray-300' : 'text-gray-700'}`}>
                {value !== null ? value : '--'}
              </span>
            </div>
          );
        })}
      </div>

      {score.participantCount > 0 && (
        <p className={`mt-3 text-[10px] ${dark ? 'text-gray-600' : 'text-gray-400'}`}>
          Based on {score.participantCount} participant{score.participantCount !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}
