import { OrchestratorTaskStatus } from "@repo/api/src/types/orchestrator";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BASE,
  IDS,
  taskMocks as mocks,
  resetTaskMocks,
} from "@/lib/orchestrator/__tests__/support/tasks.test-fake";
import { startTask } from "@/lib/orchestrator/tasks";

/**
 * Case Agent affinity for orchestrator tasks: queued tasks count, and a resumed task keeps its
 * own Agent.
 */

vi.mock("@repo/database", async () =>
  (
    await import("@/lib/orchestrator/__tests__/support/tasks.test-fake")
  ).databaseModule()
);
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

vi.mock("@/lib/orchestrator/task-asked", () => ({
  recordAskedQuestions: vi.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  resetTaskMocks();
});

describe("startTask case affinity", () => {
  it("keeps a role's second task on the Agent whose first task is still queued", async () => {
    mocks.baRole = "Dev";
    mocks.tasks.push({
      id: "task-0",
      organizationId: IDS.org,
      caseId: IDS.case,
      computeTargetId: IDS.dev,
      loopId: null,
      status: OrchestratorTaskStatus.Queued,
      createdAt: new Date(2026, 9, 23, 8, 0, 0),
    });
    const started = await startTask({
      ...BASE,
      runner: "Dev",
      command: "/executing-plans",
    });

    expect(started.ok && started.value.runner).toBe("an-PRO-1");
  });

  it("lets a resumed task use its own Agent over the case's latest one", async () => {
    mocks.baRole = "Dev";
    mocks.tasks.push(
      {
        id: "task-0",
        organizationId: IDS.org,
        caseId: IDS.case,
        computeTargetId: IDS.ba,
        loopId: "loop-0",
        status: OrchestratorTaskStatus.Succeeded,
        createdAt: new Date(2026, 9, 23, 8, 0, 0),
      },
      {
        id: "task-1",
        organizationId: IDS.org,
        caseId: IDS.case,
        computeTargetId: IDS.dev,
        loopId: "loop-1",
        status: OrchestratorTaskStatus.Succeeded,
        createdAt: new Date(2026, 9, 23, 8, 5, 0),
      }
    );
    const started = await startTask({
      ...BASE,
      runner: IDS.ba,
      command: "/ba-requirement",
      resumeTaskId: "task-0",
    });

    expect(started.ok && started.value.runner).toBe("runner-1");
  });

  it("keeps a task queued when its Agent is offline and the case has another queued task there", async () => {
    mocks.tasks.push({
      id: "task-0",
      organizationId: IDS.org,
      caseId: IDS.case,
      computeTargetId: IDS.ba,
      loopId: null,
      status: OrchestratorTaskStatus.Queued,
      createdAt: new Date(2026, 9, 23, 8, 0, 0),
    });
    mocks.online = false;
    const started = await startTask({
      ...BASE,
      runner: "runner-1",
      command: "/ba-requirement",
    });

    expect(started.ok && started.value.status).toBe(
      OrchestratorTaskStatus.Queued
    );
    expect(started.ok && started.value.waiting).toContain("offline");
  });
});
