"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, EmptyState, Icon } from "@intra/ui";
import { useSession } from "@intra/auth";
import { KNOWLEDGE_CONTENT } from "@shell/lib/knowledge/content";
import {
  COMING_SOON_ROLES,
  knowledgeRoleIdsForAssignments,
} from "@shell/lib/knowledge/roles";
import {
  searchKnowledge,
  type HandbookEntryMode,
  type HandbookSearchResult,
} from "@shell/lib/knowledge/search";
import type {
  KnowledgeAvailability,
  KnowledgeContent,
  KnowledgeModule,
} from "@shell/lib/knowledge/types";
import { FeatureGuide } from "./FeatureGuide";
import { HandbookLanding } from "./HandbookLanding";
import { KnowledgeArticle } from "./KnowledgeArticle";
import { KnowledgeFlow } from "./KnowledgeFlow";
import { KnowledgeRoleGuide } from "./KnowledgeRoleGuide";

const ENTRY_MODES = new Set<HandbookEntryMode>(["task", "role", "feature"]);
const AVAILABILITY_FILTERS = new Set<KnowledgeAvailability | "all">([
  "all",
  "live",
  "limited",
  "coming_soon",
]);

export const KNOWLEDGE_GUIDE_CONTENT: KnowledgeContent = {
  ...KNOWLEDGE_CONTENT,
  roles: [...KNOWLEDGE_CONTENT.roles, ...COMING_SOON_ROLES],
};

export function resolveKnowledgeGuide(
  content: KnowledgeContent,
  articleId: string | null,
) {
  if (!articleId) return null;
  const role = content.roles.find((item) => `role-${item.id}` === articleId);
  if (role) return { kind: "role" as const, role };
  const feature = content.features.find(
    (item) => `feature-${item.id}` === articleId,
  );
  if (feature) return { kind: "feature" as const, feature };
  return null;
}

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
    () => new Map(KNOWLEDGE_GUIDE_CONTENT.roles.map((role) => [role.id, role])),
    [],
  );
  const articlesById = useMemo(
    () =>
      new Map(KNOWLEDGE_GUIDE_CONTENT.articles.map((item) => [item.id, item])),
    [],
  );
  const results = useMemo(
    () =>
      searchKnowledge(KNOWLEDGE_GUIDE_CONTENT, query, {
        module,
        roleId: roleId || undefined,
      }),
    [module, query, roleId],
  );

  const setParams = (
    changes: Record<string, string | null>,
    options: {
      replace?: boolean;
      scroll?: "top" | "preserve" | "restore";
    } = {},
  ) => {
    const currentScrollKey = `knowledge-scroll:${window.location.pathname}${window.location.search}`;
    sessionStorage.setItem(currentScrollKey, String(window.scrollY));
    const next = new URLSearchParams(params.toString());
    const normalizedChanges = Object.prototype.hasOwnProperty.call(
      changes,
      "flow",
    )
      ? { ...changes, branch: null }
      : changes;
    for (const [key, value] of Object.entries(normalizedChanges)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const href = `/knowledge${next.size ? `?${next}` : ""}`;
    const destinationScrollKey = `knowledge-scroll:${href}`;
    if (options.scroll === "preserve")
      sessionStorage.setItem(destinationScrollKey, String(window.scrollY));
    else if (options.scroll !== "restore")
      sessionStorage.setItem(destinationScrollKey, "0");
    if (options.replace) window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
  };
  useEffect(() => {
    if (loading) return;
    const key = `knowledge-scroll:${window.location.pathname}${window.location.search}`;
    const restore = sessionStorage.getItem(key);
    const target = restore === null ? 0 : Number(restore);
    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    let frame = 0;
    let animationFrame = 0;
    let restorationComplete = false;
    const restorePosition = () => {
      window.scrollTo({ top: target });
      frame += 1;
      if (Math.abs(window.scrollY - target) > 2 && frame < 60)
        animationFrame = requestAnimationFrame(restorePosition);
      else restorationComplete = true;
    };
    animationFrame = requestAnimationFrame(restorePosition);
    const save = () => {
      if (restorationComplete)
        sessionStorage.setItem(key, String(window.scrollY));
    };
    window.addEventListener("scroll", save, { passive: true });
    window.addEventListener("pagehide", save);
    return () => {
      cancelAnimationFrame(animationFrame);
      save();
      window.history.scrollRestoration = previousScrollRestoration;
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

  const glossary = KNOWLEDGE_GUIDE_CONTENT.glossary.find(
    (item) => item.term.toLowerCase() === glossaryTerm?.toLowerCase(),
  );
  if (glossary) {
    const relatedFlows = KNOWLEDGE_GUIDE_CONTENT.flows.filter((item) =>
      `${item.title} ${item.summary} ${item.nodes.map((node) => `${node.title} ${node.body}`).join(" ")}`
        .toLowerCase()
        .includes(glossary.term.toLowerCase()),
    );
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <button
          type="button"
          className="btn-ghost btn-sm"
          onClick={() =>
            setParams({ glossary: null }, { scroll: "restore" })
          }
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

  const guide = resolveKnowledgeGuide(KNOWLEDGE_GUIDE_CONTENT, articleId);
  const openArticle = (id: string) =>
    setParams({ article: id, flow: null, step: null, view: null });
  const openFlow = (id: string) =>
    setParams({ article: null, flow: id, step: null, view: "flow" });
  if (guide?.kind === "role") {
    const roleId = guide.role.id;
    return (
      <KnowledgeRoleGuide
        role={guide.role}
        rolesById={rolesById}
        relatedFeatures={KNOWLEDGE_GUIDE_CONTENT.features.filter((feature) =>
          feature.roleIds.includes(roleId),
        )}
        relatedArticles={KNOWLEDGE_GUIDE_CONTENT.articles.filter(
          (item) =>
            item.id !== `role-${roleId}` &&
            !item.id.startsWith("feature-") &&
            item.roles.includes(roleId),
        )}
        relatedFlows={KNOWLEDGE_GUIDE_CONTENT.flows.filter((item) =>
          item.roles.includes(roleId),
        )}
        onBack={() =>
          setParams({ article: null }, { scroll: "restore" })
        }
        onOpenArticle={openArticle}
        onOpenFlow={openFlow}
      />
    );
  }
  if (guide?.kind === "feature")
    return (
      <FeatureGuide
        feature={guide.feature}
        rolesById={rolesById}
        relatedArticles={KNOWLEDGE_GUIDE_CONTENT.articles.filter(
          (item) =>
            !item.id.startsWith("role-") &&
            !item.id.startsWith("feature-") &&
            item.flowIds.some((flowId) =>
              guide.feature.relatedFlowIds.includes(flowId),
            ),
        )}
        relatedFlows={guide.feature.relatedFlowIds.flatMap((flowId) => {
          const flow = KNOWLEDGE_GUIDE_CONTENT.flows.find(
            (item) => item.id === flowId,
          );
          return flow ? [flow] : [];
        })}
        onBack={() =>
          setParams({ article: null }, { scroll: "restore" })
        }
        onOpenArticle={openArticle}
        onOpenFlow={openFlow}
      />
    );

  const article = KNOWLEDGE_GUIDE_CONTENT.articles.find(
    (item) => item.id === articleId,
  );
  if (article)
    return (
      <KnowledgeArticle
        article={article}
        rolesById={rolesById}
        articlesById={articlesById}
        onBack={() =>
          setParams({ article: null }, { scroll: "restore" })
        }
        onOpenArticle={openArticle}
        onOpenFlow={openFlow}
      />
    );
  const flow = KNOWLEDGE_GUIDE_CONTENT.flows.find((item) => item.id === flowId);
  if (flow)
    return (
      <div className="space-y-5">
        <button
          className="btn-ghost btn-sm"
          onClick={() =>
            setParams(
              { flow: null, step: null, view: null },
              { scroll: "restore" },
            )
          }
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
          evidence={KNOWLEDGE_GUIDE_CONTENT.evidence}
          rolesById={rolesById}
          onSelectNode={(id) =>
            setParams({ step: id }, { scroll: "preserve" })
          }
        />
      </div>
    );

  const recommendedRoleIds = knowledgeRoleIdsForAssignments(userRoles);

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
      content={KNOWLEDGE_GUIDE_CONTENT}
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
