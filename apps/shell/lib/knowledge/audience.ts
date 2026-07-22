import type { KnowledgeContent } from "./types";

export type KnowledgeAudience = "employee" | "vendor";

export function knowledgeAudienceForClaims(
  claims: unknown,
): KnowledgeAudience {
  if (!claims || typeof claims !== "object") return "vendor";
  const metadata = claims as Record<string, unknown>;
  const nested =
    metadata.app_metadata && typeof metadata.app_metadata === "object"
      ? (metadata.app_metadata as Record<string, unknown>)
      : undefined;
  return (metadata.kind ?? nested?.kind) === "employee"
    ? "employee"
    : "vendor";
}

const VENDOR_SHARED_FEATURES = new Set([
  "sign-in",
  "reset-password",
  "knowledge-library",
  "offline-status",
]);

const VENDOR_POLICY_ARTICLES = new Set([
  "policy-vendor-accreditation",
  "policy-legal-instruments",
  "sign-in-and-access",
]);

export function knowledgeContentForAudience(
  content: KnowledgeContent,
  audience: KnowledgeAudience,
): KnowledgeContent {
  if (audience === "employee") return content;

  const roles = content.roles.filter((role) => role.id === "vendor_portal");
  const features = content.features
    .filter(
      (feature) =>
        feature.module === "vendor" || VENDOR_SHARED_FEATURES.has(feature.id),
    )
    .map((feature) => ({
      ...feature,
      roleIds: feature.roleIds.filter((roleId) => roleId === "vendor_portal"),
      relatedFlowIds: [],
    }));
  const featureArticleIds = new Set(
    features.map((feature) => `feature-${feature.id}`),
  );
  const articles = content.articles
    .filter(
      (article) =>
        article.id === "role-vendor_portal" ||
        featureArticleIds.has(article.id) ||
        article.module === "vendor" ||
        VENDOR_POLICY_ARTICLES.has(article.id) ||
        (article.id.startsWith("trouble-") &&
          article.module === "core" &&
          article.roles.includes("vendor_portal")),
    )
    .map((article) => ({
      ...article,
      module: VENDOR_POLICY_ARTICLES.has(article.id)
        ? article.id === "sign-in-and-access"
          ? "core"
          : "vendor"
        : article.module,
      roles: article.roles.filter((roleId) => roleId === "vendor_portal"),
      relatedArticleIds: article.relatedArticleIds.filter(
        (id) => id === "role-vendor_portal" || featureArticleIds.has(id),
      ),
      flowIds: [],
      liveRoutes: article.liveRoutes.filter(
        (route) =>
          route === "/login" ||
          route === "/reset-password" ||
          route === "/knowledge" ||
          route === "/~offline" ||
          route === "/vendor" ||
          route.startsWith("/vendor/"),
      ),
    }));
  const allowedFeatureIds = new Set(features.map((feature) => feature.id));

  return {
    roles,
    features,
    articles,
    flows: [],
    glossary: content.glossary.filter((entry) =>
      /accreditation|instrument|evidence|vendor|audit/i.test(
        `${entry.term} ${entry.definition}`,
      ),
    ),
    futureFeatures: [],
    evidence: content.evidence.filter(
      (item) =>
        item.roleId === "vendor_portal" ||
        (item.featureId ? allowedFeatureIds.has(item.featureId) : false),
    ),
  };
}
