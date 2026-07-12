"use client";

import * as React from "react";
import Link from "next/link";
import { Badge, Icon } from "@intra/ui";
import type {
  KnowledgeArticle,
  KnowledgeFeature,
  KnowledgeFlow,
  KnowledgeRole,
} from "@shell/lib/knowledge/types";

const availabilityLabel = {
  live: "Live",
  limited: "Limited",
  coming_soon: "Coming soon",
} as const;

const availabilityTone = (availability: KnowledgeRole["availability"]) =>
  availability === "live"
    ? ("emerald" as const)
    : availability === "limited"
      ? ("amber" as const)
      : ("slate" as const);

const unique = (values: string[]) => [...new Set(values)];

export function KnowledgeRoleGuide({
  role,
  rolesById,
  relatedFeatures,
  relatedArticles,
  relatedFlows,
  onBack,
  onOpenArticle,
  onOpenFlow,
}: {
  role: KnowledgeRole;
  rolesById: Map<string, KnowledgeRole>;
  relatedFeatures: KnowledgeFeature[];
  relatedArticles: KnowledgeArticle[];
  relatedFlows: KnowledgeFlow[];
  onBack: () => void;
  onOpenArticle: (id: string) => void;
  onOpenFlow: (id: string) => void;
}) {
  const isRoadmap = role.availability === "coming_soon";
  const taskNames = unique([
    ...relatedFlows.flatMap((flow) =>
      flow.nodes
        .filter((node) => node.ownerRoleIds.includes(role.id))
        .filter((node) => node.type !== "terminal")
        .map((node) => node.title),
    ),
    ...relatedFeatures.flatMap((feature) =>
      feature.controls.map((control) => control.name),
    ),
  ]).slice(0, 12);
  const commonTasks = taskNames.length > 0 ? taskNames : role.authority.canDo;

  return (
    <article className="mx-auto max-w-5xl">
      <button
        type="button"
        className="btn-ghost btn-sm min-h-11"
        onClick={onBack}
      >
        <Icon name="chevron" className="h-4 w-4 rotate-90" />
        Back to Knowledge Base
      </button>

      <header className="mt-4 border-b border-line pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="brand">{role.module}</Badge>
          <Badge tone={availabilityTone(role.availability)}>
            {availabilityLabel[role.availability]}
          </Badge>
          {isRoadmap && <Badge tone="slate">Roadmap profile</Badge>}
        </div>
        <h1 className="mt-3 text-3xl font-bold text-ink">{role.label}</h1>
        <p className="mt-2 max-w-3xl text-base leading-7 text-muted">
          {role.purpose}
        </p>
        <p className="mt-4 border-l-4 border-brand-500 pl-4 text-sm leading-6 text-ink">
          {isRoadmap
            ? "Not available for live work. This profile documents planned authority only and grants no current access or execution rights."
            : `${role.label} has ${role.authority.capabilities.length} recorded capabilities and ${role.authority.decisions.length} explicit decision ${role.authority.decisions.length === 1 ? "responsibility" : "responsibilities"}.`}
        </p>
      </header>

      <div className="mt-7 space-y-9">
        <GuideSection id="role-pages" title="Accessible pages">
          {role.authority.accessibleRoutes.length > 0 ? (
            <ul className="mt-3 divide-y divide-line border-y border-line">
              {role.authority.accessibleRoutes.map((route) => (
                <li
                  key={route}
                  className="flex min-h-14 items-center justify-between gap-3 py-2"
                >
                  <code className="break-all text-sm text-ink">{route}</code>
                  {isRoadmap ? (
                    <span
                      aria-disabled="true"
                      className="shrink-0 text-xs font-semibold text-faint"
                    >
                      Planned route
                    </span>
                  ) : (
                    <Link
                      href={route}
                      className="btn-outline btn-sm min-h-11 shrink-0"
                    >
                      Open page
                      <Icon name="arrowRight" className="h-4 w-4" />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">
              {isRoadmap
                ? "No live pages are assigned to this planned profile."
                : "This role has no direct page entry; work arrives through assigned records."}
            </p>
          )}
        </GuideSection>

        <GuideSection id="role-capabilities" title="Capability matrix">
          <div
            className="mt-3 overflow-x-auto border-y border-line"
            tabIndex={0}
            role="region"
            aria-label="Role capability matrix"
          >
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="bg-inset text-xs uppercase text-muted">
                <tr>
                  <th scope="col" className="px-3 py-3 font-semibold">
                    Capability
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold">
                    State
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold">
                    Operational meaning
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {role.authority.capabilities.length > 0 ? (
                  role.authority.capabilities.map((capability) => (
                    <tr key={capability}>
                      <th
                        scope="row"
                        className="px-3 py-3 font-mono font-medium text-ink"
                      >
                        {capability}
                      </th>
                      <td className="px-3 py-3 text-muted">Granted</td>
                      <td className="px-3 py-3 text-muted">
                        Subject to current record state, route policy, and
                        segregation of duties.
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3} className="px-3 py-4 text-muted">
                      No live capabilities assigned.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </GuideSection>

        <GuideSection id="role-boundaries" title="Can do and cannot do">
          <div className="mt-3 grid gap-6 border-y border-line py-5 md:grid-cols-2">
            <div>
              <h3 className="font-semibold text-emerald-700">Can do</h3>
              <BulletList items={role.authority.canDo} />
            </div>
            <div className="md:border-l md:border-line md:pl-6">
              <h3 className="font-semibold text-red-700">Cannot do</h3>
              <BulletList items={role.authority.cannotDo} />
            </div>
          </div>
        </GuideSection>

        <GuideSection id="role-decisions" title="Decision authority">
          <BulletList items={role.authority.decisions} />
        </GuideSection>

        <GuideSection id="role-timeline" title="Responsibility timeline">
          <ol className="mt-3 divide-y divide-line border-y border-line">
            <TimelineItem number="1" title="Receive and verify">
              Confirm the record, status, evidence, ownership, and authority
              before acting.
            </TimelineItem>
            <TimelineItem number="2" title="Act or decide">
              Complete only the recorded capabilities and decisions listed in
              this guide.
            </TimelineItem>
            <TimelineItem number="3" title="Record and hand off">
              Preserve evidence, reason, actor, and status so the downstream
              owner can continue.
            </TimelineItem>
          </ol>
        </GuideSection>

        <GuideSection
          id="role-handoffs"
          title="Upstream and downstream handoffs"
        >
          <div className="mt-3 grid gap-6 border-y border-line py-5 md:grid-cols-2">
            <HandoffList
              title="Receives from"
              roleIds={role.authority.upstreamRoleIds}
              rolesById={rolesById}
            />
            <div className="md:border-l md:border-line md:pl-6">
              <HandoffList
                title="Hands off to"
                roleIds={role.authority.downstreamRoleIds}
                rolesById={rolesById}
              />
            </div>
          </div>
        </GuideSection>

        <GuideSection id="role-tasks" title="Common tasks">
          <BulletList items={commonTasks} />
        </GuideSection>

        <GuideSection id="role-sod" title="Segregation of duties">
          <p className="mt-2 text-sm leading-6 text-muted">
            Access is additive, but authority is not transferable. A page or
            platform role never replaces the independent owner or decision
            authority named by policy.
          </p>
          <BulletList items={role.authority.cannotDo} />
        </GuideSection>

        <GuideSection id="role-escalation" title="Exceptions and escalation">
          <p className="mt-2 text-sm leading-6 text-muted">
            Stop when access, ownership, evidence, or record status conflicts
            with this guide. Do not use an offline action to bypass a denied or
            unavailable control.
          </p>
          <p className="mt-3 border-l-4 border-amber-500 pl-4 text-sm font-medium leading-6 text-ink">
            {role.authority.escalation}
          </p>
        </GuideSection>

        <GuideSection id="role-related" title="Related content">
          <div className="mt-3 divide-y divide-line border-y border-line">
            {relatedFeatures.map((feature) => (
              <RelatedButton
                key={`feature-${feature.id}`}
                label={feature.title}
                context="Feature guide"
                onClick={() => onOpenArticle(`feature-${feature.id}`)}
              />
            ))}
            {relatedArticles.map((article) => (
              <RelatedButton
                key={article.id}
                label={article.title}
                context="Procedure"
                onClick={() => onOpenArticle(article.id)}
              />
            ))}
            {relatedFlows.map((flow) => (
              <RelatedButton
                key={flow.id}
                label={flow.title}
                context="Guided workflow"
                onClick={() => onOpenFlow(flow.id)}
              />
            ))}
            {relatedFeatures.length +
              relatedArticles.length +
              relatedFlows.length ===
              0 && (
              <p className="py-4 text-sm text-muted">
                No related live handbook content is registered yet.
              </p>
            )}
          </div>
        </GuideSection>
      </div>
    </article>
  );
}

function GuideSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="text-xl font-bold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function TimelineItem({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4 py-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">
        {number}
      </span>
      <div>
        <h3 className="font-semibold text-ink">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-muted">{children}</p>
      </div>
    </li>
  );
}

function HandoffList({
  title,
  roleIds,
  rolesById,
}: {
  title: string;
  roleIds: string[];
  rolesById: Map<string, KnowledgeRole>;
}) {
  return (
    <div>
      <h3 className="font-semibold text-ink">{title}</h3>
      <ul className="mt-2 space-y-2 text-sm text-muted">
        {roleIds.map((id) => (
          <li key={id}>{rolesById.get(id)?.label ?? id}</li>
        ))}
      </ul>
    </div>
  );
}

function RelatedButton({
  label,
  context,
  onClick,
}: {
  label: string;
  context: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 w-full items-center justify-between gap-4 py-3 text-left hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <span>
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="mt-0.5 block text-xs text-muted">{context}</span>
      </span>
      <Icon name="arrowRight" className="h-4 w-4 shrink-0" />
    </button>
  );
}
