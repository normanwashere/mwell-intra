'use client';

import { AnimatedNumber } from './motion/AnimatedNumber';

/** Renders a KPI value with optional count-up animation for numeric values. */
export function StatValue({
  value,
  className,
}: {
  value: string | number;
  className?: string;
}) {
  if (typeof value === 'number') {
    return <AnimatedNumber value={value} className={className} />;
  }
  return <span className={className}>{value}</span>;
}
