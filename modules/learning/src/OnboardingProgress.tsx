export function OnboardingProgress({
  completed,
  total,
}: {
  completed: number;
  total: number;
}) {
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);
  return (
    <div className="min-w-0" aria-label={`${completed} of ${total} required steps complete`}>
      <div className="mb-2 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase text-faint">Readiness</p>
          <p className="font-display text-lg font-bold text-ink">
            {completed} of {total} required {total === 1 ? "step" : "steps"} complete
          </p>
        </div>
        <span className="tnum text-sm font-semibold text-brand-700 dark:text-brand-300">
          {percent}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="Role readiness progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 overflow-hidden rounded-full bg-inset"
      >
        <div
          className="h-full rounded-full bg-brand-600 transition-[width] motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
