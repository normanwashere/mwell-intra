import type { KnowledgeFlow } from "./types";

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
