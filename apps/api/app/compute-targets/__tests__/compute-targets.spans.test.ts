import { log } from "@repo/observability/log";
import { installInMemorySpans } from "@repo/observability/testing/in-memory-spans";
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  updatedCount: 1,
  conflictingGateway: null as { id: string } | null,
}));

vi.mock("@repo/database", () => {
  const db = {
    computeTarget: {
      updateMany: vi.fn(() => Promise.resolve({ count: mocks.updatedCount })),
      findFirst: vi.fn(() => Promise.resolve(mocks.conflictingGateway)),
    },
  };
  const withDb = Object.assign(
    (fn: (client: typeof db) => unknown) => Promise.resolve(fn(db)),
    {
      tx: (fn: (client: typeof db) => unknown) => Promise.resolve(fn(db)),
    }
  );
  return { withDb };
});

import { computeTargetsService } from "@/app/compute-targets/service";

const ERROR_STATUS_CODE = 2;
const ORG_ID = "org-1";
const USER_ID = "user-1";
const TARGET_ID = "target-1";

describe("compute target spans", () => {
  const memory = installInMemorySpans();
  let warn: MockInstance;

  beforeEach(() => {
    memory.reset();
    mocks.updatedCount = 1;
    mocks.conflictingGateway = null;
    vi.restoreAllMocks();
    warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
  });
  afterAll(() => {
    memory.uninstall();
  });

  it("records the online flag and logs when a target goes offline", async () => {
    const changed = await computeTargetsService.setOnlineState(
      TARGET_ID,
      ORG_ID,
      USER_ID,
      false
    );

    expect(changed).toBe(true);
    const span = memory
      .spans()
      .find((s) => s.name === "compute_target.set_online");
    expect(span?.attributes["af.compute_target.online"]).toBe(false);
    expect(span?.attributes["af.compute_target_id"]).toBe(TARGET_ID);
    expect(warn).toHaveBeenCalledWith(
      "compute_target.offline",
      expect.objectContaining({ computeTargetId: TARGET_ID })
    );
  });

  it("does not log offline when going online", async () => {
    await computeTargetsService.setOnlineState(
      TARGET_ID,
      ORG_ID,
      USER_ID,
      true
    );

    expect(warn).not.toHaveBeenCalled();
  });

  it("marks register as an error when it returns a failure result", async () => {
    mocks.conflictingGateway = { id: "other" };

    const result = await computeTargetsService.register(ORG_ID, USER_ID, {
      machineName: "m",
      platform: "darwin",
      gatewayId: "gw-1",
      supportedOperations: [],
    } as never);

    expect(result.ok).toBe(false);
    const span = memory
      .spans()
      .find((s) => s.name === "compute_target.register");
    expect(span?.status.code).toBe(ERROR_STATUS_CODE);
    expect(span?.attributes["af.outcome"]).toBe("error");
  });
});
