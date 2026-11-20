"use client";

import { WORKFLOW_SOURCE_SYSTEMS_NOTICE } from "../lib/workflow-labels";
import { WorkflowsList } from "./workflows-list";

export type WorkflowsIndexViewProps = {
  /** Admins create and change workflows; members see them read-only. */
  isAdmin: boolean;
};

/**
 * The Workflows index: the org's workflows. The org-wide run history lives on
 * the Runs page. "New workflow" sits in the page header (web shell).
 */
export function WorkflowsIndexView({
  isAdmin,
}: Readonly<WorkflowsIndexViewProps>) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 md:p-6">
      <div className="max-w-2xl space-y-1 text-muted-foreground text-sm">
        <p>
          Workflows start the agent team when something happens in another
          system, like a Jira issue assigned to the bot account. Pre actions run
          before the agent team (e.g. move the issue to In Progress) and post
          actions report back with comments, messages or callbacks.
        </p>
        <p>{WORKFLOW_SOURCE_SYSTEMS_NOTICE}</p>
      </div>
      <WorkflowsList isAdmin={isAdmin} />
    </div>
  );
}
