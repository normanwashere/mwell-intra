import { Logo } from '@warehouse/components/Logo';
import { cx } from '@shell/lib/cx';

interface MwellIntraLogoProps {
  className?: string;
  labelClassName?: string;
  logoClassName?: string;
  showLabel?: boolean;
  variant?: 'color' | 'light';
}

export function MwellIntraLogo({
  className,
  labelClassName,
  logoClassName,
  showLabel = true,
  variant = 'color',
}: MwellIntraLogoProps) {
  return (
    <span className={cx('inline-flex select-none items-baseline gap-2', className)}>
      <Logo
        className={cx('text-xl leading-none', logoClassName)}
        title="mWell"
        variant={variant}
      />
      {showLabel && (
        <span
          className={cx(
            'text-xs font-semibold uppercase tracking-wide',
            variant === 'light' ? 'text-white/75' : 'text-faint',
            labelClassName,
          )}
        >
          Intra
        </span>
      )}
    </span>
  );
}
