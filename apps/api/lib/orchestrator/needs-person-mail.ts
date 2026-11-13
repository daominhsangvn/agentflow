import { createHash } from "node:crypto";
import { withDb } from "@repo/database";
import { log } from "@repo/observability/log";
import { projectAgentContactsService } from "@/app/projects/project-agent-contacts-service";
import {
  describeMailFailure,
  isMailConfigured,
  sendMail,
} from "@/lib/mail-transport";
import { workflowAgentCaseUrl } from "@/lib/workflows/engine/links";
import { readAgentConfig } from "@/lib/workflows/engine/run-data";

/**
 * Email to an Agent's contacts when something in an orchestrated case needs a
 * person (docs/orchestrator.md "Email to the Agent's contacts"): a task
 * settled with questions, or a decision was requested. A notification only:
 * what waits, the project, the item, the Agent and a link to the case. It
 * never carries question, option, answer or decision text.
 */

const LOG_PREFIX = "[orchestrator/needs-person-mail]";

export type NeedsPersonMailInput = {
  reason: NeedsPersonReason;
  questionCount: number;
  agentName: string | null;
  projectName: string;
  itemKey: string | null;
  caseTitle: string;
  caseUrl: string;
};

/** The item key of a case source key ("jira:LD-7" → "LD-7"); null without one. */
export function itemKeyOf(sourceKey: string | null): string | null {
  if (sourceKey === null) {
    return null;
  }
  const colon = sourceKey.indexOf(":");
  return colon === -1 ? sourceKey : sourceKey.slice(colon + 1);
}

/** The subject and body of the notification. */
export function buildNeedsPersonMail(input: NeedsPersonMailInput): {
  subject: string;
  text: string;
} {
  const item = input.itemKey
    ? `${input.itemKey} ${input.caseTitle}`
    : input.caseTitle;
  const agent = input.agentName ?? "the orchestrator";
  const isQuestions = input.reason === NeedsPersonReason.Questions;
  const subject = isQuestions
    ? `[AgentFlow] ${agent} has questions for you: ${item}`
    : `[AgentFlow] A decision is waiting: ${item}`;
  const noun = input.questionCount === 1 ? "question" : "questions";
  const headline = isQuestions
    ? `Agent ${agent} has ${input.questionCount} ${noun} waiting for an answer.`
    : "A decision is waiting for a person.";
  const text = [
    headline,
    "",
    `Project: ${input.projectName}`,
    `Item: ${item}`,
    `Agent: ${agent}`,
    "",
    `Open the case to answer: ${input.caseUrl}`,
    "",
    "This email is only a notification; replies to it are not read.",
  ].join("\n");
  return { subject, text };
}

/** Emails the contacts of the task's Agent that it has questions. */
export async function mailTaskQuestions(input: {
  taskId: string;
  questionCount: number;
}): Promise<void> {
  if (input.questionCount === 0 || !isMailConfigured()) {
    return;
  }
  const task = await withDb((db) =>
    db.orchestratorTask.findUnique({
      where: { id: input.taskId },
      select: {
        organizationId: true,
        computeTargetId: true,
        organization: { select: { slug: true } },
        computeTarget: { select: { machineName: true } },
        case: {
          select: {
            id: true,
            title: true,
            sourceKey: true,
            workflowId: true,
            projectId: true,
            project: { select: { name: true } },
          },
        },
      },
    })
  );
  if (!task || task.computeTargetId === null) {
    return;
  }
  const mail = buildNeedsPersonMail({
    reason: NeedsPersonReason.Questions,
    questionCount: input.questionCount,
    agentName: task.computeTarget?.machineName ?? null,
    projectName: task.case.project.name,
    itemKey: itemKeyOf(task.case.sourceKey),
    caseTitle: task.case.title,
    caseUrl: workflowAgentCaseUrl(
      task.organization.slug,
      task.case.workflowId,
      task.case.id,
      task.computeTargetId
    ),
  });
  await sendToContacts({
    organizationId: task.organizationId,
    projectId: task.case.projectId,
    computeTargetId: task.computeTargetId,
    idPrefix: `orchestrator-task-questions-${input.taskId}`,
    mail,
  });
}

/**
 * Emails the contacts of the case's orchestrator Agent that a decision is
 * waiting.
 */
export async function mailDecisionRequested(input: {
  decisionId: string;
}): Promise<void> {
  if (!isMailConfigured()) {
    return;
  }
  const decision = await withDb((db) =>
    db.orchestratorDecision.findUnique({
      where: { id: input.decisionId },
      select: {
        organizationId: true,
        organization: { select: { slug: true } },
        case: {
          select: {
            id: true,
            title: true,
            sourceKey: true,
            workflowId: true,
            projectId: true,
            project: { select: { name: true } },
            workflow: { select: { agentConfig: true } },
          },
        },
      },
    })
  );
  if (!decision) {
    return;
  }
  const computeTargetId = readAgentConfig(
    decision.case.workflow.agentConfig
  )?.computeTargetId;
  if (!computeTargetId) {
    return;
  }
  const agent = await withDb((db) =>
    db.computeTarget.findFirst({
      where: { id: computeTargetId, organizationId: decision.organizationId },
      select: { machineName: true },
    })
  );
  const mail = buildNeedsPersonMail({
    reason: NeedsPersonReason.Decision,
    questionCount: 0,
    agentName: agent?.machineName ?? null,
    projectName: decision.case.project.name,
    itemKey: itemKeyOf(decision.case.sourceKey),
    caseTitle: decision.case.title,
    caseUrl: workflowAgentCaseUrl(
      decision.organization.slug,
      decision.case.workflowId,
      decision.case.id,
      null
    ),
  });
  await sendToContacts({
    organizationId: decision.organizationId,
    projectId: decision.case.projectId,
    computeTargetId,
    idPrefix: `orchestrator-decision-${input.decisionId}`,
    mail,
  });
}

export const NeedsPersonReason = {
  Questions: "questions",
  Decision: "decision",
} as const;
export type NeedsPersonReason =
  (typeof NeedsPersonReason)[keyof typeof NeedsPersonReason];

/**
 * One email per contact, each in turn and each on its own, so one refusal
 * does not keep the others from theirs. Message-IDs are stable per recipient
 * and event.
 */
async function sendToContacts(input: {
  organizationId: string;
  projectId: string;
  computeTargetId: string;
  idPrefix: string;
  mail: { subject: string; text: string };
}): Promise<void> {
  const recipients = await projectAgentContactsService.recipientEmails(
    input.organizationId,
    input.projectId,
    input.computeTargetId
  );
  for (const recipient of recipients) {
    try {
      await sendMail({
        to: recipient,
        subject: input.mail.subject,
        text: input.mail.text,
        messageId: `<${input.idPrefix}.${hash12(recipient)}@agentflow>`,
      });
    } catch (error) {
      const failure = describeMailFailure(error);
      log.warn(`${LOG_PREFIX} send failed`, {
        idPrefix: input.idPrefix,
        retryable: failure.retryable,
        error: failure.message,
      });
    }
  }
}

function hash12(email: string): string {
  return createHash("sha256").update(email).digest("hex").slice(0, 12);
}
