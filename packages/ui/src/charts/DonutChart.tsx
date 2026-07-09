'use client';

export interface DonutSlice {
  label: string;
  value: number;
  tone?: 'brand' | 'accent' | 'amber' | 'emerald' | 'rose' | 'slate';
}

export interface DonutChartProps {
  slices: readonly DonutSlice[];
  size?: number;
  className?: string;
}

const SLICE_COLORS: Record<NonNullable<DonutSlice['tone']>, string> = {
  brand: '#0d7d78',
  accent: '#7c6cf5',
  amber: '#f59e0b',
  emerald: '#10b981',
  rose: '#f43f5e',
  slate: '#94a3b8',
};

const DEFAULT_TONES: NonNullable<DonutSlice['tone']>[] = ['brand', 'accent', 'amber', 'emerald'];

export function DonutChart({ slices, size = 80, className }: DonutChartProps) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const r = size / 2 - 6;
  const cx = size / 2;
  const cy = size / 2;
  let angle = -90;

  const arcs = slices.map((slice, i) => {
    const sweep = (slice.value / total) * 360;
    const start = angle;
    angle += sweep;
    const end = angle;
    const large = sweep > 180 ? 1 : 0;
    const x1 = cx + r * Math.cos((Math.PI * start) / 180);
    const y1 = cy + r * Math.sin((Math.PI * start) / 180);
    const x2 = cx + r * Math.cos((Math.PI * end) / 180);
    const y2 = cy + r * Math.sin((Math.PI * end) / 180);
    const toneKey = slice.tone ?? DEFAULT_TONES[i % DEFAULT_TONES.length] ?? 'brand';
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    return (
      <path
        key={slice.label}
        d={d}
        fill={SLICE_COLORS[toneKey]}
        opacity={0.9}
      />
    );
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label="Distribution chart"
    >
      <circle cx={cx} cy={cy} r={r * 0.55} fill="var(--surface)" />
      {arcs}
    </svg>
  );
}
