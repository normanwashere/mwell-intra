import { clsx } from "clsx";
import type { HTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { StatValue } from "./StatValue";

export function Card({
  children,
  className,
  interactive,
  ...divProps
}: HTMLAttributes<HTMLDivElement> & {
  interactive?: boolean;
}) {
  return (
    <div
      {...divProps}
      className={clsx(
        "card p-4 sm:p-5",
        interactive &&
          "cursor-pointer transition duration-200 hover:border-brand-300 hover:shadow-e2",
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
  eyebrow,
  id,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  eyebrow?: string;
  id?: string;
}) {
  return (
    <div className="section-heading-band mb-4 flex flex-col items-start gap-3 pb-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && (
          <p className="mb-1 text-caption font-semibold uppercase text-brand-700 dark:text-brand-300">
            {eyebrow}
          </p>
        )}
        <h2
          id={id}
          className="font-display text-base font-bold leading-snug text-ink sm:text-lg"
        >
          {title}
        </h2>
        {subtitle && (
          <p className="mt-1 text-sm leading-5 text-muted">{subtitle}</p>
        )}
      </div>
      {action && <div className="w-full shrink-0 sm:w-auto">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
  icon,
  eyebrow,
  status,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  /** Optional leading icon in a tinted chip. */
  icon?: IconName;
  eyebrow?: string;
  status?: ReactNode;
}) {
  return (
    <header className="page-header-band -mx-4 mb-6 flex flex-col items-start gap-4 px-4 py-4 sm:-mx-6 sm:px-6 md:flex-row md:items-center md:justify-between lg:-mx-8 lg:px-8">
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-900/30 dark:text-brand-300"
          >
            <Icon name={icon} className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {eyebrow && (
              <p className="w-full text-caption font-semibold uppercase text-brand-700 dark:text-brand-300">
                {eyebrow}
              </p>
            )}
            <h1 className="break-words font-display text-title text-ink">
              {title}
            </h1>
            {status}
          </div>
          {subtitle && (
            <p className="mt-1 max-w-3xl text-sm leading-5 text-muted">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {action && <div className="w-full shrink-0 md:w-auto">{action}</div>}
    </header>
  );
}

export type Tone =
  "brand" | "accent" | "amber" | "rose" | "emerald" | "slate" | "cyan";

/**
 * ModuleHero — suite-wide page header (v2 clinical-modern).
 * Porcelain surface card with a signature teal accent stripe — gradient is
 * reserved for the wordmark and small highlights, not full-bleed backgrounds.
 */
export function ModuleHero({
  eyebrow = "Welcome back,",
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
    <section
      className={clsx(
        "hero-surface workspace-hero overflow-hidden px-4 py-5 sm:px-6 sm:py-6",
        className,
      )}
    >
      {icon && (
        <div
          aria-hidden
          data-module-hero-watermark="true"
          className="pointer-events-none absolute right-4 top-4 z-0 grid h-12 w-12 place-items-center rounded-lg border border-brand-200 bg-surface/70 text-brand-700 sm:right-6 sm:top-6 dark:border-brand-800 dark:text-brand-300"
        >
          <Icon name={icon} className="h-6 w-6" />
        </div>
      )}
      <div
        className={clsx(
          "relative z-10 grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end",
          icon && "pr-14 sm:pr-16",
        )}
      >
        <div className="min-w-0">
          <p className="text-caption font-semibold uppercase text-brand-700 dark:text-brand-300">
            {eyebrow}
          </p>
          <h1 className="mt-1 break-words font-display text-title text-ink sm:text-[1.75rem] sm:leading-tight">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-body text-muted">{description}</p>
          )}
          {action && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {action}
            </div>
          )}
        </div>
        {accessory && (
          <div className="min-w-0 border-t border-line pt-4 md:max-w-sm md:border-l md:border-t-0 md:pl-5 md:pt-0">
            {accessory}
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * HeroStat — compact metric block for ModuleHero accessories (v2 porcelain).
 */
export function HeroStat({
  label,
  children,
  align = "left",
  className,
}: {
  label: string;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "rounded-lg border border-line bg-surface px-4 py-2",
        align === "right" && "text-right",
        className,
      )}
    >
      <p className="text-xs uppercase tracking-normal text-faint">{label}</p>
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
  type = "button",
}: {
  onClick?: () => void;
  icon?: IconName;
  children: ReactNode;
  href?: string;
  type?: "button" | "submit";
}) {
  const cls =
    "inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white shadow-e1 transition hover:bg-brand-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40";
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
  brand: "bg-brand-500/10 text-brand-700 dark:text-brand-300",
  accent: "bg-accent/15 text-accent dark:text-accent-soft",
  cyan: "bg-cyan-500/10 text-cyan-800 dark:text-cyan-300",
  amber: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  rose: "bg-rose-500/15 text-rose-800 dark:text-rose-300",
  emerald: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  slate: "bg-inset text-muted",
};

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "brand",
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
              "grid h-7 w-7 shrink-0 place-items-center rounded-lg sm:h-8 sm:w-8",
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
              "chip shrink-0",
              trend.positive
                ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
                : "bg-rose-500/15 text-rose-800 dark:text-rose-300",
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
      {hint && (
        <p className="line-clamp-2 min-h-8 text-xs leading-4 text-faint">
          {hint}
        </p>
      )}
      {children}
    </>
  );

  // Cramped mobile → tighter padding; roomier from `sm` onwards.
  const shell =
    "card group flex h-full w-full min-w-0 max-w-full flex-col gap-2 overflow-hidden p-3 sm:gap-2.5 sm:p-4 text-left transition";
  const interactiveShell =
    " hover:border-brand-300 hover:shadow-e2 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";

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
  slate: "bg-inset text-muted",
  brand: "bg-brand-500/10 text-brand-700 dark:text-brand-300",
  accent: "bg-cyan-500/15 text-cyan-800 dark:text-cyan-300",
  amber: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  rose: "bg-rose-500/15 text-rose-800 dark:text-rose-300",
  emerald: "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
  cyan: "bg-cyan-500/15 text-cyan-800 dark:text-cyan-300",
};

export function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return <span className={clsx("chip", BADGE_TONES[tone])}>{children}</span>;
}

export function EmptyState({
  icon = "box",
  title,
  message,
  action,
  compact = false,
  headingLevel = 2,
}: {
  icon?: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
  compact?: boolean;
  headingLevel?: 1 | 2 | 3;
}) {
  const Heading = headingLevel === 1 ? "h1" : headingLevel === 3 ? "h3" : "h2";
  return (
    <div
      className={clsx(
        "grid place-items-center rounded-lg border border-dashed border-line bg-inset/50 text-center",
        compact ? "px-4 py-6" : "px-6 py-12",
      )}
    >
      <span
        className={clsx(
          "mb-3 grid place-items-center rounded-lg bg-surface text-faint shadow-e1 ring-1 ring-line",
          compact ? "h-10 w-10" : "h-12 w-12",
        )}
      >
        <Icon name={icon} />
      </span>
      <Heading className="font-semibold text-ink">{title}</Heading>
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
        <p
          className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-300"
          role="alert"
        >
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
  tone = "brand",
}: {
  label: string;
  value: number;
  max: number;
  suffix?: string;
  /** Overrides the displayed number (e.g. a money string) without affecting the bar width. */
  valueLabel?: string;
  tone?: "brand" | "accent" | "amber" | "rose";
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const tones: Record<string, string> = {
    brand: "bg-brand-grad-soft",
    accent: "bg-accent-grad",
    amber: "bg-amber-400",
    rose: "bg-rose-400",
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
          className={clsx(
            "h-full rounded-full transition-[width] duration-700 ease-out",
            tones[tone],
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
