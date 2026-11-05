import {
  PULL_REQUESTS_CONNECTION_KEY,
  SOURCE_CONNECTION_KEY,
} from "@repo/api/src/types/connection-grants";
import { IntegrationProviderKey } from "@repo/api/src/types/integration";
import {
  OrchestratorPageAccess,
  OrchestratorPageOperation,
  OrchestratorPullRequestOperation,
  OrchestratorSourceOperation,
} from "@repo/api/src/types/orchestrator-grants";
import type { ProjectConnection } from "@repo/api/src/types/project-connection";
import type { YamlCompletion } from "@repo/app/shared/lib/yaml-completion";
import { YamlCompletionKind } from "@repo/app/shared/lib/yaml-completion";

/** `agent.orchestrator.connections`, as the cursor path names it. */
export const ORCHESTRATOR_GRANTS_PATH = "agent/orchestrator/connections";

/** `source`, `pull_requests` and the Confluence keys of the project. */
export function orchestratorGrantKeys(
  connections: readonly ProjectConnection[],
  existingKeys: readonly string[]
): YamlCompletion[] {
  const confluence = connections
    .filter(
      (connection) => connection.provider === IntegrationProviderKey.Confluence
    )
    .map((connection) => connection.key);
  const keys = [
    SOURCE_CONNECTION_KEY,
    PULL_REQUESTS_CONNECTION_KEY,
    ...new Set(confluence),
  ];
  return keys
    .filter((key) => !existingKeys.includes(key))
    .map((key) => ({
      label: key,
      insert: `${key}: `,
      kind: YamlCompletionKind.Key,
      info: grantKeyInfo(key),
    }));
}

/** The grants offered as the value of one key. */
export function orchestratorGrantValues(key: string): YamlCompletion[] {
  if (key === SOURCE_CONNECTION_KEY) {
    const { Comment, Attach, Transition, Label, Link } =
      OrchestratorSourceOperation;
    return [
      list([Comment], "Comment on the ticket"),
      list([Comment, Attach], "Comment and attach files"),
      list(
        [Comment, Attach, Transition, Label, Link],
        "Every write on the ticket"
      ),
    ];
  }
  if (key === PULL_REQUESTS_CONNECTION_KEY) {
    return [
      list([OrchestratorPullRequestOperation.Open], "Open pull requests"),
    ];
  }
  return [
    scalar(OrchestratorPageAccess.Read, "Read pages"),
    list([OrchestratorPageOperation.Publish], "Publish pages (implies read)"),
  ];
}

function grantKeyInfo(key: string): string {
  if (key === SOURCE_CONNECTION_KEY) {
    return "Writes on the case's ticket";
  }
  if (key === PULL_REQUESTS_CONNECTION_KEY) {
    return "Pull requests the orchestrator may open";
  }
  return "A Confluence connection: read or publish pages";
}

function list(operations: readonly string[], info: string): YamlCompletion {
  return scalar(`[${operations.join(", ")}]`, info);
}

function scalar(label: string, info: string): YamlCompletion {
  return { label, insert: label, kind: YamlCompletionKind.Value, info };
}
