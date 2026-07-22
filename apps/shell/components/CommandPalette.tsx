"use client";

// Cmd+K / Ctrl+K command palette — navigate modules, jump to common actions.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, type IconName } from "@intra/ui";
import { useSession } from "@intra/auth";
import {
  ADMIN_NAV,
  FINANCE_NAV,
  KNOWLEDGE_NAV,
  VENDOR_NAV,
  accessibleModules,
  canAccessFinance,
  hasCapability,
  hasModuleAccess,
} from "@shell/lib/navigation";
import { cx } from "@shell/lib/cx";

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  icon: IconName;
  href: string;
  keywords?: string;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const router = useRouter();
  const { profile, userRoles, userCapabilities, mode, loading } = useSession();

  const items = useMemo<CommandItem[]>(() => {
    if (loading) return [];
    const access = { mode, userRoles, userCapabilities };
    const out: CommandItem[] = [
      { id: "home", label: "Home", icon: "grid", href: "/" },
    ];

    if (!profile) {
      out.push({
        id: "login",
        label: "Sign in",
        icon: "lock",
        href: "/login",
        keywords: "auth",
      });
      return out;
    }

    out.push({
      id: "knowledge",
      label: KNOWLEDGE_NAV.label,
      hint: KNOWLEDGE_NAV.description,
      icon: KNOWLEDGE_NAV.icon,
      href: KNOWLEDGE_NAV.href,
      keywords: "help manual documentation workflow how to troubleshooting",
    });

    for (const m of accessibleModules(access)) {
      out.push({
        id: `mod-${m.module}`,
        label: m.label,
        hint: m.description,
        icon: m.icon,
        href: m.href,
        keywords: m.module,
      });
    }

    if (hasCapability(access, "procurement", "create_request")) {
      out.push({
        id: "proc-new",
        label: "New procurement request",
        icon: "plus",
        href: "/procurement/requests/new",
        keywords: "create pr",
      });
    }
    if (hasCapability(access, "procurement", "approve_request")) {
      out.push({
        id: "proc-inbox",
        label: "Approval inbox",
        icon: "clipboard",
        href: "/procurement/approvals",
        keywords: "approve",
      });
    }
    if (hasModuleAccess(access, "procurement")) {
      out.push({
        id: "proc-pos",
        label: "Purchase orders",
        icon: "cart",
        href: "/procurement/purchase-orders",
      });
    }

    if (hasModuleAccess(access, "legal")) {
      out.push({
        id: "legal-cases",
        label: "Accreditation cases",
        icon: "clipboard",
        href: "/legal/cases",
      });
    }
    if (hasCapability(access, "legal", "admin")) {
      out.push({
        id: "legal-invite",
        label: "Invite vendor",
        icon: "plus",
        href: "/legal/invites/new",
      });
    }

    if (hasModuleAccess(access, "warehouse")) {
      out.push({
        id: "wh-dash",
        label: "Warehouse dashboard",
        icon: "box",
        href: "/warehouse",
      });
    }

    if (canAccessFinance(access)) {
      out.push({
        id: "finance",
        label: FINANCE_NAV.label,
        hint: FINANCE_NAV.description,
        icon: FINANCE_NAV.icon,
        href: FINANCE_NAV.href,
        keywords:
          "valuation commitments payment readiness costing reconciliation receipts returns",
      });
    }

    if (profile.kind === "vendor") {
      out.push({
        id: "vendor",
        label: VENDOR_NAV.label,
        icon: VENDOR_NAV.icon,
        href: VENDOR_NAV.href,
      });
    }

    if (hasCapability(access, "core", "manage_rbac")) {
      out.push({
        id: "admin",
        label: ADMIN_NAV.label,
        hint: ADMIN_NAV.description,
        icon: ADMIN_NAV.icon,
        href: ADMIN_NAV.href,
      });
    }

    return out;
  }, [loading, mode, profile, userCapabilities, userRoles]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.hint?.toLowerCase().includes(q) ||
        i.keywords?.toLowerCase().includes(q),
    );
  }, [items, query]);

  const run = useCallback(
    (href: string) => {
      setOpen(false);
      setQuery("");
      setActive(0);
      router.push(href);
    },
    [router],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    setActive(0);
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, filtered.length - 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && filtered[active]) {
        e.preventDefault();
        run(filtered[active].href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, active, run]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-[12vh] backdrop-blur-sm"
      role="presentation"
      onMouseDown={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-line bg-surface shadow-e3"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <Icon name="search" className="h-4 w-4 text-faint" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search modules and actions…"
            className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
          />
          <kbd className="hidden rounded-md border border-line bg-inset px-1.5 py-0.5 font-mono text-[0.65rem] text-faint sm:inline">
            esc
          </kbd>
        </div>
        <ul
          className="max-h-[min(50vh,20rem)] overflow-y-auto p-2"
          role="listbox"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted">
              No matches
            </li>
          ) : (
            filtered.map((item, idx) => (
              <li key={item.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={idx === active}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => run(item.href)}
                  className={cx(
                    "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition",
                    idx === active
                      ? "bg-brand-500/10 text-ink"
                      : "text-muted hover:bg-inset hover:text-ink",
                  )}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-inset text-brand-700 dark:text-brand-300">
                    <Icon name={item.icon} className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{item.label}</span>
                    {item.hint && (
                      <span className="block truncate text-xs text-faint">
                        {item.hint}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="border-t border-line px-4 py-2 text-[0.65rem] text-faint">
          <span className="hidden sm:inline">
            Navigate with ↑↓ · Enter to open ·{" "}
          </span>
          <kbd className="rounded border border-line bg-inset px-1 font-mono">
            ⌘K
          </kbd>
        </div>
      </div>
    </div>
  );
}
