"use client";

import Link from "next/link";
import { Guard } from "@intra/auth";
import {
  Badge,
  Card,
  HeroChipButton,
  Icon,
  ModuleHero,
  SectionTitle,
} from "@intra/ui";

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
      <div className="space-y-7">
        <ModuleHero
          eyebrow="Platform governance"
          title="Administration"
          description="Manage accountable access, organization structure, approval authority, and retained audit evidence."
          icon="shield"
          action={
            <HeroChipButton
              href="/knowledge?flow=administration&view=flow"
              icon="info"
            >
              Open governance runbook
            </HeroChipButton>
          }
          accessory={<Badge tone="emerald">Governed workspace</Badge>}
        />
        <section aria-labelledby="admin-areas">
          <SectionTitle
            id="admin-areas"
            eyebrow="Configuration"
            title="Administration areas"
            subtitle="Choose the record type you need to govern. Changes retain actor, effective date, and history."
          />
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {areas.map((area) => (
              <Card
                key={area.href}
                className="workflow-launcher flex min-h-44 flex-col p-5"
                data-tone={area.status === "Live" ? "brand" : "cyan"}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="grid h-10 w-10 place-items-center bg-brand-50 text-brand-700">
                    <Icon name={area.icon} className="h-5 w-5" />
                  </span>
                  <Badge tone={area.status === "Live" ? "emerald" : "cyan"}>
                    {area.status}
                  </Badge>
                </div>
                <h2 className="mt-4 text-lg font-bold text-ink">
                  {area.title}
                </h2>
                <p className="mt-2 flex-1 text-sm leading-6 text-muted">
                  {area.summary}
                </p>
                <Link
                  href={area.href}
                  className="btn-outline mt-4 w-full justify-between"
                >
                  Open <Icon name="arrowRight" className="h-4 w-4" />
                </Link>
              </Card>
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
