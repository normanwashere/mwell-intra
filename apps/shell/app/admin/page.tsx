"use client";

import Link from "next/link";
import { Guard } from "@intra/auth";
import {
  Badge,
  HeroChipButton,
  Icon,
} from "@intra/ui";
import { AdminHeader } from './AdminHeader';

const areas = [
  {
    href: "/admin/users",
    icon: "list" as const,
    title: "Users and roles",
    summary:
      "Provision identities, assign minimum scoped roles, and review current access.",
    status: "Live",
  },
  {
    href: "/admin/doa",
    icon: "signature" as const,
    title: "Delegation of Authority",
    summary:
      "Create department approval matrices, named approvers, limits, and effective revisions.",
    status: "Live",
  },
  {
    href: "/admin/departments",
    icon: "building" as const,
    title: "Departments",
    summary:
      "Add, rename, re-parent, order, and deactivate organization units without changing application code.",
    status: "Live",
  },
  {
    href: "/admin/audit",
    icon: "shield" as const,
    title: "Audit history",
    summary:
      "Search retained access, department, DOA, and workflow changes by actor and record.",
    status: "Live",
  },
  {
    href: "/knowledge?flow=administration&view=flow",
    icon: "shield" as const,
    title: "Governance runbook",
    summary:
      "Follow access, department, DOA, route, exception, and audit decision paths.",
    status: "Guide",
  },
] as const;

export default function AdministrationPage() {
  return (
    <Guard module="core" cap="manage_rbac">
      <div className="space-y-4">
        <AdminHeader
          title="Administration"
          action={
            <HeroChipButton
              href="/knowledge?flow=administration&view=flow"
              icon="info"
            >
              Open governance runbook
            </HeroChipButton>
          }
        />
        <section aria-label="Administration areas">
          <div className="divide-y divide-line border-y border-line">
            {areas.map((area) => (
              <Link
                key={area.href}
                href={area.href}
                aria-label={`Open ${area.title}`}
                className="group grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)_1rem] items-start gap-3 px-2 py-4 transition hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto_1rem] sm:items-center"
                data-tone={area.status === "Live" ? "brand" : "cyan"}
              >
                  <span className="grid h-10 w-10 place-items-center rounded-md bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                    <Icon name={area.icon} className="h-5 w-5" />
                  </span>
                <div className="min-w-0">
                  <h2 className="break-words text-base font-bold text-ink">
                    {area.title}
                  </h2>
                  <p className="mt-1 break-words text-sm text-muted">
                    {area.summary}
                  </p>
                </div>
                <div className="col-start-2 row-start-2 sm:col-start-3 sm:row-start-1">
                  <Badge tone={area.status === "Live" ? "emerald" : "cyan"}>
                    {area.status}
                  </Badge>
                </div>
                <Icon name="arrowRight" className="col-start-3 row-start-1 mt-1 h-4 w-4 text-faint group-hover:text-brand-700 sm:col-start-4 sm:mt-0" />
              </Link>
            ))}
          </div>
        </section>
        <aside className="border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900">
          Administrative changes must have named approval, least privilege, an
          effective date, and retained audit evidence. Use a new revision
          instead of overwriting governed history.
        </aside>
      </div>
    </Guard>
  );
}
