'use client';

// In-module tab bar for the Legal workspace. Renders only for INTERNAL users
// (Legal reviewers, compliance, admin). Vendors get their own single case
// route + the shared vendor chrome, so no tabs there.

import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from '@intra/ui';

interface Tab {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
  requires?: 'manage_checklist';
}

const TABS: Tab[] = [
  { to: '/', label: 'Cases', icon: 'clipboard', end: true },
  { to: '/invites/new', label: 'Invite vendor', icon: 'plus', requires: 'manage_checklist' },
];

export function LegalTabs({ canInvite }: { canInvite: boolean }) {
  const visible = TABS.filter((t) => !t.requires || (t.requires === 'manage_checklist' && canInvite));
  return (
    <div className="mb-4 border-b border-line">
      <nav
        aria-label="Legal sections"
        className="-mb-px flex gap-1 overflow-x-auto px-1"
      >
        {visible.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              [
                'group inline-flex items-center gap-2 whitespace-nowrap rounded-t-lg px-3 py-2 text-sm font-semibold transition',
                isActive
                  ? 'border-b-2 border-brand-600 text-brand-700 dark:border-brand-300 dark:text-brand-300'
                  : 'border-b-2 border-transparent text-muted hover:border-line hover:text-ink',
              ].join(' ')
            }
          >
            <Icon name={t.icon} className="h-4 w-4" />
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
