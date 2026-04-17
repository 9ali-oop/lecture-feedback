import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { FeedbackDistribution } from '@lecture-feedback/shared';

interface Props {
  distribution: FeedbackDistribution;
  emptyLabel?: string;
  dark?: boolean;
}

// Okabe-Ito palette — the de-facto colour-blind-safe palette (Okabe & Ito,
// 2008). Every pair of these hues is distinguishable under deuteranopia,
// protanopia, and tritanopia, so the chart conveys meaning without relying
// on colour perception alone. We also render the percentage label inside
// each slice as a belt-and-braces fallback.
const COLORS = {
  got_it: '#009E73', // bluish-green (success)
  neutral: '#0072B2', // blue (neutral)
  confused: '#E69F00', // orange (attention)
  lost: '#D55E00', // vermillion (distinct from orange for protanopia/deuteranopia)
};

const LABELS = {
  got_it: '😊 Got it',
  neutral: '😐 Neutral',
  confused: '😕 Confused',
  lost: '😵 Lost',
};

export default function FeedbackPieChart({ distribution, emptyLabel, dark }: Props) {
  const data = (['got_it', 'neutral', 'confused', 'lost'] as const)
    .filter((k) => distribution[k] > 0)
    .map((k) => ({
      name: LABELS[k],
      value: distribution[k],
      key: k,
    }));

  if (distribution.total === 0) {
    return (
      <div className={`flex h-48 items-center justify-center text-sm ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
        {emptyLabel ?? 'Waiting for responses...'}
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
            // Render the percentage inside each slice. Redundant with the
            // colour legend, but critical for colour-blind users and for
            // screenshots printed in greyscale — meaning is no longer
            // carried by hue alone.
            label={({ value, cx, cy, midAngle, innerRadius, outerRadius }) => {
              const RAD = Math.PI / 180;
              const r = innerRadius + (outerRadius - innerRadius) * 0.5;
              const x = cx + r * Math.cos(-midAngle * RAD);
              const y = cy + r * Math.sin(-midAngle * RAD);
              const pct = Math.round((value / distribution.total) * 100);
              if (pct < 8) return null; // too small to render legibly
              return (
                <text x={x} y={y} fill="#fff" textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="600">
                  {pct}%
                </text>
              );
            }}
            labelLine={false}
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
              <span className={`flex-1 text-xs ${dark ? 'text-gray-400' : 'text-gray-600'}`}>{LABELS[k]}</span>
              <span className={`text-xs font-semibold ${dark ? 'text-gray-200' : 'text-gray-900'}`}>{pct}%</span>
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
