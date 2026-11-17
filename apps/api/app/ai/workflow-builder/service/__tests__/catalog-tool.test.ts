import { IntegrationFieldKind } from "@repo/api/src/types/integration";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findProjects: vi.fn(),
  listAllConnections: vi.fn(),
  listTargets: vi.fn(),
  findMembers: vi.fn(),
  providers: vi.fn(),
}));

vi.mock("@/app/projects/service", () => ({
  projectsService: { findByOrganization: mocks.findProjects },
}));
vi.mock("@/app/projects/project-connection-service", () => ({
  projectConnectionService: { listAll: mocks.listAllConnections },
}));
vi.mock("@/app/compute-targets/service", () => ({
  computeTargetsService: { listAvailableForOrg: mocks.listTargets },
}));
vi.mock("@/app/users/service", () => ({
  usersService: { findByOrganization: mocks.findMembers },
}));
vi.mock("@/lib/integrations/registry", () => ({
  listIntegrationProviders: () => [{}],
  toProviderSummary: () => mocks.providers(),
}));

import {
  CATALOG_MAX_PROJECTS,
  CatalogToolError,
  loadWorkflowBuilderCatalog,
  type WorkflowBuilderCaller,
} from "../catalog-tool";

const caller: WorkflowBuilderCaller = {
  organizationId: "org-1",
  userId: "user-1",
  clerkUserId: "clerk-1",
  canManageProjects: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findProjects.mockResolvedValue([{ id: "p1", name: "Alpha" }]);
  mocks.listAllConnections.mockResolvedValue([
    {
      projectId: "p1",
      key: "jira-main",
      name: "Jira",
      provider: "jira",
      settings: { secret: "x" },
    },
  ]);
  mocks.listTargets.mockResolvedValue([
    { id: "t1", machineName: "box", isOnline: true, isSharedWithOrg: false },
  ]);
  mocks.findMembers.mockResolvedValue([
    { id: "u1", firstName: "Ann", lastName: "Lee", email: "ann@example.com" },
  ]);
  mocks.providers.mockReturnValue({
    key: "jira",
    displayName: "Jira",
    builtIn: false,
    triggers: [
      {
        key: "jira.issue_assigned",
        displayName: "Assigned",
        description: "d",
        configFields: [
          { key: "a", label: "A", kind: IntegrationFieldKind.Text },
          { key: "s", label: "S", kind: IntegrationFieldKind.Secret },
        ],
      },
    ],
    actions: [],
  });
});

describe("loadWorkflowBuilderCatalog", () => {
  it("drops secret fields and omits connection settings", async () => {
    const catalog = await loadWorkflowBuilderCatalog(caller);
    expect(catalog).toMatchObject({
      projects: [{ id: "p1", name: "Alpha" }],
      runners: [
        { id: "t1", name: "box", isOnline: true, sharedWithOrg: false },
      ],
      members: [{ id: "u1", name: "Ann Lee", email: "ann@example.com" }],
    });
    const serialized = JSON.stringify(catalog);
    expect(serialized).not.toContain('"key":"s"');
    expect(serialized).toContain('"key":"a"');
    expect(serialized).not.toContain("settings");
    expect(serialized).toContain("jira-main");
  });

  it("withholds project connections without project manage permission", async () => {
    const catalog = await loadWorkflowBuilderCatalog({
      ...caller,
      canManageProjects: false,
    });
    expect(catalog).toMatchObject({
      projectConnections: null,
      projectConnectionsNote: "requires project manage permission",
    });
    expect(mocks.listAllConnections).not.toHaveBeenCalled();
  });

  it("caps the project list", async () => {
    mocks.findProjects.mockResolvedValue(
      Array.from({ length: CATALOG_MAX_PROJECTS + 50 }, (_, i) => ({
        id: `p${i}`,
        name: `P${i}`,
      }))
    );
    const catalog = await loadWorkflowBuilderCatalog(caller);
    expect("projects" in catalog && catalog.projects).toHaveLength(
      CATALOG_MAX_PROJECTS
    );
  });

  it("returns catalog_unavailable when a read throws", async () => {
    mocks.listTargets.mockRejectedValue(new Error("db down"));
    const catalog = await loadWorkflowBuilderCatalog(caller);
    expect(catalog).toEqual({ error: CatalogToolError.Unavailable });
  });
});
