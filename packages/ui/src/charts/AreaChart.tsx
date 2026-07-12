'use client';

import { clsx } from 'clsx';

export interface AreaChartPoint {
  label: string;
  value: number;
}

export interface AreaChartProps {
  data: readonly AreaChartPoint[];
  height?: number;
  className?: string;
  tone?: 'brand' | 'accent';
}

export function AreaChart({
  data,
  height = 48,
  className,
  tone = 'brand',
}: AreaChartProps) {
  if (data.length === 0) return null;
  const w = 120;
  const h = height;
  const pad = 2;
  const max = Math.max(...data.map((d) => d.value), 1);
  const step = data.length > 1 ? (w - pad * 2) / (data.length - 1) : 0;
  const points = data.map((d, i) => {
    const x = pad + i * step;
    const y = h - pad - (d.value / max) * (h - pad * 2);
    return `${x},${y}`;
  });
  const area = `${pad},${h - pad} ${points.join(' ')} ${w - pad},${h - pad}`;
  const stroke = tone === 'accent' ? 'var(--accent)' : 'var(--brand)';

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className={clsx('w-full', className)}
      aria-hidden
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={`area-${tone}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#area-${tone})`} />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
