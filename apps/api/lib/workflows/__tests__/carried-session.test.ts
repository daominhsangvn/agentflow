import { LoopCommand } from "@repo/api/src/types/loop";
import { Result } from "@repo/api/src/types/result";
import { WorkflowRunStatus } from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import {
  WorkflowSameItem,
  WorkflowSessionCarryAttempt,
  WorkflowSessionCarryReason,
} from "@repo/api/src/types/workflow-same-item";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceItem } from "@/lib/integrations/types";
import {
  CARRIED_DELTA_MAX,
  CARRIED_MESSAGES_FILE,
  carriedSessionInput,
  findCarriedSession,
  MAX_CARRIED_SESSION_DEPTH,
} from "@/lib/workflows/engine/carried-session";
import type { EngineRun } from "@/lib/workflows/engine/step-outcome";

const mocks = vi.hoisted(() => ({
  loadItemRunKey: vi.fn(),
  findPreviousItemRun: vi.fn(),
  listRunLoops: vi.fn(),
  loopFindMany: vi.fn(),
  artifactFindFirst: vi.fn(),
  resolveTarget: vi.fn(),
  findTarget: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({
      loop: { findMany: mocks.loopFindMany, findFirst: vi.fn() },
      artifact: { findFirst: mocks.artifactFindFirst },
    }),
}));
vi.mock("@/app/compute-targets/service", () => ({
  computeTargetsService: { findById: mocks.findTarget },
}));
vi.mock("@/lib/workflows/engine/item-queue", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/workflows/engine/item-queue")
  >()),
  loadItemRunKey: mocks.loadItemRunKey,
  findPreviousItemRun: mocks.findPreviousItemRun,
}));
vi.mock("@/lib/workflows/engine/run-loops", () => ({
  listRunLoops: mocks.listRunLoops,
}));
vi.mock("@/lib/workflows/engine/launch", () => ({
  resolveProjectComputeTarget: mocks.resolveTarget,
}));

const ORG = "org-1";
const TARGET = "target-1";
const PREVIOUS_ID = "run-1";
const STEP = "answer";
const AUTO_CAPS = { loopStepResumeMiss: true, loopStepForkSession: true };
const PERSONAL_CAPS = {
  ...AUTO_CAPS,
  personalRunner: { projectKey: "PRJ", parallel: false },
};

function run(overrides: Partial<EngineRun> = {}): EngineRun {
  return {
    id: "run-2",
    organizationId: ORG,
    cycle: 1,
    agentConfig: {
      mode: WorkflowAgentMode.PlanAndExecute,
      sameItem: WorkflowSameItem.QueueResume,
    },
    ...overrides,
  } as EngineRun;
}

function sessionLoop(
  id: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    loopId: id,
    command: LoopCommand.Step,
    stepId: STEP,
    sessionId: `session-${id}`,
    computeTargetId: TARGET,
    createdAt: new Date("2026-11-01T10:00:00Z"),
    ...overrides,
  };
}

function find(overrides: Record<string, unknown> = {}) {
  return findCarriedSession({
    run: run(),
    stepId: STEP,
    runAsUserId: "user-1",
    documentId: "issue-1",
    pushes: false,
    artifacts: [".agentflow-ai/work/answer.md"],
    ...overrides,
  } as Parameters<typeof findCarriedSession>[0]);
}

function errReason(
  result: Awaited<ReturnType<typeof find>>
): WorkflowSessionCarryReason | null {
  return result.ok ? null : result.error.reason;
}

function previousRunRow(status: WorkflowRunStatus) {
  return {
    id: PREVIOUS_ID,
    status,
    source: null,
    featureDocumentId: "issue-0",
    planDocumentId: null,
  };
}

function loopRow(metadata: Record<string, unknown>, artifactId = "issue-0") {
  return {
    id: "loop-a",
    artifactId,
    createdAt: new Date("2026-11-01T10:00:00Z"),
    metadata: { workflowRunId: PREVIOUS_ID, ...metadata },
  };
}

function attemptMetadata(depth: number, workspace?: string) {
  return {
    carriedSession: {
      fromRunId: "run-0",
      attempt: WorkflowSessionCarryAttempt.Resume,
      depth,
      reason: null,
    },
    ...(workspace
      ? { carriedWorkspace: { slug: workspace, fromRunId: "run-0" } }
      : {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadItemRunKey.mockResolvedValue({
    id: "run-2",
    organizationId: ORG,
    workflowId: "wf-1",
    sourceKey: "k",
    createdAt: new Date("2026-11-02T10:00:00Z"),
  });
  mocks.findPreviousItemRun.mockResolvedValue(
    previousRunRow(WorkflowRunStatus.Succeeded)
  );
  mocks.listRunLoops.mockResolvedValue([sessionLoop("loop-a")]);
  mocks.loopFindMany.mockResolvedValue([loopRow({})]);
  mocks.artifactFindFirst.mockResolvedValue({ slug: "FEA-1" });
  mocks.resolveTarget.mockResolvedValue(Result.ok(TARGET));
  mocks.findTarget.mockResolvedValue({
    id: TARGET,
    organizationId: ORG,
    capabilities: AUTO_CAPS,
  });
});

describe("findCarriedSession", () => {
  it("carries on an auto runner with the earlier run's folder", async () => {
    const result = await find();

    expect(result.ok && result.value).toMatchObject({
      fromRunId: PREVIOUS_ID,
      loop: { loopId: "loop-a", computeTargetId: TARGET },
      workspace: { slug: "FEA-1", fromRunId: PREVIOUS_ID },
      depth: 1,
      forks: true,
    });
  });

  it("carries on a personal runner without a folder", async () => {
    mocks.findTarget.mockResolvedValue({
      organizationId: ORG,
      capabilities: PERSONAL_CAPS,
    });

    const result = await find();

    expect(result.ok && result.value.workspace).toBeNull();
    expect(mocks.artifactFindFirst).not.toHaveBeenCalled();
  });

  it("follows the carried folder of a chain and counts the depth", async () => {
    mocks.loopFindMany.mockResolvedValue([
      loopRow(attemptMetadata(3, "FEA-0")),
    ]);

    const result = await find();

    expect(result.ok && result.value.depth).toBe(4);
    expect(result.ok && result.value.workspace?.slug).toBe("FEA-0");
  });

  it("resumes the newest session loop of the earlier run, an answers loop included", async () => {
    mocks.listRunLoops.mockResolvedValue([
      sessionLoop("loop-a"),
      sessionLoop("loop-answers", {
        createdAt: new Date("2026-11-01T11:00:00Z"),
      }),
      sessionLoop("loop-no-session", {
        sessionId: null,
        createdAt: new Date("2026-11-01T12:00:00Z"),
      }),
    ]);

    mocks.loopFindMany.mockResolvedValue([
      { ...loopRow({}), id: "loop-answers" },
    ]);

    const result = await find();

    expect(result.ok && result.value.loop.loopId).toBe("loop-answers");
  });

  it.each([
    WorkflowRunStatus.Failed,
    WorkflowRunStatus.Cancelled,
    WorkflowRunStatus.Succeeded,
  ])("carries from a previous run that ended %s", async (status) => {
    mocks.findPreviousItemRun.mockResolvedValue(previousRunRow(status));

    expect((await find()).ok).toBe(true);
  });

  it("starts fresh past the depth cap", async () => {
    mocks.loopFindMany.mockResolvedValue([
      loopRow(attemptMetadata(MAX_CARRIED_SESSION_DEPTH)),
    ]);

    expect(errReason(await find())).toBe(WorkflowSessionCarryReason.DepthLimit);
  });

  it("gives each miss its reason", async () => {
    const queue = run({
      agentConfig: {
        mode: WorkflowAgentMode.PlanAndExecute,
        sameItem: WorkflowSameItem.Queue,
      },
    });
    expect(errReason(await find({ run: queue }))).toBe(
      WorkflowSessionCarryReason.NotResume
    );
    expect(errReason(await find({ run: run({ cycle: 2 }) }))).toBe(
      WorkflowSessionCarryReason.NotFirstCycle
    );
    const orchestrated = run({
      agentConfig: {
        mode: WorkflowAgentMode.Orchestrated,
        sameItem: WorkflowSameItem.QueueResume,
      },
    });
    expect(errReason(await find({ run: orchestrated }))).toBe(
      WorkflowSessionCarryReason.NotResume
    );

    mocks.findPreviousItemRun.mockResolvedValueOnce(null);
    expect(errReason(await find())).toBe(
      WorkflowSessionCarryReason.NoPreviousRun
    );

    mocks.listRunLoops.mockResolvedValueOnce([
      sessionLoop("loop-a", { sessionId: null }),
    ]);
    expect(errReason(await find())).toBe(WorkflowSessionCarryReason.NoSession);
  });

  it("starts fresh when the runner is not the resolved one or cannot be resolved", async () => {
    mocks.resolveTarget.mockResolvedValueOnce(Result.ok("other-target"));
    expect(errReason(await find())).toBe(
      WorkflowSessionCarryReason.RunnerUnavailable
    );

    mocks.resolveTarget.mockResolvedValueOnce(
      Result.err({ code: "x", message: "offline" })
    );
    expect(errReason(await find())).toBe(
      WorkflowSessionCarryReason.RunnerUnavailable
    );
  });

  it("starts fresh when the earlier runner is missing or in another organization", async () => {
    mocks.findTarget.mockResolvedValueOnce(null);
    expect(errReason(await find())).toBe(
      WorkflowSessionCarryReason.RunnerUnavailable
    );

    mocks.findTarget.mockResolvedValueOnce({
      organizationId: "org-other",
      capabilities: AUTO_CAPS,
    });
    expect(errReason(await find())).toBe(
      WorkflowSessionCarryReason.RunnerUnavailable
    );
  });

  it("starts fresh on a runner that cannot report a resume miss", async () => {
    mocks.findTarget.mockResolvedValue({
      organizationId: ORG,
      capabilities: { loopStepForkSession: true },
    });

    expect(errReason(await find())).toBe(
      WorkflowSessionCarryReason.RunnerCannotReportMiss
    );
  });

  it("starts fresh for a pushing step or files outside the work dir on an auto runner", async () => {
    expect(errReason(await find({ pushes: true }))).toBe(
      WorkflowSessionCarryReason.PushingStepOnAuto
    );
    expect(errReason(await find({ artifacts: ["answer.md"] }))).toBe(
      WorkflowSessionCarryReason.ArtifactsOutsideWorkDir
    );
  });

  it("starts fresh when the folder is unknown or the loop was a case loop", async () => {
    mocks.artifactFindFirst.mockResolvedValueOnce(null);
    expect(errReason(await find())).toBe(
      WorkflowSessionCarryReason.WorkspaceUnknown
    );

    mocks.loopFindMany.mockResolvedValueOnce([
      loopRow({ orchestratorTaskId: "t-1" }),
    ]);
    expect(errReason(await find())).toBe(
      WorkflowSessionCarryReason.WorkspaceUnknown
    );

    mocks.loopFindMany.mockResolvedValueOnce([loopRow({}, "case-issue")]);
    expect(errReason(await find())).toBe(
      WorkflowSessionCarryReason.WorkspaceUnknown
    );
  });

  it("forks only when the runner can", async () => {
    mocks.findTarget.mockResolvedValue({
      organizationId: ORG,
      capabilities: { loopStepResumeMiss: true },
    });

    const result = await find();

    expect(result.ok && result.value.forks).toBe(false);
  });
});

function item(overrides: Partial<SourceItem> = {}): SourceItem {
  return {
    provider: "microsoft_teams",
    externalId: "e",
    key: "teams-1",
    url: null,
    title: "Thread",
    container: null,
    bodyMarkdown: "the request body",
    itemType: null,
    status: null,
    priority: null,
    labels: [],
    reporter: null,
    assignee: null,
    sections: [],
    comments: [],
    attachments: [],
    ...overrides,
  } as SourceItem;
}

function message(
  id: string,
  createdAt: string,
  extra: { fromBot?: boolean; body?: string } = {}
) {
  return {
    id,
    parentId: null,
    author: `author-${id}`,
    createdAt,
    bodyMarkdown: extra.body ?? `body-${id}`,
    fromBot: extra.fromBot ?? false,
  };
}

const PREVIOUS = { occurredAt: "2026-11-01T10:00:00Z", messageId: "m-prev" };
const CURRENT = {
  occurredAt: "2026-11-02T10:00:00Z",
  messageId: "m-cur",
  text: "new question",
};

function build(overrides: Partial<Parameters<typeof carriedSessionInput>[0]>) {
  return carriedSessionInput({
    instruction: "Answer the question.",
    item: item(),
    previous: PREVIOUS,
    current: CURRENT,
    ownCommentIds: new Set<string>(),
    ...overrides,
  });
}

function fileContent(result: ReturnType<typeof build>): string {
  return result.inputs[0]?.content ?? "";
}

describe("carriedSessionInput", () => {
  it("lists only the messages between the two mentions", () => {
    const result = build({
      item: item({
        thread: [
          message("m-root", "2026-10-31T10:00:00Z"),
          message("m-prev", "2026-11-01T10:00:00Z"),
          message("m-bot", "2026-11-01T10:05:00Z", { fromBot: true }),
          message("m-between", "2026-11-01T12:00:00Z"),
          message("m-cur", "2026-11-02T10:00:00Z"),
          message("m-after", "2026-11-02T11:00:00Z"),
        ],
      }),
    });

    const content = fileContent(result);
    expect(content).toContain("body-m-between");
    for (const excluded of ["m-root", "m-prev", "m-bot", "m-cur", "m-after"]) {
      expect(content).not.toContain(`body-${excluded}`);
    }
    expect(content).toContain("new question");
    expect(content).toContain("BEGIN UNTRUSTED");
  });

  it("falls back to comments without the agent's own", () => {
    const result = build({
      item: item({
        comments: [
          message("c-1", "2026-11-01T12:00:00Z"),
          message("c-own", "2026-11-01T13:00:00Z"),
        ],
      }),
      ownCommentIds: new Set(["c-own"]),
    });

    expect(fileContent(result)).toContain("body-c-1");
    expect(fileContent(result)).not.toContain("body-c-own");
  });

  it("says so when there are no new messages", () => {
    expect(fileContent(build({}))).toContain("No new messages.");
  });

  it("keeps the newest messages within the cap and states the count", () => {
    const big = "x".repeat(CARRIED_DELTA_MAX / 4);
    const thread = Array.from({ length: 6 }, (_, index) =>
      message(`m-${index}`, `2026-11-01T1${index}:00:00Z`, {
        body: `${index}${big}`,
      })
    );

    const content = fileContent(build({ item: item({ thread }) }));

    expect(content).toContain(
      "earlier messages written since your last answer"
    );
    expect(content).toContain(`5${big}`);
    expect(content).not.toContain(`0${big}`);
  });

  it("starts the prompt with the instruction's slash command", () => {
    const { prompt } = build({ instruction: "/ask Answer the question." });

    expect(prompt.startsWith("/ask ")).toBe(true);
    expect(prompt).toContain("Answer the question.");
  });

  it("starts a plain instruction with the preamble", () => {
    expect(build({}).prompt.startsWith("## Untrusted Input Handling")).toBe(
      true
    );
  });

  it("never puts thread text in the prompt and keeps it short", () => {
    const instruction = "/ask Answer.";
    const huge = "y".repeat(CARRIED_DELTA_MAX);
    const result = build({
      instruction,
      item: item({
        thread: [message("m-1", "2026-11-01T12:00:00Z", { body: huge })],
      }),
    });

    expect(result.prompt).not.toContain("yyyy");
    expect(result.prompt.length).toBeLessThan(instruction.length + 3000);
    expect(result.prompt).toContain(CARRIED_MESSAGES_FILE);
  });

  it("names a file the runner accepts", () => {
    expect(build({}).inputs[0]?.name).toMatch(INPUT_NAME_RE);
  });

  it("points at the issue file when the last answer's time is unknown", () => {
    const result = build({ previous: { occurredAt: null, messageId: null } });

    expect(fileContent(result)).toContain("issue file");
  });
});

/** The runner's input file name rule (packages/loops-api loop-step). */
const INPUT_NAME_RE = /^(?!\.{1,2}$)[\w.-]{1,200}$/;
