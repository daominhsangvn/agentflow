import type { ProjectRunners } from "@repo/api/src/types/project-runners";
import { Status } from "@repo/api/src/types/result";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authContext: {
    clerkOrgId: "auth-org-1",
    clerkUserId: "auth-user-1",
    user: { id: "user-1", organizationId: "org-1" },
  },
  getOrgPermissionStatus: vi.fn(),
  resolveProjectId: vi.fn(),
  replace: vi.fn(),
  get: vi.fn(),
}));

vi.mock("@/lib/auth/with-any-auth", () => ({
  withAnyAuth:
    (handler: (...args: unknown[]) => Promise<Response>) =>
    (request: NextRequest, context: { params: Promise<unknown> }) =>
      handler(mocks.authContext, request, context?.params),
}));
vi.mock("@/lib/auth/org-permissions", () => ({
  getOrgPermissionStatus: mocks.getOrgPermissionStatus,
}));
vi.mock("@/lib/identifier-utils", () => ({
  resolveProjectId: mocks.resolveProjectId,
}));
vi.mock("@/app/projects/project-agent-contacts-service", () => ({
  projectAgentContactsService: { replace: mocks.replace },
}));
vi.mock("@/app/projects/project-runners-service", () => ({
  projectRunnersService: { get: mocks.get },
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

import { PUT } from "./route";

const PROJECT_ID = "0199a5f0-0000-7000-8000-0000000000d1";
const TARGET_ID = "0199a5f0-0000-7000-8000-0000000000c1";
const USER_ID = "0199a5f0-0000-7000-8000-0000000000b1";
const RUNNERS: ProjectRunners = { runners: [], projectKey: null, waiting: [] };

function put(body: unknown, computeTargetId = TARGET_ID) {
  return PUT(
    new NextRequest(
      `http://localhost/projects/shop/runners/${computeTargetId}/contacts`,
      {
        method: "PUT",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }
    ),
    { params: Promise.resolve({ id: "shop", computeTargetId }) }
  );
}

function asRole(isOwner: boolean) {
  mocks.getOrgPermissionStatus.mockResolvedValue({
    kind: "member",
    isOwner,
    permissions: new Set(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  asRole(true);
  mocks.resolveProjectId.mockResolvedValue(PROJECT_ID);
  mocks.replace.mockResolvedValue({ ok: true, value: undefined });
  mocks.get.mockResolvedValue(RUNNERS);
});

describe("PUT /projects/{id}/runners/{computeTargetId}/contacts", () => {
  it("is admin-only", async () => {
    asRole(false);

    const response = await put({ contacts: [] });

    expect(response.status).toBe(403);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("rejects a contact with both a user and an email", async () => {
    const response = await put({
      contacts: [{ userId: USER_ID, email: "ops@acme.dev" }],
    });

    expect(response.status).toBe(400);
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown project", async () => {
    mocks.resolveProjectId.mockResolvedValue(null);

    const response = await put({ contacts: [] });

    expect(response.status).toBe(404);
  });

  it("returns 404 for an id that is not an Agent id", async () => {
    const response = await put({ contacts: [] }, "not-a-uuid");

    expect(response.status).toBe(404);
  });

  it("maps a service error to its status", async () => {
    mocks.replace.mockResolvedValue({
      ok: false,
      error: { status: Status.NotFound, message: "Not an Agent" },
    });

    const response = await put({ contacts: [] });

    expect(response.status).toBe(404);
  });

  it("saves the contacts and returns the project's runners", async () => {
    const response = await put({
      contacts: [{ userId: USER_ID }, { email: " Ops@Acme.dev " }],
    });

    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual(RUNNERS);
    expect(mocks.replace).toHaveBeenCalledWith("org-1", PROJECT_ID, TARGET_ID, {
      contacts: [{ userId: USER_ID }, { email: "ops@acme.dev" }],
    });
  });
});
