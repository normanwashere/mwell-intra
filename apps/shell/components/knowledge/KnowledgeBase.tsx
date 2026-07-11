"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, EmptyState, Icon, ModuleHero } from "@intra/ui";
import { useSession } from "@intra/auth";
import { KNOWLEDGE_CONTENT } from "@shell/lib/knowledge/content";
import { searchKnowledge } from "@shell/lib/knowledge/search";
import type {
  KnowledgeModule,
  KnowledgeResultType,
} from "@shell/lib/knowledge/types";
import { KnowledgeArticle } from "./KnowledgeArticle";
import { KnowledgeFlow } from "./KnowledgeFlow";
import { WorkflowLibrary } from "./WorkflowLibrary";

const MODULES = [
  "all",
  "core",
  "warehouse",
  "procurement",
  "legal",
  "vendor",
  "admin",
] as const;
const TYPES = ["all", "article", "flow", "glossary", "future"] as const;

export function KnowledgeBase() {
  const { profile, loading, userRoles } = useSession();
  const params = useSearchParams();
  const paramKey = params.toString();
  const query = params.get("q") ?? "";
  const module = (params.get("module") ?? "all") as KnowledgeModule | "all";
  const roleId = params.get("role") ?? "";
  const type = (params.get("type") ?? "all") as KnowledgeResultType | "all";
  const articleId = params.get("article");
  const flowId = params.get("flow");
  const stepId = params.get("step");
  const glossaryTerm = params.get("glossary");
  const rolesById = useMemo(
    () => new Map(KNOWLEDGE_CONTENT.roles.map((role) => [role.id, role])),
    [],
  );
  const results = useMemo(
    () =>
      searchKnowledge(KNOWLEDGE_CONTENT, query, {
        module,
        roleId: roleId || undefined,
        type,
      }),
    [module, query, roleId, type],
  );

  const setParams = (
    changes: Record<string, string | null>,
    options: { replace?: boolean } = {},
  ) => {
    sessionStorage.setItem(
      `knowledge-scroll:${window.location.pathname}${window.location.search}`,
      String(window.scrollY),
    );
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const href = `/knowledge${next.size ? `?${next}` : ""}`;
    if (options.replace) window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
  };
  useEffect(() => {
    if (loading) return;
    const key = `knowledge-scroll:${window.location.pathname}${window.location.search}`;
    const restore = sessionStorage.getItem(key);
    let frame = 0;
    let animationFrame = 0;
    const restorePosition = () => {
      if (restore === null) return;
      const target = Number(restore);
      window.scrollTo({ top: target });
      frame += 1;
      if (Math.abs(window.scrollY - target) > 2 && frame < 60)
        animationFrame = requestAnimationFrame(restorePosition);
    };
    animationFrame = requestAnimationFrame(restorePosition);
    const save = () => sessionStorage.setItem(key, String(window.scrollY));
    window.addEventListener("scroll", save, { passive: true });
    window.addEventListener("pagehide", save);
    return () => {
      cancelAnimationFrame(animationFrame);
      save();
      window.removeEventListener("scroll", save);
      window.removeEventListener("pagehide", save);
    };
  }, [loading, paramKey]);
  if (loading)
    return <div className="h-80 animate-pulse bg-inset" aria-busy="true" />;
  if (!profile)
    return (
      <EmptyState
        icon="lock"
        title="Sign in required"
        message="Sign in to use the Mwell Intra Knowledge Base."
      />
    );

  const glossary = KNOWLEDGE_CONTENT.glossary.find(
    (item) => item.term.toLowerCase() === glossaryTerm?.toLowerCase(),
  );
  if (glossary) {
    const relatedFlows = KNOWLEDGE_CONTENT.flows.filter((item) =>
      `${item.title} ${item.summary} ${item.nodes.map((node) => `${node.title} ${node.body}`).join(" ")}`
        .toLowerCase()
        .includes(glossary.term.toLowerCase()),
    );
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() => setParams({ glossary: null })}
        >
          <Icon name="chevron" className="h-4 w-4 rotate-90" />
          Back to Knowledge Base
        </button>
        <article className="border-y border-line py-7">
          <Badge tone="brand">Glossary</Badge>
          <h1 className="mt-4 text-3xl font-bold text-ink">{glossary.term}</h1>
          <p className="mt-3 max-w-3xl text-lg leading-8 text-muted">
            {glossary.definition}
          </p>
          {glossary.aliases.length > 0 && (
            <p className="mt-4 text-sm text-muted">
              <span className="font-semibold text-ink">Also known as:</span>{" "}
              {glossary.aliases.join(", ")}
            </p>
          )}
        </article>
        <section aria-labelledby="related-guidance">
          <h2 id="related-guidance" className="text-xl font-bold text-ink">
            Related guided workflows
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {relatedFlows.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() =>
                  setParams({ glossary: null, flow: item.id, step: null })
                }
                className="border border-line bg-surface p-4 text-left hover:border-brand-500"
              >
                <span className="font-semibold text-ink">{item.title}</span>
                <span className="mt-1 block text-sm text-muted">
                  {item.summary}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
    );
  }

  const article = KNOWLEDGE_CONTENT.articles.find(
    (item) => item.id === articleId,
  );
  if (article)
    return (
      <KnowledgeArticle
        article={article}
        rolesById={rolesById}
        onBack={() => setParams({ article: null })}
        onOpenFlow={(id) => setParams({ article: null, flow: id })}
      />
    );
  const flow = KNOWLEDGE_CONTENT.flows.find((item) => item.id === flowId);
  if (flow)
    return (
      <div className="space-y-5">
        <button
          className="btn-ghost btn-sm"
          onClick={() => setParams({ flow: null })}
        >
          <Icon name="chevron" className="h-4 w-4 rotate-90" />
          Back to Knowledge Base
        </button>
        <KnowledgeFlow
          flow={flow}
          selectedNodeId={
            flow.nodes.some((node) => node.id === stepId)
              ? stepId!
              : flow.startNodeId
          }
          evidence={KNOWLEDGE_CONTENT.evidence}
          rolesById={rolesById}
          onSelectNode={(id) => setParams({ step: id })}
        />
      </div>
    );

  const assignedRoleIds = Object.values(userRoles).flat();
  const recommendedRoleIds = KNOWLEDGE_CONTENT.roles
    .filter(
      (role) =>
        role.module === "core" ||
        (profile.kind === "vendor" && role.module === "vendor") ||
        assignedRoleIds.includes(role.id.replace(/^warehouse_/, "")),
    )
    .map((role) => role.id);
  return (
    <div className="space-y-6">
      <ModuleHero
        eyebrow="Mwell Intra"
        title="Knowledge Base"
        description="Search functions, role guides, workflows, troubleshooting, policies, and future recommendations."
        icon="search"
      />
      {!query && !roleId && type === "all" && (
        <WorkflowLibrary
          flows={KNOWLEDGE_CONTENT.flows}
          rolesById={rolesById}
          recommendedRoleIds={recommendedRoleIds}
          onOpenFlow={(id) => setParams({ flow: id, article: null })}
        />
      )}
      <section
        aria-label="Knowledge search"
        className="border-y border-line py-5"
      >
        <label
          htmlFor="knowledge-search"
          className="text-sm font-semibold text-ink"
        >
          Search functions and workflows
        </label>
        <div className="relative mt-2">
          <Icon
            name="search"
            className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-faint"
          />
          <input
            id="knowledge-search"
            type="search"
            value={query}
            onChange={(event) =>
              setParams(
                {
                  q: event.target.value || null,
                  article: null,
                  flow: null,
                },
                { replace: true },
              )
            }
            className="input-base min-h-11 w-full pl-10"
            placeholder="Try receive stock, PR, vendor renewal, bins..."
          />
        </div>
        <p className="mt-2 text-sm text-muted" role="status" aria-live="polite">
          {results.length} result{results.length === 1 ? "" : "s"}
        </p>
        <div
          className="mt-4 flex gap-2 overflow-x-auto pb-1"
          aria-label="Module filters"
        >
          {MODULES.map((item) => (
            <button
              key={item}
              onClick={() =>
                setParams({ module: item === "all" ? null : item })
              }
              className={
                module === item ? "btn-primary btn-sm" : "btn-outline btn-sm"
              }
            >
              {item === "all" ? "All modules" : item}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium text-muted">
            Role
            <select
              className="input-base mt-1 min-h-11 w-full"
              value={roleId}
              onChange={(event) =>
                setParams({ role: event.target.value || null })
              }
            >
              <option value="">All roles</option>
              {KNOWLEDGE_CONTENT.roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium text-muted">
            Content type
            <select
              className="input-base mt-1 min-h-11 w-full"
              value={type}
              onChange={(event) =>
                setParams({
                  type:
                    event.target.value === "all" ? null : event.target.value,
                })
              }
            >
              {TYPES.map((item) => (
                <option key={item} value={item}>
                  {item === "all" ? "All content" : item}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      <section aria-label="Knowledge results">
        {results.length === 0 ? (
          <EmptyState
            icon="search"
            title="No matching guidance"
            message="Try a shorter task name, an acronym such as PR or PO, or clear a filter."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {results.map((result) => (
              <button
                key={`${result.type}-${result.id}`}
                onClick={() => {
                  const target = new URL(result.href, window.location.origin);
                  const changes: Record<string, string | null> = {
                    q: null,
                    article: null,
                    flow: null,
                    step: null,
                    glossary: null,
                    type: null,
                  };
                  target.searchParams.forEach((value, key) => {
                    changes[key] = value;
                  });
                  setParams(changes);
                }}
                className="min-w-0 border border-line bg-surface p-4 text-left shadow-e1 transition hover:border-brand-500 hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge
                    tone={
                      result.type === "future"
                        ? "amber"
                        : result.type === "flow"
                          ? "cyan"
                          : "brand"
                    }
                  >
                    {result.type}
                  </Badge>
                  {result.module && (
                    <span className="text-xs text-faint">{result.module}</span>
                  )}
                </div>
                <h2 className="mt-3 font-semibold text-ink">{result.title}</h2>
                <p className="mt-1 line-clamp-3 text-sm text-muted">
                  {result.summary}
                </p>
                <span className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-brand-700">
                  Open <Icon name="arrowRight" className="h-3.5 w-3.5" />
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
