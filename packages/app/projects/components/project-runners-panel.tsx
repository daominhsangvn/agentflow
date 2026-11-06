"use client";

import { AgentKind } from "@repo/api/src/types/agent-fleet";
import {
  PROJECT_RUNNERS_MAX,
  type ProjectRunner,
  readPersonalAgentProjectKey,
} from "@repo/api/src/types/project-runners";
// Cross-slice: same retryable error block as the repositories list.
import { QueryErrorMessage } from "@repo/app/integrations/components/query-error-message";
import { Button } from "@repo/design-system/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system/components/ui/select";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import {
  useAssignableComputers,
  useProjectRunners,
  useSaveProjectRunners,
} from "../hooks/use-project-runners";

export type ProjectRunnersPanelProps = {
  projectId: string;
  /** Org admins choose the agents; members see them (the API enforces it). */
  isAdmin: boolean;
};

/**
 * Project → Agents: the computers the project's agent loops run on. Each
 * agent needs the toolchains of every repository; a new loop goes to the least
 * busy one online. Without agents, loops run on the computer the user (or the
 * workflow) picks.
 */
export function ProjectRunnersPanel({
  projectId,
  isAdmin,
}: Readonly<ProjectRunnersPanelProps>) {
  const runners = useProjectRunners(projectId);
  const save = useSaveProjectRunners(projectId);
  const [isAdding, setIsAdding] = useState(false);
  const assigned = runners.data?.runners ?? [];
  const waiting = runners.data?.waiting ?? [];
  const saveIds = (runnerIds: string[]) => save.mutate({ runnerIds });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="font-medium text-sm">Agents</h4>
          <p className="text-muted-foreground text-xs">
            Agents are the computers that run this project&apos;s agent loops.
            Each one needs the toolchains of all the repositories (for example
            .NET, Rust and Node.js), so set them up alike; a new loop goes to
            the least busy one online. Without agents, loops run on the computer
            each user picks.
            {isAdmin ? null : " Only organization admins can change them."}
          </p>
        </div>
        {isAdmin ? (
          <Button
            disabled={!isAdding && assigned.length >= PROJECT_RUNNERS_MAX}
            onClick={() => setIsAdding((value) => !value)}
            size="sm"
            type="button"
            variant={isAdding ? "ghost" : "outline"}
          >
            {isAdding ? (
              "Close"
            ) : (
              <>
                <PlusIcon className="size-3.5" />
                Add agent
              </>
            )}
          </Button>
        ) : null}
      </div>
      {runners.error ? (
        <QueryErrorMessage
          error={runners.error}
          onRetry={() => runners.refetch()}
          title="Couldn't load the agents"
        />
      ) : (
        <RunnerList
          isBusy={save.isPending}
          isLoading={runners.isLoading}
          onRemove={
            isAdmin
              ? (id) =>
                  saveIds(
                    assigned
                      .map((runner) => runner.id)
                      .filter((other) => other !== id)
                  )
              : null
          }
          runners={assigned}
        />
      )}
      {waiting.length > 0 ? (
        <WaitingList
          canAdd={isAdmin && assigned.length < PROJECT_RUNNERS_MAX}
          isAdmin={isAdmin}
          isBusy={save.isPending}
          onAdd={(id) => saveIds([...assigned.map((runner) => runner.id), id])}
          runners={waiting}
        />
      ) : null}
      {isAdmin && isAdding ? (
        <AddRunnerForm
          assignedIds={assigned.map((runner) => runner.id)}
          isBusy={save.isPending}
          onAdd={(id) => {
            saveIds([...assigned.map((runner) => runner.id), id]);
            setIsAdding(false);
          }}
          projectKey={runners.data?.projectKey ?? null}
        />
      ) : null}
    </div>
  );
}

type WaitingListProps = {
  runners: ProjectRunner[];
  isAdmin: boolean;
  canAdd: boolean;
  isBusy: boolean;
  onAdd: (id: string) => void;
};

function WaitingList({
  runners,
  isAdmin,
  canAdd,
  isBusy,
  onAdd,
}: Readonly<WaitingListProps>) {
  return (
    <div className="space-y-1">
      <h5 className="font-medium text-xs">Waiting to be added</h5>
      <ul className="divide-y rounded-md border border-dashed">
        {runners.map((runner) => (
          <li
            className="flex items-center gap-2 px-3 py-2"
            data-testid="project-runner-waiting-row"
            key={runner.id}
          >
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${runner.isOnline ? "bg-green-500" : "bg-muted-foreground/40"}`}
            />
            <div className="min-w-0 flex-1">
              <span className="block truncate font-medium text-sm">
                {runner.machineName}
              </span>
              <span className="block truncate text-muted-foreground text-xs">
                Personal Agent registered for this project
              </span>
            </div>
            {isAdmin ? (
              <Button
                aria-label={`Add ${runner.machineName}`}
                disabled={isBusy || !canAdd}
                onClick={() => onAdd(runner.id)}
                size="sm"
                type="button"
                variant="outline"
              >
                Add
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

type RunnerListProps = {
  runners: ProjectRunner[];
  isLoading: boolean;
  isBusy: boolean;
  /** Null: the viewer cannot remove agents. */
  onRemove: ((id: string) => void) | null;
};

function RunnerList({
  runners,
  isLoading,
  isBusy,
  onRemove,
}: Readonly<RunnerListProps>) {
  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }
  if (runners.length === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-muted-foreground text-sm">
        No agents yet: loops run on the computer each user picks.
      </p>
    );
  }
  return (
    <ul className="divide-y rounded-md border">
      {runners.map((runner) => (
        <li
          className="flex items-start gap-2 px-3 py-2"
          data-testid="project-runner-row"
          key={runner.id}
        >
          <span
            aria-hidden="true"
            className={`mt-1.5 size-2 shrink-0 rounded-full ${runner.isOnline ? "bg-green-500" : "bg-muted-foreground/40"}`}
          />
          <div className="min-w-0 flex-1">
            <span className="block truncate font-medium text-sm">
              {runner.machineName}
            </span>
            <span className="block truncate text-muted-foreground text-xs">
              {describeRunner(runner)}
            </span>
            {runner.isSharedWithOrg ? null : (
              <span className="block text-amber-600 text-xs dark:text-amber-400">
                Not shared with the organization: only its owner&apos;s loops
                can run on it.
              </span>
            )}
            <ToolList tools={runner.tools} />
          </div>
          {onRemove ? (
            <Button
              aria-label={`Remove ${runner.machineName}`}
              disabled={isBusy}
              onClick={() => onRemove(runner.id)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Trash2Icon className="size-4" />
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ToolList({ tools }: Readonly<{ tools: Record<string, string> }>) {
  const names = Object.keys(tools).sort((a, b) => a.localeCompare(b));
  if (names.length === 0) {
    return null;
  }
  return (
    <ul aria-label="Reported tools" className="mt-1 flex flex-wrap gap-1">
      {names.map((name) => (
        <li
          className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
          key={name}
          title={tools[name]}
        >
          {name}
        </li>
      ))}
    </ul>
  );
}

type AddRunnerFormProps = {
  assignedIds: string[];
  projectKey: string | null;
  isBusy: boolean;
  onAdd: (id: string) => void;
};

function AddRunnerForm({
  assignedIds,
  projectKey,
  isBusy,
  onAdd,
}: Readonly<AddRunnerFormProps>) {
  const computers = useAssignableComputers(true);
  const [selectedId, setSelectedId] = useState("");
  const choices = (computers.data ?? []).filter(
    (computer) =>
      !assignedIds.includes(computer.id) &&
      belongsToProject(computer, projectKey)
  );

  if (computers.error) {
    return (
      <QueryErrorMessage
        error={computers.error}
        onRetry={() => computers.refetch()}
        title="Couldn't load the computers"
      />
    );
  }
  if (computers.isLoading) {
    return <p className="text-muted-foreground text-sm">Loading…</p>;
  }
  if (choices.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No other computer is available. Connect an agent, or share a computer
        with the organization.
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md border p-3">
      <Select onValueChange={setSelectedId} value={selectedId}>
        <SelectTrigger aria-label="Computer" className="flex-1">
          <SelectValue placeholder="Choose a computer" />
        </SelectTrigger>
        <SelectContent>
          {choices.map((computer) => (
            <SelectItem key={computer.id} value={computer.id}>
              {computer.machineName}
              {readPersonalAgentProjectKey(computer.capabilities)
                ? " (personal)"
                : ""}
              {computer.isOnline ? "" : " (offline)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        disabled={!selectedId || isBusy}
        onClick={() => onAdd(selectedId)}
        size="sm"
        type="button"
      >
        Add
      </Button>
    </div>
  );
}

/** A personal Agent can only join the project it registered for. */
function belongsToProject(
  computer: { capabilities?: unknown },
  projectKey: string | null
): boolean {
  const key = readPersonalAgentProjectKey(computer.capabilities);
  return key === null || key === projectKey;
}

function describeRunner(runner: ProjectRunner): string {
  const parts = [
    runner.isOnline ? "Online" : "Offline",
    runner.kind === AgentKind.Personal ? "Personal" : "Automatic",
    describeLoad(runner),
  ];
  if (runner.ownerName) {
    parts.push(runner.ownerName);
  }
  return parts.join(" · ");
}

function describeLoad(runner: ProjectRunner): string {
  if (runner.capacity === null) {
    return runner.activeLoops === 1
      ? "1 loop running"
      : `${runner.activeLoops} loops running`;
  }
  return `${runner.activeLoops} of ${runner.capacity} loops running`;
}
