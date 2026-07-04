import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { clsx } from 'clsx';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'accent' | 'ghost' | 'outline';
export type ButtonSize = 'md' | 'sm';

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  accent: 'btn-accent',
  ghost: 'btn-ghost',
  outline: 'btn-outline',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. */
  icon?: IconName;
  /** Trailing icon. */
  iconRight?: IconName;
  children?: ReactNode;
}

/**
 * The design-system button. Maps to the `btn-*` component classes (see
 * styles.css) so it stays visually consistent with anchors/other controls that
 * use the same classes. Defaults to `type="button"` to avoid accidental form
 * submits.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon, iconRight, className, children, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={clsx(VARIANT_CLASS[variant], size === 'sm' && 'btn-sm', className)}
      {...rest}
    >
      {icon && <Icon name={icon} className="h-4 w-4" />}
      {children}
      {iconRight && <Icon name={iconRight} className="h-4 w-4" />}
    </button>
  );
});
