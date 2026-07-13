import type {
  KnowledgeFlow,
  KnowledgeFlowEdge,
  KnowledgeFlowNode,
} from "./types";

export interface FlowLayoutNode {
  id: string;
  depth: number;
  lane: number;
  x: number;
  y: number;
}

export interface FlowLayout {
  nodes: Map<string, FlowLayoutNode>;
  width: number;
  height: number;
}

export function layoutFlow(flow: KnowledgeFlow): FlowLayout {
  const depthById = new Map<string, number>();
  const queue: Array<{ id: string; depth: number }> = [
    { id: flow.startNodeId, depth: 0 },
  ];
  while (queue.length) {
    const current = queue.shift()!;
    if (depthById.has(current.id)) continue;
    depthById.set(current.id, current.depth);
    const outgoing = flow.edges.filter((edge) => edge.from === current.id);
    outgoing.forEach((edge) =>
      queue.push({ id: edge.to, depth: current.depth + 1 }),
    );
  }
  let fallbackDepth = Math.max(0, ...depthById.values()) + 1;
  for (const node of flow.nodes)
    if (!depthById.has(node.id)) depthById.set(node.id, fallbackDepth++);

  const layers = new Map<number, string[]>();
  for (const node of flow.nodes) {
    const depth = depthById.get(node.id)!;
    layers.set(depth, [...(layers.get(depth) ?? []), node.id]);
  }

  const nodeWidth = 200;
  const columnGap = 84;
  const rowHeight = 196;
  const horizontalPadding = 24;
  const widestLayer = Math.max(1, ...[...layers.values()].map((layer) => layer.length));
  const width = Math.max(
    720,
    horizontalPadding * 2 +
      widestLayer * nodeWidth +
      (widestLayer - 1) * columnGap,
  );
  const nodes = new Map<string, FlowLayoutNode>();
  for (const [depth, layer] of layers) {
    const layerWidth = layer.length * nodeWidth + (layer.length - 1) * columnGap;
    const startX = (width - layerWidth) / 2;
    layer.forEach((id, index) =>
      nodes.set(id, {
        id,
        depth,
        lane: index - (layer.length - 1) / 2,
        x: startX + index * (nodeWidth + columnGap),
        y: 24 + depth * rowHeight,
      }),
    );
  }
  return {
    nodes,
    width,
    height: Math.max(
      230,
      48 +
        (Math.max(...depthById.values()) + 1) *
          rowHeight,
    ),
  };
}

export function outgoingEdges(flow: KnowledgeFlow, nodeId: string) {
  return flow.edges.filter((edge) => edge.from === nodeId);
}

export function branchOptions(
  flow: KnowledgeFlow,
  nodeId: string,
): KnowledgeFlowEdge[] {
  return outgoingEdges(flow, nodeId);
}

export function edgeChoiceId(
  flow: KnowledgeFlow,
  edge: KnowledgeFlowEdge,
): string {
  const localId =
    edge.id ??
    [edge.from, edge.to, edge.label ?? "next"]
      .map((part) =>
        part
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
      )
      .join("-");
  return `${encodeURIComponent(flow.id)}~${encodeURIComponent(localId)}`;
}

export interface BranchResolution {
  nodes: KnowledgeFlowNode[];
  traversedEdges: KnowledgeFlowEdge[];
  chosenEdges: KnowledgeFlowEdge[];
  choiceIds: string[];
  invalidChoiceIds: string[];
  currentNode: KnowledgeFlowNode;
}

export function resolveBranch(
  flow: KnowledgeFlow,
  requestedChoiceIds: readonly string[],
): BranchResolution {
  const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
  const nodes: KnowledgeFlowNode[] = [];
  const traversedEdges: KnowledgeFlowEdge[] = [];
  const chosenEdges: KnowledgeFlowEdge[] = [];
  const choiceIds: string[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = flow.startNodeId;
  let choiceIndex = 0;

  while (currentId && !visited.has(currentId)) {
    const current = nodesById.get(currentId);
    if (!current) break;
    nodes.push(current);
    visited.add(currentId);

    const options = branchOptions(flow, currentId);
    if (options.length === 0) break;
    let selected: KnowledgeFlowEdge | undefined;
    if (options.length === 1) {
      selected = options[0]!;
    } else {
      const requestedId = requestedChoiceIds[choiceIndex];
      if (!requestedId) break;
      selected = options.find(
        (edge) => edgeChoiceId(flow, edge) === requestedId,
      );
      if (!selected) break;
      chosenEdges.push(selected);
      choiceIds.push(requestedId);
      choiceIndex += 1;
    }
    if (!selected) break;
    traversedEdges.push(selected);
    currentId = selected.to;
  }

  const currentNode =
    nodes.at(-1) ?? nodesById.get(flow.startNodeId) ?? flow.nodes[0]!;
  return {
    nodes,
    traversedEdges,
    chosenEdges,
    choiceIds,
    invalidChoiceIds: requestedChoiceIds.slice(choiceIndex),
    currentNode,
  };
}

export function traceBranch(
  flow: KnowledgeFlow,
  choices: readonly string[],
): KnowledgeFlowNode[] {
  return resolveBranch(flow, choices).nodes;
}

export function roleNodes(
  flow: KnowledgeFlow,
  roleId: string,
): KnowledgeFlowNode[] {
  return flow.nodes.filter(
    (node) =>
      node.ownerRoleIds.includes(roleId) ||
      (node.type === "decision" && node.authorityRoleId === roleId),
  );
}

export function exceptionNodes(flow: KnowledgeFlow): KnowledgeFlowNode[] {
  const exceptionDestinations = new Set(
    flow.edges
      .filter((edge) => edge.outcome === "exception")
      .map((edge) => edge.to),
  );
  return flow.nodes.filter(
    (node) =>
      node.type === "exception" ||
      Boolean(node.exception) ||
      exceptionDestinations.has(node.id),
  );
}
