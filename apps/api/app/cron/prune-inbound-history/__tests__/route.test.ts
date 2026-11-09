import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prune: vi.fn(),
  scheduleLogFlush: vi.fn(),
}));

vi.mock("@repo/observability/log", () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("@/lib/route-utils", () => ({
  scheduleLogFlush: mocks.scheduleLogFlush,
}));
vi.mock("@/app/workflows/workflow-event-retention-service", () => ({
  workflowEventRetentionService: { prune: mocks.prune },
}));

import { GET } from "@/app/cron/prune-inbound-history/route";

const SECRET = "test-cron-secret";

function request(authorization?: string): Request {
  return new Request("http://127.0.0.1:3002/cron/prune-inbound-history", {
    headers: authorization ? { authorization } : {},
  });
}

describe("GET /cron/prune-inbound-history", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = SECRET;
    mocks.prune.mockResolvedValue({ events: 4, deliveries: 2 });
  });
  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  it("rejects a request without the bearer secret", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(mocks.prune).not.toHaveBeenCalled();
  });

  it("prunes and returns the counts", async () => {
    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      events: 4,
      deliveries: 2,
    });
    expect(mocks.prune).toHaveBeenCalledTimes(1);
  });

  it("answers 500 when the prune rejects", async () => {
    mocks.prune.mockRejectedValue(new Error("db down"));

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(500);
  });
});
