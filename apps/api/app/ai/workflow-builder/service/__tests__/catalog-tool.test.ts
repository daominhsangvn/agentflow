import { AgentKind } from "@repo/api/src/types/agent-fleet";
import { IntegrationFieldKind } from "@repo/api/src/types/integration";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findProjects: vi.fn(),
  listAllConnections: vi.fn(),
  listTargets: vi.fn(),
  findMembers: vi.fn(),
  providers: vi.fn(),
  listForProject: vi.fn(),
  loadRunnerIds: vi.fn(),
}));

vi.mock("@/app/compute-targets/capabilities-service", () => ({
  computeTargetCapabilitiesService: { listForProject: mocks.listForProject },
}));
vi.mock("@/app/projects/project-runner-selection", () => ({
  loadProjectRunnerIds: mocks.loadRunnerIds,
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

const WITH_PROJECT = "project: Alpha";
const NO_EDITOR = { editorYaml: "" };
const MISSING = "project: is required to resolve runners and capabilities";

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
  mocks.listForProject.mockResolvedValue([]);
  mocks.loadRunnerIds.mockResolvedValue([]);
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
    const loaded = await loadWorkflowBuilderCatalog(caller, NO_EDITOR);
    const catalog = "catalog" in loaded ? loaded.catalog : loaded;
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
    const loaded = await loadWorkflowBuilderCatalog(
      { ...caller, canManageProjects: false },
      NO_EDITOR
    );
    expect("catalog" in loaded && loaded.catalog).toMatchObject({
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
    const loaded = await loadWorkflowBuilderCatalog(caller, NO_EDITOR);
    expect("catalog" in loaded && loaded.catalog.projects).toHaveLength(
      CATALOG_MAX_PROJECTS
    );
  });

  it("returns catalog_unavailable when a read throws", async () => {
    mocks.listTargets.mockRejectedValue(new Error("db down"));
    const catalog = await loadWorkflowBuilderCatalog(caller, NO_EDITOR);
    expect(catalog).toEqual({ error: CatalogToolError.Unavailable });
  });

  it("adds capabilities of the project named by the editor YAML", async () => {
    mocks.listForProject.mockResolvedValue([
      {
        computeTargetId: "t1",
        runnerName: "box",
        source: "toolkit",
        content: "---\nrunner: ba\n---\nBody text",
        capabilities: {
          runner: "ba",
          commands: [{ name: "/ask" }],
          skills: [{ name: "s1" }],
        },
        problems: [],
        uploadedAt: new Date().toISOString(),
      },
      {
        computeTargetId: "other",
        runnerName: "hidden",
        source: "toolkit",
        content: "x",
        capabilities: null,
        problems: [],
        uploadedAt: new Date().toISOString(),
      },
    ]);
    const loaded = await loadWorkflowBuilderCatalog(caller, {
      editorYaml: WITH_PROJECT,
    });
    if (!("catalog" in loaded)) {
      throw new Error("expected catalog");
    }
    expect(loaded.catalog.capabilitiesProject?.id).toBe("p1");
    expect(loaded.catalog.runners[0]).toMatchObject({
      capabilities: { file: "runners/box-t1.md", stale: false },
    });
    expect(loaded.catalog.runners[0]?.capabilities?.commands[0]?.name).toBe(
      "/ask"
    );
    expect(loaded.runnerFiles).toHaveLength(1);
    expect(loaded.runnerFiles[0]?.content).toContain("Body text");
    expect(loaded.runnerFiles[0]?.content).not.toContain("runner: ba");
  });

  it.each([
    ["no project", "agent:\n  runner: t1\n"],
    ["only agent.project", "agent:\n  project: Alpha\n"],
    ["unknown project", "project: Nope\n"],
  ])("gives capabilitiesError for %s", async (_name, editorYaml) => {
    const loaded = await loadWorkflowBuilderCatalog(caller, { editorYaml });
    if (!("catalog" in loaded)) {
      throw new Error("expected catalog");
    }
    expect(loaded.catalog.capabilitiesProject).toBeNull();
    expect(JSON.stringify(loaded.catalog)).toContain(MISSING);
    expect(mocks.listForProject).not.toHaveBeenCalled();
    expect(loaded.runnerFiles).toEqual([]);
  });

  it("marks personal runners and stale files", async () => {
    mocks.listTargets.mockResolvedValue([
      {
        id: "t1",
        machineName: "box",
        isOnline: true,
        isSharedWithOrg: false,
        capabilities: { personalRunner: { projectKey: "PRO-1" } },
      },
    ]);
    mocks.listForProject.mockResolvedValue([
      {
        computeTargetId: "t1",
        runnerName: "box",
        source: "toolkit",
        content: "x",
        capabilities: null,
        problems: [],
        uploadedAt: "2020-01-01T00:00:00.000Z",
      },
    ]);
    const loaded = await loadWorkflowBuilderCatalog(caller, {
      editorYaml: WITH_PROJECT,
    });
    if (!("catalog" in loaded)) {
      throw new Error("expected catalog");
    }
    expect(loaded.catalog.runners[0]).toMatchObject({
      kind: AgentKind.Personal,
      projectKey: "PRO-1",
      capabilities: { stale: true },
    });
  });
});
