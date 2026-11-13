"use client";

import { FeatureFlagged } from "@repo/analytics/components/feature-flagged";
import { OrgPermission } from "@repo/api/src/types/org-permissions";
import type { ProjectWithDetails } from "@repo/api/src/types/project";
import { TagEntityType } from "@repo/api/src/types/tag";
import { EditableProjectDescription } from "@repo/app/projects/components/editable-project-description";
import { EditableProjectTitle } from "@repo/app/projects/components/editable-project-title";
import { ProjectAgentInstructionsPanel } from "@repo/app/projects/components/project-agent-instructions-panel";
import { ProjectConnectionsPanel } from "@repo/app/projects/components/project-connections-panel";
import { ProjectProcessPanel } from "@repo/app/projects/components/project-process-panel";
import { ProjectRepositoriesPanel } from "@repo/app/projects/components/project-repositories-panel";
import { ProjectRunnerCapabilities } from "@repo/app/projects/components/project-runner-capabilities";
import { ProjectRunnersPanel } from "@repo/app/projects/components/project-runners-panel";
import { ProjectWorkflowsCasesPanel } from "@repo/app/projects/components/project-workflows-cases-panel";
import { hasOrgPermission } from "@repo/app/shared/lib/role-utils";
import { TagPicker } from "@repo/app/tags/components/tag-picker";
import { useOrganization } from "@repo/auth/client";
import { WORKFLOW_CONNECTIONS_SETTINGS_PATH } from "@/app/(authenticated)/[orgSlug]/workflows/components/workflow-connections-path";

export const PROJECT_PANEL_TABS = [
  "overview",
  "workflows",
  "agents",
  "repositories",
  "process",
  "instructions",
] as const;
export type ProjectPanelTabValue = (typeof PROJECT_PANEL_TABS)[number];

// The non-table tabs. Org admins change them; the API refuses everyone else,
// who get a read-only view. Only the active tab's panel mounts.
export function ProjectPanelTab({
  project,
  tab,
}: {
  project: ProjectWithDetails;
  tab: string;
}) {
  const { membership } = useOrganization();
  const isAdmin = hasOrgPermission(membership, OrgPermission.ProjectManage);

  if (tab === "workflows") {
    return <ProjectWorkflowsCasesPanel projectId={project.id} />;
  }
  if (tab === "agents") {
    return (
      <div className="mx-auto flex max-w-[950px] flex-col gap-8 p-6">
        <ProjectRunnersPanel isAdmin={isAdmin} projectId={project.id} />
        <ProjectRunnerCapabilities isAdmin={isAdmin} projectId={project.id} />
      </div>
    );
  }
  if (tab === "repositories") {
    return (
      <div className="mx-auto flex max-w-[950px] flex-col gap-8 p-6">
        <ProjectConnectionsPanel
          connectionsSettingsPath={WORKFLOW_CONNECTIONS_SETTINGS_PATH}
          isAdmin={isAdmin}
          projectId={project.id}
        />
        <ProjectRepositoriesPanel
          connectionsSettingsPath={WORKFLOW_CONNECTIONS_SETTINGS_PATH}
          isAdmin={isAdmin}
          projectId={project.id}
        />
      </div>
    );
  }
  if (tab === "process") {
    return (
      <div className="mx-auto flex max-w-[950px] flex-col gap-8 p-6">
        <ProjectProcessPanel isAdmin={isAdmin} projectId={project.id} />
      </div>
    );
  }
  if (tab === "instructions") {
    return (
      <div className="mx-auto flex max-w-[950px] flex-col gap-8 p-6">
        <ProjectAgentInstructionsPanel
          isAdmin={isAdmin}
          projectId={project.id}
        />
      </div>
    );
  }
  return <ProjectOverviewPanel project={project} />;
}

function ProjectOverviewPanel({ project }: { project: ProjectWithDetails }) {
  return (
    <div className="mx-auto mt-0 flex max-w-[950px] flex-col gap-10 p-6">
      <div className="flex flex-col gap-2">
        <EditableProjectTitle
          initialTitle={project.name}
          projectId={project.id}
        />
        <EditableProjectDescription
          initialDescription={project.description ?? ""}
          projectId={project.id}
        />
      </div>
      <FeatureFlagged flag="artifact-tags">
        <TagPicker
          appliedTags={project.tags ?? []}
          entityId={project.id}
          entityType={TagEntityType.Project}
        />
      </FeatureFlagged>
    </div>
  );
}
