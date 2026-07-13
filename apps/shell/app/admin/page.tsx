"use client";

import Link from "next/link";
import { Guard } from "@intra/auth";
import { Badge, Card, Icon } from "@intra/ui";

const areas = [
  {
    href: "/admin/users",
    icon: "list" as const,
    title: "Users and roles",
    summary: "Provision identities, assign minimum scoped roles, and review current access.",
    status: "Live",
  },
  {
    href: "/admin/doa",
    icon: "signature" as const,
    title: "Delegation of Authority",
    summary: "Create department approval matrices, named approvers, limits, and effective revisions.",
    status: "Live",
  },
  {
    href: "/knowledge?flow=administration&view=flow",
    icon: "shield" as const,
    title: "Governance runbook",
    summary: "Follow access, department, DOA, route, exception, and audit decision paths.",
    status: "Guide",
  },
] as const;

export default function AdministrationPage() {
  return (
    <Guard module="core" cap="manage_rbac">
      <div className="space-y-7">
        <header className="border-b border-line pb-6">
          <p className="text-xs font-semibold uppercase text-brand-700">Platform governance</p>
          <h1 className="mt-1 text-3xl font-bold text-ink">Administration</h1>
          <p className="mt-2 max-w-3xl text-muted">
            Manage accountable access and approval configuration from one governed workspace.
          </p>
        </header>
        <section aria-labelledby="admin-areas" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <h2 id="admin-areas" className="sr-only">Administration areas</h2>
          {areas.map((area) => (
            <Card key={area.href} className="flex min-h-52 flex-col p-5">
              <div className="flex items-start justify-between gap-3">
                <span className="grid h-10 w-10 place-items-center bg-brand-50 text-brand-700">
                  <Icon name={area.icon} className="h-5 w-5" />
                </span>
                <Badge tone={area.status === "Live" ? "emerald" : "cyan"}>{area.status}</Badge>
              </div>
              <h2 className="mt-4 text-lg font-bold text-ink">{area.title}</h2>
              <p className="mt-2 flex-1 text-sm leading-6 text-muted">{area.summary}</p>
              <Link href={area.href} className="btn-outline mt-4 w-full justify-between">
                Open <Icon name="arrowRight" className="h-4 w-4" />
              </Link>
            </Card>
          ))}
        </section>
        <aside className="border-l-4 border-amber-500 bg-amber-50 p-4 text-sm text-amber-900">
          Administrative changes must have named approval, least privilege, an effective date, and retained audit evidence. Use a new revision instead of overwriting governed history.
        </aside>
      </div>
    </Guard>
  );
}
