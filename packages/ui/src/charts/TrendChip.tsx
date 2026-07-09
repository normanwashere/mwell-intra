'use client';

import { clsx } from 'clsx';
import { Icon } from '../Icon';

export interface TrendChipProps {
  value: string;
  positive?: boolean;
  className?: string;
}

export function TrendChip({ value, positive, className }: TrendChipProps) {
  return (
    <span
      className={clsx(
        'chip inline-flex items-center gap-0.5',
        positive
          ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
          : 'bg-rose-500/15 text-rose-800 dark:text-rose-300',
        className,
      )}
    >
      <Icon
        name="trend"
        className={clsx('h-3 w-3', !positive && 'rotate-180')}
      />
      {value}
    </span>
  );
}
