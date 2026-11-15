import { z } from "zod";
import type { AgentKind } from "./agent-fleet.ts";

/**
 * Runners of a project: the computers (compute targets) its agent loops run
 * on. Every runner of a project needs the toolchains of all of its
 * repositories (e.g. .NET, Rust and Node.js for a project with one repository
 * of each), so assign runners that are set up alike. A new loop goes to the
 * least busy one that is online; a loop that continues another (EXECUTE after
 * PLAN) stays on the runner holding its state. A project without runners
 * runs on the computer chosen by the user (or the workflow). Stored in the
 * `project_agents` table (not in the project's `settings`).
 */

export const PROJECT_RUNNERS_MAX = 10;

export type ProjectRunner = {
  id: string;
  machineName: string;
  isOnline: boolean;
  isSharedWithOrg: boolean;
  /** Personal Agents belong to one project; automatic ones are shared. */
  kind: AgentKind;
  ownerName: string | null;
  /** Loops it runs at once; null when it did not report it. */
  capacity: number | null;
  /** Loops waiting for it or running on it now. */
  activeLoops: number;
  /**
   * Version of each tool and toolchain it reported, e.g.
   * `{ git: "git version 2.39.5", dotnet: "8.0.404" }`.
   */
  tools: Record<string, string>;
  /**
   * Who is emailed when its orchestrated case needs a person (questions or a
   * decision). Empty for waiting Agents.
   */
  contacts: ProjectAgentContact[];
};

export type ProjectRunners = {
  runners: ProjectRunner[];
  /** The project's key (slug); personal Agents register against it. */
  projectKey: string | null;
  /** Personal Agents registered for this project and not added yet. */
  waiting: ProjectRunner[];
};

export const updateProjectRunnersInputSchema = z.object({
  runnerIds: z.array(z.uuid()).max(PROJECT_RUNNERS_MAX),
});
export type UpdateProjectRunnersInput = z.infer<
  typeof updateProjectRunnersInputSchema
>;

/**
 * The project key (slug) of a personal Agent; null for an automatic Agent.
 */
export function readPersonalAgentProjectKey(
  capabilities: unknown
): string | null {
  const parsed = z
    .object({
      personalRunner: z.object({ projectKey: z.string().trim().min(1) }),
    })
    .safeParse(capabilities);
  return parsed.success ? parsed.data.personalRunner.projectKey : null;
}

export const PROJECT_AGENT_CONTACTS_MAX = 20;

export const ProjectAgentContactKind = {
  Member: "member",
  External: "external",
} as const;
export type ProjectAgentContactKind =
  (typeof ProjectAgentContactKind)[keyof typeof ProjectAgentContactKind];

/** A member contact carries the member's current email and name; an external one has no name. */
export type ProjectAgentContact = {
  id: string;
  kind: ProjectAgentContactKind;
  userId: string | null;
  email: string;
  name: string | null;
};

export const projectAgentContactInputSchema = z.union([
  z.strictObject({ userId: z.uuid() }),
  z.strictObject({
    email: z
      .string()
      .trim()
      .toLowerCase()
      .max(320)
      .pipe(z.email("Write an email address")),
  }),
]);
export type ProjectAgentContactInput = z.infer<
  typeof projectAgentContactInputSchema
>;

export const updateProjectAgentContactsInputSchema = z.object({
  contacts: z
    .array(projectAgentContactInputSchema)
    .max(PROJECT_AGENT_CONTACTS_MAX),
});
export type UpdateProjectAgentContactsInput = z.infer<
  typeof updateProjectAgentContactsInputSchema
>;
