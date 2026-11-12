import { describe, expect, it } from "vitest";
import { ConnectionAccess } from "../connection-grants.ts";
import {
  OrchestratorPageAccess,
  OrchestratorPageOperation,
  OrchestratorPullRequestOperation,
  OrchestratorSourceOperation,
  OrchestratorTeamsOperation,
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

  it("resolves an ask grant on a Teams key", () => {
    const grants = { teams: [OrchestratorTeamsOperation.Ask] };
    expect(orchestratorConnectionGrantsSchema.safeParse(grants).success).toBe(
      true
    );
    const set = resolveOrchestratorGrants(grants);
    expect([...set.ask]).toEqual(["teams"]);
    expect(set.pages.size).toBe(0);
  });

  it("refuses publish and ask on one key", () => {
    const result = orchestratorConnectionGrantsSchema.safeParse({
      teams: [
        OrchestratorTeamsOperation.Ask,
        OrchestratorPageOperation.Publish,
      ],
    });
    expect(result.success).toBe(false);
  });

  it("refuses read and ask on one key", () => {
    const result = orchestratorConnectionGrantsSchema.safeParse({
      teams: ["read", OrchestratorTeamsOperation.Ask],
    });
    expect(result.success).toBe(false);
  });

  it("refuses an unknown operation naming the allowed ones", () => {
    const result = orchestratorConnectionGrantsSchema.safeParse({
      teams: ["post"],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("publish, ask");
  });
});
