import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadConnectionPollScopes } from "@/lib/integrations/project-connections";
import { jiraProvider } from "@/lib/integrations/providers/jira/provider";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("@repo/database", () => ({
  withDb: (fn: (db: unknown) => unknown) =>
    fn({ projectConnection: { findMany: mocks.findMany } }),
  Prisma: {},
}));
vi.mock("@repo/observability/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/integrations/connection-service", () => ({
  loadConnectionRuntime: vi.fn(),
}));

describe("loadConnectionPollScopes", () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
  });

  it("returns the containers and settings of valid rows and skips invalid ones", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "pc-1", settings: { projectKeys: ["ab"] } },
      { id: "pc-2", settings: { projectKeys: [] } },
    ]);

    const scopes = await loadConnectionPollScopes(
      "org-1",
      "conn-1",
      jiraProvider
    );

    expect(scopes).toEqual([
      {
        projectConnectionId: "pc-1",
        containers: ["AB"],
        settings: { projectKeys: ["AB"] },
      },
    ]);
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1", connectionId: "conn-1" },
      })
    );
  });
});
