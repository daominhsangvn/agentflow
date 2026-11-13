import {
  type ProjectAgentContact,
  ProjectAgentContactKind,
  type UpdateProjectAgentContactsInput,
} from "@repo/api/src/types/project-runners";
import { Result, Status } from "@repo/api/src/types/result";
import { withDb } from "@repo/database";
import { getPrismaErrorCode } from "@/lib/db-utils";
import type { ProjectRunnersServiceError } from "./project-runners-service";

/**
 * Who is emailed when an Agent's orchestrated case needs a person: org
 * members (their current email is read at send time) and external addresses.
 */
export const projectAgentContactsService = {
  /** Contacts of each Agent of the project, by compute target id. */
  async listByProject(
    organizationId: string,
    projectId: string
  ): Promise<Map<string, ProjectAgentContact[]>> {
    const agents = await withDb((db) =>
      db.projectAgent.findMany({
        where: { organizationId, projectId },
        select: {
          computeTargetId: true,
          contacts: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              userId: true,
              email: true,
              user: { select: userSelect },
            },
          },
        },
      })
    );
    return new Map(
      agents.map((agent) => [
        agent.computeTargetId,
        agent.contacts.flatMap((contact) => toContact(contact, organizationId)),
      ])
    );
  },

  /** Replaces the contacts of one of the project's Agents. */
  async replace(
    organizationId: string,
    projectId: string,
    computeTargetId: string,
    input: UpdateProjectAgentContactsInput
  ): Promise<Result<void, ProjectRunnersServiceError>> {
    const agent = await withDb((db) =>
      db.projectAgent.findFirst({
        where: { organizationId, projectId, computeTargetId },
        select: { id: true },
      })
    );
    if (!agent) {
      return serviceError(Status.NotFound, AGENT_NOT_IN_PROJECT);
    }
    const userIds = new Set<string>();
    const emails = new Set<string>();
    const order: ({ userId: string } | { email: string })[] = [];
    for (const contact of input.contacts) {
      if ("userId" in contact && !userIds.has(contact.userId)) {
        userIds.add(contact.userId);
        order.push({ userId: contact.userId });
      } else if ("email" in contact && !emails.has(contact.email)) {
        emails.add(contact.email);
        order.push({ email: contact.email });
      }
    }
    if (userIds.size > 0) {
      const members = await withDb((db) =>
        db.user.findMany({
          where: { id: { in: [...userIds] }, organizationId, active: true },
          select: { id: true },
        })
      );
      if (members.length !== userIds.size) {
        return serviceError(
          Status.BadRequest,
          "Choose members of this organization"
        );
      }
    }
    try {
      await withDb.tx(async (tx) => {
        await tx.projectAgentContact.deleteMany({
          where: { projectAgentId: agent.id },
        });
        if (order.length > 0) {
          await tx.projectAgentContact.createMany({
            data: order.map((contact) => ({
              projectAgentId: agent.id,
              userId: "userId" in contact ? contact.userId : null,
              email: "email" in contact ? contact.email : null,
            })),
          });
        }
      });
    } catch (error) {
      // The Agent was removed from the project after the lookup above.
      if (getPrismaErrorCode(error) === FOREIGN_KEY_ERROR_CODE) {
        return serviceError(Status.NotFound, AGENT_NOT_IN_PROJECT);
      }
      throw error;
    }
    return Result.ok(undefined);
  },

  /**
   * Emails of the Agent's contacts in the project: active members' current
   * email and external addresses, lowercased, without duplicates.
   */
  async recipientEmails(
    organizationId: string,
    projectId: string,
    computeTargetId: string
  ): Promise<string[]> {
    const agent = await withDb((db) =>
      db.projectAgent.findFirst({
        where: { organizationId, projectId, computeTargetId },
        select: {
          contacts: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              id: true,
              userId: true,
              email: true,
              user: { select: userSelect },
            },
          },
        },
      })
    );
    const emails = (agent?.contacts ?? []).flatMap((contact) => {
      const mapped = toContact(contact, organizationId);
      return mapped.map((entry) => entry.email.toLowerCase());
    });
    return [...new Set(emails)];
  },

  /** Removes a member from every Agent's contacts; returns how many rows went. */
  async removeMember(organizationId: string, userId: string): Promise<number> {
    const removed = await withDb((db) =>
      db.projectAgentContact.deleteMany({
        where: { userId, projectAgent: { organizationId } },
      })
    );
    return removed.count;
  },
};

const userSelect = {
  email: true,
  firstName: true,
  lastName: true,
  active: true,
  organizationId: true,
} as const;

type ContactRow = {
  id: string;
  userId: string | null;
  email: string | null;
  user: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    active: boolean;
    organizationId: string;
  } | null;
};

/** The contact as the API shows it; none for a member who is inactive or elsewhere. */
function toContact(
  row: ContactRow,
  organizationId: string
): ProjectAgentContact[] {
  if (row.userId !== null) {
    const { user } = row;
    if (!user?.active || user.organizationId !== organizationId) {
      return [];
    }
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
    return [
      {
        id: row.id,
        kind: ProjectAgentContactKind.Member,
        userId: row.userId,
        email: user.email,
        name: name || null,
      },
    ];
  }
  if (row.email === null) {
    return [];
  }
  return [
    {
      id: row.id,
      kind: ProjectAgentContactKind.External,
      userId: null,
      email: row.email,
      name: null,
    },
  ];
}

function serviceError<T>(
  status: ProjectRunnersServiceError["status"],
  message: string
): Result<T, ProjectRunnersServiceError> {
  return Result.err({ status, message });
}

const FOREIGN_KEY_ERROR_CODE = "P2003";
const AGENT_NOT_IN_PROJECT = "That Agent is not one of the project's Agents";
