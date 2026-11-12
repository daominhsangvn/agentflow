import { z } from "zod";
import {
  CONNECTION_GRANT_OPERATIONS_MAX,
  CONNECTION_GRANTS_MAX,
  ConnectionAccess,
  connectionGrantKeySchema,
  PULL_REQUESTS_CONNECTION_KEY,
  SOURCE_CONNECTION_KEY,
  SourceOperation,
} from "./connection-grants.ts";

/**
 * What the orchestrator may write (`agent.orchestrator.connections`). Default
 * `{}`: it only reads the ticket. Checked at save and at every tool call.
 *
 * ```yaml
 * connections:
 *   source: [comment, attach, transition, label, link]
 *   confluence: [publish]     # or read
 *   teams: [ask]              # teams_ask posts in an Ask channel
 *   pull_requests: [open]
 * ```
 */

/** Writes on the case's ticket; `attach` needs `comment`. */
export const OrchestratorSourceOperation = {
  Comment: SourceOperation.Comment,
  Attach: "attach",
  Transition: SourceOperation.Transition,
  Label: SourceOperation.Label,
  Link: SourceOperation.Link,
} as const;
export type OrchestratorSourceOperation =
  (typeof OrchestratorSourceOperation)[keyof typeof OrchestratorSourceOperation];

export const OrchestratorPageOperation = {
  Publish: "publish",
} as const;
export type OrchestratorPageOperation =
  (typeof OrchestratorPageOperation)[keyof typeof OrchestratorPageOperation];

export const OrchestratorPullRequestOperation = {
  Open: "open",
} as const;
export type OrchestratorPullRequestOperation =
  (typeof OrchestratorPullRequestOperation)[keyof typeof OrchestratorPullRequestOperation];

export const OrchestratorPageAccess = {
  Read: "read",
  Publish: "publish",
} as const;
export type OrchestratorPageAccess =
  (typeof OrchestratorPageAccess)[keyof typeof OrchestratorPageAccess];

export const orchestratorConnectionGrantsSchema = z
  .record(
    connectionGrantKeySchema,
    z.union([
      z.literal(ConnectionAccess.Read),
      z
        .array(z.string().trim().min(1))
        .min(1, "List at least one operation")
        .max(CONNECTION_GRANT_OPERATIONS_MAX),
    ])
  )
  .superRefine((grants, ctx) => {
    if (Object.keys(grants).length > CONNECTION_GRANTS_MAX) {
      ctx.addIssue({
        code: "custom",
        message: `At most ${CONNECTION_GRANTS_MAX} connections`,
      });
    }
    for (const [key, grant] of Object.entries(grants)) {
      const message = grantProblem(key, grant);
      if (message) {
        ctx.addIssue({ code: "custom", path: [key], message });
      }
    }
  });
export type OrchestratorConnectionGrants = z.infer<
  typeof orchestratorConnectionGrantsSchema
>;

export type OrchestratorGrantSet = {
  source: ReadonlySet<OrchestratorSourceOperation>;
  pages: ReadonlyMap<string, OrchestratorPageAccess>;
  /** Connection keys granted `ask` (Teams). */
  ask: ReadonlySet<string>;
  pullRequestOpen: boolean;
};

export function resolveOrchestratorGrants(
  grants: OrchestratorConnectionGrants | undefined
): OrchestratorGrantSet {
  const source = new Set<OrchestratorSourceOperation>();
  const pages = new Map<string, OrchestratorPageAccess>();
  const ask = new Set<string>();
  let pullRequestOpen = false;
  for (const [key, grant] of Object.entries(grants ?? {})) {
    const ops = Array.isArray(grant) ? grant : [];
    if (key === SOURCE_CONNECTION_KEY) {
      addSourceOperations(source, ops);
    } else if (key === PULL_REQUESTS_CONNECTION_KEY) {
      pullRequestOpen = ops.includes(OrchestratorPullRequestOperation.Open);
    } else if (ops.includes(OrchestratorTeamsOperation.Ask)) {
      ask.add(key);
    } else {
      const access = pageAccessOf(grant, ops);
      if (access) {
        pages.set(key, access);
      }
    }
  }
  return { source, pages, ask, pullRequestOpen };
}

/** Keys granted `access` or higher (publish implies read). */
export function pageKeysWith(
  set: OrchestratorGrantSet,
  access: OrchestratorPageAccess
): string[] {
  return [...set.pages]
    .filter(
      ([, granted]) =>
        granted === access || granted === OrchestratorPageAccess.Publish
    )
    .map(([key]) => key);
}

function isSourceOperation(op: string): op is OrchestratorSourceOperation {
  return (Object.values(OrchestratorSourceOperation) as string[]).includes(op);
}

function grantProblem(key: string, grant: "read" | string[]): string | null {
  if (key === SOURCE_CONNECTION_KEY) {
    return sourceProblem(grant);
  }
  if (key === PULL_REQUESTS_CONNECTION_KEY) {
    return listProblem(
      `connections.${key}`,
      grant,
      Object.values(OrchestratorPullRequestOperation),
      false
    );
  }
  if (
    Array.isArray(grant) &&
    grant.includes(OrchestratorTeamsOperation.Ask) &&
    grant.some((op) => op !== OrchestratorTeamsOperation.Ask)
  ) {
    return `connections.${key}: ask (Teams) cannot be combined with page operations (read, publish); use a different connection.`;
  }
  return listProblem(
    `connections.${key}`,
    grant,
    [
      ...Object.values(OrchestratorPageOperation),
      ...Object.values(OrchestratorTeamsOperation),
    ],
    true
  );
}

function sourceProblem(grant: "read" | string[]): string | null {
  const problem = listProblem(
    `connections.${SOURCE_CONNECTION_KEY}`,
    grant,
    Object.values(OrchestratorSourceOperation),
    true
  );
  if (problem) {
    return problem;
  }
  if (
    Array.isArray(grant) &&
    grant.includes(OrchestratorSourceOperation.Attach) &&
    !grant.includes(OrchestratorSourceOperation.Comment)
  ) {
    return "connections.source: attach needs comment.";
  }
  return null;
}

function listProblem(
  label: string,
  grant: "read" | string[],
  allowed: string[],
  readAllowed: boolean
): string | null {
  const expected = allowed.join(", ");
  if (!Array.isArray(grant)) {
    return readAllowed ? null : `${label} allows ${expected}, not "read".`;
  }
  const bad = grant.find((op) => !allowed.includes(op));
  return bad === undefined
    ? null
    : `${label} allows ${expected}, not "${bad}".`;
}

/** Operations on a Teams connection. */
export const OrchestratorTeamsOperation = { Ask: "ask" } as const;
export type OrchestratorTeamsOperation =
  (typeof OrchestratorTeamsOperation)[keyof typeof OrchestratorTeamsOperation];

function pageAccessOf(
  grant: "read" | string[],
  ops: string[]
): OrchestratorPageAccess | null {
  if (ops.includes(OrchestratorPageOperation.Publish)) {
    return OrchestratorPageAccess.Publish;
  }
  return grant === ConnectionAccess.Read ? OrchestratorPageAccess.Read : null;
}

function addSourceOperations(
  source: Set<OrchestratorSourceOperation>,
  ops: string[]
): void {
  for (const op of ops) {
    if (isSourceOperation(op)) {
      source.add(op);
    }
  }
}
