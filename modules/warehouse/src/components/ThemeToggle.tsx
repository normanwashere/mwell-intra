import { useTheme } from '@/app/theme';
import { Icon } from './Icon';
import { clsx } from 'clsx';

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      role="switch"
      aria-checked={dark}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={clsx(
        'grid h-11 w-11 place-items-center rounded-full text-muted transition hover:bg-inset hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        className,
      )}
    >
      <Icon name={dark ? 'sun' : 'moon'} />
    </button>
  );
}
