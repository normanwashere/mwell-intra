import { clsx } from 'clsx';
import { Icon, type IconName } from './Icon';

interface FabProps {
  onClick: () => void;
  icon?: IconName;
  label: string;
  /** Hide on large screens where a toolbar button is used instead. */
  mobileOnly?: boolean;
}

export function Fab({ onClick, icon = 'scan', label, mobileOnly }: FabProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={clsx(
        'fixed z-30 flex items-center gap-2 rounded-2xl bg-brand-600 px-4 py-3.5 font-semibold text-white shadow-e3 ring-4 ring-surface transition hover:bg-brand-700 active:scale-95',
        mobileOnly
          ? 'bottom-[calc(7rem+env(safe-area-inset-bottom))] right-4 md:bottom-6 md:hidden'
          : 'bottom-6 right-4',
      )}
    >
      <Icon name={icon} className="h-5 w-5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
