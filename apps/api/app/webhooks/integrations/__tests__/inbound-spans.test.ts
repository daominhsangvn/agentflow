import {
  IntegrationConnectionStatus,
  IntegrationDeliveryMode,
  IntegrationDeliveryOutcome,
  IntegrationProviderKey,
} from "@repo/api/src/types/integration";
import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import {
  type InMemorySpans,
  installInMemorySpans,
  TestSpanStatus,
} from "@repo/observability/testing/in-memory-spans";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INBOUND_TOKEN_HEADER,
  verifyStaticToken,
} from "@/lib/integrations/inbound-auth";
import { IngressOutcome } from "../ingress-response";

const mocks = vi.hoisted(() => ({
  loadConnectionByInboundKey: vi.fn(),
  ingestEvents: vi.fn(),
  parse: vi.fn(),
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
vi.mock("@/lib/integrations/connection-service", () => ({
  loadConnectionByInboundKey: mocks.loadConnectionByInboundKey,
  createProviderContext: (runtime: unknown) => ({ connection: runtime }),
}));
vi.mock("@/lib/workflows/engine/ingest", () => ({
  ingestEvents: mocks.ingestEvents,
  toDeliveryPayload: (body: string) => ({ body }),
}));
vi.mock("@/lib/route-utils", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/route-utils")>();
  return { ...original, scheduleLogFlush: vi.fn() };
});

import { POST } from "@/app/webhooks/integrations/[inboundKey]/route";

const SECRET = "inbound-secret-value";
let recorder: InMemorySpans | undefined;

beforeEach(() => {
  recorder?.uninstall();
  recorder = installInMemorySpans();
  vi.clearAllMocks();
  mocks.loadConnectionByInboundKey.mockResolvedValue(connection());
  mocks.parse.mockResolvedValue({
    deliveryId: "d-1",
    eventType: "jira:issue_updated",
    events: [],
  });
  mocks.ingestEvents.mockResolvedValue({
    outcome: IntegrationDeliveryOutcome.Accepted,
    runCount: 1,
    deliveryRowId: "row-1",
    decisions: [{ runId: "run-1" }],
    detail: null,
  });
});

afterAll(() => recorder?.uninstall());

function connection() {
  return {
    record: {
      id: "conn-1",
      organizationId: "org-1",
      provider: IntegrationProviderKey.Jira,
      status: IntegrationConnectionStatus.Active,
      deliveryMode: IntegrationDeliveryMode.Webhook,
    },
    provider: {
      key: IntegrationProviderKey.Jira,
      inbound: {
        verify: (req: { headers: Headers }, ctx: { inboundSecret: string }) =>
          verifyStaticToken(req.headers, ctx.inboundSecret),
        parse: mocks.parse,
      },
    },
    runtime: {
      id: "conn-1",
      provider: IntegrationProviderKey.Jira,
      name: "Jira",
      config: {},
      account: null,
      secrets: {},
    },
    inboundSecret: SECRET,
  };
}

function post() {
  const headers = new Headers({ [INBOUND_TOKEN_HEADER]: SECRET });
  const request = new Request("https://api.example.test/webhooks/x", {
    method: "POST",
    headers,
    body: "{}",
  });
  return POST(request, { params: Promise.resolve({ inboundKey: "k" }) });
}

function integrationSpan() {
  return recorder?.spans().find((s) => s.name === "webhook.integration");
}

describe("webhook.integration span", () => {
  it("marks an unknown key as an error with the ingress outcome", async () => {
    mocks.loadConnectionByInboundKey.mockResolvedValue(null);
    await post();
    const span = integrationSpan();
    expect(span?.status.code).toBe(TestSpanStatus.Error);
    expect(span?.attributes[AfAttribute.ErrorReason]).toBe(
      IngressOutcome.UnknownInboundKey
    );
  });

  it("tags the connection and an ok outcome on success", async () => {
    await post();
    const span = integrationSpan();
    expect(span?.attributes[AfAttribute.ConnectionId]).toBe("conn-1");
    expect(span?.attributes[AfAttribute.DeliveryId]).toBe("d-1");
    expect(span?.attributes[AfAttribute.Outcome]).toBe(AfOutcome.Ok);
  });
});
