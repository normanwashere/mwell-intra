import type { KnowledgeContent } from "./types";

export function validateKnowledgeBase(content: KnowledgeContent): string[] {
  const errors: string[] = [];
  const roleIds = new Set(content.roles.map((role) => role.id));
  const articleIds = new Set<string>();
  const slugs = new Set<string>();
  const flowIds = new Set(content.flows.map((flow) => flow.id));

  for (const article of content.articles) {
    if (articleIds.has(article.id))
      errors.push(`Duplicate article id: ${article.id}`);
    if (slugs.has(article.slug))
      errors.push(`Duplicate article slug: ${article.slug}`);
    articleIds.add(article.id);
    slugs.add(article.slug);
    for (const role of article.roles)
      if (!roleIds.has(role))
        errors.push(`Article ${article.id} references unknown role ${role}`);
    for (const route of article.liveRoutes)
      if (!route.startsWith("/"))
        errors.push(`Article ${article.id} has invalid route ${route}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(article.reviewedAt))
      errors.push(`Article ${article.id} has invalid review date`);
  }
  for (const article of content.articles) {
    for (const id of article.relatedArticleIds)
      if (!articleIds.has(id))
        errors.push(`Article ${article.id} links unknown article ${id}`);
    for (const id of article.flowIds)
      if (!flowIds.has(id))
        errors.push(`Article ${article.id} links unknown flow ${id}`);
  }
  for (const flow of content.flows) {
    const nodes = new Map(flow.nodes.map((item) => [item.id, item]));
    if (!nodes.has(flow.startNodeId))
      errors.push(`Flow ${flow.id} has unknown start node`);
    if (!flow.nodes.some((item) => item.type === "terminal"))
      errors.push(`Flow ${flow.id} has no terminal node`);
    for (const role of flow.roles)
      if (!roleIds.has(role))
        errors.push(`Flow ${flow.id} references unknown role ${role}`);
    for (const edge of flow.edges)
      if (!nodes.has(edge.from) || !nodes.has(edge.to))
        errors.push(
          `Flow ${flow.id} has invalid edge ${edge.from}->${edge.to}`,
        );
  }
  for (const role of content.roles) {
    if (!content.articles.some((article) => article.roles.includes(role.id)))
      errors.push(`Role ${role.id} has no article`);
    if (!content.flows.some((flow) => flow.roles.includes(role.id)))
      errors.push(`Role ${role.id} has no flow`);
  }
  return errors;
}
