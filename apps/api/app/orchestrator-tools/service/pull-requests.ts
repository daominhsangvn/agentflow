import type { RepoExecutionResult } from "@agentflow-ai/loops-api/execution-result";
import { OrchestratorTaskStatus } from "@repo/api/src/types/orchestrator";
import { withDb } from "@repo/database";
import { z } from "zod";
import {
  checkoutBaseBranch,
  findRepositoryCheckout,
  listProjectRepositoryCheckouts,
  type ProjectRepositoryCheckout,
} from "@/app/projects/project-repository-checkouts";
import {
  createProviderContext,
  loadConnectionRuntime,
} from "@/lib/integrations/connection-service";
import {
  PULL_REQUEST_DESCRIPTION_MAX,
  PULL_REQUEST_TITLE_MAX,
} from "@/lib/integrations/pull-request-action";
import { getIntegrationProvider } from "@/lib/integrations/registry";
import { jsonValueSchema } from "@/lib/json-schema";
import { scrubProviderError } from "@/lib/workflows/engine/errors";
import { readRepoExecutionResults } from "@/lib/workflows/engine/run-loops";
import { refused, type ToolOutcome } from "./turn";

/**
 * pull_request_open: an auto-runner task with `push: true` only pushes a
 * branch per changed repository and an orchestrated workflow has no actions,
 * so the orchestrator opens the pull requests itself through each
 * repository's integration.
 */

const LOG_PREFIX = "[orchestrator-tools]";
const NO_BRANCH =
  "The task pushed no branch (its command declares no push, or it changed nothing).";

export const pullRequestOpenInputSchema = z.object({
  taskId: z.uuid(),
  title: z.string().trim().min(1).max(PULL_REQUEST_TITLE_MAX),
  description: z.string().max(PULL_REQUEST_DESCRIPTION_MAX).default(""),
  draft: z.boolean().default(false),
});
export type PullRequestOpenInput = z.infer<typeof pullRequestOpenInputSchema>;

type OpenedPullRequest = {
  repository: string;
  url: string;
  number: number;
  existing: boolean;
};

type Pushed = Extract<RepoExecutionResult, { status: "pushed" }>;

export async function openTaskPullRequests(
  context: { organizationId: string; projectId: string; caseId: string },
  input: PullRequestOpenInput
): Promise<ToolOutcome> {
  const task = await withDb((db) =>
    db.orchestratorTask.findFirst({
      where: { id: input.taskId, caseId: context.caseId },
      select: { status: true, loopId: true },
    })
  );
  if (!task) {
    return refused("No task of this case has that id.");
  }
  if (task.status !== OrchestratorTaskStatus.Succeeded || !task.loopId) {
    return refused(
      "Only a succeeded task's pushed branches get a pull request."
    );
  }
  const { loopId } = task;
  const loop = await withDb((db) =>
    db.loop.findFirst({
      where: { id: loopId, organizationId: context.organizationId },
      select: { uploadedArtifacts: true },
    })
  );
  const results = readRepoExecutionResults(loop?.uploadedArtifacts ?? null);
  if (!results.some((r) => r.status === "pushed" || r.status === "success")) {
    return refused(NO_BRANCH);
  }
  const checkouts = await listProjectRepositoryCheckouts(
    context.organizationId,
    context.projectId
  );
  const opened: OpenedPullRequest[] = [];
  const skipped: string[] = [];
  const failed: string[] = [];
  let pushedCount = 0;
  let pushedOpened = 0;
  for (const result of results) {
    if (result.status === "success") {
      opened.push({
        repository: result.fullName,
        url: result.prUrl,
        number: result.prNumber,
        existing: true,
      });
    } else if (result.status === "skipped") {
      skipped.push(
        `${result.fullName}: ${await scrubReason(context.organizationId, checkouts, result.fullName, result.reason)}`
      );
    } else if (result.status === "failed") {
      failed.push(
        `${result.fullName}: ${await scrubReason(context.organizationId, checkouts, result.fullName, result.error)}`
      );
    } else {
      pushedCount += 1;
      const done = await openOne(
        context.organizationId,
        checkouts,
        result,
        input
      );
      if (done.ok) {
        opened.push(done.pullRequest);
        pushedOpened += 1;
      } else {
        failed.push(`${result.fullName}: ${done.error}`);
      }
    }
  }
  const output = jsonValueSchema.parse(
    JSON.parse(JSON.stringify({ pullRequests: opened, skipped, failed }))
  );
  if (pushedCount > 0 && pushedOpened === 0) {
    return {
      ok: false,
      error: `No pull request could be opened: ${failed.join("; ")}`,
      retryable: false,
    };
  }
  return { ok: true, output };
}

/** A runner-reported reason with the repository connection's secrets removed. */
async function scrubReason(
  organizationId: string,
  checkouts: readonly ProjectRepositoryCheckout[],
  fullName: string,
  reason: string
): Promise<string> {
  const checkout = findRepositoryCheckout(checkouts, fullName);
  const loaded = checkout
    ? await loadConnectionRuntime(organizationId, checkout.connectionId)
    : null;
  return scrubProviderError(reason, loaded?.runtime.secrets ?? {});
}

async function openOne(
  organizationId: string,
  checkouts: readonly ProjectRepositoryCheckout[],
  pushed: Pushed,
  input: PullRequestOpenInput
): Promise<
  { ok: true; pullRequest: OpenedPullRequest } | { ok: false; error: string }
> {
  const checkout = findRepositoryCheckout(checkouts, pushed.fullName);
  if (!checkout) {
    return { ok: false, error: "not a project repository" };
  }
  const loaded = await loadConnectionRuntime(
    organizationId,
    checkout.connectionId
  );
  const repositories = getIntegrationProvider(checkout.provider)?.repositories;
  if (!(loaded && repositories)) {
    return { ok: false, error: "its connection cannot open pull requests" };
  }
  const secrets = loaded.runtime.secrets;
  try {
    const ctx = createProviderContext(loaded.runtime, LOG_PREFIX);
    const repository = await repositories.get(ctx, checkout.externalId);
    if (!repository) {
      return { ok: false, error: "the repository is gone or inaccessible" };
    }
    const created = await repositories.createPullRequest(ctx, {
      repository,
      sourceBranch: pushed.branchName,
      targetBranch: pushed.baseBranch || checkoutBaseBranch(checkout),
      title: input.title,
      description: input.description,
      draft: input.draft,
    });
    if (!created.ok) {
      return { ok: false, error: scrubProviderError(created.error, secrets) };
    }
    return {
      ok: true,
      pullRequest: {
        repository: pushed.fullName,
        url: created.value.url,
        number: created.value.number,
        existing: created.value.existing,
      },
    };
  } catch (error) {
    return { ok: false, error: scrubProviderError(error, secrets) };
  }
}
