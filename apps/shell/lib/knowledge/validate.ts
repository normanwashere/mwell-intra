import type { KnowledgeContent } from "./types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateKnowledgeContent(content: KnowledgeContent): string[] {
  const errors: string[] = [];
  const roleIds = new Set(content.roles.map((role) => role.id));
  const evidenceIds = new Set<string>();

  for (const evidence of content.evidence) {
    if (evidenceIds.has(evidence.id))
      errors.push(`duplicate evidence id ${evidence.id}`);
    evidenceIds.add(evidence.id);
    if (!roleIds.has(evidence.roleId))
      errors.push(`${evidence.id} references unknown role ${evidence.roleId}`);
    if (!evidence.desktopSrc.startsWith("/knowledge/"))
      errors.push(`${evidence.id} has invalid desktop screenshot path`);
    if (evidence.mobileSrc && !evidence.mobileSrc.startsWith("/knowledge/"))
      errors.push(`${evidence.id} has invalid mobile screenshot path`);
    if (
      !ISO_DATE.test(evidence.capturedAt) ||
      !ISO_DATE.test(evidence.reviewedAt)
    )
      errors.push(`${evidence.id} has invalid evidence date`);

    const hotspotNumbers = new Set<number>();
    const hotspotIds = new Set<string>();
    for (const hotspot of evidence.hotspots) {
      if (hotspotNumbers.has(hotspot.number))
        errors.push(
          `${evidence.id} has duplicate hotspot number ${hotspot.number}`,
        );
      if (hotspotIds.has(hotspot.id))
        errors.push(`${evidence.id} has duplicate hotspot id ${hotspot.id}`);
      hotspotNumbers.add(hotspot.number);
      hotspotIds.add(hotspot.id);
      if (hotspot.x < 0 || hotspot.x > 1 || hotspot.y < 0 || hotspot.y > 1)
        errors.push(
          `${evidence.id}:${hotspot.id} hotspot coordinates must be between 0 and 1`,
        );
    }
  }

  for (const flow of content.flows) {
    const nodeIds = new Set<string>();
    for (const item of flow.nodes) {
      if (nodeIds.has(item.id))
        errors.push(`${flow.id} has duplicate node id ${item.id}`);
      nodeIds.add(item.id);
      for (const roleId of item.ownerRoleIds)
        if (!roleIds.has(roleId))
          errors.push(
            `${flow.id}:${item.id} references unknown role ${roleId}`,
          );
      if (item.evidenceId && !evidenceIds.has(item.evidenceId))
        errors.push(
          `${flow.id}:${item.id} references missing evidence ${item.evidenceId}`,
        );
    }

    if (!nodeIds.has(flow.startNodeId)) {
      errors.push(`${flow.id} has unknown start node ${flow.startNodeId}`);
      continue;
    }

    const outgoing = new Map<string, typeof flow.edges>();
    const incoming = new Map<string, typeof flow.edges>();
    for (const edge of flow.edges) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
        errors.push(`${flow.id} has invalid edge ${edge.from}->${edge.to}`);
        continue;
      }
      outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
      incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
      const source = flow.nodes.find((item) => item.id === edge.from);
      if (source?.type === "decision" && !edge.label?.trim())
        errors.push(
          `${flow.id}:${edge.from} decision edge to ${edge.to} requires a label`,
        );
    }

    for (const item of flow.nodes)
      if (item.type !== "terminal" && !outgoing.get(item.id)?.length)
        errors.push(`${flow.id}:${item.id} is a non-terminal dead end`);

    const reachable = new Set<string>();
    const queue = [flow.startNodeId];
    while (queue.length) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      for (const edge of outgoing.get(id) ?? []) queue.push(edge.to);
    }
    for (const item of flow.nodes)
      if (!reachable.has(item.id))
        errors.push(`${flow.id}:${item.id} is unreachable from start`);

    const reachesTerminal = new Set(
      flow.nodes
        .filter((item) => item.type === "terminal")
        .map((item) => item.id),
    );
    const reverseQueue = [...reachesTerminal];
    while (reverseQueue.length) {
      const id = reverseQueue.shift()!;
      for (const edge of incoming.get(id) ?? [])
        if (!reachesTerminal.has(edge.from)) {
          reachesTerminal.add(edge.from);
          reverseQueue.push(edge.from);
        }
    }
    for (const item of flow.nodes)
      if (reachable.has(item.id) && !reachesTerminal.has(item.id))
        errors.push(`${flow.id}:${item.id} cannot reach a terminal outcome`);
  }

  return errors;
}

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
