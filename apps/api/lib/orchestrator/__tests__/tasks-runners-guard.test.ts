import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BASE,
  IDS,
  taskMocks as mocks,
  resetTaskMocks,
} from "@/lib/orchestrator/__tests__/support/tasks.test-fake";
import { startTask } from "@/lib/orchestrator/tasks";

/**
 * The runners_list guard on startTask (docs/orchestrator.md): a task starts
 * only after the conversation read the runners it targets, unchanged.
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

vi.mock("@/lib/orchestrator/needs-person-mail", () => ({
  mailTaskQuestions: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/orchestrator/task-asked", () => ({
  recordAskedQuestions: vi.fn(() => Promise.resolve()),
}));

describe("runners_list guard", () => {
  const run = () =>
    startTask({ ...BASE, runner: "runner-1", command: "/ba-requirement" });

  beforeEach(() => {
    resetTaskMocks();
  });

  it("refuses before the conversation called runners_list", async () => {
    mocks.runnersRead = null;
    const result = await run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("runners_list");
    }
    expect(mocks.tasks).toHaveLength(0);
    expect(mocks.createLoop).not.toHaveBeenCalled();
  });

  it("starts after runners_list", async () => {
    const result = await run();
    expect(result.ok).toBe(true);
  });

  it("refuses when the runner's AGENTFLOW.md changed since runners_list", async () => {
    mocks.baHash = "hash-ba-2";
    const result = await run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("changed");
    }
    expect(mocks.tasks).toHaveLength(0);
  });

  it("refuses a runner the last runners_list did not return", async () => {
    mocks.runnersRead = { [IDS.dev]: "hash-dev" };
    const result = await run();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("was not in your last");
    }
    expect(mocks.tasks).toHaveLength(0);
  });
});
