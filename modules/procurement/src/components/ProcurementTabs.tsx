'use client';

// In-module tab bar for the Procurement workspace. Replaces the previous
// "3 buttons in a section-title" pattern (UX audit finding #14) so users
// always know where they are inside procurement and can switch surfaces
// without hunting.
//
// Tier-only entrants (PR-11: e.g. legal reviewers acting on the Legal ladder
// step) see the Approvals tab only — Requests / POs are hidden for them.

import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from '@intra/ui';

interface Tab {
  to: string;
  label: string;
  /** Short label used at <sm widths (PR-6: "Purchase orders" wrapped). */
  shortLabel?: string;
  icon: IconName;
  end?: boolean;
}

export function ProcurementTabs({
  canApprove,
  showRequests = true,
  showPurchaseOrders = true,
}: {
  canApprove: boolean;
  showRequests?: boolean;
  showPurchaseOrders?: boolean;
}) {
  const visible: Tab[] = [];
  if (showRequests) {
    visible.push({ to: '/', label: 'Requests', icon: 'clipboard', end: true });
  }
  if (canApprove) {
    visible.push({ to: '/approvals', label: 'Approvals', icon: 'check' });
  }
  if (showPurchaseOrders) {
    visible.push({
      to: '/purchase-orders',
      label: 'Purchase orders',
      shortLabel: 'POs',
      icon: 'cart',
    });
  }
  return (
    <div className="relative z-10 mb-4 border-b border-line bg-app">
      <nav
        aria-label="Procurement sections"
        className="-mb-px grid grid-flow-col auto-cols-fr gap-0 sm:flex sm:gap-1 sm:overflow-x-auto sm:px-1"
      >
        {visible.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              [
                'group inline-flex min-h-11 min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-t-lg px-2 py-2.5 text-sm font-semibold transition sm:justify-start sm:gap-2 sm:px-3',
                isActive
                  ? 'border-b-2 border-brand-600 text-brand-700 dark:border-brand-300 dark:text-brand-300'
                  : 'border-b-2 border-transparent text-muted hover:border-line hover:text-ink',
              ].join(' ')
            }
          >
            <Icon name={t.icon} className="h-4 w-4" />
            {t.shortLabel ? (
              <>
                <span className="sm:hidden">{t.shortLabel}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </>
            ) : (
              t.label
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
