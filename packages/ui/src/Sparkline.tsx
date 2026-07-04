interface SparklineProps {
  values: number[];
  className?: string;
  width?: number;
  height?: number;
  ariaLabel?: string;
}

/** Tiny inline trend chart rendered as an SVG polyline. No chart library. */
export function Sparkline({
  values,
  className = 'text-accent',
  width = 96,
  height = 28,
  ariaLabel,
}: SparklineProps) {
  if (values.length < 2) {
    return <svg className={className} width={width} height={height} aria-hidden="true" />;
  }
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => {
      const x = i * step;
      const y = height - ((v - min) / span) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  const last = points.split(' ').at(-1)!.split(',');

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      role="img"
      aria-label={ariaLabel ?? 'trend'}
    >
      <polyline
        points={points}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill="currentColor" />
    </svg>
  );
}
