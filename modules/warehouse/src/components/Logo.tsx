import { clsx } from 'clsx';

interface LogoProps {
  className?: string;
  /** Render a white treatment for dark backgrounds (sidebar / loading screen). */
  variant?: 'color' | 'light';
  title?: string;
}

/** Official mWell wordmark (image asset in /public). */
export function Logo({ className, variant = 'color', title = 'mWell' }: LogoProps) {
  return (
    <img
      src="/mwell-logo.png"
      alt={title}
      className={clsx(className, variant === 'light' && 'brightness-0 invert')}
    />
  );
}
