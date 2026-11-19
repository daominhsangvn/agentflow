import { AgentKind } from "@repo/api/src/types/agent-fleet";
import {
  type IntegrationFieldDescriptor,
  IntegrationFieldKind,
  type IntegrationProviderSummary,
} from "@repo/api/src/types/integration";
import { readPersonalAgentProjectKey } from "@repo/api/src/types/project-runners";
import { AfAttribute, AfOutcome } from "@repo/observability/af-attributes";
import { log } from "@repo/observability/log";
import { setSpanOutcome, withSpan } from "@repo/observability/span";
import { computeTargetCapabilitiesService } from "@/app/compute-targets/capabilities-service";
import { computeTargetsService } from "@/app/compute-targets/service";
import { projectConnectionService } from "@/app/projects/project-connection-service";
import { loadProjectRunnerIds } from "@/app/projects/project-runner-selection";
import { projectsService } from "@/app/projects/service";
import { usersService } from "@/app/users/service";
import {
  listIntegrationProviders,
  toProviderSummary,
} from "@/lib/integrations/registry";
import type { AgentWorkDirFile } from "@/lib/platform-agent/work-dir";
import {
  buildRunnerCapabilities,
  type CatalogRunnerCapabilities,
  resolveCapabilitiesProject,
} from "./runner-catalog";

export type WorkflowBuilderCaller = {
  organizationId: string;
  userId: string;
  clerkUserId: string;
  canManageProjects: boolean;
};

export const CATALOG_MAX_PROJECTS = 200;
export const CATALOG_MAX_PROJECT_CONNECTIONS = 500;
export const CATALOG_MAX_RUNNERS = 200;
export const CATALOG_MAX_MEMBERS = 500;

export const CatalogToolError = {
  Unavailable: "catalog_unavailable",
} as const;

const CATALOG_READ_FAILED = "catalog_read_failed";
const PROJECT_CONNECTIONS_NOTE = "requires project manage permission";

type CatalogField = {
  key: string;
  label: string;
  kind: IntegrationFieldKind;
  required: boolean;
  description: string | null;
  options: { value: string; label: string }[];
};

export type WorkflowBuilderCatalog = Awaited<
  ReturnType<typeof readCatalog>
>["catalog"];

export function loadWorkflowBuilderCatalog(
  caller: WorkflowBuilderCaller,
  context: { editorYaml: string }
): Promise<
  | { catalog: WorkflowBuilderCatalog; runnerFiles: AgentWorkDirFile[] }
  | { error: typeof CatalogToolError.Unavailable }
> {
  return withSpan(
    "workflow_builder.get_catalog",
    {
      [AfAttribute.OrgId]: caller.organizationId,
      [AfAttribute.UserId]: caller.userId,
    },
    async () => {
      try {
        return await readCatalog(caller, context.editorYaml);
      } catch (error) {
        setSpanOutcome(AfOutcome.Error, CATALOG_READ_FAILED);
        log.warn("workflow_builder.catalog_failed", {
          reason: CATALOG_READ_FAILED,
          organizationId: caller.organizationId,
          userId: caller.userId,
          error,
        });
        return { error: CatalogToolError.Unavailable };
      }
    }
  );
}

async function readCatalog(caller: WorkflowBuilderCaller, editorYaml: string) {
  const { organizationId, userId, clerkUserId } = caller;
  const [projects, connections, targets, members] = await Promise.all([
    projectsService.findByOrganization(organizationId),
    caller.canManageProjects
      ? projectConnectionService.listAll(organizationId)
      : Promise.resolve(null),
    computeTargetsService.listAvailableForOrg(
      organizationId,
      userId,
      clerkUserId
    ),
    usersService.findByOrganization(organizationId),
  ]);
  const capped = projects
    .slice(0, CATALOG_MAX_PROJECTS)
    .map((project) => ({ id: project.id, name: project.name }));
  const runnerTargets = targets.slice(0, CATALOG_MAX_RUNNERS);
  const resolved = resolveCapabilitiesProject({ editorYaml, projects: capped });
  const projectScope = resolved.ok
    ? await loadProjectScope(
        organizationId,
        resolved.project.id,
        new Set(runnerTargets.map((target) => target.id))
      )
    : null;
  const catalog = {
    projects: projects
      .slice(0, CATALOG_MAX_PROJECTS)
      .map((project) => ({ id: project.id, name: project.name })),
    projectConnections: connections
      ? connections.slice(0, CATALOG_MAX_PROJECT_CONNECTIONS).map((c) => ({
          projectId: c.projectId,
          key: c.key,
          name: c.name,
          provider: c.provider,
        }))
      : null,
    ...(connections
      ? {}
      : { projectConnectionsNote: PROJECT_CONNECTIONS_NOTE }),
    providers: listIntegrationProviders().map((provider) =>
      toCatalogProvider(toProviderSummary(provider))
    ),
    runners: runnerTargets.map((target) => ({
      id: target.id,
      name: target.machineName,
      isOnline: target.isOnline,
      sharedWithOrg: target.isSharedWithOrg,
      ...toRunnerKind(target.capabilities),
      ...(projectScope
        ? {
            projectAgent:
              projectScope.runnerIds.length === 0 ||
              projectScope.runnerIds.includes(target.id),
            capabilities: projectScope.byTarget.get(target.id) ?? null,
          }
        : {}),
    })),
    members: members.slice(0, CATALOG_MAX_MEMBERS).map((member) => ({
      id: member.id,
      name: [member.firstName, member.lastName].filter(Boolean).join(" "),
      email: member.email,
    })),
    capabilitiesProject: resolved.ok ? resolved.project : null,
    ...(resolved.ok ? {} : { capabilitiesError: resolved.error }),
  };
  return { catalog, runnerFiles: projectScope?.files ?? [] };
}

async function loadProjectScope(
  organizationId: string,
  projectId: string,
  accessibleIds: Set<string>
): Promise<{
  runnerIds: string[];
  byTarget: Map<string, CatalogRunnerCapabilities>;
  files: AgentWorkDirFile[];
}> {
  const [capabilityFiles, runnerIds] = await Promise.all([
    computeTargetCapabilitiesService.listForProject(organizationId, projectId),
    loadProjectRunnerIds(organizationId, { projectId }),
  ]);
  const built = buildRunnerCapabilities({
    files: capabilityFiles,
    accessibleIds,
    now: Date.now(),
  });
  return { runnerIds, byTarget: built.byTarget, files: built.files };
}

function toRunnerKind(
  capabilities: Parameters<typeof readPersonalAgentProjectKey>[0]
) {
  const projectKey = readPersonalAgentProjectKey(capabilities);
  return {
    kind: projectKey ? AgentKind.Personal : AgentKind.Automatic,
    projectKey: projectKey ?? null,
  };
}

function toCatalogProvider(provider: IntegrationProviderSummary) {
  return {
    key: provider.key,
    displayName: provider.displayName,
    builtIn: provider.builtIn,
    triggers: provider.triggers.map((trigger) => ({
      type: trigger.key,
      displayName: trigger.displayName,
      description: trigger.description,
      fields: toCatalogFields(trigger.configFields),
    })),
    actions: provider.actions.map((action) => ({
      type: action.key,
      displayName: action.displayName,
      description: action.description,
      target: action.target,
      defaultEvents: action.defaultEvents,
      fields: toCatalogFields(action.configFields),
    })),
  };
}

function toCatalogFields(fields: IntegrationFieldDescriptor[]): CatalogField[] {
  return fields
    .filter((field) => field.kind !== IntegrationFieldKind.Secret)
    .map((field) => ({
      key: field.key,
      label: field.label,
      kind: field.kind,
      required: field.required === true,
      description: field.description ?? null,
      options: field.options ?? [],
    }));
}
