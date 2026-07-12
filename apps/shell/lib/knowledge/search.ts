import type {
  KnowledgeContent,
  KnowledgeModule,
  KnowledgeSearchResult,
} from "./types";

export interface KnowledgeFilters {
  module?: KnowledgeModule | "all";
  roleId?: string;
  type?: KnowledgeSearchResult["type"] | "all";
}
const normalize = (value: string) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function searchKnowledge(
  content: KnowledgeContent,
  query: string,
  filters: KnowledgeFilters = {},
): KnowledgeSearchResult[] {
  const q = normalize(query);
  const tokens = q.split(" ").filter(Boolean);
  const score = (
    title: string,
    aliases: string[],
    keywords: string[],
    body: string,
  ) => {
    if (!q) return 1;
    const t = normalize(title),
      a = normalize(aliases.join(" ")),
      k = normalize(keywords.join(" ")),
      b = normalize(body);
    let value = t === q ? 100 : 0;
    if (t.includes(q)) value += 40;
    if (a.includes(q)) value += 35;
    if (k.includes(q)) value += 25;
    for (const token of tokens) {
      if (t.includes(token)) value += 12;
      if (a.includes(token)) value += 10;
      if (k.includes(token)) value += 7;
      if (b.includes(token)) value += 3;
    }
    return value;
  };
  const results: KnowledgeSearchResult[] = [];
  for (const article of content.articles)
    results.push({
      id: article.id,
      type: "article",
      title: article.title,
      summary: article.summary,
      module: article.module,
      roleIds: article.roles,
      href: `/knowledge?article=${encodeURIComponent(article.id)}`,
      score: score(
        article.title,
        [],
        article.keywords,
        article.sections
          .map(
            (s) =>
              `${s.title} ${s.body} ${s.steps?.map((x) => `${x.title} ${x.instruction}`).join(" ") ?? ""}`,
          )
          .join(" "),
      ),
    });
  for (const flow of content.flows)
    results.push({
      id: flow.id,
      type: "flow",
      title: flow.title,
      summary: flow.summary,
      roleIds: flow.roles,
      href: `/knowledge?flow=${encodeURIComponent(flow.id)}`,
      score: score(
        flow.title,
        [],
        ["flowchart", "workflow"],
        [
          ...flow.nodes.map(
            (n) =>
              `${n.title} ${n.body} ${n.outcome ?? ""} ${n.exception ?? ""} ${n.databaseEffect ?? ""}`,
          ),
          ...flow.edges.map((edge) => edge.label ?? ""),
          ...content.evidence
            .filter((item) =>
              flow.nodes.some((node) => node.id === item.nodeId),
            )
            .flatMap((item) =>
              item.hotspots.map(
                (hotspot) => `${hotspot.label} ${hotspot.instruction}`,
              ),
            ),
        ].join(" "),
      ),
    });
  for (const flow of content.flows)
    for (const node of flow.nodes) {
      const evidence = content.evidence.find((item) => item.nodeId === node.id);
      results.push({
        id: `${flow.id}-${node.id}`,
        type: "flow",
        title: node.title,
        summary: node.body,
        roleIds: node.ownerRoleIds,
        href: `/knowledge?flow=${encodeURIComponent(flow.id)}&step=${encodeURIComponent(node.id)}`,
        score: score(
          node.title,
          flow.edges
            .filter((edge) => edge.from === node.id)
            .map((edge) => edge.label ?? ""),
          [node.type],
          `${node.body} ${node.outcome ?? ""} ${node.exception ?? ""} ${node.databaseEffect ?? ""} ${evidence?.hotspots.map((hotspot) => `${hotspot.label} ${hotspot.instruction}`).join(" ") ?? ""}`,
        ),
      });
    }
  for (const item of content.glossary)
    results.push({
      id: `glossary-${item.term}`,
      type: "glossary",
      title: item.term,
      summary: item.definition,
      roleIds: [],
      href: `/knowledge?glossary=${encodeURIComponent(item.term)}`,
      score: score(item.term, item.aliases, [], item.definition),
    });
  for (const item of content.futureFeatures)
    results.push({
      id: `future-${item.id}`,
      type: "future",
      title: item.title,
      summary: item.value,
      roleIds: [],
      href: "/knowledge?type=future",
      score: score(item.title, [], [item.status], item.value),
    });
  return results
    .filter(
      (item) =>
        item.score > 0 &&
        (!filters.module ||
          filters.module === "all" ||
          item.module === filters.module) &&
        (!filters.roleId ||
          item.roleIds.length === 0 ||
          item.roleIds.includes(filters.roleId)) &&
        (!filters.type || filters.type === "all" || item.type === filters.type),
    )
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
}
