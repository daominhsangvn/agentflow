export type Point = { x: number; y: number };

export type AgentMapLayout = {
  orchestrator: Point;
  agents: Point[];
  rows: number;
};

const ORCHESTRATOR_Y = 10;
const FIRST_ROW_Y = 45;
const LAST_ROW_Y = 85;

/** Percent positions (0-100): orchestrator top-centre, agents in centred rows. */
export function layoutAgentMap(
  agentCount: number,
  { perRow = 4 }: { perRow?: number } = {}
): AgentMapLayout {
  const orchestrator = { x: 50, y: ORCHESTRATOR_Y };
  if (agentCount <= 0) {
    return { orchestrator, agents: [], rows: 0 };
  }
  const rows = Math.ceil(agentCount / perRow);
  const agents: Point[] = [];
  for (let row = 0; row < rows; row++) {
    const inRow = Math.min(perRow, agentCount - row * perRow);
    const y = rowY(row, rows);
    for (let i = 0; i < inRow; i++) {
      agents.push({ x: (100 * (i + 1)) / (inRow + 1), y });
    }
  }
  return { orchestrator, agents, rows };
}

/** SVG path (same 0-100 space) from the orchestrator to an agent: a vertical elbow. */
export function edgePath(from: Point, to: Point): string {
  if (from.x === to.x) {
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  }
  const midY = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y}`;
}

function rowY(row: number, rows: number): number {
  if (rows === 1) {
    return FIRST_ROW_Y + (LAST_ROW_Y - FIRST_ROW_Y) / 2;
  }
  return FIRST_ROW_Y + (row * (LAST_ROW_Y - FIRST_ROW_Y)) / (rows - 1);
}
