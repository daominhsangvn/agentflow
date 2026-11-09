import { Result, Status } from "@repo/api/src/types/result";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authContext: {
    clerkOrgId: "auth-org-1",
    clerkUserId: "auth-user-1",
    user: { id: "user-1", organizationId: "org-1" },
  },
  getOrgAdminStatus: vi.fn(),
  eventService: { list: vi.fn(), getPayload: vi.fn() },
}));

vi.mock("@/lib/auth/with-any-auth", () => ({
  withAnyAuth:
    (handler: (...args: unknown[]) => Promise<Response>) =>
    (request: NextRequest, context: { params: Promise<unknown> }) =>
      handler(mocks.authContext, request, context?.params),
}));
vi.mock("@/lib/auth/org-admin", () => ({
  getOrgAdminStatus: mocks.getOrgAdminStatus,
}));
vi.mock("@/app/workflows/workflow-event-service", () => ({
  workflowEventService: mocks.eventService,
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

import { GET as getPayload } from "@/app/workflows/[id]/events/[eventId]/route";
import { GET as listEvents } from "@/app/workflows/[id]/events/route";

const WORKFLOW_ID = "0199a5f0-0000-7000-8000-0000000000f1";
const EVENT_ID = "0199a5f0-0000-7000-8000-0000000000a1";

function get(path: string) {
  return new NextRequest(`http://localhost${path}`);
}

function params(values: Record<string, string>) {
  return { params: Promise.resolve(values) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrgAdminStatus.mockResolvedValue({ isAdmin: true, reason: "admin" });
});

describe("GET /workflows/{id}/events", () => {
  it("passes the parsed cursor and limit to the service", async () => {
    mocks.eventService.list.mockResolvedValue(
      Result.ok({ events: [], nextCursor: null })
    );
    const response = await listEvents(
      get(`/workflows/${WORKFLOW_ID}/events?cursor=abc&limit=20`),
      params({ id: WORKFLOW_ID })
    );
    expect(response.status).toBe(200);
    expect(mocks.eventService.list).toHaveBeenCalledWith("org-1", WORKFLOW_ID, {
      cursor: "abc",
      limit: 20,
    });
  });

  it.each(["limit=101", "unknown=1"])("rejects %s with 400", async (query) => {
    const response = await listEvents(
      get(`/workflows/${WORKFLOW_ID}/events?${query}`),
      params({ id: WORKFLOW_ID })
    );
    expect(response.status).toBe(400);
    expect(mocks.eventService.list).not.toHaveBeenCalled();
  });

  it("maps a service NotFound to 404", async () => {
    mocks.eventService.list.mockResolvedValue(
      Result.err({ status: Status.NotFound, message: "Workflow not found" })
    );
    const response = await listEvents(
      get(`/workflows/${WORKFLOW_ID}/events`),
      params({ id: WORKFLOW_ID })
    );
    expect(response.status).toBe(404);
  });
});

describe("GET /workflows/{id}/events/{eventId}", () => {
  const path = `/workflows/${WORKFLOW_ID}/events/${EVENT_ID}`;
  const ids = params({ id: WORKFLOW_ID, eventId: EVENT_ID });

  it("denies non-admins without calling the service", async () => {
    mocks.getOrgAdminStatus.mockResolvedValue({
      isAdmin: false,
      reason: "not_admin",
    });
    const response = await getPayload(get(path), ids);
    expect(response.status).toBe(403);
    expect(mocks.eventService.getPayload).not.toHaveBeenCalled();
  });

  it("returns 404 for an admin when the event is missing", async () => {
    mocks.eventService.getPayload.mockResolvedValue(null);
    expect((await getPayload(get(path), ids)).status).toBe(404);
  });

  it("returns 200 for an admin", async () => {
    mocks.eventService.getPayload.mockResolvedValue({ id: EVENT_ID });
    expect((await getPayload(get(path), ids)).status).toBe(200);
    expect(mocks.eventService.getPayload).toHaveBeenCalledWith(
      "org-1",
      WORKFLOW_ID,
      EVENT_ID
    );
  });
});
