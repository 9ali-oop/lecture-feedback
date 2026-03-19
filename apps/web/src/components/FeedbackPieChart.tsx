import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { FeedbackDistribution } from '@lecture-feedback/shared';

interface Props {
  distribution: FeedbackDistribution;
}

const COLORS = {
  got_it: '#16a34a',
  neutral: '#2563eb',
  confused: '#ca8a04',
  lost: '#dc2626',
};

const LABELS = {
  got_it: '😊 Got it',
  neutral: '😐 Neutral',
  confused: '😕 Confused',
  lost: '😵 Lost',
};

export default function FeedbackPieChart({ distribution }: Props) {
  const data = (['got_it', 'neutral', 'confused', 'lost'] as const)
    .filter((k) => distribution[k] > 0)
    .map((k) => ({
      name: LABELS[k],
      value: distribution[k],
      key: k,
    }));

  if (distribution.total === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-gray-400">
        Waiting for responses…
      </div>
    );
  }

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={50}
            outerRadius={80}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((entry) => (
              <Cell key={entry.key} fill={COLORS[entry.key as keyof typeof COLORS]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(value: number) => [
              `${value} (${Math.round((value / distribution.total) * 100)}%)`,
            ]}
          />
        </PieChart>
      </ResponsiveContainer>

      <div className="mt-2 space-y-1.5">
        {(['got_it', 'neutral', 'confused', 'lost'] as const).map((k) => {
          const pct = distribution.total > 0
            ? Math.round((distribution[k] / distribution.total) * 100)
            : 0;
          return (
            <div key={k} className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[k] }} />
              <span className="flex-1 text-xs text-gray-600">{LABELS[k]}</span>
              <span className="text-xs font-semibold text-gray-900">{pct}%</span>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-center text-xs text-gray-400">
        {distribution.total} response{distribution.total !== 1 ? 's' : ''}
      </p>
    </div>
  );
}
