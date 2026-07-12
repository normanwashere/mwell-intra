import type {
  KnowledgeAvailability,
  KnowledgeContent,
  KnowledgeModule,
} from "./types";

export type HandbookEntryMode = "task" | "role" | "feature";
export type HandbookResultType = HandbookEntryMode | "glossary" | "roadmap";

export interface HandbookSearchResult {
  id: string;
  type: HandbookResultType;
  title: string;
  summary: string;
  score: number;
  href: string;
  availability: KnowledgeAvailability;
  module?: KnowledgeModule;
  moduleContext: KnowledgeModule[];
  roleIds: string[];
  roleContext: string[];
  destinationContext: string;
  reviewedAt?: string;
}

export interface KnowledgeFilters {
  module?: KnowledgeModule | "all";
  roleId?: string;
  type?: HandbookResultType | "article" | "flow" | "future" | "all";
}

interface WeightedText {
  title: string;
  aliases?: string[];
  keywords?: string[];
  body?: string;
}

interface IndexedResult extends Omit<HandbookSearchResult, "score"> {
  text: WeightedText;
}

const ROADMAP_TERMS = new Set([
  "roadmap",
  "planned",
  "proposed",
  "future",
  "upcoming",
  "coming soon",
]);

const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const phraseScore = (haystack: string, query: string, weight: number) => {
  if (!haystack || !query) return 0;
  if (haystack === query) return weight * 2;
  return ` ${haystack} `.includes(` ${query} `) ? weight : 0;
};

const includesToken = (haystack: string, token: string) =>
  ` ${haystack} `.includes(` ${token} `);

const scoreText = (text: WeightedText, query: string) => {
  if (!query) return 1;
  const title = normalize(text.title);
  const aliases = (text.aliases ?? []).map(normalize);
  const keywords = (text.keywords ?? []).map(normalize);
  const body = normalize(text.body ?? "");
  const tokens = query.split(" ").filter(Boolean);
  let score = phraseScore(title, query, 180);
  score += Math.max(
    0,
    ...aliases.map((value) => phraseScore(value, query, 160)),
  );
  score += Math.max(
    0,
    ...keywords.map((value) => phraseScore(value, query, 130)),
  );
  score += phraseScore(body, query, 90);

  if (tokens.every((token) => includesToken(title, token))) score += 100;

  for (const token of tokens) {
    if (includesToken(title, token)) score += 24;
    if (aliases.some((value) => includesToken(value, token))) score += 20;
    if (keywords.some((value) => includesToken(value, token))) score += 14;
    if (includesToken(body, token)) score += 3;
  }
  return score;
};

const typeMatches = (
  actual: HandbookResultType,
  requested: KnowledgeFilters["type"],
) => {
  if (!requested || requested === "all") return true;
  if (requested === "article" || requested === "flow") return actual === "task";
  if (requested === "future") return actual === "roadmap";
  return actual === requested;
};

export function searchKnowledge(
  content: KnowledgeContent,
  query: string,
  filters: KnowledgeFilters = {},
): HandbookSearchResult[] {
  const rolesById = new Map(content.roles.map((role) => [role.id, role]));
  const roleContext = (roleIds: string[]) =>
    roleIds.map((id) => rolesById.get(id)?.label ?? id);
  const moduleContext = (roleIds: string[]) => [
    ...new Set(
      roleIds.flatMap((id) => {
        const module = rolesById.get(id)?.module;
        return module ? [module] : [];
      }),
    ),
  ];
  const rawQuery = normalize(query);
  const requestsRoadmap = [...ROADMAP_TERMS].some(
    (term) =>
      rawQuery === term ||
      rawQuery.includes(`${term} `) ||
      rawQuery.includes(` ${term}`),
  );
  const q = rawQuery
    .split(" ")
    .filter((token) => !ROADMAP_TERMS.has(token))
    .join(" ");
  const results: IndexedResult[] = [];

  for (const role of content.roles) {
    results.push({
      id: role.id,
      type: "role",
      title: role.label,
      summary: role.purpose,
      module: role.module,
      moduleContext: [role.module],
      roleIds: [role.id],
      roleContext: [role.label],
      availability: role.availability,
      href: `/knowledge?article=${encodeURIComponent(`role-${role.id}`)}`,
      destinationContext: `${role.module} role guide`,
      text: {
        title: role.label,
        aliases: [role.id.replaceAll("_", " "), role.rbacRole ?? ""],
        keywords: [
          ...role.authority.capabilities,
          ...role.authority.accessibleRoutes,
        ],
        body: [
          role.purpose,
          ...role.authority.canDo,
          ...role.authority.cannotDo,
          ...role.authority.decisions,
          role.authority.escalation,
        ].join(" "),
      },
    });
  }

  for (const feature of content.features) {
    results.push({
      id: feature.id,
      type: feature.availability === "coming_soon" ? "roadmap" : "feature",
      title: feature.title,
      summary: feature.purpose,
      module: feature.module,
      moduleContext: [feature.module],
      roleIds: feature.roleIds,
      roleContext: roleContext(feature.roleIds),
      availability: feature.availability,
      href: `/knowledge?article=${encodeURIComponent(`feature-${feature.id}`)}`,
      destinationContext: `${feature.module} page reference`,
      reviewedAt: feature.reviewedAt,
      text: {
        title: feature.title,
        aliases: [...feature.routes, feature.id.replaceAll("-", " ")],
        keywords: [
          ...feature.capabilityIds,
          ...feature.controls.map((control) => control.name),
          ...(feature.fields ?? []).map((field) => field.name),
          ...feature.statuses,
        ],
        body: [
          feature.purpose,
          ...feature.controls.flatMap((control) => [
            control.behavior,
            control.validation,
            control.result,
          ]),
          ...(feature.fields ?? []).flatMap((field) => [
            field.purpose,
            field.validation,
          ]),
          ...feature.statuses,
          ...feature.exceptions,
          ...feature.reads,
          ...feature.writes,
          ...feature.policyBasis,
        ].join(" "),
      },
    });
  }

  const referenceArticleIds = new Set([
    ...content.roles.map((role) => `role-${role.id}`),
    ...content.features.map((feature) => `feature-${feature.id}`),
  ]);
  for (const article of content.articles) {
    if (referenceArticleIds.has(article.id)) continue;
    results.push({
      id: article.id,
      type: "task",
      title: article.title,
      summary: article.summary,
      module: article.module,
      moduleContext: [article.module],
      roleIds: article.roles,
      roleContext: roleContext(article.roles),
      availability: "live",
      href: `/knowledge?article=${encodeURIComponent(article.id)}`,
      destinationContext: `${article.module} procedure`,
      reviewedAt: article.reviewedAt,
      text: {
        title: article.title,
        aliases: article.keywords,
        keywords: article.sections.flatMap((section) =>
          (section.steps ?? []).map((step) => step.title),
        ),
        body: article.sections
          .map(
            (section) =>
              `${section.title} ${section.body} ${(section.steps ?? [])
                .map(
                  (step) =>
                    `${step.instruction} ${step.expectedOutcome} ${step.exception ?? ""} ${step.handoff ?? ""}`,
                )
                .join(" ")}`,
          )
          .join(" "),
      },
    });
  }

  for (const flow of content.flows) {
    const flowArticles = content.articles.filter(
      (article) =>
        !referenceArticleIds.has(article.id) &&
        article.flowIds.includes(flow.id),
    );
    const flowPrimaryModule =
      flowArticles[0]?.module ?? moduleContext(flow.roles)[0];
    const flowModules = [
      ...new Set([
        ...(flowPrimaryModule ? [flowPrimaryModule] : []),
        ...moduleContext(flow.roles),
        ...flowArticles.map((article) => article.module),
      ]),
    ];
    results.push({
      id: flow.id,
      type: "task",
      title: flow.title,
      summary: flow.summary,
      module: flowModules[0],
      moduleContext: flowModules,
      roleIds: flow.roles,
      roleContext: roleContext(flow.roles),
      availability: "live",
      href: `/knowledge?flow=${encodeURIComponent(flow.id)}`,
      destinationContext: "End-to-end workflow",
      text: {
        title: flow.title,
        aliases: ["flowchart", "workflow"],
        keywords: flow.nodes.map((node) => node.title),
        body: [
          flow.summary,
          ...flow.nodes.flatMap((node) => [
            node.body,
            node.outcome ?? "",
            node.exception ?? "",
            node.type === "decision" ? node.policyBasis : "",
          ]),
          ...flow.edges.map((edge) => edge.label ?? ""),
        ].join(" "),
      },
    });

    for (const node of flow.nodes) {
      const evidence = content.evidence.find((item) => item.nodeId === node.id);
      const nodeArticleModule = content.articles.find(
        (article) => article.id === node.articleId,
      )?.module;
      const nodePrimaryModule =
        nodeArticleModule ??
        flowPrimaryModule ??
        moduleContext(node.ownerRoleIds)[0];
      const nodeModules = [
        ...new Set([
          ...(nodePrimaryModule ? [nodePrimaryModule] : []),
          ...moduleContext(node.ownerRoleIds),
          ...flowModules,
        ]),
      ];
      results.push({
        id: `${flow.id}-${node.id}`,
        type: "task",
        title: node.title,
        summary: node.body,
        module: nodeModules[0],
        moduleContext: nodeModules,
        roleIds: node.ownerRoleIds,
        roleContext: roleContext(node.ownerRoleIds),
        availability: "live",
        href: `/knowledge?flow=${encodeURIComponent(flow.id)}&step=${encodeURIComponent(node.id)}`,
        destinationContext: `${flow.title} / ${node.type}`,
        text: {
          title: node.title,
          aliases: flow.edges
            .filter((edge) => edge.from === node.id)
            .map((edge) => edge.label ?? ""),
          keywords: [
            node.type,
            node.type === "decision" ? node.policyBasis : "",
          ],
          body: [
            node.body,
            node.outcome ?? "",
            node.exception ?? "",
            node.databaseEffect ?? "",
            node.type === "decision" ? node.policyBasis : "",
            ...(evidence?.hotspots.flatMap((hotspot) => [
              hotspot.label,
              hotspot.instruction,
            ]) ?? []),
          ].join(" "),
        },
      });
    }
  }

  for (const item of content.glossary) {
    results.push({
      id: `glossary-${item.term}`,
      type: "glossary",
      title: item.term,
      summary: item.definition,
      roleIds: [],
      moduleContext: [],
      roleContext: [],
      availability: "live",
      href: `/knowledge?glossary=${encodeURIComponent(item.term)}`,
      destinationContext: "Glossary definition",
      text: {
        title: item.term,
        aliases: item.aliases,
        body: item.definition,
      },
    });
  }

  const indexedFeatureIds = new Set(
    content.features.map((feature) => feature.id),
  );
  for (const item of content.futureFeatures) {
    if (indexedFeatureIds.has(item.id)) continue;
    results.push({
      id: `future-${item.id}`,
      type: "roadmap",
      title: item.title,
      summary: item.value,
      roleIds: [],
      moduleContext: [],
      roleContext: [],
      availability: item.status === "released" ? "live" : "coming_soon",
      href: "/knowledge?mode=feature&availability=coming_soon",
      destinationContext: "Product roadmap",
      text: {
        title: item.title,
        aliases: [item.id.replaceAll("-", " ")],
        keywords: [item.status, "roadmap", "coming soon"],
        body: item.value,
      },
    });
  }

  return results
    .map(({ text, ...item }) => {
      const relevance = scoreText(text, q);
      const availabilityBoost = requestsRoadmap
        ? item.availability === "coming_soon"
          ? 1_000
          : 0
        : item.availability === "live"
          ? 1_000
          : item.availability === "limited"
            ? 500
            : 0;
      return { ...item, score: relevance + availabilityBoost, relevance };
    })
    .filter(
      (item) =>
        item.relevance > 0 &&
        (!filters.module ||
          filters.module === "all" ||
          item.moduleContext.includes(filters.module)) &&
        (!filters.roleId ||
          item.roleIds.length === 0 ||
          item.roleIds.includes(filters.roleId)) &&
        typeMatches(item.type, filters.type),
    )
    .sort(
      (left, right) =>
        right.score - left.score || left.title.localeCompare(right.title),
    )
    .map(({ relevance: _relevance, ...item }) => item);
}
