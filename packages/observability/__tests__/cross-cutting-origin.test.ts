// ---------------------------------------------------------------------------
// CROSS-CUTTING ORIGIN — integration tests verifying `origin` propagates
// correctly from OTEL_SERVICE_NAME through log.ts into the exported log record.
//
// Scope differs from origin.test.ts (which tests the ORIGIN const resolver in
// isolation). These tests exercise the full log pipeline: module load, entry
// building, batching, and flush — confirming the `origin` field in the flushed
// JSON body reflects the OTEL_SERVICE_NAME-resolved Origin value.
//
// NOTE: Relay-native connection lifecycle events emitted via
// `log.*(JSON.stringify({ category: ... }))` directly in apps/relay/src/index.ts
// DO carry an `origin` field. `buildEntry()` in log.ts always stamps
// `origin = metaOrigin ?? ORIGIN`, and with no meta arg, ORIGIN is the
// module-level constant resolved from OTEL_SERVICE_NAME (resolves to "relay" when
// OTEL_SERVICE_NAME=relay). The real distinction vs emitter.ts events is that
// `category`, `trace`, etc. land inside the stringified `message` (pipeline
// rule required for facet queries), while `origin` is always top-level and
// facet-queryable without the rule — see apps/api/docs/telemetry-verification.md.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import { Origin } from "../telemetry/origin";
import { deleteEnvForTest, importLogWithSink } from "./test-helpers";

// `log` must be imported inside each test via importLogWithSink. Never
// statically imported at the top of this file — the module resolves ORIGIN at
// load time, so each test needs a fresh module evaluation.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function findRecord<T extends { message: string }>(
  records: T[],
  message: string
): T {
  const record = records.find((candidate) => candidate.message === message);
  if (!record) {
    throw new Error(`no log record with message "${message}"`);
  }
  return record;
}

// ---------------------------------------------------------------------------
// T-1.1: Parameterized — origin propagates for all known service paths
// ---------------------------------------------------------------------------

describe("origin propagation into exported log record — known paths", () => {
  const cases: [string, Origin][] = [
    ["desktop", Origin.Desktop],
    ["api", Origin.Api],
    ["relay", Origin.Relay],
    ["af-api", Origin.Api],
    ["af-relay", Origin.Relay],
    ["af-desktop", Origin.Desktop],
  ];

  for (const [ddServiceValue, expectedOrigin] of cases) {
    it(`sets origin=${expectedOrigin} when OTEL_SERVICE_NAME=${ddServiceValue}`, async () => {
      vi.stubEnv("OTEL_SERVICE_NAME", ddServiceValue);
      vi.spyOn(console, "info").mockImplementation(() => {});

      const { log, records } = await importLogWithSink();

      log.info("test message");

      expect(findRecord(records, "test message").attributes.origin).toBe(
        expectedOrigin
      );
    });
  }
});

// ---------------------------------------------------------------------------
// T-1.2: Fallback path — OTEL_SERVICE_NAME unset resolves to Origin.Unknown
// ---------------------------------------------------------------------------

describe("origin propagation — OTEL_SERVICE_NAME-unset fallback path", () => {
  it("sets origin=unknown in the exported record when OTEL_SERVICE_NAME is unset", async () => {
    // Delete the key (rather than stubEnv) to exercise the truly-absent
    // branch; deleteEnvForTest restores the parent env afterwards.
    deleteEnvForTest("OTEL_SERVICE_NAME");

    // Suppress origin.ts's console.warn on the fallback path.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});

    const { log, records } = await importLogWithSink();

    log.info("fallback test");

    expect(findRecord(records, "fallback test").attributes.origin).toBe(
      Origin.Unknown
    );
  });
});

// ---------------------------------------------------------------------------
// T-1.3: Post-import env mutation does not change the resolved origin
// ---------------------------------------------------------------------------

describe("origin propagation — post-import env mutation does not change origin", () => {
  it("retains Origin.Api after OTEL_SERVICE_NAME is mutated to 'desktop' without resetModules", async () => {
    vi.stubEnv("OTEL_SERVICE_NAME", "api");
    vi.spyOn(console, "info").mockImplementation(() => {});

    const { log, records } = await importLogWithSink();

    log.info("first");
    expect(findRecord(records, "first").attributes.origin).toBe(Origin.Api);

    // Mutate env WITHOUT calling vi.resetModules() — same log instance
    vi.stubEnv("OTEL_SERVICE_NAME", "desktop");

    log.info("second");
    expect(findRecord(records, "second").attributes.origin).toBe(Origin.Api);
  });
});
