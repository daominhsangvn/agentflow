import { describe, expect, it } from "vitest";
import { ConnectionAccess } from "../connection-grants.ts";
import {
  OrchestratorPageAccess,
  OrchestratorPageOperation,
  OrchestratorPullRequestOperation,
  OrchestratorSourceOperation,
  orchestratorConnectionGrantsSchema,
  pageKeysWith,
  resolveOrchestratorGrants,
} from "../orchestrator-grants.ts";

const FULL = {
  source: Object.values(OrchestratorSourceOperation),
  confluence: [OrchestratorPageOperation.Publish],
  pull_requests: [OrchestratorPullRequestOperation.Open],
};

describe("orchestrator connection grants", () => {
  it("parses the full example", () => {
    const parsed = orchestratorConnectionGrantsSchema.safeParse(FULL);
    expect(parsed.success).toBe(true);
    const set = resolveOrchestratorGrants(FULL);
    expect(set.source.size).toBe(5);
    expect(set.pullRequestOpen).toBe(true);
  });

  it("resolves {} to no writes", () => {
    const set = resolveOrchestratorGrants({});
    expect(set.source.size).toBe(0);
    expect(set.pages.size).toBe(0);
    expect(set.pullRequestOpen).toBe(false);
  });

  it("refuses attach without comment", () => {
    const result = orchestratorConnectionGrantsSchema.safeParse({
      source: [OrchestratorSourceOperation.Attach],
    });
    expect(result.success).toBe(false);
  });

  it("refuses an operation pull_requests does not allow", () => {
    const result = orchestratorConnectionGrantsSchema.safeParse({
      pull_requests: ["reply"],
    });
    expect(result.success).toBe(false);
  });

  it("resolves a publish grant, which also reads", () => {
    const set = resolveOrchestratorGrants(FULL);
    expect(set.pages.get("confluence")).toBe(OrchestratorPageAccess.Publish);
    expect(pageKeysWith(set, OrchestratorPageAccess.Read)).toContain(
      "confluence"
    );
  });

  it("treats source: read as no writes", () => {
    const grants = { source: ConnectionAccess.Read };
    expect(orchestratorConnectionGrantsSchema.safeParse(grants).success).toBe(
      true
    );
    expect(resolveOrchestratorGrants(grants).source.size).toBe(0);
  });
});
