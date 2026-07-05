import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

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
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-ink">
          {title}
        </h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export type Tone = 'brand' | 'accent' | 'amber' | 'rose' | 'emerald' | 'slate' | 'cyan';

/**
 * ModuleHero — the suite-wide hero banner (spec §13 look & feel).
 * Ported from the warehouse dashboard hero so every module (Procurement,
 * Legal, Vendor, Admin) reads as the same product. Deep-navy brand gradient
 * with a subtle watermark, welcome eyebrow, big display title, one-line
 * description, an optional action button, and an optional right-side
 * accessory (Sparkline, StatCard mini, etc.).
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
  /** Watermark icon rendered top-right at 10% opacity. */
  icon?: IconName;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-3xl bg-brand-grad p-5 text-white shadow-navy sm:p-6',
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-6 -top-6 text-white/10"
        >
          <Icon name={icon} className="h-40 w-40" />
        </div>
      )}
      <div className="relative">
        <p className="text-sm text-brand-100/80">{eyebrow}</p>
        <h1 className="font-display text-2xl font-extrabold sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-md text-sm text-brand-100/70">{description}</p>
        )}
        {action && <div className="mt-3">{action}</div>}
        {accessory && (
          <div className="mt-4 flex items-end justify-between gap-4">
            {accessory}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * HeroChipButton — a small pill button styled for use INSIDE ModuleHero
 * (translucent white on the navy gradient). Use for the hero's primary
 * action (e.g. "Export", "New request").
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
    'inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60';
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
  accent: 'bg-cyan-500/10 text-cyan-800 dark:text-cyan-300',
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
  children?: ReactNode;
}) {
  const interactive = Boolean(onClick);
  const inner = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[0.68rem] font-semibold uppercase leading-snug tracking-wide text-faint">
          {label}
        </p>
        {icon && (
          <span
            className={clsx(
              'grid h-8 w-8 shrink-0 place-items-center rounded-lg',
              ICON_TONES[tone],
            )}
          >
            <Icon name={icon} className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="mt-auto flex items-end justify-between gap-2">
        <p className="tnum font-display text-2xl font-extrabold leading-none text-ink">
          {value}
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
          <span className="shrink-0 text-faint transition group-hover:text-brand-600 dark:group-hover:text-brand-300">
            <Icon name="chevron" className="h-4 w-4" />
          </span>
        ) : null}
      </div>
      {hint && <p className="truncate text-xs text-faint">{hint}</p>}
      {children}
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label}: ${value}. View details`}
        className="card group flex flex-col gap-2.5 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-e3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {inner}
      </button>
    );
  }

  return <div className="card flex flex-col gap-2.5 p-4">{inner}</div>;
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
