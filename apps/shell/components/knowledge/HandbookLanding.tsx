"use client";

import { Badge, EmptyState, Icon } from "@intra/ui";
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

const MODULES = [
  "all",
  "core",
  "warehouse",
  "procurement",
  "legal",
  "vendor",
  "admin",
] as const;

const MODES: Array<{
  id: HandbookEntryMode;
  label: string;
  description: string;
}> = [
  { id: "task", label: "Do a task", description: "Procedures and flows" },
  {
    id: "role",
    label: "Understand a role",
    description: "Authority and handoffs",
  },
  {
    id: "feature",
    label: "Explore a feature",
    description: "Pages and controls",
  },
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

const flowPhase = (id: string) => {
  if (["identity-and-access", "administration", "doa-governance", "access-recertification-offboarding", "audit-incident-handling"].includes(id))
    return "Govern and secure";
  if (["procure-to-pay", "vendor-accreditation", "product-master-data-lifecycle", "po-amendment-cancellation", "finance-export-reconciliation"].includes(id))
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
    options?: { replace?: boolean },
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

  return (
    <div className="space-y-8">
      <header className="border-b border-line pb-5">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
          Mwell Intra operating handbook
        </p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-ink">Start with the flow</h1>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
              Follow the governed process, find the exact control, and confirm
              who owns the next decision.
            </p>
          </div>
          <span className="text-sm text-muted">
            {content.flows.length} principal workflows
          </span>
        </div>
      </header>

      <section aria-labelledby="principal-flow-title">
        <div className="flex items-center justify-between gap-3">
          <h2 id="principal-flow-title" className="text-lg font-bold text-ink">
            Principal Intra flows
          </h2>
          <span className="text-xs text-faint">
            Grouped by operating phase
          </span>
        </div>
        <div className="mt-4 space-y-7">
          {["Govern and secure", "Source and control", "Operate inventory", "Recover and improve"].map((phase) => (
            <section key={phase} aria-labelledby={`phase-${phase.replaceAll(" ", "-")}`}>
              <h3 id={`phase-${phase.replaceAll(" ", "-")}`} className="mb-3 text-sm font-semibold uppercase text-muted">{phase}</h3>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {content.flows.filter((flow) => flowPhase(flow.id) === phase).map((flow, index) => {
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
                  onSetParams({ flow: flow.id, step: null, view: "flow" })
                }
                className="group min-h-40 w-full border border-line bg-surface p-4 text-left transition hover:border-brand-500 hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="grid h-8 w-8 place-items-center bg-brand-50 text-sm font-bold text-brand-700">
                    {index + 1}
                  </span>
                  <Badge tone={flow.availability === "limited" ? "amber" : "emerald"}>{flow.availability === "limited" ? "Limited" : "Live"}</Badge>
                </span>
                <span className="mt-3 line-clamp-2 block font-semibold text-ink">
                  {flow.title}
                </span>
                <span className="mt-3 flex gap-3 text-xs text-faint">
                  <span>{flow.nodes.length} steps</span>
                  <span>{decisions} {decisions === 1 ? "decision" : "decisions"}</span>
                  <span>{outcomes} {outcomes === 1 ? "outcome" : "outcomes"}</span>
                </span>
              </button>
            );
          })}
              </div>
            </section>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="handbook-search-title"
        className="border-y border-line py-6"
      >
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2
              id="handbook-search-title"
              className="text-lg font-bold text-ink"
            >
              Search the handbook
            </h2>
            <p className="mt-1 text-sm text-muted">
              Tasks, roles, pages, controls, fields, statuses, exceptions, and
              policy terms.
            </p>
          </div>
          <p className="text-sm text-muted" role="status" aria-live="polite">
            {matchingResults.length} result
            {matchingResults.length === 1 ? "" : "s"}
          </p>
        </div>
        <label htmlFor="knowledge-search" className="sr-only">
          Search all handbook content
        </label>
        <div className="relative mt-4">
          <Icon
            name="search"
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-faint"
          />
          <input
            id="knowledge-search"
            type="search"
            value={query}
            onChange={(event) =>
              onSetParams(
                { q: event.target.value || null, limit: null },
                { replace: true },
              )
            }
            className="input-base min-h-12 w-full pl-11 pr-12 text-base"
            placeholder="Search a task, control, status, exception, or policy term"
          />
          {query && (
            <button
              type="button"
              onClick={() =>
                onSetParams({ q: null, limit: null }, { replace: true })
              }
              className="absolute right-0.5 top-0.5 grid h-11 w-11 place-items-center text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              aria-label="Clear handbook search"
              title="Clear search"
            >
              <Icon name="x" className="h-4 w-4" />
            </button>
          )}
        </div>

        <div
          className="mt-4 grid grid-cols-3 gap-px border border-line bg-line"
          aria-label="Handbook entry mode"
        >
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onSetParams({ mode: item.id, limit: null })}
              aria-pressed={mode === item.id}
              className={`min-h-14 border-b-2 bg-surface px-2 py-2 text-center transition focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500 sm:px-4 ${
                mode === item.id
                  ? "border-brand-500 text-brand-700"
                  : "border-transparent text-muted hover:bg-inset hover:text-ink"
              }`}
            >
              <span className="block text-sm font-semibold">{item.label}</span>
              <span className="mt-0.5 hidden text-xs sm:block">
                {item.description}
              </span>
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium text-muted">
            Module
            <select
              className="input-base mt-1 min-h-11 w-full"
              value={module}
              onChange={(event) =>
                onSetParams({
                  module:
                    event.target.value === "all" ? null : event.target.value,
                  limit: null,
                })
              }
            >
              {MODULES.map((item) => (
                <option key={item} value={item}>
                  {item === "all" ? "All modules" : item}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-muted">
            Role
            <select
              className="input-base mt-1 min-h-11 w-full"
              value={roleId}
              onChange={(event) =>
                onSetParams({
                  role: event.target.value || null,
                  limit: null,
                })
              }
            >
              <option value="">All roles</option>
              {content.roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-muted">
            Availability
            <select
              className="input-base mt-1 min-h-11 w-full"
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
        </div>
        {filtersActive && (
          <button
            type="button"
            className="btn-ghost btn-sm mt-3 min-h-11"
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
      </section>

      {!query && recommended.length > 0 && (
        <ResultSection
          id="recommended-work"
          title="Recommended for your work"
          description="Live procedures matched to your current role assignments."
          results={recommended}
          rolesById={rolesById}
          onOpenResult={onOpenResult}
        />
      )}

      <ResultSection
        id="handbook-results"
        title={
          query
            ? "Search results"
            : MODES.find((item) => item.id === mode)!.label
        }
        description={
          query
            ? "Best operational matches across the complete handbook."
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

      {!query && recentlyReviewed.length > 0 && (
        <section
          aria-labelledby="recently-reviewed-title"
          className="border-t border-line pt-7"
        >
          <div>
            <h2
              id="recently-reviewed-title"
              className="text-lg font-bold text-ink"
            >
              Recently reviewed
            </h2>
            <p className="mt-1 text-sm text-muted">
              Current live references with the latest content review dates.
            </p>
          </div>
          <div className="mt-4 divide-y divide-line border-y border-line">
            {recentlyReviewed.map((result) => (
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
        </section>
      )}
    </div>
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
      <h2 id={`${id}-title`} className="text-lg font-bold text-ink">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted">{description}</p>
      {results.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            icon="search"
            title="No matching guidance"
            message="Try a shorter task name, a common acronym, or clear a filter."
          />
        </div>
      ) : (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {results.map((result) => (
            <button
              key={`${result.type}-${result.id}`}
              type="button"
              onClick={() => onOpenResult(result)}
              className="group min-h-44 min-w-0 border border-line bg-surface p-4 text-left shadow-e1 transition hover:border-brand-500 hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap gap-1.5">
                  <Badge tone="brand">{resultTypeLabel[result.type]}</Badge>
                  <Badge tone={availabilityTone(result.availability)}>
                    {availabilityLabel[result.availability]}
                  </Badge>
                </span>
                {result.module && (
                  <span
                    className="text-xs text-faint"
                    aria-hidden={result.type === "roadmap" ? "true" : undefined}
                  >
                    {result.module}
                  </span>
                )}
              </span>
              <span className="mt-3 block font-semibold text-ink">
                {result.title}
              </span>
              <span className="mt-1 line-clamp-2 block text-sm leading-5 text-muted">
                {result.summary}
              </span>
              <span className="mt-3 block truncate text-xs text-muted">
                {result.roleIds.length > 0
                  ? result.roleIds
                      .slice(0, 2)
                      .map((role) => rolesById.get(role)?.label ?? role)
                      .join(" / ")
                  : result.destinationContext}
              </span>
              <span className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3 text-xs font-semibold text-brand-700">
                <span className="truncate">{result.destinationContext}</span>
                <Icon
                  name="arrowRight"
                  className="h-4 w-4 shrink-0 transition group-hover:translate-x-0.5"
                />
              </span>
            </button>
          ))}
        </div>
      )}
      {onShowMore && totalResults && results.length < totalResults ? (
        <div className="mt-5 flex items-center justify-center border-t border-line pt-5">
          <button
            type="button"
            className="btn-outline btn-sm min-h-11"
            onClick={onShowMore}
          >
            Show more
            <span className="text-xs font-normal text-muted">
              {results.length} of {totalResults}
            </span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
