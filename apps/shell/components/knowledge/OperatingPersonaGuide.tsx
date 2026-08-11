"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Badge, Icon } from "@intra/ui";
import type {
  KnowledgeFeature,
  KnowledgeFlow,
  KnowledgeRole,
} from "@shell/lib/knowledge/types";
import type {
  OperatingPersona,
  OperatingPersonaGuide as PersonaGuideDefinition,
} from "@shell/lib/knowledge/operatingPersonas";

const unique = (items: string[]) => [...new Set(items)];

export function OperatingPersonaGuide({
  persona,
  guide,
  linkedRoles,
  rolesById,
  relatedFlows,
  relatedFeatures,
  onBack,
  onOpenFlow,
  onOpenFeature,
}: {
  persona: OperatingPersona;
  guide: PersonaGuideDefinition;
  linkedRoles: KnowledgeRole[];
  rolesById: Map<string, KnowledgeRole>;
  relatedFlows: KnowledgeFlow[];
  relatedFeatures: KnowledgeFeature[];
  onBack: () => void;
  onOpenFlow: (id: string) => void;
  onOpenFeature: (id: string) => void;
}) {
  const canDo = unique(linkedRoles.flatMap((role) => role.authority.canDo));
  const cannotDo = unique(
    linkedRoles.flatMap((role) => role.authority.cannotDo),
  );
  const decisions = unique(
    linkedRoles.flatMap((role) => role.authority.decisions),
  );
  const escalations = unique(
    linkedRoles.map((role) => role.authority.escalation),
  );
  const upstream = unique(
    linkedRoles.flatMap((role) => role.authority.upstreamRoleIds),
  );
  const downstream = unique(
    linkedRoles.flatMap((role) => role.authority.downstreamRoleIds),
  );
  const visibleFeatures = relatedFeatures.slice(0, 4);
  const visibleFlows = relatedFlows.slice(0, 4);

  return (
    <article className="mx-auto max-w-6xl pb-10">
      <button
        type="button"
        className="btn-ghost btn-sm min-h-11"
        onClick={onBack}
      >
        <Icon name="chevron" className="h-4 w-4 rotate-180" />
        All job personas
      </button>

      <header className="mt-3 border-b border-line pb-6">
        <nav aria-label="Breadcrumb" className="text-xs text-muted">
          Knowledge Base <span aria-hidden="true">/</span> Roles
        </nav>
        <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="brand">{persona.department}</Badge>
              <Badge tone="emerald">Live</Badge>
            </div>
            <h1 className="mt-3 text-3xl font-bold text-ink sm:text-4xl">
              {persona.label}
            </h1>
            <p className="mt-2 max-w-3xl text-base leading-7 text-muted">
              {persona.responsibility}
            </p>
          </div>
          <div className="border-l-4 border-brand-500 bg-inset px-4 py-3">
            <p className="text-xs font-semibold uppercase text-brand-700">
              Start here
            </p>
            <p className="mt-1 text-sm leading-6 text-ink">
              Choose the work you need to complete. Open the live workspace or
              follow the illustrated walkthrough.
            </p>
          </div>
        </div>
      </header>

      <section
        id="persona-start"
        className="scroll-mt-24 pt-7"
        aria-labelledby="persona-start-title"
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-brand-700">
              Your work
            </p>
            <h2
              id="persona-start-title"
              className="mt-1 text-xl font-bold text-ink"
            >
              What do you need to do?
            </h2>
          </div>
          <span className="text-xs text-muted">
            {guide.tasks.length} live task{guide.tasks.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {guide.tasks.map((task, index) => (
            <section
              key={task.id}
              aria-labelledby={`persona-task-${task.id}`}
              className="flex min-h-44 flex-col rounded-lg border border-line bg-surface p-4 shadow-e1"
            >
              <div className="flex items-start gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-50 text-sm font-bold text-brand-700">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <h3
                    id={`persona-task-${task.id}`}
                    className="font-semibold text-ink"
                  >
                    {task.title}
                  </h3>
                  <p className="mt-1 text-sm leading-6 text-muted">
                    {task.summary}
                  </p>
                </div>
              </div>
              <div className="mt-auto flex flex-wrap gap-2 pt-4">
                <Link
                  href={task.workspaceHref}
                  className="btn-primary btn-sm min-h-11"
                >
                  Open workspace
                  <Icon name="arrowRight" className="h-4 w-4" />
                </Link>
                <button
                  type="button"
                  className="btn-outline btn-sm min-h-11"
                  onClick={() => onOpenFeature(task.featureId)}
                >
                  Show me how
                </button>
              </div>
            </section>
          ))}
        </div>
      </section>

      <section
        id="persona-responsibility"
        className="scroll-mt-24 border-t border-line pt-7 mt-8"
        aria-labelledby="persona-responsibility-title"
      >
        <p className="text-xs font-semibold uppercase text-brand-700">
          Responsibility
        </p>
        <h2
          id="persona-responsibility-title"
          className="mt-1 text-xl font-bold text-ink"
        >
          What you own and when to stop
        </h2>
        <div className="mt-5 grid gap-6 md:grid-cols-2">
          <div>
            <h3 className="font-semibold text-emerald-700">
              You are expected to
            </h3>
            <BulletList items={canDo} />
          </div>
          <div className="md:border-l md:border-line md:pl-6">
            <h3 className="font-semibold text-amber-800">
              Stop and escalate when
            </h3>
            <BulletList items={escalations} />
          </div>
        </div>
      </section>

      <section
        className="mt-8 divide-y divide-line border-y border-line"
        aria-label="Role decisions, boundaries, and handoffs"
      >
        <ReferenceDetails
          title="Decisions you can make"
          count={decisions.length}
        >
          <BulletList items={decisions} />
        </ReferenceDetails>
        <ReferenceDetails
          title="Permissions and boundaries"
          count={cannotDo.length}
        >
          <p className="mt-1 text-sm leading-6 text-muted">
            These safeguards remain in force even when one person holds several
            compatible roles.
          </p>
          <BulletList items={cannotDo} />
          <div className="mt-5 border-t border-line pt-4">
            <p className="text-xs font-semibold uppercase text-faint">
              Access profiles combined for this job
            </p>
            <p className="mt-2 text-sm text-muted">
              {linkedRoles.map((role) => role.label).join(" | ")}
            </p>
          </div>
        </ReferenceDetails>
        <ReferenceDetails
          title="Upstream and downstream handoffs"
          count={upstream.length + downstream.length}
        >
          <div className="mt-3 grid gap-6 sm:grid-cols-2">
            <RoleList
              title="Receives from"
              ids={upstream}
              rolesById={rolesById}
            />
            <RoleList
              title="Hands off to"
              ids={downstream}
              rolesById={rolesById}
            />
          </div>
        </ReferenceDetails>
      </section>

      <section
        id="persona-related"
        className="scroll-mt-24 pt-8"
        aria-labelledby="persona-related-title"
      >
        <p className="text-xs font-semibold uppercase text-brand-700">
          Keep learning
        </p>
        <h2
          id="persona-related-title"
          className="mt-1 text-xl font-bold text-ink"
        >
          Related guidance
        </h2>
        <p className="mt-1 text-sm text-muted">
          Only the most relevant guides for this job are shown here.
        </p>
        <div className="mt-4 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2">
          {visibleFeatures.map((feature) => (
            <RelatedButton
              key={`feature-${feature.id}`}
              title={feature.title}
              context="Feature walkthrough"
              onClick={() => onOpenFeature(feature.id)}
            />
          ))}
          {visibleFlows.map((flow) => (
            <RelatedButton
              key={`flow-${flow.id}`}
              title={flow.title}
              context="Decision tree"
              onClick={() => onOpenFlow(flow.id)}
            />
          ))}
        </div>
      </section>
    </article>
  );
}

function ReferenceDetails({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details className="group py-1">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-3 font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        <span>{title}</span>
        <span className="flex items-center gap-2 text-xs text-muted">
          {count}
          <Icon
            name="chevron"
            className="h-4 w-4 rotate-90 transition group-open:-rotate-90"
          />
        </span>
      </summary>
      <div className="pb-5 pr-2">{children}</div>
    </details>
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

function RoleList({
  title,
  ids,
  rolesById,
}: {
  title: string;
  ids: string[];
  rolesById: Map<string, KnowledgeRole>;
}) {
  return (
    <div>
      <h3 className="font-semibold text-ink">{title}</h3>
      <ul className="mt-2 space-y-2 text-sm text-muted">
        {ids.map((id) => (
          <li key={id}>
            {rolesById.get(id)?.label ?? id.replaceAll("_", " ")}
          </li>
        ))}
      </ul>
    </div>
  );
}

function RelatedButton({
  title,
  context,
  onClick,
}: {
  title: string;
  context: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-20 items-center justify-between gap-3 bg-surface p-4 text-left hover:bg-inset focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
    >
      <span>
        <span className="block font-semibold text-ink">{title}</span>
        <span className="mt-1 block text-xs text-muted">{context}</span>
      </span>
      <Icon
        name="arrowRight"
        className="h-4 w-4 shrink-0 text-brand-700 transition group-hover:translate-x-0.5"
      />
    </button>
  );
}
