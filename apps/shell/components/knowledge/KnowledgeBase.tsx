"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Badge, EmptyState, Icon } from "@intra/ui";
import { useSession } from "@intra/auth";
import { knowledgeRoleIdsForAssignments } from "@shell/lib/knowledge/roles";
import {
  OPERATING_PERSONAS,
  OPERATING_PERSONA_GUIDES,
} from "@shell/lib/knowledge/operatingPersonas";
import { knowledgeContentForAudience } from "@shell/lib/knowledge/audience";
import {
  searchKnowledge,
  type HandbookEntryMode,
  type HandbookSearchResult,
} from "@shell/lib/knowledge/search";
import type {
  KnowledgeAvailability,
  KnowledgeContent,
  KnowledgeEvidence,
  KnowledgeFeature,
  KnowledgeModule,
} from "@shell/lib/knowledge/types";
import { FeatureGuide } from "./FeatureGuide";
import { HandbookLanding } from "./HandbookLanding";
import { KnowledgeArticle } from "./KnowledgeArticle";
import { KnowledgeFlow } from "./KnowledgeFlow";
import { KnowledgeRoleGuide } from "./KnowledgeRoleGuide";
import { KnowledgePageTools } from "./KnowledgePageTools";
import { OperatingPersonaGuide } from "./OperatingPersonaGuide";

const ENTRY_MODES = new Set<HandbookEntryMode>(["task", "role", "feature"]);
const AVAILABILITY_FILTERS = new Set<KnowledgeAvailability | "all">([
  "all",
  "live",
  "limited",
  "coming_soon",
]);

export function evidenceForFeature(
  feature: KnowledgeFeature,
  evidence: KnowledgeEvidence[],
): KnowledgeEvidence[] {
  return evidence.filter((item) => {
    if (item.featureId === feature.id) return true;
    const evidenceRoute = item.route.split(/[?#]/, 1)[0] ?? "";
    return feature.routes.some((route) => {
      const routeSegments = route.split("/").filter(Boolean);
      const evidenceSegments = evidenceRoute.split("/").filter(Boolean);
      if (routeSegments.some((segment) => segment.startsWith(":")))
        return (
          routeSegments.length === evidenceSegments.length &&
          routeSegments.every(
            (segment, index) =>
              segment.startsWith(":") || segment === evidenceSegments[index],
          )
        );
      return evidenceRoute === route || evidenceRoute.startsWith(`${route}/`);
    });
  });
}

export function resolveKnowledgeGuide(
  content: KnowledgeContent,
  articleId: string | null,
) {
  if (!articleId) return null;
  const persona = OPERATING_PERSONAS.find(
    (item) => `persona-${item.id}` === articleId,
  );
  const personaGuide = persona ? OPERATING_PERSONA_GUIDES[persona.id] : null;
  if (
    persona &&
    personaGuide &&
    personaGuide.roleIds.some((roleId) =>
      content.roles.some((role) => role.id === roleId),
    )
  )
    return { kind: "persona" as const, persona, personaGuide };
  const role = content.roles.find((item) => `role-${item.id}` === articleId);
  if (role) return { kind: "role" as const, role };
  const feature = content.features.find(
    (item) => `feature-${item.id}` === articleId,
  );
  if (feature) return { kind: "feature" as const, feature };
  return null;
}

export function KnowledgeBase({ content }: { content: KnowledgeContent }) {
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
  const scopedContent = useMemo(
    () => knowledgeContentForAudience(content, profile?.kind ?? "vendor"),
    [content, profile?.kind],
  );
  const rolesById = useMemo(
    () => new Map(scopedContent.roles.map((role) => [role.id, role])),
    [scopedContent],
  );
  const articlesById = useMemo(
    () => new Map(scopedContent.articles.map((item) => [item.id, item])),
    [scopedContent],
  );
  const results = useMemo(
    () =>
      searchKnowledge(scopedContent, query, {
        module,
        roleId: roleId || undefined,
      }),
    [module, query, roleId, scopedContent],
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

  const glossary = scopedContent.glossary.find(
    (item) => item.term.toLowerCase() === glossaryTerm?.toLowerCase(),
  );
  if (glossary) {
    const relatedFlows = scopedContent.flows.filter((item) =>
      `${item.title} ${item.summary} ${item.nodes.map((node) => `${node.title} ${node.body}`).join(" ")}`
        .toLowerCase()
        .includes(glossary.term.toLowerCase()),
    );
    return (
      <div>
        <KnowledgePageTools
          userId={profile.id}
          item={{
            id: `glossary:${glossary.term}`,
            title: glossary.term,
            href: `/knowledge?glossary=${encodeURIComponent(glossary.term)}`,
            context: "Glossary",
          }}
        />
        <div className="mx-auto max-w-4xl space-y-6">
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => setParams({ glossary: null }, { scroll: "restore" })}
          >
            <Icon name="chevron" className="h-4 w-4 rotate-90" />
            Back to Knowledge Base
          </button>
          <article className="border-y border-line py-7">
            <Badge tone="brand">Glossary</Badge>
            <h1 className="mt-4 text-3xl font-bold text-ink">
              {glossary.term}
            </h1>
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
      </div>
    );
  }

  const guide = resolveKnowledgeGuide(scopedContent, articleId);
  const openArticle = (id: string) =>
    setParams({ article: id, flow: null, step: null, view: null });
  const openFlow = (id: string) =>
    setParams({ article: null, flow: id, step: null, view: "flow" });
  const openKnowledgeHref = (href: string) => {
    const target = new URL(href, window.location.origin);
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
  if (guide?.kind === "persona") {
    const linkedRoleIds = new Set(guide.personaGuide.roleIds);
    const taskFeatureIds = new Set(
      guide.personaGuide.tasks.map((task) => task.featureId),
    );
    const featuresById = new Map(
      scopedContent.features.map((feature) => [feature.id, feature]),
    );
    const taskFeatures = guide.personaGuide.tasks.flatMap((task) => {
      const feature = featuresById.get(task.featureId);
      return feature ? [feature] : [];
    });
    const additionalRoleFeatures = scopedContent.features.filter(
      (feature) =>
        !taskFeatureIds.has(feature.id) &&
        feature.roleIds.some((linkedRoleId) => linkedRoleIds.has(linkedRoleId)),
    );
    const linkedRoles = guide.personaGuide.roleIds.flatMap((linkedRoleId) => {
      const role = rolesById.get(linkedRoleId);
      return role ? [role] : [];
    });
    return (
      <>
        <KnowledgePageTools
          userId={profile.id}
          item={{
            id: `persona:${guide.persona.id}`,
            title: guide.persona.label,
            href: `/knowledge?mode=role&article=persona-${encodeURIComponent(guide.persona.id)}`,
            context: "Job persona guide",
            owner: guide.persona.department,
          }}
        />
        <OperatingPersonaGuide
          persona={guide.persona}
          guide={guide.personaGuide}
          linkedRoles={linkedRoles}
          rolesById={rolesById}
          relatedFeatures={[...taskFeatures, ...additionalRoleFeatures]}
          relatedFlows={scopedContent.flows.filter((flow) =>
            flow.roles.some((linkedRoleId) => linkedRoleIds.has(linkedRoleId)),
          )}
          onBack={() =>
            setParams(
              { article: null, q: null, role: null, limit: null, mode: "role" },
              { scroll: "restore" },
            )
          }
          onOpenFeature={(id) => openArticle(`feature-${id}`)}
          onOpenFlow={openFlow}
        />
      </>
    );
  }
  if (guide?.kind === "role") {
    const roleId = guide.role.id;
    return (
      <>
        <KnowledgePageTools
          userId={profile.id}
          item={{
            id: `role:${roleId}`,
            title: guide.role.label,
            href: `/knowledge?article=role-${encodeURIComponent(roleId)}`,
            context: "Role guide",
            owner: guide.role.module,
          }}
        />
        <KnowledgeRoleGuide
          role={guide.role}
          rolesById={rolesById}
          relatedFeatures={scopedContent.features.filter((feature) =>
            feature.roleIds.includes(roleId),
          )}
          relatedArticles={scopedContent.articles.filter(
            (item) =>
              item.id !== `role-${roleId}` &&
              !item.id.startsWith("feature-") &&
              item.roles.includes(roleId),
          )}
          relatedFlows={scopedContent.flows.filter((item) =>
            item.roles.includes(roleId),
          )}
          glossary={scopedContent.glossary}
          onBack={() => setParams({ article: null }, { scroll: "restore" })}
          onOpenArticle={openArticle}
          onOpenFlow={openFlow}
        />
      </>
    );
  }
  if (guide?.kind === "feature")
    return (
      <>
        <KnowledgePageTools
          userId={profile.id}
          item={{
            id: `feature:${guide.feature.id}`,
            title: guide.feature.title,
            href: `/knowledge?article=feature-${encodeURIComponent(guide.feature.id)}`,
            context: "Feature guide",
            owner: guide.feature.owner,
          }}
        />
        <FeatureGuide
          feature={guide.feature}
          rolesById={rolesById}
          relatedArticles={scopedContent.articles.filter(
            (item) =>
              !item.id.startsWith("role-") &&
              !item.id.startsWith("feature-") &&
              item.flowIds.some((flowId) =>
                guide.feature.relatedFlowIds.includes(flowId),
              ),
          )}
          relatedFlows={guide.feature.relatedFlowIds.flatMap((flowId) => {
            const flow = scopedContent.flows.find((item) => item.id === flowId);
            return flow ? [flow] : [];
          })}
          evidence={evidenceForFeature(
            guide.feature,
            scopedContent.evidence,
          )}
          glossary={scopedContent.glossary}
          onBack={() => setParams({ article: null }, { scroll: "restore" })}
          onOpenArticle={openArticle}
          onOpenFlow={openFlow}
        />
      </>
    );

  const article = scopedContent.articles.find((item) => item.id === articleId);
  if (article)
    return (
      <>
        <KnowledgePageTools
          userId={profile.id}
          item={{
            id: `article:${article.id}`,
            title: article.title,
            href: `/knowledge?article=${encodeURIComponent(article.id)}`,
            context: "Procedure",
            owner: article.owner,
          }}
        />
        <KnowledgeArticle
          article={article}
          rolesById={rolesById}
          articlesById={articlesById}
          glossary={scopedContent.glossary}
          onBack={() => setParams({ article: null }, { scroll: "restore" })}
          onOpenArticle={openArticle}
          onOpenFlow={openFlow}
        />
      </>
    );
  const flow = scopedContent.flows.find((item) => item.id === flowId);
  if (flow)
    return (
      <div className="space-y-5">
        <KnowledgePageTools
          userId={profile.id}
          item={{
            id: `flow:${flow.id}`,
            title: flow.title,
            href: `/knowledge?flow=${encodeURIComponent(flow.id)}&view=flow`,
            context: "Guided workflow",
          }}
        />
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
          evidence={scopedContent.evidence}
          rolesById={rolesById}
          onSelectNode={(id) => setParams({ step: id }, { scroll: "preserve" })}
        />
      </div>
    );

  const recommendedRoleIds = knowledgeRoleIdsForAssignments(userRoles);

  const openResult = (result: HandbookSearchResult) =>
    openKnowledgeHref(result.href);

  return (
    <HandbookLanding
      content={scopedContent}
      results={results}
      query={query}
      mode={mode}
      module={module}
      roleId={roleId}
      availability={availability}
      resultLimit={resultLimit}
      recommendedRoleIds={recommendedRoleIds}
      userId={profile.id}
      rolesById={rolesById}
      onSetParams={setParams}
      onOpenResult={openResult}
      onOpenHref={openKnowledgeHref}
    />
  );
}
