"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, EmptyState, Icon } from "@intra/ui";
import { useSession } from "@intra/auth";
import { KNOWLEDGE_CONTENT } from "@shell/lib/knowledge/content";
import {
  searchKnowledge,
  type HandbookEntryMode,
  type HandbookSearchResult,
} from "@shell/lib/knowledge/search";
import type {
  KnowledgeAvailability,
  KnowledgeModule,
} from "@shell/lib/knowledge/types";
import { HandbookLanding } from "./HandbookLanding";
import { KnowledgeArticle } from "./KnowledgeArticle";
import { KnowledgeFlow } from "./KnowledgeFlow";

const ENTRY_MODES = new Set<HandbookEntryMode>(["task", "role", "feature"]);
const AVAILABILITY_FILTERS = new Set<KnowledgeAvailability | "all">([
  "all",
  "live",
  "limited",
  "coming_soon",
]);

export function KnowledgeBase() {
  const { profile, loading, userRoles } = useSession();
  const params = useSearchParams();
  const paramKey = params.toString();
  const query = params.get("q") ?? "";
  const module = (params.get("module") ?? "all") as KnowledgeModule | "all";
  const roleId = params.get("role") ?? "";
  const legacyType = params.get("type");
  const requestedMode = params.get("mode") as HandbookEntryMode | null;
  const mode =
    requestedMode && ENTRY_MODES.has(requestedMode)
      ? requestedMode
      : legacyType === "future"
        ? "feature"
        : "task";
  const requestedAvailability = params.get("availability") as
    KnowledgeAvailability | "all" | null;
  const availability =
    requestedAvailability && AVAILABILITY_FILTERS.has(requestedAvailability)
      ? requestedAvailability
      : legacyType === "future"
        ? "coming_soon"
        : "all";
  const requestedLimit = Number(params.get("limit") ?? "12");
  const resultLimit = Number.isFinite(requestedLimit)
    ? Math.min(60, Math.max(12, requestedLimit))
    : 12;
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
      }),
    [module, query, roleId],
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
        onOpenFlow={(id) =>
          setParams({ article: null, flow: id, step: null, view: "flow" })
        }
      />
    );
  const flow = KNOWLEDGE_CONTENT.flows.find((item) => item.id === flowId);
  if (flow)
    return (
      <div className="space-y-5">
        <button
          className="btn-ghost btn-sm"
          onClick={() => setParams({ flow: null, step: null, view: null })}
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

  const openResult = (result: HandbookSearchResult) => {
    const target = new URL(result.href, window.location.origin);
    const changes: Record<string, string | null> = {
      article: null,
      flow: null,
      step: null,
      glossary: null,
      view: null,
      type: null,
    };
    target.searchParams.forEach((value, key) => {
      changes[key] = value;
    });
    if (target.searchParams.has("flow") && !target.searchParams.has("view"))
      changes.view = "flow";
    setParams(changes);
  };

  return (
    <HandbookLanding
      content={KNOWLEDGE_CONTENT}
      results={results}
      query={query}
      mode={mode}
      module={module}
      roleId={roleId}
      availability={availability}
      resultLimit={resultLimit}
      recommendedRoleIds={recommendedRoleIds}
      rolesById={rolesById}
      onSetParams={setParams}
      onOpenResult={openResult}
    />
  );
}
