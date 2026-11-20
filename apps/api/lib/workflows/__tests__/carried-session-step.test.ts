import { LoopStepFinish } from "@agentflow-ai/loops-api/loop-step";
import {
  LoopCommand,
  LoopErrorCode,
  LoopStatus,
} from "@repo/api/src/types/loop";
import {
  type AgentProcessStep,
  ProcessStepType,
  projectProcessSchema,
  RunProcessSource,
} from "@repo/api/src/types/project-process";
import { Result } from "@repo/api/src/types/result";
import {
  WorkflowRunErrorCode,
  WorkflowRunStatus,
  workflowPrdRuleSchema,
} from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import {
  WorkflowSameItem,
  WorkflowSessionCarryAttempt,
  WorkflowSessionCarryReason,
} from "@repo/api/src/types/workflow-same-item";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceItem } from "@/lib/integrations/types";
import {
  settleAgentStep,
  startAgentStep,
} from "@/lib/workflows/engine/agent-step";
import { continueCarriedStep } from "@/lib/workflows/engine/agent-step-resume";
import { runError } from "@/lib/workflows/engine/errors";
import type { RunLoopState } from "@/lib/workflows/engine/run-loops";
import type { EngineRun } from "@/lib/workflows/engine/step-outcome";

/**
 * The first agent step of a run that continues the item's earlier session
 * (agent.sameItem queue_resume): resume, then a copy of the session, then a
 * fresh one. Mocks the launch and the session lookup; the prompt and file
 * builder is the real one.
 */

const mocks = vi.hoisted(() => ({
  launchStepLoop: vi.fn(),
  findCarriedSession: vi.fn(),
  readLoopCarriedSession: vi.fn(),
  readCarriedLoop: vi.fn(),
  listRunLoops: vi.fn(),
  findLatestRunLoop: vi.fn(),
  getLatest: vi.fn(),
  readRunCommentIds: vi.fn(),
  findTarget: vi.fn(),
}));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({ integrationToolSession: { findUnique: () => null } }),
}));
vi.mock("@/lib/workflows/engine/launch-step", () => ({
  launchStepLoop: mocks.launchStepLoop,
}));
vi.mock("@/lib/workflows/engine/carried-session", () => ({
  findCarriedSession: mocks.findCarriedSession,
  readLoopCarriedSession: mocks.readLoopCarriedSession,
  readCarriedLoop: mocks.readCarriedLoop,
  carriedSessionInput: () => ({
    prompt: "/ask short prompt, read new-messages.md",
    inputs: [{ name: "new-messages.md", content: "messages" }],
  }),
}));
vi.mock("@/lib/workflows/engine/run-loops", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/workflows/engine/run-loops")
  >()),
  listRunLoops: mocks.listRunLoops,
  findLatestRunLoop: mocks.findLatestRunLoop,
  isLoopSettled: () => Promise.resolve(true),
}));
vi.mock("@/app/documents/document-version-service", () => ({
  documentVersionService: { getLatest: mocks.getLatest },
}));
vi.mock("@/lib/workflows/engine/run-comments", () => ({
  readRunCommentIds: mocks.readRunCommentIds,
}));
vi.mock("@/app/compute-targets/service", () => ({
  computeTargetsService: { findById: mocks.findTarget },
}));

const ORG = "org-1";
const TARGET = "0199a5f0-0000-7000-8000-0000000000c1";
const FROM_RUN = "run-1";
const FEATURE = "feature-1";
const STEP_ID = "answer";
const WORKSPACE = { slug: "FEA-1", fromRunId: FROM_RUN };

const PROCESS = projectProcessSchema.parse({
  steps: [
    {
      type: ProcessStepType.Agent,
      id: STEP_ID,
      name: "Answer",
      instruction: "/ask Answer the question.",
    },
  ],
});

const STEP = PROCESS.steps[0] as AgentProcessStep;

function engineRun(sameItem?: WorkflowSameItem): EngineRun {
  return {
    id: "run-2",
    organizationId: ORG,
    cycle: 1,
    stepId: STEP_ID,
    agentConfig: {
      mode: WorkflowAgentMode.PlanAndExecute,
      stopOnOpenQuestions: true,
      computeTargetId: TARGET,
      runners: [],
      repository: null,
      prd: workflowPrdRuleSchema.parse({}),
      instructions: "",
      titleTemplate: "{{source.key}}",
      process: null,
      ...(sameItem ? { sameItem } : {}),
    },
    source: {
      item: {
        provider: "p",
        externalId: "e",
        key: "K-1",
        url: null,
        title: "T",
        container: null,
      },
      occurredAt: "2026-11-02T10:00:00Z",
      message: { id: "m-cur", text: "new question" },
    },
    process: {
      version: 1,
      source: RunProcessSource.Project,
      definition: PROCESS,
    },
    featureDocumentId: FEATURE,
    planDocumentId: null,
    phaseStartedAt: new Date("2026-11-02T10:00:00Z"),
    stepAttempts: 0,
    stepState: null,
    runAsUserId: "user-1",
  } as unknown as EngineRun;
}

const ITEM = {
  provider: "p",
  externalId: "e",
  key: "K-1",
  url: null,
  title: "T",
  container: null,
  bodyMarkdown: "body",
  itemType: null,
  status: null,
  priority: null,
  labels: [],
  reporter: null,
  assignee: null,
  sections: [],
  comments: [],
  attachments: [],
} as SourceItem;

function startInput(run: EngineRun) {
  return {
    run,
    agent: run.agentConfig as never,
    runProcess: { process: PROCESS, snapshot: true },
    step: STEP,
    projectId: "project-1",
    runAsUser: { id: "user-1", clerkId: "clerk-1" },
    documents: { featureDocumentId: FEATURE, planDocumentId: null },
    events: [],
    data: undefined,
    item: ITEM,
  };
}

function carriedSession(overrides: Record<string, unknown> = {}) {
  return {
    fromRunId: FROM_RUN,
    loop: {
      loopId: "loop-prev",
      computeTargetId: TARGET,
      sessionId: "session-prev",
    },
    workspace: WORKSPACE,
    depth: 1,
    forks: true,
    previousSource: { occurredAt: "2026-11-01T10:00:00Z", message: null },
    ...overrides,
  };
}

function launchedInput(call = 0): Record<string, unknown> {
  return mocks.launchStepLoop.mock.calls[call]?.[0] ?? {};
}

function launchedStep(call = 0): Record<string, unknown> {
  return launchedInput(call).step as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.launchStepLoop.mockResolvedValue(
    Result.ok({ loopId: "loop-new", computeTargetId: TARGET })
  );
  mocks.findLatestRunLoop.mockResolvedValue(null);
  mocks.listRunLoops.mockResolvedValue([]);
  mocks.getLatest.mockResolvedValue({ content: "issue body" });
  mocks.readRunCommentIds.mockResolvedValue(new Set<string>());
  mocks.readLoopCarriedSession.mockResolvedValue(null);
  mocks.findTarget.mockResolvedValue({
    organizationId: ORG,
    capabilities: { loopStepForkSession: true, loopStepResumeMiss: true },
  });
});

describe("first step of a run with queue_resume", () => {
  it("resumes the earlier session with the short prompt and the messages file", async () => {
    mocks.findCarriedSession.mockResolvedValue(Result.ok(carriedSession()));

    const outcome = await startAgentStep(
      startInput(engineRun(WorkflowSameItem.QueueResume))
    );

    expect(outcome).toMatchObject({
      kind: "transition",
      status: WorkflowRunStatus.Running,
    });
    const input = launchedInput();
    expect(input).toMatchObject({
      resumeLoopId: "loop-prev",
      computeTargetId: TARGET,
      workspace: WORKSPACE,
      carried: {
        fromRunId: FROM_RUN,
        attempt: WorkflowSessionCarryAttempt.Resume,
        depth: 1,
        reason: null,
      },
    });
    const step = launchedStep();
    expect(step.forkSession).toBeUndefined();
    expect(step).toMatchObject({ fresh: true, reportResumeMiss: true });
    expect(step.inputs).toEqual([
      expect.objectContaining({ name: "new-messages.md" }),
    ]);
    expect(String(input.prompt).startsWith("/ask ")).toBe(true);
    expect(String(input.prompt)).toContain("new-messages.md");
  });

  it("starts fresh with the reason when no session can be continued", async () => {
    mocks.findCarriedSession.mockResolvedValue(
      Result.err({
        reason: WorkflowSessionCarryReason.RunnerUnavailable,
        fromRunId: FROM_RUN,
      })
    );

    await startAgentStep(startInput(engineRun(WorkflowSameItem.QueueResume)));

    expect(mocks.launchStepLoop).toHaveBeenCalledTimes(1);
    expect(launchedInput()).toMatchObject({
      computeTargetId: null,
      workspace: null,
      carried: {
        fromRunId: FROM_RUN,
        attempt: WorkflowSessionCarryAttempt.Fresh,
        reason: WorkflowSessionCarryReason.RunnerUnavailable,
      },
    });
    expect(launchedInput().resumeLoopId).toBeUndefined();
    expect(String(launchedInput().prompt)).toContain("/ask Answer");
    expect(launchedStep().reportResumeMiss).toBeUndefined();
  });

  it.each([
    undefined,
    WorkflowSameItem.Ignore,
  ])("launches exactly today's input with sameItem %s", async (sameItem) => {
    await startAgentStep(startInput(engineRun(sameItem)));

    expect(mocks.findCarriedSession).not.toHaveBeenCalled();
    const input = launchedInput();
    for (const key of ["carried", "workspace", "resumeLoopId"]) {
      expect(input[key]).toBeUndefined();
    }
    const step = launchedStep();
    expect(step.inputs).toBeUndefined();
    expect(step.reportResumeMiss).toBeUndefined();
    expect(input.computeTargetId).toBeNull();
  });

  it("waits for a busy runner", async () => {
    mocks.findCarriedSession.mockResolvedValue(Result.ok(carriedSession()));
    mocks.launchStepLoop.mockResolvedValue(
      Result.err(runError(WorkflowRunErrorCode.RunnerBusy, "busy"))
    );

    const outcome = await startAgentStep(
      startInput(engineRun(WorkflowSameItem.QueueResume))
    );

    expect(outcome.kind).toBe("retry");
    expect(mocks.launchStepLoop).toHaveBeenCalledTimes(1);
  });

  it.each([
    WorkflowRunErrorCode.ComputeTargetUnavailable,
    WorkflowRunErrorCode.DispatchFailed,
    WorkflowRunErrorCode.AgentNotInProject,
    WorkflowRunErrorCode.SigningRequired,
    WorkflowRunErrorCode.PlanStateUnavailable,
  ])("starts fresh when the carried launch fails with %s", async (code) => {
    mocks.findCarriedSession.mockResolvedValue(Result.ok(carriedSession()));
    mocks.launchStepLoop
      .mockResolvedValueOnce(Result.err(runError(code, "no")))
      .mockResolvedValueOnce(
        Result.ok({ loopId: "loop-fresh", computeTargetId: TARGET })
      );

    const outcome = await startAgentStep(
      startInput(engineRun(WorkflowSameItem.QueueResume))
    );

    expect(outcome.kind).toBe("transition");
    expect(mocks.launchStepLoop).toHaveBeenCalledTimes(2);
    expect(launchedInput(1)).toMatchObject({
      computeTargetId: null,
      carried: {
        attempt: WorkflowSessionCarryAttempt.Fresh,
        reason: WorkflowSessionCarryReason.CarriedLaunchFailed,
      },
    });
  });

  it.each([
    WorkflowRunErrorCode.ConcurrencyLimit,
    WorkflowRunErrorCode.RepositoryNotAllowed,
    WorkflowRunErrorCode.DocumentBlocked,
    WorkflowRunErrorCode.NoRepository,
  ])("fails the run when the carried launch fails with %s", async (code) => {
    mocks.findCarriedSession.mockResolvedValue(Result.ok(carriedSession()));
    mocks.launchStepLoop.mockResolvedValue(Result.err(runError(code, "no")));

    const outcome = await startAgentStep(
      startInput(engineRun(WorkflowSameItem.QueueResume))
    );

    expect(outcome).toMatchObject({
      kind: "transition",
      status: WorkflowRunStatus.Failed,
    });
    expect(mocks.launchStepLoop).toHaveBeenCalledTimes(1);
  });

  it("starts fresh on re-entry after an attempt that left a loop without a session", async () => {
    mocks.listRunLoops.mockResolvedValue([
      { loopId: "loop-dispatch-failed", sessionId: null },
    ]);
    mocks.readLoopCarriedSession.mockResolvedValue({
      fromRunId: FROM_RUN,
      attempt: WorkflowSessionCarryAttempt.Resume,
      depth: 1,
      reason: null,
    });

    await startAgentStep(startInput(engineRun(WorkflowSameItem.QueueResume)));

    expect(mocks.findCarriedSession).not.toHaveBeenCalled();
    expect(launchedInput()).toMatchObject({
      carried: {
        attempt: WorkflowSessionCarryAttempt.Fresh,
        reason: WorkflowSessionCarryReason.CarriedLaunchFailed,
      },
    });
  });
});

function failedLoop(code: string, sessionId: string | null = "session-x") {
  return {
    loopId: "loop-attempt",
    command: LoopCommand.Step,
    stepId: STEP_ID,
    status: LoopStatus.Failed,
    computeTargetId: TARGET,
    sessionId,
    error: { code, message: "failed" },
    completedAt: new Date(),
    revivalCount: 0,
    uploadedArtifacts: null,
    createdAt: new Date(),
  } as unknown as RunLoopState;
}

function attempt(kind: WorkflowSessionCarryAttempt) {
  return {
    fromRunId: FROM_RUN,
    attempt: kind,
    depth: 1,
    reason: null,
  };
}

describe("settling a failed first step", () => {
  beforeEach(() => {
    mocks.findLatestRunLoop.mockResolvedValue(
      failedLoop(LoopErrorCode.ResumeSessionNotFound)
    );
  });

  it.each([
    LoopErrorCode.ResumeSessionNotFound,
    LoopErrorCode.LaunchFailed,
  ])("follows a resumed attempt that failed with %s", async (code) => {
    mocks.findLatestRunLoop.mockResolvedValue(failedLoop(code));
    mocks.readLoopCarriedSession.mockResolvedValue(
      attempt(WorkflowSessionCarryAttempt.Resume)
    );

    const settled = await settleAgentStep(
      engineRun(WorkflowSameItem.QueueResume),
      new Date()
    );

    expect(settled.kind).toBe("carryFallback");
  });

  it.each([
    LoopErrorCode.ProcessFailed,
    LoopErrorCode.BranchCreateFailed,
    LoopErrorCode.AuthChallenge,
  ])("leaves %s to the normal failure path", async (code) => {
    mocks.findLatestRunLoop.mockResolvedValue(failedLoop(code));
    mocks.readLoopCarriedSession.mockResolvedValue(
      attempt(WorkflowSessionCarryAttempt.Resume)
    );

    const settled = await settleAgentStep(
      engineRun(WorkflowSameItem.QueueResume),
      new Date()
    );

    expect(settled).toMatchObject({
      kind: "outcome",
      outcome: { status: WorkflowRunStatus.Failed },
    });
  });

  it("fails a failed fresh fallback the normal way", async () => {
    mocks.readLoopCarriedSession.mockResolvedValue(
      attempt(WorkflowSessionCarryAttempt.Fresh)
    );

    const settled = await settleAgentStep(
      engineRun(WorkflowSameItem.QueueResume),
      new Date()
    );

    expect(settled.kind).toBe("outcome");
  });

  it("runs no metadata query without the setting", async () => {
    const settled = await settleAgentStep(engineRun(), new Date());

    expect(settled.kind).toBe("outcome");
    expect(mocks.readLoopCarriedSession).not.toHaveBeenCalled();
  });
});

function fallback(
  code: string,
  kind: WorkflowSessionCarryAttempt
): Parameters<typeof continueCarriedStep>[2] {
  return {
    kind: "carryFallback",
    step: STEP,
    loop: failedLoop(code),
    carried: attempt(kind),
  };
}

const CONTEXT = {
  agent: {} as never,
  projectId: "project-1",
  runAsUser: { id: "user-1", clerkId: "clerk-1" },
};

function failedAttempt(overrides: Record<string, unknown> = {}) {
  return {
    carried: attempt(WorkflowSessionCarryAttempt.Resume),
    workspace: WORKSPACE,
    parentLoopId: "loop-prev",
    prompt: "/ask short prompt",
    step: {
      runId: "run-2",
      stepId: STEP_ID,
      name: "Answer",
      fresh: true,
      askQuestions: false,
      artifacts: [],
      finish: LoopStepFinish.None,
      toolkit: null,
      inputs: [{ name: "new-messages.md", content: "x" }],
      reportResumeMiss: true,
    },
    ...overrides,
  };
}

describe("the request a fresh first launch answers", () => {
  const INSTRUCTION = "/ask Answer the question.";

  it("names the request after the instruction under queue", async () => {
    await startAgentStep(startInput(engineRun(WorkflowSameItem.Queue)));

    const prompt = String(launchedInput().prompt);
    expect(prompt.startsWith(INSTRUCTION)).toBe(true);
    const rest = prompt.slice(INSTRUCTION.length);
    expect(rest).toContain("exactly one request");
    expect(rest).toContain("new question");
    expect(launchedStep().inputs).toBeUndefined();
  });

  it("names the request on the fresh fallback after a resume miss", async () => {
    mocks.findCarriedSession.mockResolvedValue(
      Result.err({
        reason: WorkflowSessionCarryReason.RunnerUnavailable,
        fromRunId: FROM_RUN,
      })
    );

    await startAgentStep(startInput(engineRun(WorkflowSameItem.QueueResume)));

    const prompt = String(launchedInput().prompt);
    expect(prompt.startsWith(INSTRUCTION)).toBe(true);
    expect(prompt).toContain("new question");
  });

  it("names the request when the session is missing on the runner", async () => {
    mocks.readCarriedLoop.mockResolvedValue(null);
    mocks.findTarget.mockResolvedValue({
      organizationId: ORG,
      capabilities: { loopStepResumeMiss: true },
    });

    await continueCarriedStep(
      engineRun(WorkflowSameItem.QueueResume),
      CONTEXT,
      fallback(
        LoopErrorCode.ResumeSessionNotFound,
        WorkflowSessionCarryAttempt.Resume
      )
    );

    expect(String(launchedInput().prompt)).toContain("new question");
  });

  it("puts a long request in inputs/request.md", async () => {
    const run = engineRun(WorkflowSameItem.Queue);
    (run.source as { message: { text: string } }).message.text = "q".repeat(
      5000
    );

    await startAgentStep(startInput(run));

    const prompt = String(launchedInput().prompt);
    expect(prompt.startsWith(INSTRUCTION)).toBe(true);
    expect(prompt).toContain("request.md");
    expect(prompt).not.toContain("qqqq");
    expect(launchedStep().inputs).toEqual([
      expect.objectContaining({ name: "request.md" }),
    ]);
  });

  it("adds nothing when the source has no message", async () => {
    const run = engineRun(WorkflowSameItem.Queue);
    (run.source as { message: unknown }).message = null;

    await startAgentStep(startInput(run));

    expect(String(launchedInput().prompt)).toBe(INSTRUCTION);
  });

  it("adds nothing without sameItem", async () => {
    await startAgentStep(startInput(engineRun()));

    expect(String(launchedInput().prompt)).toBe(INSTRUCTION);
  });
});

describe("the next attempt after a missing session", () => {
  beforeEach(() => {
    mocks.readCarriedLoop.mockResolvedValue(failedAttempt());
  });

  it("forks the same session on the same runner and folder", async () => {
    const outcome = await continueCarriedStep(
      engineRun(WorkflowSameItem.QueueResume),
      CONTEXT,
      fallback(
        LoopErrorCode.ResumeSessionNotFound,
        WorkflowSessionCarryAttempt.Resume
      )
    );

    expect(outcome.kind).toBe("transition");
    expect(launchedInput()).toMatchObject({
      resumeLoopId: "loop-prev",
      computeTargetId: TARGET,
      workspace: WORKSPACE,
      prompt: "/ask short prompt",
      carried: {
        attempt: WorkflowSessionCarryAttempt.Fork,
        reason: WorkflowSessionCarryReason.ResumeSessionNotFound,
      },
    });
    expect(launchedStep()).toMatchObject({
      forkSession: true,
      reportResumeMiss: true,
    });
    expect(launchedStep().inputs).toHaveLength(1);
  });

  it("starts fresh at once when the runner cannot fork", async () => {
    mocks.findTarget.mockResolvedValue({
      organizationId: ORG,
      capabilities: { loopStepResumeMiss: true },
    });

    await continueCarriedStep(
      engineRun(WorkflowSameItem.QueueResume),
      CONTEXT,
      fallback(
        LoopErrorCode.ResumeSessionNotFound,
        WorkflowSessionCarryAttempt.Resume
      )
    );

    expect(mocks.launchStepLoop).toHaveBeenCalledTimes(1);
    expect(launchedInput()).toMatchObject({
      computeTargetId: null,
      workspace: null,
      carried: {
        attempt: WorkflowSessionCarryAttempt.Fresh,
        reason: WorkflowSessionCarryReason.ResumeSessionNotFound,
      },
    });
    expect(launchedStep().forkSession).toBeUndefined();
  });

  it("starts fresh after a fork that did not find the session", async () => {
    await continueCarriedStep(
      engineRun(WorkflowSameItem.QueueResume),
      CONTEXT,
      fallback(
        LoopErrorCode.ResumeSessionNotFound,
        WorkflowSessionCarryAttempt.Fork
      )
    );

    expect(mocks.launchStepLoop).toHaveBeenCalledTimes(1);
    expect(launchedInput()).toMatchObject({
      carried: {
        attempt: WorkflowSessionCarryAttempt.Fresh,
        reason: WorkflowSessionCarryReason.ForkSessionNotFound,
      },
    });
  });

  it("goes straight to a fresh session when the resume loop never started", async () => {
    await continueCarriedStep(
      engineRun(WorkflowSameItem.QueueResume),
      CONTEXT,
      fallback(LoopErrorCode.LaunchFailed, WorkflowSessionCarryAttempt.Resume)
    );

    expect(mocks.launchStepLoop).toHaveBeenCalledTimes(1);
    expect(launchedInput()).toMatchObject({
      carried: {
        attempt: WorkflowSessionCarryAttempt.Fresh,
        reason: WorkflowSessionCarryReason.CarriedLaunchFailed,
      },
    });
  });

  it("starts fresh when the fork cannot be launched", async () => {
    mocks.launchStepLoop
      .mockResolvedValueOnce(
        Result.err(
          runError(WorkflowRunErrorCode.ComputeTargetUnavailable, "offline")
        )
      )
      .mockResolvedValueOnce(
        Result.ok({ loopId: "loop-fresh", computeTargetId: TARGET })
      );

    const outcome = await continueCarriedStep(
      engineRun(WorkflowSameItem.QueueResume),
      CONTEXT,
      fallback(
        LoopErrorCode.ResumeSessionNotFound,
        WorkflowSessionCarryAttempt.Resume
      )
    );

    expect(outcome.kind).toBe("transition");
    expect(launchedInput(1)).toMatchObject({
      carried: { attempt: WorkflowSessionCarryAttempt.Fresh },
    });
  });

  it("does not launch twice after a crash between the launch and the status write", async () => {
    mocks.findLatestRunLoop.mockResolvedValue({ loopId: "loop-next" });

    const outcome = await continueCarriedStep(
      engineRun(WorkflowSameItem.QueueResume),
      CONTEXT,
      fallback(
        LoopErrorCode.ResumeSessionNotFound,
        WorkflowSessionCarryAttempt.Resume
      )
    );

    expect(outcome.kind).toBe("transition");
    expect(mocks.launchStepLoop).not.toHaveBeenCalled();
  });
});
