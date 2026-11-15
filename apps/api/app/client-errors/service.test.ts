import {
  ClientErrorKind,
  ClientErrorLevel,
  type ClientErrorRecord,
  clientErrorReportSchema,
} from "@repo/api/src/types/client-errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { logError, logWarn } = vi.hoisted(() => ({
  logError: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@repo/observability/log", () => ({
  log: { error: logError, warn: logWarn, info: vi.fn(), debug: vi.fn() },
}));

import { clientErrorService } from "./service";

function makeRecord(overrides: Partial<ClientErrorRecord> = {}) {
  return {
    kind: ClientErrorKind.Log,
    level: ClientErrorLevel.Error,
    message: "boom",
    path: "/projects",
    ...overrides,
  } satisfies ClientErrorRecord;
}

describe("clientErrorService.record", () => {
  beforeEach(() => {
    logError.mockClear();
    logWarn.mockClear();
  });

  it("logs a valid report at its level with the user id", () => {
    const result = clientErrorService.record(
      { userId: "user-a", organizationId: "org-1" },
      {
        records: [
          makeRecord({ attributes: { route: "x" } }),
          makeRecord({ level: ClientErrorLevel.Warn, message: "careful" }),
        ],
      }
    );

    expect(result).toEqual({ limited: false });
    expect(logError).toHaveBeenCalledWith(
      "client.error",
      expect.objectContaining({
        message: "boom",
        userId: "user-a",
        organizationId: "org-1",
        "client.route": "x",
      })
    );
    expect(logWarn).toHaveBeenCalledWith(
      "client.error",
      expect.objectContaining({ message: "careful", userId: "user-a" })
    );
  });

  it("drops records over 30 per minute and reports limited when all are dropped", () => {
    const auth = { userId: "user-b", organizationId: "org-1" };
    const batch = { records: Array.from({ length: 20 }, () => makeRecord()) };

    clientErrorService.record(auth, batch);
    const second = clientErrorService.record(auth, batch);

    expect(second).toEqual({ limited: false });
    expect(logError).toHaveBeenCalledTimes(30);

    const third = clientErrorService.record(auth, batch);
    expect(third).toEqual({ limited: true });
    expect(logError).toHaveBeenCalledTimes(30);
  });
});

describe("clientErrorReportSchema", () => {
  it("rejects 21 records", () => {
    const parsed = clientErrorReportSchema.safeParse({
      records: Array.from({ length: 21 }, () => makeRecord()),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a 2 KiB message", () => {
    const parsed = clientErrorReportSchema.safeParse({
      records: [makeRecord({ message: "x".repeat(2048) })],
    });
    expect(parsed.success).toBe(false);
  });
});
