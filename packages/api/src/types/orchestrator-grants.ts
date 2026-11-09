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
  pullRequestOpen: boolean;
};

export function resolveOrchestratorGrants(
  grants: OrchestratorConnectionGrants | undefined
): OrchestratorGrantSet {
  const source = new Set<OrchestratorSourceOperation>();
  const pages = new Map<string, OrchestratorPageAccess>();
  let pullRequestOpen = false;
  for (const [key, grant] of Object.entries(grants ?? {})) {
    const ops = Array.isArray(grant) ? grant : [];
    if (key === SOURCE_CONNECTION_KEY) {
      for (const op of ops) {
        if (isSourceOperation(op)) {
          source.add(op);
        }
      }
    } else if (key === PULL_REQUESTS_CONNECTION_KEY) {
      pullRequestOpen = ops.includes(OrchestratorPullRequestOperation.Open);
    } else if (ops.includes(OrchestratorPageOperation.Publish)) {
      pages.set(key, OrchestratorPageAccess.Publish);
    } else if (grant === ConnectionAccess.Read) {
      pages.set(key, OrchestratorPageAccess.Read);
    }
  }
  return { source, pages, pullRequestOpen };
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
  return listProblem(
    `connections.${key}`,
    grant,
    Object.values(OrchestratorPageOperation),
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
