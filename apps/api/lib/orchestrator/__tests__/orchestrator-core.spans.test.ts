import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import {
  installInMemorySpans,
  TestSpanStatus,
} from "@repo/observability/testing/in-memory-spans";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BASE,
  IDS,
  resetTaskMocks,
} from "@/lib/orchestrator/__tests__/support/tasks.test-fake";
import { advanceConversation } from "@/lib/orchestrator/advance";
import { startTask } from "@/lib/orchestrator/tasks";

/** Domain spans of the orchestrator core: advance and tasks. */

const advanceFake = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/lib/loops/loop-desktop", () => ({
  dispatchOrchestratorTurn: vi.fn(),
  dispatchOrchestratorTurnCancel: vi.fn(),
}));
vi.mock("@/app/projects/project-runner-selection", () => ({
  loadProjectRunnerIds: () => Promise.resolve([]),
}));
vi.mock("@/lib/desktop-command-store", () => ({
  desktopCommandStore: {},
}));
vi.mock("@repo/database", async () => {
  const base = (
    await import("@/lib/orchestrator/__tests__/support/tasks.test-fake")
  ).databaseModule();
  return {
    withDb: (fn: (client: unknown) => unknown) =>
      advanceFake.db ? fn(advanceFake.db) : base.withDb(fn),
  };
});
vi.mock("@/app/compute-targets/capabilities-service", async () =>
  (
    await import("@/lib/orchestrator/__tests__/support/tasks.test-fake")
  ).capabilitiesModule()
);
vi.mock("@/lib/loops/loop-state", async () =>
  (
    await import("@/lib/orchestrator/__tests__/support/tasks.test-fake")
  ).loopStateModule()
);
vi.mock("@/app/documents/document-service", async () =>
  (
    await import("@/lib/orchestrator/__tests__/support/tasks.test-fake")
  ).documentServiceModule()
);
vi.mock("@/app/loops/service", async () =>
  (
    await import("@/lib/orchestrator/__tests__/support/tasks.test-fake")
  ).loopsServiceModule()
);
vi.mock("@/app/projects/project-repository-checkouts", async () =>
  (
    await import("@/lib/orchestrator/__tests__/support/tasks.test-fake")
  ).checkoutsModule()
);
vi.mock("@/lib/loops/launch-harness", async () =>
  (
    await import("@/lib/orchestrator/__tests__/support/tasks.test-fake")
  ).launchHarnessModule()
);
vi.mock("@/lib/loops/loop-dispatch-utils", async () =>
  (
    await import("@/lib/orchestrator/__tests__/support/tasks.test-fake")
  ).dispatchUtilsModule()
);
vi.mock("@/lib/workflows/engine/launch", async () =>
  (
    await import("@/lib/orchestrator/__tests__/support/tasks.test-fake")
  ).engineLaunchModule()
);
vi.mock("@/lib/workflows/engine/personal-runner-queue", async () =>
  (
    await import("@/lib/orchestrator/__tests__/support/tasks.test-fake")
  ).personalRunnerQueueModule()
);
vi.mock("@/lib/workflows/engine/run-loops", async () =>
  (
    await import("@/lib/orchestrator/__tests__/support/tasks.test-fake")
  ).runLoopsModule()
);
vi.mock("@/lib/orchestrator/case-render", async () =>
  (
    await import("@/lib/orchestrator/__tests__/support/tasks.test-fake")
  ).caseRenderModule()
);

const recorder = installInMemorySpans();

afterAll(() => recorder.uninstall());

beforeEach(() => {
  resetTaskMocks();
  recorder.reset();
  advanceFake.db = null;
});

const CONVERSATION_ID = "conv-1";

function spanNamed(name: string) {
  return recorder.spans().find((span) => span.name === name);
}

describe("orchestrator.advance_conversation", () => {
  it("records the error and still releases the lease when step fails", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    advanceFake.db = {
      orchestratorConversation: { updateMany },
      orchestratorTurn: {
        findFirst: vi.fn().mockRejectedValue(new Error("db exploded")),
      },
    };

    await advanceConversation(CONVERSATION_ID);

    const span = spanNamed("orchestrator.advance_conversation");
    expect(span?.attributes[AfAttribute.ConversationId]).toBe(CONVERSATION_ID);
    expect(span?.attributes[AfAttribute.Outcome]).toBe(AfOutcome.Error);
    expect(span?.status.code).toBe(TestSpanStatus.Error);
    expect(span?.status.message).toContain("db exploded");
    expect(updateMany).toHaveBeenCalledTimes(2);
  });

  it("marks a lease miss as skipped", async () => {
    advanceFake.db = {
      orchestratorConversation: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    };

    await advanceConversation(CONVERSATION_ID);

    expect(
      spanNamed("orchestrator.advance_conversation")?.attributes[
        AfAttribute.Outcome
      ]
    ).toBe(AfOutcome.Skipped);
  });
});

describe("orchestrator.start_task", () => {
  it("carries the case ids when the task starts", async () => {
    const started = await startTask({
      ...BASE,
      runner: "runner-1",
      command: "/ba-requirement",
    });

    expect(started.ok).toBe(true);
    const span = spanNamed("orchestrator.start_task");
    expect(span?.attributes[AfAttribute.OrgId]).toBe(IDS.org);
    expect(span?.attributes[AfAttribute.CaseId]).toBe(IDS.case);
    expect(span?.attributes[AfAttribute.TurnId]).toBe(IDS.turn);
    expect(span?.attributes[AfAttribute.Outcome]).toBeUndefined();
  });

  it("marks a refused task as an error with the reason", async () => {
    const started = await startTask({
      ...BASE,
      runner: "no-such-runner",
      command: "/ba-requirement",
    });

    expect(started.ok).toBe(false);
    const span = spanNamed("orchestrator.start_task");
    expect(span?.attributes[AfAttribute.Outcome]).toBe(AfOutcome.Error);
    expect(span?.status.code).toBe(TestSpanStatus.Error);
  });
});
