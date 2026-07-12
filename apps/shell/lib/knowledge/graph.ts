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

export function traceBranch(
  flow: KnowledgeFlow,
  choices: readonly string[],
): KnowledgeFlowNode[] {
  const nodesById = new Map(flow.nodes.map((node) => [node.id, node]));
  const path: KnowledgeFlowNode[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = flow.startNodeId;
  let choiceIndex = 0;

  while (currentId && !visited.has(currentId)) {
    const current = nodesById.get(currentId);
    if (!current) break;
    path.push(current);
    visited.add(currentId);

    const options = branchOptions(flow, currentId);
    if (options.length === 0) break;
    if (options.length === 1) {
      currentId = options[0]!.to;
      continue;
    }

    const choice = choices[choiceIndex];
    if (!choice) break;
    const selected = options.find(
      (edge) =>
        edge.to === choice ||
        edge.label === choice ||
        `${edge.from}:${edge.to}` === choice,
    );
    if (!selected) break;
    choiceIndex += 1;
    currentId = selected.to;
  }

  return path;
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
