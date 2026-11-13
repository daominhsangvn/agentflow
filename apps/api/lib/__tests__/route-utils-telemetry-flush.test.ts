import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript6";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// route-utils flush scheduling.
//
// Per-request flushing was removed: spans and logs are exported by the batch
// processors. `scheduleLogFlush` is a no-op and `scheduleLogFlushAfter` only
// hands the promise to `waitUntil`.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  waitUntil: vi.fn(),
  after: vi.fn(),
  flushTelemetry: vi.fn(() => Promise.resolve()),
  isTelemetryActive: vi.fn(() => true),
}));

vi.mock("@/lib/wait-until", () => ({ waitUntil: mocks.waitUntil }));

vi.mock("next/server", () => ({
  after: mocks.after,
  NextResponse: { json: vi.fn() },
}));

vi.mock("@repo/observability/tracing/hooks", () => ({
  flushTelemetry: mocks.flushTelemetry,
  isTelemetryActive: mocks.isTelemetryActive,
}));

vi.mock("@repo/observability/log", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    flush: vi.fn(() => Promise.resolve()),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.resetModules();
});

describe("scheduleLogFlush", () => {
  it("is a no-op even when tracing is active", async () => {
    const { scheduleLogFlush } = await import("../route-utils");

    scheduleLogFlush();

    expect(mocks.waitUntil).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.flushTelemetry).not.toHaveBeenCalled();
  });
});

describe("scheduleLogFlushAfter", () => {
  it("hands the deferred promise to waitUntil without flushing", async () => {
    const { scheduleLogFlushAfter } = await import("../route-utils");
    const pending = Promise.resolve();

    scheduleLogFlushAfter(pending);

    expect(mocks.waitUntil).toHaveBeenCalledTimes(1);
    expect(mocks.waitUntil).toHaveBeenCalledWith(pending);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.flushTelemetry).not.toHaveBeenCalled();
  });
});

/**
 * ISS-4659: `route-utils.ts` is imported by ~40 route modules. If it reached
 * the OpenTelemetry Node SDK through a static import, the first route that ever
 * opts into the edge runtime would fail to build — the same evaluation-order
 * trap `apps/api/instrumentation.ts` guards against.
 *
 * The flush therefore goes through `@repo/observability/tracing/hooks`, which
 * has no OTel import; only `tracing/provider` touches the SDK. Checked over the
 * real AST so a reformat cannot make it pass vacuously.
 */
describe("route-utils.ts — SDK reachability", () => {
  it("never imports the OTel provider", () => {
    const filePath = join(import.meta.dirname, "..", "route-utils.ts");
    const sourceFile = ts.createSourceFile(
      filePath,
      readFileSync(filePath, "utf8"),
      ts.ScriptTarget.Latest,
      true
    );
    const specifiers = sourceFile.statements
      .filter(ts.isImportDeclaration)
      .map((statement) => statement.moduleSpecifier)
      .filter(ts.isStringLiteral)
      .map((specifier) => specifier.text);

    expect(specifiers).not.toContain("@repo/observability/tracing/provider");
  });
});
