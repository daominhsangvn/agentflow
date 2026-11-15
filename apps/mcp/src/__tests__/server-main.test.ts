import { beforeEach, describe, expect, it, vi } from "vitest";

const order: string[] = [];
const initTelemetry = vi.fn((_options?: unknown) => {
  order.push("init");
});
const startHttpServer = vi.fn(() => ({ fake: "server" }));
const installShutdownHandlers = vi.fn();

vi.mock("@repo/observability/tracing/provider", () => ({ initTelemetry }));
vi.mock("../index.js", () => {
  order.push("index-loaded");
  return { startHttpServer, __testables: { installShutdownHandlers } };
});

async function runMain(): Promise<void> {
  vi.resetModules();
  await import("../server-main.js");
  await vi.waitFor(() => {
    if (installShutdownHandlers.mock.calls.length === 0) {
      throw new Error("not started");
    }
  });
}

describe("server-main", () => {
  beforeEach(() => {
    order.length = 0;
    vi.clearAllMocks();
  });

  it("initialises telemetry before importing index", async () => {
    await runMain();
    expect(initTelemetry).toHaveBeenCalledWith({
      handleShutdownSignals: false,
    });
    expect(order.indexOf("init")).toBeLessThan(order.indexOf("index-loaded"));
    expect(installShutdownHandlers).toHaveBeenCalledWith({ fake: "server" });
  });

  it("still starts the server when telemetry init throws", async () => {
    initTelemetry.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    await runMain();
    expect(startHttpServer).toHaveBeenCalled();
  });
});
