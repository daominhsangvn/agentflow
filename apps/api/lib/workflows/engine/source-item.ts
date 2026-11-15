import { Result } from "@repo/api/src/types/result";
import {
  type WorkflowRunError,
  WorkflowRunErrorCode,
} from "@repo/api/src/types/workflow";
import { log } from "@repo/observability/log";
import { createProviderContext } from "@/lib/integrations/connection-service";
import {
  RetryableSourceError,
  type SourceItem,
} from "@/lib/integrations/types";
import { runError, scrubProviderError } from "./errors";
import { readRunSource } from "./run-data";
import { loadSourceConnection } from "./source-connection";
import { type EngineRun, failRun, type StepOutcome } from "./step-outcome";
import { STEP_MAX_ATTEMPTS, stepRetryDelayMs } from "./step-retry";

const LOG_PREFIX = "[workflows/engine]";

export type SourceItemFailure = { error: WorkflowRunError; retryable: boolean };

/**
 * The inline item, else the canonical item fetched with the connection. A
 * RetryableSourceError (rate limited, 5xx, timeout) is reported as retryable.
 */
export async function resolveSourceItem(
  run: EngineRun
): Promise<Result<SourceItem, SourceItemFailure>> {
  const source = readRunSource(run.source);
  if (!source) {
    return sourceError("The run's source item could not be read.");
  }
  if (source.inlineItem) {
    return Result.ok(source.inlineItem);
  }
  const loaded = await loadSourceConnection(run);
  if (!loaded) {
    return sourceError(
      "The integration connection of the trigger is no longer available."
    );
  }
  const fetchItem = loaded.provider.source?.fetchItem;
  if (!fetchItem) {
    return sourceError(
      `${loaded.provider.displayName} cannot fetch source items.`
    );
  }
  try {
    const item = await fetchItem(
      createProviderContext(loaded.runtime, LOG_PREFIX),
      source.item
    );
    return Result.ok(item);
  } catch (error) {
    log.warn("workflow.source_item_load_failed", {
      workflowRunId: run.id,
      organizationId: run.organizationId,
      reason: scrubProviderError(error, loaded.runtime.secrets),
    });
    return sourceError(
      `Could not load ${source.item.key} from ${loaded.provider.displayName}: ${scrubProviderError(error, loaded.runtime.secrets)}`,
      error instanceof RetryableSourceError
    );
  }
}

/** Retry the import after its backoff, or fail once every attempt is used. */
export function retrySourceFetch(
  run: EngineRun,
  error: WorkflowRunError
): StepOutcome {
  const failedAttempts = run.stepAttempts + 1;
  const delayMs = stepRetryDelayMs(failedAttempts);
  if (delayMs === null) {
    return failRun(
      runError(
        WorkflowRunErrorCode.SourceFetchFailed,
        `${error.message} (gave up after ${STEP_MAX_ATTEMPTS} attempts)`
      )
    );
  }
  return { kind: "retry", delayMs, error };
}

function sourceError(
  message: string,
  retryable = false
): Result<never, SourceItemFailure> {
  return Result.err({
    error: runError(WorkflowRunErrorCode.SourceFetchFailed, message),
    retryable,
  });
}
