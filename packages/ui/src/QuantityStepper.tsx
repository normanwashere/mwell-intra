import { Icon } from './Icon';

interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  id?: string;
  'aria-label'?: string;
}

/**
 * Number entry with +/- controls. Clamps to [min, max], rejects NaN, and keeps
 * a real <input> so labels/tests work and keyboard entry is allowed.
 */
export function QuantityStepper({
  value,
  onChange,
  min = 0,
  max,
  id,
  'aria-label': ariaLabel,
}: QuantityStepperProps) {
  const clamp = (n: number) => {
    if (Number.isNaN(n)) return min;
    if (n < min) return min;
    if (max !== undefined && n > max) return max;
    return n;
  };

  return (
    <div className="flex min-w-0 items-stretch gap-1">
      <button
        type="button"
        aria-label="Decrease"
        className="grid min-h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-surface text-ink transition hover:bg-inset disabled:opacity-40"
        disabled={value <= min}
        onClick={() => onChange(clamp(value - 1))}
      >
        <Icon name="minus" className="h-4 w-4" />
      </button>
      <input
        id={id}
        aria-label={ariaLabel}
        type="number"
        inputMode="numeric"
        className="input min-w-0 flex-1 text-center"
        min={min}
        max={max}
        value={Number.isNaN(value) ? '' : value}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
      />
      <button
        type="button"
        aria-label="Increase"
        className="grid min-h-11 w-11 shrink-0 place-items-center rounded-xl border border-line bg-surface text-ink transition hover:bg-inset disabled:opacity-40"
        disabled={max !== undefined && value >= max}
        onClick={() => onChange(clamp(value + 1))}
      >
        <Icon name="plus" className="h-4 w-4" />
      </button>
    </div>
  );
}
