import { clsx } from 'clsx';

interface LogoProps {
  className?: string;
  /** Render a white treatment for dark backgrounds (sidebar / loading screen). */
  variant?: 'color' | 'light';
  title?: string;
}

/**
 * mWell wordmark. Rendered as on-brand text (no raster asset) so there is no
 * dependency on a /public image — the previous `/mwell-logo.png` returned 404
 * in this build. `variant="light"` is for dark surfaces.
 */
export function Logo({ className, variant = 'color', title = 'mWell' }: LogoProps) {
  return (
    <span
      className={clsx(
        'inline-flex select-none items-center font-display text-xl font-extrabold tracking-tight',
        variant === 'light' ? 'text-white' : 'text-ink',
        className,
      )}
      aria-label={title}
      title={title}
    >
      m
      <span className={variant === 'light' ? 'text-white/90' : 'brand-gradient'}>
        well
      </span>
    </span>
  );
}
