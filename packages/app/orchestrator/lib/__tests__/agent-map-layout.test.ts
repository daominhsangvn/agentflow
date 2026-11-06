import { describe, expect, it } from "vitest";

import { edgePath, layoutAgentMap } from "../agent-map-layout";

describe("layoutAgentMap", () => {
  it("places one agent under the orchestrator", () => {
    const layout = layoutAgentMap(1);
    expect(layout.rows).toBe(1);
    expect(layout.agents).toHaveLength(1);
    expect(layout.agents[0].x).toBe(50);
    expect(layout.agents[0].y).toBeGreaterThan(layout.orchestrator.y);
  });

  it("spaces three agents evenly in one centred row", () => {
    const { agents, rows } = layoutAgentMap(3);
    expect(rows).toBe(1);
    expect(agents.map((p) => p.x)).toEqual([25, 50, 75]);
  });

  it("wraps seven agents into two centred rows", () => {
    const { agents, rows } = layoutAgentMap(7, { perRow: 4 });
    expect(rows).toBe(2);
    expect(agents).toHaveLength(7);
    const first = agents.slice(0, 4);
    const second = agents.slice(4);
    expect(new Set(first.map((p) => p.y)).size).toBe(1);
    expect(second[0].y).toBeGreaterThan(first[0].y);
    const centre = (row: typeof agents) => (row[0].x + row.at(-1)!.x) / 2;
    expect(centre(first)).toBe(50);
    expect(centre(second)).toBe(50);
    const keys = new Set(agents.map((p) => `${p.x},${p.y}`));
    expect(keys.size).toBe(7);
    for (const p of [...agents, layoutAgentMap(7).orchestrator]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
  });

  it("returns no agents for zero", () => {
    expect(layoutAgentMap(0)).toMatchObject({ agents: [], rows: 0 });
  });
});

describe("edgePath", () => {
  it("is a straight line when aligned", () => {
    expect(edgePath({ x: 50, y: 10 }, { x: 50, y: 60 })).toBe(
      "M 50 10 L 50 60"
    );
  });

  it("is an elbow otherwise", () => {
    expect(edgePath({ x: 50, y: 10 }, { x: 25, y: 50 })).toBe(
      "M 50 10 L 50 30 L 25 30 L 25 50"
    );
  });
});
