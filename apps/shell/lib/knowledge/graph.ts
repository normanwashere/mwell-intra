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
  const placed = new Map<string, { depth: number; lane: number }>();
  const queue: Array<{ id: string; depth: number; lane: number }> = [
    { id: flow.startNodeId, depth: 0, lane: 0 },
  ];
  while (queue.length) {
    const current = queue.shift()!;
    if (placed.has(current.id)) continue;
    placed.set(current.id, { depth: current.depth, lane: current.lane });
    const outgoing = flow.edges.filter((edge) => edge.from === current.id);
    outgoing.forEach((edge, index) => {
      const offset =
        outgoing.length === 1 ? 0 : (index - (outgoing.length - 1) / 2) * 2;
      queue.push({
        id: edge.to,
        depth: current.depth + 1,
        lane: current.lane + offset,
      });
    });
  }
  for (const item of flow.nodes)
    if (!placed.has(item.id))
      placed.set(item.id, { depth: placed.size, lane: 0 });

  const lanes = [...placed.values()].map((item) => item.lane);
  const minLane = Math.min(...lanes);
  const maxLane = Math.max(...lanes);
  const laneWidth = 250;
  const rowHeight = 168;
  const nodes = new Map<string, FlowLayoutNode>();
  for (const [id, item] of placed)
    nodes.set(id, {
      id,
      depth: item.depth,
      lane: item.lane,
      x: 24 + (item.lane - minLane) * laneWidth,
      y: 24 + item.depth * rowHeight,
    });
  return {
    nodes,
    width: Math.max(720, 48 + (maxLane - minLane) * laneWidth + 220),
    height: Math.max(
      230,
      48 +
        (Math.max(...[...placed.values()].map((item) => item.depth)) + 1) *
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
