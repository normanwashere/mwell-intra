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
import { capabilityGuidance } from "@shell/lib/knowledge/capabilities";

const availabilityLabel = {
  live: "Live",
  limited: "Limited",
  coming_soon: "Coming soon",
} as const;

const availabilityTone = (availability: KnowledgeFeature["availability"]) =>
  availability === "live"
    ? ("emerald" as const)
    : availability === "limited"
      ? ("amber" as const)
      : ("slate" as const);

export function FeatureGuide({
  feature,
  rolesById,
  relatedArticles,
  relatedFlows,
  onBack,
  onOpenArticle,
  onOpenFlow,
}: {
  feature: KnowledgeFeature;
  rolesById: Map<string, KnowledgeRole>;
  relatedArticles: KnowledgeArticle[];
  relatedFlows: KnowledgeFlow[];
  onBack: () => void;
  onOpenArticle: (id: string) => void;
  onOpenFlow: (id: string) => void;
}) {
  const isRoadmap = feature.availability === "coming_soon";
  const exactFlows = relatedFlows.filter((flow) =>
    feature.relatedFlowIds.includes(flow.id),
  );

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
          <Badge tone="brand">{feature.module}</Badge>
          <Badge tone={availabilityTone(feature.availability)}>
            {availabilityLabel[feature.availability]}
          </Badge>
          {isRoadmap && <Badge tone="slate">Reference only</Badge>}
        </div>
        <h1 className="mt-3 text-3xl font-bold text-ink">{feature.title}</h1>
        <p className="mt-2 max-w-3xl text-base leading-7 text-muted">
          {feature.purpose}
        </p>
        {isRoadmap && (
          <p className="mt-4 border-l-4 border-amber-500 pl-4 text-sm font-medium leading-6 text-ink">
            Not available for live work. Routes and controls below describe
            planned behavior and do not execute an action.
          </p>
        )}
        <dl className="mt-5 grid gap-4 border-y border-line py-4 sm:grid-cols-3">
          <Meta label="Audience">
            {feature.roleIds
              .map((id) => rolesById.get(id)?.label ?? id)
              .join(", ")}
          </Meta>
          <Meta label="Owner">{feature.owner}</Meta>
          <Meta label="Reviewed">{feature.reviewedAt}</Meta>
        </dl>
      </header>

      <div className="mt-7 space-y-9">
        <GuideSection id="feature-entry" title="Entry routes and access">
          <div className="mt-3 divide-y divide-line border-y border-line">
            {feature.routes.map((route) => (
              <div
                key={route}
                className="flex min-h-14 items-center justify-between gap-3 py-2"
              >
                <code className="break-all text-sm text-ink">{route}</code>
                {isRoadmap || route.includes(":") ? (
                  <span
                    aria-disabled="true"
                    className="shrink-0 text-xs font-semibold text-faint"
                  >
                    {isRoadmap ? "Planned route" : "Open from a record list"}
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
              </div>
            ))}
          </div>
          <p className="mt-3 text-sm text-muted">
            Required capabilities:{" "}
            {feature.capabilityIds.length > 0
              ? feature.capabilityIds
                  .map(
                    (capability) =>
                      capabilityGuidance(capability, feature.module).label,
                  )
                  .join(", ")
              : "authenticated access described by the route"}
            .
          </p>
        </GuideSection>

        <GuideSection id="feature-controls" title="Controls">
          <ol className="mt-3 divide-y divide-line border-y border-line">
            {feature.controls.map((control) => (
              <li key={control.name} className="py-5">
                <h3 className="font-semibold text-ink">{control.name}</h3>
                <dl className="mt-3 grid gap-4 text-sm sm:grid-cols-3">
                  <Definition term="Behavior">{control.behavior}</Definition>
                  <Definition term="Validation">
                    {control.validation}
                  </Definition>
                  <Definition term="Result">{control.result}</Definition>
                </dl>
              </li>
            ))}
          </ol>
        </GuideSection>

        <GuideSection id="feature-fields" title="Fields">
          {(feature.fields ?? []).length > 0 ? (
            <div
              className="mt-3 overflow-x-auto border-y border-line"
              tabIndex={0}
              role="region"
              aria-label="Feature fields"
            >
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead className="bg-inset text-xs uppercase text-muted">
                  <tr>
                    <th scope="col" className="px-3 py-3 font-semibold">
                      Field
                    </th>
                    <th scope="col" className="px-3 py-3 font-semibold">
                      Requirement
                    </th>
                    <th scope="col" className="px-3 py-3 font-semibold">
                      Purpose
                    </th>
                    <th scope="col" className="px-3 py-3 font-semibold">
                      Validation
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {(feature.fields ?? []).map((field) => (
                    <tr key={field.name}>
                      <th
                        scope="row"
                        className="px-3 py-3 font-medium text-ink"
                      >
                        {field.name}
                      </th>
                      <td className="px-3 py-3 text-muted">
                        {field.required ? "Required" : "Optional"}
                      </td>
                      <td className="px-3 py-3 text-muted">{field.purpose}</td>
                      <td className="px-3 py-3 text-muted">
                        {field.validation}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">
              This page has no user-entered fields.
            </p>
          )}
        </GuideSection>

        <GuideSection id="feature-data" title="Reads and writes">
          <div className="mt-3 grid gap-6 border-y border-line py-5 md:grid-cols-2">
            <DataList title="Reads" items={feature.reads} />
            <div className="md:border-l md:border-line md:pl-6">
              <DataList title="Writes" items={feature.writes} />
            </div>
          </div>
        </GuideSection>

        <GuideSection id="feature-states" title="Statuses and notifications">
          <div className="mt-3 grid gap-6 border-y border-line py-5 md:grid-cols-2">
            <DataList title="Statuses" items={feature.statuses} />
            <div className="md:border-l md:border-line md:pl-6">
              <DataList
                title="Notifications and feedback"
                items={
                  feature.notifications ?? [
                    "No notification is recorded by this page.",
                  ]
                }
              />
            </div>
          </div>
        </GuideSection>

        <GuideSection id="feature-outcomes" title="Errors and completion">
          <div className="mt-3 grid gap-6 border-y border-line py-5 md:grid-cols-2">
            <DataList title="Errors and recovery" items={feature.exceptions} />
            <div className="md:border-l md:border-line md:pl-6">
              <DataList
                title="Completion evidence"
                items={
                  feature.completionEvidence ?? [
                    "The expected governed status is visible on the record.",
                  ]
                }
              />
            </div>
          </div>
        </GuideSection>

        <GuideSection id="feature-policy" title="Policy basis">
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
            {feature.policyBasis.map((policy) => (
              <li key={policy}>{policy}</li>
            ))}
          </ul>
        </GuideSection>

        <GuideSection id="feature-related" title="Related flows and content">
          <div className="mt-3 divide-y divide-line border-y border-line">
            {feature.roleIds.map((roleId) => (
              <RelatedButton
                key={`role-${roleId}`}
                label={rolesById.get(roleId)?.label ?? roleId}
                context="Role guide"
                onClick={() => onOpenArticle(`role-${roleId}`)}
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
            {exactFlows.map((flow) => (
              <RelatedButton
                key={flow.id}
                label={flow.title}
                context="Guided workflow"
                onClick={() => onOpenFlow(flow.id)}
              />
            ))}
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

function Meta({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-faint">{label}</dt>
      <dd className="mt-1 text-sm text-ink">{children}</dd>
    </div>
  );
}

function Definition({
  term,
  children,
}: {
  term: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase text-faint">{term}</dt>
      <dd className="mt-1 leading-6 text-muted">{children}</dd>
    </div>
  );
}

function DataList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="font-semibold text-ink">{title}</h3>
      <ul className="mt-2 list-disc space-y-2 pl-5 text-sm leading-6 text-muted">
        {items.map((item) => (
          <li key={item}>{item}</li>
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
