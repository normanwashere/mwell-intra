import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { StatValue } from './StatValue';

export function Card({
  children,
  className,
  interactive,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={clsx(
        'card p-4 sm:p-5',
        interactive &&
          'cursor-pointer transition duration-200 hover:-translate-y-0.5 hover:shadow-e3',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionTitle({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="font-display text-base font-bold text-ink sm:text-lg">
          {title}
        </h2>
        {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
  icon,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /** Optional leading icon in a tinted chip. */
  icon?: IconName;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3 border-b border-line/80 pb-4">
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-500/10 text-brand-700 dark:text-brand-300"
          >
            <Icon name={icon} className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="font-display text-title text-ink">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export type Tone = 'brand' | 'accent' | 'amber' | 'rose' | 'emerald' | 'slate' | 'cyan';

/**
 * ModuleHero — suite-wide page header (v2 clinical-modern).
 * Porcelain surface card with a signature teal accent stripe — gradient is
 * reserved for the wordmark and small highlights, not full-bleed backgrounds.
 */
export function ModuleHero({
  eyebrow = 'Welcome back,',
  title,
  description,
  action,
  accessory,
  icon,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  accessory?: ReactNode;
  /** Watermark icon rendered top-right at low opacity. */
  icon?: IconName;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'hero-surface relative overflow-hidden rounded-3xl p-5 sm:p-6',
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-3xl bg-gradient-to-b from-brand-500 to-brand-700"
      />
      {icon && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-4 -top-4 text-brand-500/8"
        >
          <Icon name={icon} className="h-36 w-36 sm:h-40 sm:w-40" />
        </div>
      )}
      <div className="relative pl-2">
        <p className="text-caption font-semibold uppercase tracking-wide text-faint">
          {eyebrow}
        </p>
        <h1 className="mt-1 font-display text-title text-ink sm:text-display">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-xl text-body text-muted">{description}</p>
        )}
        {action && <div className="mt-4">{action}</div>}
        {accessory && (
          <div className="mt-4 flex items-end justify-between gap-4">{accessory}</div>
        )}
      </div>
    </div>
  );
}

/**
 * HeroStat — compact metric block for ModuleHero accessories (v2 porcelain).
 */
export function HeroStat({
  label,
  children,
  align = 'left',
  className,
}: {
  label: string;
  children: ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'rounded-2xl bg-inset px-4 py-2',
        align === 'right' && 'text-right',
        className,
      )}
    >
      <p className="text-xs uppercase tracking-wide text-faint">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * HeroChipButton — primary CTA styled for use inside ModuleHero (v2).
 */
export function HeroChipButton({
  onClick,
  icon,
  children,
  href,
  type = 'button',
}: {
  onClick?: () => void;
  icon?: IconName;
  children: ReactNode;
  href?: string;
  type?: 'button' | 'submit';
}) {
  const cls =
    'inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white shadow-e1 transition hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40';
  if (href) {
    return (
      <a href={href} className={cls}>
        {icon && <Icon name={icon} className="h-4 w-4" />}
        {children}
      </a>
    );
  }
  return (
    <button type={type} onClick={onClick} className={cls}>
      {icon && <Icon name={icon} className="h-4 w-4" />}
      {children}
    </button>
  );
}

const ICON_TONES: Record<string, string> = {
  brand: 'bg-brand-500/10 text-brand-700 dark:text-brand-300',
  accent: 'bg-accent/15 text-accent dark:text-accent-soft',
  cyan: 'bg-cyan-500/10 text-cyan-800 dark:text-cyan-300',
  amber: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  rose: 'bg-rose-500/15 text-rose-800 dark:text-rose-300',
  emerald: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  slate: 'bg-inset text-muted',
};

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
  trend,
  onClick,
  href,
  children,
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: IconName;
  tone?: Tone;
  trend?: { value: string; positive?: boolean };
  /** When provided the whole card becomes a button that drills into details. */
  onClick?: () => void;
  /** When provided the whole card becomes an anchor to `href` (drill-in). */
  href?: string;
  children?: ReactNode;
}) {
  const interactive = Boolean(onClick) || Boolean(href);
  const inner = (
    <>
      <div className="flex min-w-0 items-start justify-between gap-2">
        <p className="min-w-0 break-words text-[0.62rem] font-semibold uppercase leading-snug tracking-wide text-faint sm:text-[0.68rem]">
          {label}
        </p>
        {icon && (
          <span
            className={clsx(
              'grid h-7 w-7 shrink-0 place-items-center rounded-lg sm:h-8 sm:w-8',
              ICON_TONES[tone],
            )}
          >
            <Icon name={icon} className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="mt-auto flex min-w-0 items-end justify-between gap-2">
        <p className="tnum min-w-0 font-display text-xl font-extrabold leading-none text-ink sm:text-2xl">
          <StatValue value={value} />
        </p>
        {trend ? (
          <span
            className={clsx(
              'chip shrink-0',
              trend.positive
                ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                : 'bg-rose-500/15 text-rose-800 dark:text-rose-300',
            )}
          >
            {trend.value}
          </span>
        ) : interactive ? (
          <span
            aria-hidden
            className="shrink-0 text-faint transition group-hover:text-brand-600 dark:group-hover:text-brand-300"
          >
            <Icon name="chevron" className="h-4 w-4" />
          </span>
        ) : null}
      </div>
      {hint && <p className="truncate text-xs text-faint">{hint}</p>}
      {children}
    </>
  );

  // Cramped mobile → tighter padding; roomier from `sm` onwards.
  const shell =
    'card group flex min-w-0 max-w-full flex-col gap-2 overflow-hidden p-3 sm:gap-2.5 sm:p-4 text-left transition';
  const interactiveShell =
    ' hover:-translate-y-0.5 hover:shadow-e3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500';

  if (href) {
    return (
      <a
        href={href}
        aria-label={`${label}: ${value}. View details`}
        className={clsx(shell, interactiveShell)}
      >
        {inner}
      </a>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label}: ${value}. View details`}
        className={clsx(shell, interactiveShell)}
      >
        {inner}
      </button>
    );
  }

  return <div className={shell}>{inner}</div>;
}

const BADGE_TONES: Record<string, string> = {
  slate: 'bg-inset text-muted',
  brand: 'bg-brand-500/10 text-brand-700 dark:text-brand-300',
  accent: 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-300',
  amber: 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
  rose: 'bg-rose-500/15 text-rose-800 dark:text-rose-300',
  emerald: 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300',
  cyan: 'bg-cyan-500/15 text-cyan-800 dark:text-cyan-300',
};

export function Badge({
  children,
  tone = 'slate',
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return <span className={clsx('chip', BADGE_TONES[tone])}>{children}</span>;
}

export function EmptyState({
  icon = 'box',
  title,
  message,
  action,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-line bg-inset/50 px-6 py-12 text-center">
      <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-surface text-faint shadow-e1 ring-1 ring-line">
        <Icon name={icon} />
      </span>
      <p className="font-semibold text-ink">{title}</p>
      {message && <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Field({
  label,
  htmlFor,
  children,
  hint,
  error,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
  error?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-300" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1 text-xs text-faint">{hint}</p>
      )}
    </div>
  );
}

/** Inline horizontal bar for lightweight charts (no chart lib needed). */
export function BarRow({
  label,
  value,
  max,
  suffix,
  valueLabel,
  tone = 'brand',
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  /** Overrides the displayed number (e.g. a money string) without affecting the bar width. */
  valueLabel?: string;
  tone?: 'brand' | 'accent' | 'amber' | 'rose';
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const tones: Record<string, string> = {
    brand: 'bg-brand-grad-soft',
    accent: 'bg-accent-grad',
    amber: 'bg-amber-400',
    rose: 'bg-rose-400',
  };
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="truncate font-medium text-ink">{label}</span>
        <span className="tnum text-muted">
          {valueLabel ?? (
            <>
              {value}
              {suffix}
            </>
          )}
        </span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-inset"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        <div
          className={clsx('h-full rounded-full transition-[width] duration-700 ease-out', tones[tone])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
