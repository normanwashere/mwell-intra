"use client";

import { Badge, EmptyState, Icon, type IconName } from "@intra/ui";
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
import { PersonalLibrary } from "./PersonalLibrary";
import { TaskActionLink } from "./TaskActionLink";
import { tasksForRoles, type TaskDefinition } from "@shell/lib/knowledge/taskCatalog";
import { useSession } from "@intra/auth";

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
    label: "Task",
    description: "Workflows and procedures",
    icon: "check",
  },
  {
    id: "role",
    label: "Role",
    description: "Responsibilities and handoffs",
    icon: "building",
  },
  {
    id: "feature",
    label: "Reference",
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


export function HandbookLanding({
  content,
  results,
  query,
  mode,
  module,
  roleId,
  scope = "mine",
  availability,
  resultLimit,
  recommendedRoleIds,
  userId,
  rolesById,
  onSetParams,
  onOpenResult,
  onOpenHref,
}: {
  content: KnowledgeContent;
  results: HandbookSearchResult[];
  query: string;
  mode: HandbookEntryMode;
  module: KnowledgeModule | "all";
  roleId: string;
  scope?: "mine" | "all";
  availability: KnowledgeAvailability | "all";
  resultLimit: number;
  recommendedRoleIds: string[];
  userId: string;
  rolesById: Map<string, KnowledgeRole>;
  onSetParams: (
    changes: Record<string, string | null>,
    options?: { replace?: boolean; scroll?: "top" | "preserve" | "restore" },
  ) => void;
  onOpenResult: (result: HandbookSearchResult) => void;
  onOpenHref: (href: string) => void;
}) {
  const { userRoles, profile } = useSession();
  const suggestedTasks = tasksForRoles(content, userRoles, profile?.kind === "vendor" ? "vendor" : "internal");
  const recommendedRoles = new Set(recommendedRoleIds);
  const matchingResults = results.filter(
    (result) =>
      (availability === "all" || result.availability === availability) &&
      (query.length > 0 || scope === "all" || roleId.length > 0 || result.roleIds.length === 0 || result.roleIds.some(id => recommendedRoles.has(id))) &&
      (query.length > 0 ||
        (mode === "task" && taskResultTypes.includes(result.type)) ||
        (mode !== "task" && result.type === mode) ||
        (mode === "feature" && ["roadmap", "glossary"].includes(result.type))),
  );
  const visibleResults = matchingResults.slice(0, resultLimit);
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
    <div className="mx-auto max-w-[78rem] space-y-5 pb-10 sm:space-y-6">
      <header className="border-b border-line pb-4">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
              Mwell Intra Knowledge Base
            </p>
            <h1 className="mt-1 text-2xl font-bold text-ink">
              Knowledge Base
            </h1>
          </div>
          <dl className="hidden gap-6 text-right xl:flex">
            <div>
              <dt className="text-2xl font-bold text-ink">
                {content.flows.length}
              </dt>
              <dd className="text-xs text-muted">workflows</dd>
            </div>
            <div>
              <dt className="text-2xl font-bold text-ink">
                {content.roles.length}
              </dt>
              <dd className="text-xs text-muted">role guides</dd>
            </div>
          </dl>
        </div>
      </header>

      <section
        id="kb-search"
        aria-labelledby="handbook-search-title"
        className="relative scroll-mt-28"
      >
        <div className="bg-surface px-4 py-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2
                id="handbook-search-title"
                className="sr-only"
              >
                Search the knowledge base
              </h2>
              <p className="sr-only">
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
          <div className="relative">
            <Icon
              name="search"
              className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-700 dark:text-brand-300"
            />
            <input
              id="knowledge-search"
              type="search"
              aria-label="Search all handbook content"
              style={{ minHeight: "3rem" }}
              value={query}
              onChange={(event) =>
                onSetParams(
                  { q: event.target.value || null, limit: null },
                  { replace: true, scroll: "preserve" },
                )
              }
              className="input-base min-h-14 min-w-12 w-full bg-surface pl-12 pr-12 text-base shadow-e1"
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
            <details className="mt-1">
              <summary className="min-h-11 cursor-pointer py-3 text-xs font-semibold text-muted">Common tasks</summary>
            <div
              className="flex flex-wrap items-center gap-2 pb-2"
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
            </details>
          )}
        </div>

        <div
          className="mt-2 flex flex-wrap gap-1 border-b border-line"
          aria-label="Knowledge base entry point"
        >
          {MODES.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() =>
                onSetParams({ mode: item.id, limit: null })
              }
              aria-pressed={mode === item.id}
              aria-label={item.label}
              className={`group flex min-h-11 flex-1 items-center justify-center gap-2 border-b-2 px-2 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:flex-none sm:justify-start sm:px-3 ${
                mode === item.id
                  ? "border-brand-500 text-ink"
                  : "border-transparent text-muted hover:border-brand-300 hover:bg-inset hover:text-ink"
              }`}
            >
              <span
                className={`hidden h-5 w-5 shrink-0 place-items-center sm:grid ${mode === item.id ? "text-brand-700 dark:text-brand-300" : "text-muted"}`}
              >
                <Icon name={item.icon} className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">
                  {item.label}
                </span>
                <span className="sr-only">{item.description}</span>
              </span>
            </button>
          ))}
        </div>

          <div className="mt-3 flex flex-wrap items-end gap-3 border-b border-line pb-3">
            <label className="min-w-44 flex-1 text-xs font-semibold text-muted">
              Guidance scope
              <select aria-label="Guidance scope" className="input-base mt-1 min-h-11 w-full text-sm" value={query || roleId ? 'all' : scope} disabled={Boolean(query || roleId)} onChange={event => onSetParams({ scope: event.target.value === 'all' ? 'all' : null, limit: null })}>
                <option value="mine">Relevant to my roles</option>
                <option value="all">All permitted guidance</option>
              </select>
            </label>
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
      </section>


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
          tasks={suggestedTasks}
          learningHref={profile?.kind === "vendor" ? "/vendor/onboarding" : "/onboarding"}
          onOpenResult={onOpenResult}
          onShowMore={() =>
            onSetParams({ limit: String(Math.min(60, resultLimit + 12)) })
          }
        />
      {!query && <details className="border-t border-line">
        <summary className="min-h-11 cursor-pointer content-center py-3 text-sm font-semibold text-ink">Saved and recent guides</summary>
        <PersonalLibrary userId={userId} onOpenHref={onOpenHref} />
      </details>}
      <details id="kb-help" className="border-t border-line">
        <summary className="min-h-11 cursor-pointer content-center py-3 text-sm font-semibold text-ink">Help and recovery</summary>
        <HelpAndUpdates results={recentlyReviewed} onSetParams={onSetParams} onOpenResult={onOpenResult} />
      </details>
    </div>
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


function ResultSection({
  id,
  title,
  description,
  results,
  totalResults,
  rolesById,
  onOpenResult,
  onShowMore,
  tasks = [],
  learningHref,
}: {
  id: string;
  title: string;
  description: string;
  results: HandbookSearchResult[];
  totalResults?: number;
  rolesById: Map<string, KnowledgeRole>;
  onOpenResult: (result: HandbookSearchResult) => void;
  onShowMore?: () => void;
  tasks?: TaskDefinition[];
  learningHref?: string;
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
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {results.map((result) => {
            const task = tasks.find(item => item.id === result.taskId);
            return <li key={`${result.type}-${result.id}`} className="flex min-w-0 flex-col sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => onOpenResult(result)}
              className="group flex min-h-24 min-w-0 flex-1 items-start gap-3 p-3 text-left transition hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500"
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
            {task && <div className="shrink-0 px-3 pb-3 sm:py-3"><TaskActionLink task={task} learningHref={learningHref} /></div>}
            </li>;
          })}
        </ul>
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
