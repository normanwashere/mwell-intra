"use client";

import { useState } from "react";
import { Badge, EmptyState, Icon, type IconName } from "@intra/ui";
import { OPERATING_PERSONAS } from "@shell/lib/knowledge/operatingPersonas";
import type {
  HandbookEntryMode,
  HandbookSearchResult,
} from "@shell/lib/knowledge/search";
import type {
  KnowledgeAvailability,
  KnowledgeContent,
  KnowledgeModule,
  KnowledgeRole,
} from "@shell/lib/knowledge/types";
import { OperatingModel } from "./OperatingModel";

const MODULES: Array<{
  id: KnowledgeModule;
  label: string;
  description: string;
  icon: IconName;
}> = [
  {
    id: "core",
    label: "Core Intra",
    description: "Home, work, people, departments, and events",
    icon: "grid",
  },
  {
    id: "procurement",
    label: "Procurement",
    description: "Requests, sourcing, approvals, and purchase orders",
    icon: "cart",
  },
  {
    id: "warehouse",
    label: "Warehouse",
    description: "Receiving, stock, quality, movement, and counts",
    icon: "box",
  },
  {
    id: "finance",
    label: "Finance",
    description: "Spend, matching, valuation, and readiness",
    icon: "coins",
  },
  {
    id: "legal",
    label: "Legal & compliance",
    description: "Accreditation, instruments, policy, and DOA",
    icon: "shield",
  },
  {
    id: "vendor",
    label: "Vendor portal",
    description: "Applications, evidence, declarations, and corrections",
    icon: "clipboard",
  },
  {
    id: "admin",
    label: "Administration",
    description: "Identity, access, setup, and governance",
    icon: "lock",
  },
  {
    id: "events",
    label: "Events",
    description: "Planning, fulfillment, returns, and reconciliation",
    icon: "calendar",
  },
  {
    id: "insights",
    label: "Insights",
    description: "Source-linked operational and leadership views",
    icon: "trend",
  },
];

const MODES: Array<{
  id: HandbookEntryMode;
  label: string;
  description: string;
  icon: IconName;
}> = [
  {
    id: "task",
    label: "Do a task",
    description: "Workflows and procedures",
    icon: "check",
  },
  {
    id: "role",
    label: "Understand a role",
    description: "Responsibilities and handoffs",
    icon: "building",
  },
  {
    id: "feature",
    label: "Explore a feature",
    description: "Pages, controls, and data",
    icon: "grid",
  },
];

const QUICK_SEARCHES = [
  "Create a purchase request",
  "Accredit a vendor",
  "Receive stock",
  "Resolve an exception",
];

const availabilityLabel: Record<KnowledgeAvailability, string> = {
  live: "Live",
  limited: "Limited",
  coming_soon: "Coming soon",
};

const availabilityTone = (availability: KnowledgeAvailability) =>
  availability === "live"
    ? ("emerald" as const)
    : availability === "limited"
      ? ("amber" as const)
      : ("slate" as const);

const resultTypeLabel: Record<HandbookSearchResult["type"], string> = {
  workflow: "Workflow",
  procedure: "Procedure",
  action: "Action",
  decision: "Decision",
  system: "System step",
  exception: "Exception",
  outcome: "Outcome",
  role: "Role",
  feature: "Feature",
  glossary: "Glossary",
  roadmap: "Roadmap",
};

const taskResultTypes: HandbookSearchResult["type"][] = [
  "workflow",
  "procedure",
  "action",
  "decision",
  "system",
  "exception",
  "outcome",
];

const FLOW_PHASES = [
  {
    label: "Govern and secure",
    description: "Access, authority, audit, and platform controls",
    icon: "shield" as IconName,
  },
  {
    label: "Source and control",
    description: "Demand, vendors, sourcing, orders, and finance",
    icon: "cart" as IconName,
  },
  {
    label: "Operate inventory",
    description: "Receive, inspect, store, move, issue, and reconcile",
    icon: "box" as IconName,
  },
  {
    label: "Recover and improve",
    description: "Exceptions, corrections, evidence, and learning",
    icon: "rotate" as IconName,
  },
] as const;

const flowPhase = (id: string) => {
  if (
    [
      "identity-and-access",
      "administration",
      "doa-governance",
      "access-recertification-offboarding",
      "audit-incident-handling",
    ].includes(id)
  )
    return "Govern and secure";
  if (
    [
      "procure-to-pay",
      "vendor-accreditation",
      "product-master-data-lifecycle",
      "po-amendment-cancellation",
      "finance-export-reconciliation",
    ].includes(id)
  )
    return "Source and control";
  if (["exception-and-recovery"].includes(id)) return "Recover and improve";
  return "Operate inventory";
};

export function HandbookLanding({
  content,
  results,
  query,
  mode,
  module,
  roleId,
  availability,
  resultLimit,
  recommendedRoleIds,
  rolesById,
  onSetParams,
  onOpenResult,
}: {
  content: KnowledgeContent;
  results: HandbookSearchResult[];
  query: string;
  mode: HandbookEntryMode;
  module: KnowledgeModule | "all";
  roleId: string;
  availability: KnowledgeAvailability | "all";
  resultLimit: number;
  recommendedRoleIds: string[];
  rolesById: Map<string, KnowledgeRole>;
  onSetParams: (
    changes: Record<string, string | null>,
    options?: { replace?: boolean; scroll?: "top" | "preserve" | "restore" },
  ) => void;
  onOpenResult: (result: HandbookSearchResult) => void;
}) {
  const recommendedRoles = new Set(recommendedRoleIds);
  const matchingResults = results.filter(
    (result) =>
      (availability === "all" || result.availability === availability) &&
      (query.length > 0 ||
        (mode === "task" && taskResultTypes.includes(result.type)) ||
        (mode !== "task" && result.type === mode) ||
        (mode === "feature" && result.type === "roadmap")),
  );
  const visibleResults = matchingResults.slice(0, resultLimit);
  const recommended = results
    .filter(
      (result) =>
        ["workflow", "procedure", "action"].includes(result.type) &&
        result.availability === "live" &&
        result.roleIds.some((id) => recommendedRoles.has(id)),
    )
    .slice(0, 4);
  const recentlyReviewed = results
    .filter(
      (result) => result.reviewedAt && result.availability !== "coming_soon",
    )
    .sort(
      (left, right) =>
        (right.reviewedAt ?? "").localeCompare(left.reviewedAt ?? "") ||
        left.title.localeCompare(right.title),
    )
    .slice(0, 4);
  const filtersActive =
    module !== "all" || roleId.length > 0 || availability !== "all";
  const isHome = !query && !filtersActive && mode === "task";
  const shouldShowResults =
    query.length > 0 || filtersActive || mode !== "task";

  return (
    <div className="mx-auto max-w-[78rem] space-y-10 pb-10">
      <header className="border-b border-line pb-6">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
              Mwell Intra Knowledge Base
            </p>
            <h1 className="mt-1 text-3xl font-bold text-ink sm:text-4xl">
              Find the right next step
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted sm:text-base">
              Follow a complete workflow, understand your responsibility, or
              find the exact control you need without leaving Intra.
            </p>
          </div>
          <dl className="flex gap-6 text-right">
            <div>
              <dt className="text-2xl font-bold text-ink">
                {content.flows.length}
              </dt>
              <dd className="text-xs text-muted">workflows</dd>
            </div>
            <div>
              <dt className="text-2xl font-bold text-ink">
                {OPERATING_PERSONAS.length}
              </dt>
              <dd className="text-xs text-muted">job personas</dd>
            </div>
          </dl>
        </div>
      </header>

      <section aria-labelledby="handbook-search-title" className="relative">
        <div className="rounded-lg border border-brand-400 bg-surface p-4 shadow-e1 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2
                id="handbook-search-title"
                className="text-lg font-bold text-ink"
              >
                Search the knowledge base
              </h2>
              <p className="mt-1 text-sm text-muted">
                Use a task, page, role, policy, status, error, or question.
              </p>
            </div>
            {(query || filtersActive || mode !== "task") && (
              <p
                className="text-sm font-medium text-muted"
                role="status"
                aria-live="polite"
              >
                {matchingResults.length} result
                {matchingResults.length === 1 ? "" : "s"}
              </p>
            )}
          </div>
          <label htmlFor="knowledge-search" className="sr-only">
            Search all handbook content
          </label>
          <div className="relative mt-4">
            <Icon
              name="search"
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-700"
            />
            <input
              id="knowledge-search"
              type="search"
              value={query}
              onChange={(event) =>
                onSetParams(
                  { q: event.target.value || null, limit: null },
                  { replace: true, scroll: "preserve" },
                )
              }
              className="input-base min-h-14 w-full bg-surface pl-12 pr-12 text-base shadow-e1"
              placeholder="How do I receive stock, approve a request, or fix an error?"
            />
            {query && (
              <button
                type="button"
                onClick={() =>
                  onSetParams(
                    { q: null, limit: null },
                    { replace: true, scroll: "preserve" },
                  )
                }
                className="absolute right-1 top-1 grid h-12 w-12 place-items-center text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                aria-label="Clear handbook search"
                title="Clear search"
              >
                <Icon name="x" className="h-4 w-4" />
              </button>
            )}
          </div>
          {!query && (
            <div
              className="mt-3 flex flex-wrap items-center gap-2"
              aria-label="Popular searches"
            >
              <span className="mr-1 text-xs font-semibold uppercase text-muted">
                Popular
              </span>
              {QUICK_SEARCHES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => onSetParams({ q: item, limit: null })}
                  className="min-h-11 rounded-full border border-line bg-surface px-3 text-xs font-medium text-ink transition hover:border-brand-400 hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>

        <div
          className="mt-4 grid gap-3 sm:grid-cols-3"
          aria-label="Knowledge base entry point"
        >
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() =>
                onSetParams({ mode: item.id, q: null, limit: null })
              }
              aria-pressed={mode === item.id}
              className={`group flex min-h-20 items-center gap-3 rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                mode === item.id
                  ? "border-brand-500 bg-surface text-ink shadow-e1 ring-1 ring-brand-500"
                  : "border-line bg-surface text-muted hover:border-brand-300 hover:bg-inset hover:text-ink"
              }`}
            >
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${mode === item.id ? "bg-brand-600 text-white" : "bg-inset text-muted group-hover:text-brand-700"}`}
              >
                <Icon name={item.icon} className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">
                  {item.label}
                </span>
                <span className="mt-0.5 block text-xs">{item.description}</span>
              </span>
            </button>
          ))}
        </div>

        {(query || filtersActive || mode !== "task") && (
          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-3">
            <label className="min-w-44 flex-1 text-xs font-semibold text-muted">
              Module
              <select
                className="input-base mt-1 min-h-11 w-full text-sm"
                value={module}
                onChange={(event) =>
                  onSetParams({
                    module:
                      event.target.value === "all" ? null : event.target.value,
                    limit: null,
                  })
                }
              >
                <option value="all">All modules</option>
                {MODULES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-44 flex-1 text-xs font-semibold text-muted">
              Availability
              <select
                className="input-base mt-1 min-h-11 w-full text-sm"
                value={availability}
                onChange={(event) =>
                  onSetParams({
                    availability:
                      event.target.value === "all" ? null : event.target.value,
                    limit: null,
                  })
                }
              >
                <option value="all">All availability</option>
                <option value="live">Live</option>
                <option value="limited">Limited</option>
                <option value="coming_soon">Coming soon</option>
              </select>
            </label>
            {filtersActive && (
              <button
                type="button"
                className="btn-ghost btn-sm min-h-11"
                onClick={() =>
                  onSetParams({
                    module: null,
                    role: null,
                    availability: null,
                    limit: null,
                  })
                }
              >
                <Icon name="x" className="h-4 w-4" />
                Clear filters
              </button>
            )}
          </div>
        )}
      </section>

      {isHome && (
        <>
          {recommended.length > 0 && (
            <StartHere
              results={recommended}
              rolesById={rolesById}
              onOpenResult={onOpenResult}
            />
          )}
          <OperatingModel
            onOpenFlow={(flowId) =>
              onSetParams({ flow: flowId, step: null, view: "flow" })
            }
          />
          <PrincipalFlowLibrary content={content} onSetParams={onSetParams} />
          <ModuleDirectory onSetParams={onSetParams} />
          <HelpAndUpdates
            results={recentlyReviewed}
            onSetParams={onSetParams}
            onOpenResult={onOpenResult}
          />
        </>
      )}

      {!query && !filtersActive && mode === "role" && (
        <PersonaDirectory
          onExplore={(persona) =>
            onSetParams({ q: persona.label, mode: "role", limit: null })
          }
        />
      )}

      {shouldShowResults && (
        <ResultSection
          id="handbook-results"
          title={
            query
              ? "Search results"
              : MODES.find((item) => item.id === mode)!.label
          }
          description={
            query
              ? "Best matches across workflows, procedures, roles, features, and reference content."
              : MODES.find((item) => item.id === mode)!.description
          }
          results={visibleResults}
          totalResults={matchingResults.length}
          rolesById={rolesById}
          onOpenResult={onOpenResult}
          onShowMore={() =>
            onSetParams({ limit: String(Math.min(60, resultLimit + 12)) })
          }
        />
      )}
    </div>
  );
}

function StartHere({
  results,
  rolesById,
  onOpenResult,
}: {
  results: HandbookSearchResult[];
  rolesById: Map<string, KnowledgeRole>;
  onOpenResult: (result: HandbookSearchResult) => void;
}) {
  return (
    <section aria-labelledby="recommended-work-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
            Start here
          </p>
          <h2
            id="recommended-work-title"
            className="mt-1 text-xl font-bold text-ink"
          >
            Recommended for your work
          </h2>
          <p className="mt-1 text-sm text-muted">
            Live guidance matched to your current access.
          </p>
        </div>
        <span className="text-xs text-faint">
          Personalized from your role assignments
        </span>
      </div>
      <div className="mt-4 grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2">
        {results.map((result) => (
          <button
            key={`${result.type}-${result.id}`}
            type="button"
            onClick={() => onOpenResult(result)}
            className="group flex min-h-24 items-start gap-3 bg-surface p-4 text-left transition hover:bg-inset focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand-50 text-brand-700">
              <Icon name="arrowRight" className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">
                {result.title}
              </span>
              <span className="mt-1 line-clamp-2 block text-xs leading-5 text-muted">
                {result.summary}
              </span>
              <span className="mt-2 block truncate text-xs font-medium text-brand-700">
                {result.roleIds
                  .slice(0, 2)
                  .map((role) => rolesById.get(role)?.label ?? role)
                  .join(" / ") || result.destinationContext}
              </span>
            </span>
            <Icon
              name="chevron"
              className="mt-1 h-4 w-4 shrink-0 -rotate-90 text-faint transition group-hover:translate-x-0.5 group-hover:text-brand-700"
            />
          </button>
        ))}
      </div>
    </section>
  );
}

function PersonaDirectory({
  onExplore,
}: {
  onExplore: (persona: (typeof OPERATING_PERSONAS)[number]) => void;
}) {
  return (
    <section aria-labelledby="persona-directory-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          Job-based access
        </p>
        <h2
          id="persona-directory-title"
          className="mt-1 text-xl font-bold text-ink"
        >
          11 operating personas
        </h2>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
          Start with the job a person performs. Detailed permission grants
          remain inside each role guide so the operating model stays lean and
          understandable.
        </p>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {OPERATING_PERSONAS.map((persona) => (
          <button
            key={persona.id}
            type="button"
            onClick={() => onExplore(persona)}
            className="group min-h-36 rounded-lg border border-line bg-surface p-4 text-left transition hover:border-brand-400 hover:shadow-e1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <span className="flex items-start justify-between gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-md bg-inset text-muted group-hover:bg-brand-50 group-hover:text-brand-700">
                <Icon
                  name={
                    persona.id === "vendor_representative"
                      ? "building"
                      : "clipboard"
                  }
                  className="h-5 w-5"
                />
              </span>
              <Icon
                name="arrowRight"
                className="h-4 w-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-brand-700"
              />
            </span>
            <span className="mt-3 block font-semibold text-ink">
              {persona.label}
            </span>
            <span className="mt-0.5 block text-xs font-semibold uppercase text-faint">
              {persona.department}
            </span>
            <span className="mt-2 block text-sm leading-5 text-muted">
              {persona.responsibility}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-4 border-l-4 border-brand-500 pl-4 text-sm leading-6 text-muted">
        One person may hold more than one compatible persona. Delegated
        authority and segregation-of-duties controls still determine what that
        person may approve.
      </p>
    </section>
  );
}

function ModuleDirectory({
  onSetParams,
}: {
  onSetParams: (changes: Record<string, string | null>) => void;
}) {
  return (
    <section
      aria-labelledby="module-directory-title"
      className="border-t border-line pt-8"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          Browse by workspace
        </p>
        <h2
          id="module-directory-title"
          className="mt-1 text-xl font-bold text-ink"
        >
          Modules and shared services
        </h2>
        <p className="mt-1 text-sm text-muted">
          Understand the pages, controls, data, and owners within each part of
          Intra.
        </p>
      </div>
      <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() =>
              onSetParams({
                mode: "feature",
                module: item.id,
                q: null,
                limit: null,
              })
            }
            className="group flex min-h-24 items-start gap-3 bg-surface p-4 text-left transition hover:bg-inset focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-inset text-muted group-hover:bg-brand-50 group-hover:text-brand-700">
              <Icon name={item.icon} className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">
                {item.label}
              </span>
              <span className="mt-1 block text-xs leading-5 text-muted">
                {item.description}
              </span>
            </span>
            <Icon
              name="chevron"
              className="mt-1 h-4 w-4 shrink-0 -rotate-90 text-faint"
            />
          </button>
        ))}
      </div>
    </section>
  );
}

function HelpAndUpdates({
  results,
  onSetParams,
  onOpenResult,
}: {
  results: HandbookSearchResult[];
  onSetParams: (changes: Record<string, string | null>) => void;
  onOpenResult: (result: HandbookSearchResult) => void;
}) {
  return (
    <section
      aria-labelledby="help-updates-title"
      className="grid min-w-0 gap-6 border-t border-line pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]"
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          Help and recovery
        </p>
        <h2 id="help-updates-title" className="mt-1 text-xl font-bold text-ink">
          When work does not go as planned
        </h2>
        <p className="mt-1 text-sm leading-6 text-muted">
          Find the responsible owner, required evidence, and safe recovery path.
          The guide never recommends bypassing an approval or control.
        </p>
        <div className="mt-4 grid gap-2">
          {(
            [
              ["Resolve an exception", "exception", "alert"],
              ["Fix access or sign-in", "access sign in", "lock"],
              ["Understand a status", "status", "info"],
              ["Find a policy term", "policy", "clipboard"],
            ] as const
          ).map(([label, q, icon]) => (
            <button
              key={label}
              type="button"
              onClick={() => onSetParams({ q, mode: "task", limit: null })}
              className="group flex min-h-11 w-full min-w-0 items-center gap-3 border-b border-line py-2 text-left text-sm font-medium text-ink hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <Icon
                name={icon as IconName}
                className="h-4 w-4 text-muted group-hover:text-brand-700"
              />
              <span className="flex-1">{label}</span>
              <Icon name="arrowRight" className="h-4 w-4 text-faint" />
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">
          Recently reviewed
        </h3>
        <div className="mt-2 divide-y divide-line border-y border-line">
          {results.map((result) => (
            <button
              key={`${result.type}-${result.id}`}
              type="button"
              onClick={() => onOpenResult(result)}
              className="flex min-h-14 w-full items-center justify-between gap-4 py-3 text-left hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-ink">
                  {result.title}
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  {result.destinationContext}
                </span>
              </span>
              <span className="shrink-0 text-xs text-faint">
                {result.reviewedAt}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function PrincipalFlowLibrary({
  content,
  onSetParams,
}: {
  content: KnowledgeContent;
  onSetParams: (changes: Record<string, string | null>) => void;
}) {
  const [openPhase, setOpenPhase] = useState<string | null>(
    "Source and control",
  );
  return (
    <section
      aria-labelledby="principal-flow-title"
      className="border-t border-line pt-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
            Complete library
          </p>
          <h2
            id="principal-flow-title"
            className="mt-1 text-xl font-bold text-ink"
          >
            Browse all governed workflows
          </h2>
          <p className="mt-1 text-sm text-muted">
            Grouped into four operating phases so the full handbook remains
            scannable.
          </p>
        </div>
        <span className="text-xs text-faint">
          {content.flows.length} workflows
        </span>
      </div>
      <div className="mt-5 overflow-hidden rounded-lg border border-line">
        {FLOW_PHASES.map((phase, phaseIndex) => {
          const flows = content.flows.filter(
            (flow) => flowPhase(flow.id) === phase.label,
          );
          const expanded = openPhase === phase.label;
          const panelId = `principal-flow-${phase.label.toLowerCase().replaceAll(" ", "-")}`;
          return (
            <section
              key={phase.label}
              className={phaseIndex > 0 ? "border-t border-line" : undefined}
            >
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => setOpenPhase(expanded ? null : phase.label)}
                className="group flex min-h-16 w-full items-center gap-3 bg-surface px-4 py-3 text-left transition hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-inset text-muted group-hover:text-brand-700">
                  <Icon name={phase.icon} className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">
                    {phase.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {phase.description}
                  </span>
                </span>
                <span className="hidden text-xs text-faint sm:block">
                  {flows.length} workflows
                </span>
                <Icon
                  name="chevron"
                  className={`h-4 w-4 text-faint transition ${expanded ? "rotate-90" : "-rotate-90"}`}
                />
              </button>
              {expanded && (
                <div
                  id={panelId}
                  data-testid="principal-flow-carousel"
                  className="grid gap-px border-t border-line bg-line sm:grid-cols-2 xl:grid-cols-3"
                >
                  {flows.map((flow) => {
                    const decisions = flow.nodes.filter(
                      (node) => node.type === "decision",
                    ).length;
                    const outcomes = flow.nodes.filter(
                      (node) => node.type === "terminal",
                    ).length;
                    return (
                      <button
                        key={flow.id}
                        type="button"
                        onClick={() =>
                          onSetParams({
                            flow: flow.id,
                            step: null,
                            view: "flow",
                          })
                        }
                        className="group/flow min-h-32 bg-surface p-4 text-left transition hover:bg-inset focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <Badge
                            tone={
                              flow.availability === "limited"
                                ? "amber"
                                : "emerald"
                            }
                          >
                            {flow.availability === "limited"
                              ? "Limited"
                              : "Live"}
                          </Badge>
                          <Icon
                            name="arrowRight"
                            className="h-4 w-4 text-faint transition group-hover/flow:translate-x-0.5 group-hover/flow:text-brand-700"
                          />
                        </span>
                        <span className="mt-3 block font-semibold text-ink">
                          {flow.title}
                        </span>
                        <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-faint">
                          <span>{flow.nodes.length} steps</span>
                          <span>
                            {decisions}{" "}
                            {decisions === 1 ? "decision" : "decisions"}
                          </span>
                          <span>
                            {outcomes} {outcomes === 1 ? "outcome" : "outcomes"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function ResultSection({
  id,
  title,
  description,
  results,
  totalResults,
  rolesById,
  onOpenResult,
  onShowMore,
}: {
  id: string;
  title: string;
  description: string;
  results: HandbookSearchResult[];
  totalResults?: number;
  rolesById: Map<string, KnowledgeRole>;
  onOpenResult: (result: HandbookSearchResult) => void;
  onShowMore?: () => void;
}) {
  return (
    <section aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={`${id}-title`} className="text-xl font-bold text-ink">
            {title}
          </h2>
          <p className="mt-1 text-sm text-muted">{description}</p>
        </div>
        {typeof totalResults === "number" && (
          <span className="text-xs text-faint">
            {totalResults} result{totalResults === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {results.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon="search"
            title="No matching guidance"
            message="Try a shorter task name, a common acronym, or clear a filter."
          />
        </div>
      ) : (
        <div className="mt-4 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {results.map((result) => (
            <button
              key={`${result.type}-${result.id}`}
              type="button"
              onClick={() => onOpenResult(result)}
              className="group flex min-h-24 w-full items-start gap-3 p-4 text-left transition hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-inset text-muted group-hover:bg-brand-50 group-hover:text-brand-700">
                <Icon
                  name={
                    result.type === "exception"
                      ? "alert"
                      : result.type === "role"
                        ? "building"
                        : result.type === "feature"
                          ? "grid"
                          : "clipboard"
                  }
                  className="h-4 w-4"
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-ink">{result.title}</span>
                  <Badge tone="brand">{resultTypeLabel[result.type]}</Badge>
                  <Badge tone={availabilityTone(result.availability)}>
                    {availabilityLabel[result.availability]}
                  </Badge>
                </span>
                <span className="mt-1 line-clamp-2 block text-sm leading-5 text-muted">
                  {result.summary}
                </span>
                <span className="mt-2 block truncate text-xs text-faint">
                  {result.roleIds.length > 0
                    ? result.roleIds
                        .slice(0, 2)
                        .map((role) => rolesById.get(role)?.label ?? role)
                        .join(" / ")
                    : result.destinationContext}
                </span>
              </span>
              <Icon
                name="arrowRight"
                className="mt-2 h-4 w-4 shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-brand-700"
              />
            </button>
          ))}
        </div>
      )}
      {onShowMore && totalResults && results.length < totalResults ? (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            className="btn-outline btn-sm min-h-11"
            onClick={onShowMore}
          >
            Show more{" "}
            <span className="text-xs font-normal text-muted">
              {results.length} of {totalResults}
            </span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
