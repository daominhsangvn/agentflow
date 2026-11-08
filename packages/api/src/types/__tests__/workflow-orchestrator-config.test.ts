import { describe, expect, it } from "vitest";
import {
  OrchestratorConcurrency,
  OrchestratorTicketChange,
} from "../orchestrator.ts";
import {
  resolveWorkflowOrchestratorConfig,
  WORKFLOW_INSTRUCTIONS_MAX,
  workflowAgentConfigSchema,
  workflowOrchestratorConfigSchema,
} from "../workflow.ts";

const BASE = { computeTargetId: "0199a5f0-0000-7000-8000-0000000000c1" };

describe("workflow orchestrator config", () => {
  it("leaves orchestrator undefined when absent", () => {
    expect(workflowAgentConfigSchema.parse(BASE).orchestrator).toBeUndefined();
  });

  it("resolves defaults", () => {
    expect(resolveWorkflowOrchestratorConfig({})).toEqual({
      concurrency: OrchestratorConcurrency.Supersede,
      debounceSeconds: 20,
      turnTimeoutMinutes: 10,
      cancelOn: [
        OrchestratorTicketChange.StatusChanged,
        OrchestratorTicketChange.LabelRemoved,
      ],
      mentionOnly: false,
      caseLookup: false,
      caseHandoff: false,
      connections: {},
    });
  });

  it("refuses an out-of-range debounce", () => {
    expect(
      workflowOrchestratorConfigSchema.safeParse({ debounceSeconds: 601 })
        .success
    ).toBe(false);
  });

  it("round-trips queue concurrency", () => {
    const parsed = workflowAgentConfigSchema.parse({
      ...BASE,
      orchestrator: {
        concurrency: OrchestratorConcurrency.Queue,
        debounceSeconds: 5,
        turnTimeoutMinutes: 3,
      },
    });
    expect(parsed.orchestrator).toEqual({
      concurrency: OrchestratorConcurrency.Queue,
      debounceSeconds: 5,
      turnTimeoutMinutes: 3,
      cancelOn: [
        OrchestratorTicketChange.StatusChanged,
        OrchestratorTicketChange.LabelRemoved,
      ],
      mentionOnly: false,
      caseLookup: false,
      caseHandoff: false,
      connections: {},
    });
  });

  it("parses the side-conversation switches", () => {
    const parsed = workflowOrchestratorConfigSchema.parse({
      mentionOnly: true,
      caseHandoff: true,
    });
    expect(parsed.mentionOnly).toBe(true);
    expect(parsed.caseHandoff).toBe(true);
    expect(parsed.caseLookup).toBe(false);
  });

  it("accepts rules up to the limit and rejects longer ones", () => {
    const rules = (length: number) => ({
      ...BASE,
      instructions: "x".repeat(length),
    });
    expect(WORKFLOW_INSTRUCTIONS_MAX).toBe(16_000);
    expect(
      workflowAgentConfigSchema.safeParse(rules(WORKFLOW_INSTRUCTIONS_MAX))
        .success
    ).toBe(true);
    expect(
      workflowAgentConfigSchema.safeParse(rules(WORKFLOW_INSTRUCTIONS_MAX + 1))
        .success
    ).toBe(false);
  });
});
