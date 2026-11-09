import { describe, expect, it } from "vitest";
import { projectAgentsError } from "../workflow-project-agents";

const withAgents = (id: string, name: string, ids: string[]) => ({
  id,
  name,
  settings: { runnerIds: ids },
});
const names = new Map([
  ["a1", "alpha"],
  ["a2", "beta"],
]);

describe("projectAgentsError", () => {
  it("passes any Agent for a project without Agents", () => {
    expect(
      projectAgentsError({
        projects: [{ id: "p", name: "P", settings: {} }],
        agents: [{ label: "The workflow's Agent", computeTargetId: "a1" }],
        agentNames: names,
      })
    ).toBeNull();
  });

  it("rejects a default Agent outside the project's Agents", () => {
    const error = projectAgentsError({
      projects: [withAgents("p", "Alpha", ["a2"])],
      agents: [{ label: "The workflow's Agent", computeTargetId: "a1" }],
      agentNames: names,
    });
    expect(error).toContain("The workflow's Agent (alpha)");
    expect(error).toContain("project Alpha");
  });

  it("labels a runner rule and the orchestrator", () => {
    const projects = [withAgents("p", "Alpha", ["a1"])];
    expect(
      projectAgentsError({
        projects,
        agents: [
          { label: "The workflow's Agent", computeTargetId: "a1" },
          { label: "Runner rule 2's Agent", computeTargetId: "a2" },
        ],
        agentNames: names,
      })
    ).toContain("Runner rule 2's Agent (beta)");
    expect(
      projectAgentsError({
        projects,
        agents: [{ label: "The orchestrator's Agent", computeTargetId: "a2" }],
        agentNames: names,
      })
    ).toContain("The orchestrator's Agent");
  });

  it("names a trigger project whose Agents exclude the Agent", () => {
    const error = projectAgentsError({
      projects: [
        { id: "p1", name: "One", settings: {} },
        withAgents("p2", "Two", ["a2"]),
      ],
      agents: [{ label: "The workflow's Agent", computeTargetId: "a1" }],
      agentNames: names,
    });
    expect(error).toContain("project Two");
  });
});
