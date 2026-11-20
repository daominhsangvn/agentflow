import { LoopCommand } from "@repo/api/src/types/loop";
import {
  WorkflowSessionCarryAttempt,
  WorkflowSessionCarryReason,
} from "@repo/api/src/types/workflow-same-item";
import { describe, expect, it } from "vitest";
import {
  CARRIED_SESSION_METADATA_KEY,
  CARRIED_WORKSPACE_METADATA_KEY,
  carriedWorkspaceSlug,
  readCarriedSessionMetadata,
  readCarriedWorkspaceMetadata,
} from "../carried-session-metadata";

const WORKSPACE = { slug: "FEA-1", fromRunId: "run-1" };

describe("readCarriedSessionMetadata", () => {
  it("reads a valid value", () => {
    const carried = {
      fromRunId: "run-1",
      attempt: WorkflowSessionCarryAttempt.Fork,
      depth: 2,
      reason: WorkflowSessionCarryReason.ResumeSessionNotFound,
    };
    expect(
      readCarriedSessionMetadata({ [CARRIED_SESSION_METADATA_KEY]: carried })
    ).toEqual(carried);
  });

  it.each([
    undefined,
    null,
    {},
    { [CARRIED_SESSION_METADATA_KEY]: "x" },
    { [CARRIED_SESSION_METADATA_KEY]: { attempt: "nope", depth: 1 } },
  ])("returns null for %j", (metadata) => {
    expect(readCarriedSessionMetadata(metadata)).toBeNull();
  });
});

describe("readCarriedWorkspaceMetadata", () => {
  it("reads a valid value", () => {
    expect(
      readCarriedWorkspaceMetadata({
        [CARRIED_WORKSPACE_METADATA_KEY]: WORKSPACE,
      })
    ).toEqual(WORKSPACE);
  });

  it.each([
    undefined,
    {},
    { [CARRIED_WORKSPACE_METADATA_KEY]: { slug: "", fromRunId: "r" } },
    { [CARRIED_WORKSPACE_METADATA_KEY]: { slug: "FEA-1" } },
  ])("returns null for %j", (metadata) => {
    expect(readCarriedWorkspaceMetadata(metadata)).toBeNull();
  });
});

describe("carriedWorkspaceSlug", () => {
  const metadata = {
    workflowRunId: "run-2",
    [CARRIED_WORKSPACE_METADATA_KEY]: WORKSPACE,
  };

  it("returns the slug of a workflow STEP loop", () => {
    expect(carriedWorkspaceSlug({ command: LoopCommand.Step, metadata })).toBe(
      "FEA-1"
    );
  });

  it("returns null for another command", () => {
    expect(
      carriedWorkspaceSlug({ command: LoopCommand.Plan, metadata })
    ).toBeNull();
  });

  it("returns null without a workflow run id", () => {
    expect(
      carriedWorkspaceSlug({
        command: LoopCommand.Step,
        metadata: { [CARRIED_WORKSPACE_METADATA_KEY]: WORKSPACE },
      })
    ).toBeNull();
  });

  it("returns null for an orchestrator task loop", () => {
    expect(
      carriedWorkspaceSlug({
        command: LoopCommand.Step,
        metadata: { ...metadata, orchestratorTaskId: "task-1" },
      })
    ).toBeNull();
  });

  it("returns null without the key", () => {
    expect(
      carriedWorkspaceSlug({
        command: LoopCommand.Step,
        metadata: { workflowRunId: "run-2" },
      })
    ).toBeNull();
  });
});
