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
      className={`${
        mobileOnly ? 'md:hidden' : ''
      } fixed bottom-20 right-4 z-30 flex items-center gap-2 rounded-full bg-accent-grad px-5 py-3.5 font-semibold text-brand-900 shadow-glow transition active:scale-95 md:bottom-6`}
    >
      <Icon name={icon} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}
