import { LOOP_STEP_INPUTS_MAX } from "@agentflow-ai/loops-api/loop-step";
import type { IntegrationToolDescriptor } from "@repo/api/src/types/integration-tools";
import {
  ORCHESTRATOR_ASKED_HUMAN_MAX,
  OrchestratorDocumentKind,
  OrchestratorReplyTarget,
  OrchestratorToolName,
  OrchestratorWaitKind,
} from "@repo/api/src/types/orchestrator";
import {
  type OrchestratorGrantSet,
  OrchestratorPageAccess,
  OrchestratorSourceOperation,
  pageKeysWith,
} from "@repo/api/src/types/orchestrator-grants";
import { RunnerCommandMode } from "@repo/api/src/types/runner-capabilities";
import {
  KEEPS,
  NO_ARGUMENTS,
  PAGE_FILE_REF,
  POSTS,
  READS,
  STOPS,
  TASK_FILE_REF,
} from "./annotations";
import { REPLY_ATTACHMENTS_MAX } from "./attachments";
import { NOTIFY_MESSAGE_MAX } from "./case-notify";
import {
  NOTES_MAX,
  REPLY_MAX,
  TASK_PROMPT_MAX,
  WAIT_TASKS_MAX,
  WAIT_TIMEOUT_MAX_MINUTES,
} from "./limits";
import type { OrchestratorToolFeatures } from "./turn";

const INSTRUCTIONS =
  "Tools of the project orchestrator for one turn of one conversation. reply posts in the conversation's thread; case_get and case_update_notes read and keep the case; runners_list shows what each runner can do; source_item_get reads the conversation's item; case_notify wakes the case of another item of this workflow (e.g. the items this one blocks); task_run sends a runner one of its commands, task_get reads a task and task_cancel stops one, only in a turn that handles a ticket change the workflow's cancelOn lists. A task's files come back with its result; reply attaches them (attachments) and task_run hands them to a later task (files). End the turn with wait_for (the tasks you started), wait_human or close_case. A write refused as superseded means a newer message arrived: end the turn with wait_human and a one-line note; the next turn answers both. Refused calls are recorded on the case.";

export const TOOLS: IntegrationToolDescriptor[] = [
  {
    name: OrchestratorToolName.CaseGet,
    title: "Read the case",
    description:
      "The case as AgentFlow records it (CASE.md): its notes, conversations with their latest messages, tasks and decisions.",
    inputSchema: NO_ARGUMENTS,
    annotations: READS,
  },
  {
    name: OrchestratorToolName.CaseUpdateNotes,
    title: "Save the case's notes",
    description:
      "Replaces the case's notes: what later turns must know (decisions, open questions, who was asked what). Read them with case_get first and keep what still holds.",
    inputSchema: {
      type: "object",
      properties: { notes: { type: "string", maxLength: NOTES_MAX } },
      required: ["notes"],
      additionalProperties: false,
    },
    annotations: KEEPS,
  },
  {
    name: OrchestratorToolName.RunnersList,
    title: "List the runners",
    description:
      "Each runner of the project with its AGENTFLOW.md: the commands it declares (mode read or write, what each produces and needs), its skills and whether it is online.",
    inputSchema: NO_ARGUMENTS,
    annotations: READS,
  },
  {
    name: OrchestratorToolName.SourceItemGet,
    title: "Read the item",
    description:
      "The conversation's source item (the ticket, the Teams thread): title, status, description, latest comments, attachment names, and its blocking relations: blockedBy (items it waits for) and blocks (items waiting for it), each with key, title, status and url.",
    inputSchema: NO_ARGUMENTS,
    annotations: READS,
  },
  {
    name: OrchestratorToolName.SourceItemTransition,
    title: "Move the item",
    description:
      "Moves this case's own item to another status: transitionName is the transition's name (Jira) or the state (Azure DevOps). Refused when the transition is not available from the item's current status. The change is recorded on the case.",
    inputSchema: {
      type: "object",
      properties: {
        transitionName: { type: "string", minLength: 1, maxLength: 128 },
      },
      required: ["transitionName"],
      additionalProperties: false,
    },
    annotations: POSTS,
  },
  {
    name: OrchestratorToolName.SourceItemLabel,
    title: "Label the item",
    description:
      "Adds and removes labels (Jira) or tags (Azure DevOps) on this case's own item. The change is recorded on the case.",
    inputSchema: {
      type: "object",
      properties: {
        add: { type: "array", maxItems: 20, items: { type: "string" } },
        remove: { type: "array", maxItems: 20, items: { type: "string" } },
      },
      additionalProperties: false,
    },
    annotations: POSTS,
  },
  {
    name: OrchestratorToolName.SourceItemLink,
    title: "Add a link to the item",
    description:
      "Adds a web link with a title to this case's own item, e.g. the Confluence page of a plan.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        title: { type: "string", minLength: 1, maxLength: 255 },
      },
      required: ["url", "title"],
      additionalProperties: false,
    },
    annotations: POSTS,
  },
  {
    name: OrchestratorToolName.Reply,
    title: "Reply in the thread",
    description:
      "Posts a markdown message in this conversation's thread (a comment on the ticket, a Teams reply), or on the case page with where: case_page (the default for a message written on the case page). A reply to it comes back to this conversation. replyTo: the ref of the <message> you answer, so the answer lands in that comment's thread (answer each comment in its own thread; omit it for a ticket change, which is answered with a new comment). attachments: files of this case's tasks (task_get, wait results) to attach to the item first and show under the message (Jira); refused where the thread takes no files (Teams).",
    inputSchema: {
      type: "object",
      properties: {
        text: { type: "string", minLength: 1, maxLength: REPLY_MAX },
        replyTo: { type: "string", minLength: 1, maxLength: 255 },
        where: {
          type: "string",
          enum: Object.values(OrchestratorReplyTarget),
          description:
            "thread (a comment on the item) or case_page (shown on the case page in AgentFlow only; no files). Default: where the message you answer came from (a message from AgentFlow is answered on the case page).",
        },
        attachments: {
          type: "array",
          maxItems: REPLY_ATTACHMENTS_MAX,
          items: TASK_FILE_REF,
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
    annotations: POSTS,
  },
  {
    name: OrchestratorToolName.TaskRun,
    title: "Run a command on a runner",
    description:
      "Starts one of a runner's declared commands as a task (runners_list). The runner works on the case in its own workspace; the task's answer, questions and files come back when it ends (wait_for). A task resumes an earlier task's session on the same runner with resumeTaskId (fork: in a copy, leaving that session as it was), e.g. to answer the questions it asked or to ask about its plan. It is refused when the runner does not declare the command, when write mode is asked for a read command, or when a file the command needs (its needs, produced by another command's attach) is neither in files nor attached to the ticket.",
    inputSchema: {
      type: "object",
      properties: {
        runner: { type: "string", description: "The runner's name." },
        command: {
          type: "string",
          description:
            "A slash command the runner declares, e.g. /writing-plans.",
        },
        args: {
          type: "string",
          description: "Its arguments, e.g. the ticket key.",
        },
        prompt: {
          type: "string",
          maxLength: TASK_PROMPT_MAX,
          description:
            "What you want from this task and the context it needs (the request, decisions, earlier answers): the runner sees only this and the case.",
        },
        mode: {
          type: "string",
          enum: Object.values(RunnerCommandMode),
          description:
            "read (changes nothing) or write; default: what the command declares.",
        },
        resumeTaskId: { type: "string" },
        fork: { type: "boolean" },
        files: {
          type: "array",
          maxItems: LOOP_STEP_INPUTS_MAX,
          items: { oneOf: [TASK_FILE_REF, PAGE_FILE_REF] },
          description:
            "Text files of earlier tasks of this case (e.g. PRD-LD-5.md), or {page, name}: the page's current content as that file, the runner finds them in its work directory's inputs/.",
        },
        replyTo: {
          type: "string",
          minLength: 1,
          maxLength: 255,
          description:
            "The ref of the <message> (comment) this task answers: it comes back with the task's result (task_get, wait results) so the answer goes in that comment's thread with reply replyTo.",
        },
      },
      required: ["runner", "command"],
      additionalProperties: false,
    },
    annotations: POSTS,
  },
  {
    name: OrchestratorToolName.TaskGet,
    title: "Read a task",
    description:
      "A task of this case: its status (queued, running, succeeded, failed, cancelled), its answer, the questions it asks (a question with commentId was already asked on the item by its agent), its error and its files.",
    inputSchema: {
      type: "object",
      properties: { taskId: { type: "string" } },
      required: ["taskId"],
      additionalProperties: false,
    },
    annotations: READS,
  },
  {
    name: OrchestratorToolName.TaskCancel,
    title: "Cancel a task",
    description:
      "Stops a task that belongs to the status or label the ticket left: a running task's loop is stopped, a queued one never starts, a finished one can no longer be resumed. Only in a turn that handles a ticket change the workflow's cancelOn lists (status_changed, label_removed by default); a comment, question or reply never cancels a task.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        reason: { type: "string", maxLength: 500 },
      },
      required: ["taskId", "reason"],
      additionalProperties: false,
    },
    annotations: STOPS,
  },
  {
    name: OrchestratorToolName.WaitFor,
    title: "Wait for tasks",
    description:
      "Ends the turn waiting for tasks: all of them (default) or the first (kind any). A failed task wakes you at once unless wakeOnFailure is false; timeoutMinutes wakes you with where they are.",
    inputSchema: {
      type: "object",
      properties: {
        taskIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: WAIT_TASKS_MAX,
        },
        kind: { type: "string", enum: Object.values(OrchestratorWaitKind) },
        timeoutMinutes: {
          type: "integer",
          minimum: 1,
          maximum: WAIT_TIMEOUT_MAX_MINUTES,
        },
        wakeOnFailure: { type: "boolean" },
      },
      required: ["taskIds"],
      additionalProperties: false,
    },
    annotations: KEEPS,
  },
  {
    name: OrchestratorToolName.RequestDecision,
    title: "Ask people to decide",
    description:
      "Asks for an approval (a plan, a go to implement, a comment before it is posted): stores a pending decision and posts the question with where: thread (on the item, with the case's link; needs source: comment) or case_page (in AgentFlow only; no grant); under approvals: required only case_page. Default: where the message you answer came from. An admin approves or rejects in AgentFlow; someone may also answer in the thread or on the case page: record_decision then. Put what should go on the item in draft (the whole comment, never a summary; and/or the status move): people see it in full, and on approval AgentFlow posts it itself; never post it again. End the turn with wait_human.",
    inputSchema: {
      type: "object",
      properties: {
        question: { type: "string", minLength: 1, maxLength: 4000 },
        where: {
          type: "string",
          enum: Object.values(OrchestratorReplyTarget),
          description:
            "thread (the item's thread) or case_page (only the case page in AgentFlow; nothing is posted on the item). Default: where the message you answer came from.",
        },
        draft: {
          type: "object",
          properties: {
            comment: {
              type: "object",
              properties: {
                text: { type: "string", minLength: 1, maxLength: REPLY_MAX },
                replyTo: { type: "string" },
                attachments: {
                  type: "array",
                  maxItems: REPLY_ATTACHMENTS_MAX,
                  items: {
                    type: "object",
                    properties: {
                      taskId: { type: "string" },
                      name: { type: "string" },
                    },
                    required: ["taskId", "name"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["text"],
              additionalProperties: false,
            },
            transitionName: { type: "string", minLength: 1, maxLength: 128 },
          },
          additionalProperties: false,
        },
      },
      required: ["question"],
      additionalProperties: false,
    },
    annotations: POSTS,
  },
  {
    name: OrchestratorToolName.RecordDecision,
    title: "Record a decision",
    description:
      "Records the decision someone gave in the thread on a pending decision (request_decision): who, approved or not, and what they said. A decision with a draft: approving it here carries the draft out, except under approvals: required, where only an admin's Approve button approves a draft (rejecting still works).",
    inputSchema: {
      type: "object",
      properties: {
        decisionId: { type: "string" },
        approved: { type: "boolean" },
        decidedBy: { type: "string" },
        comment: { type: "string", maxLength: 4000 },
      },
      required: ["decisionId", "approved", "decidedBy"],
      additionalProperties: false,
    },
    annotations: KEEPS,
  },
  {
    name: OrchestratorToolName.EditReply,
    title: "Edit a posted message",
    description:
      "Replaces the text of a message this conversation posted (its reference from reply), e.g. the summary of a plan once a new version is out; version records which version it shows. It takes no files: post a new reply for a new version of a file.",
    inputSchema: {
      type: "object",
      properties: {
        reference: { type: "string" },
        text: { type: "string", minLength: 1, maxLength: REPLY_MAX },
        version: { type: "integer", minimum: 1 },
      },
      required: ["reference", "text"],
      additionalProperties: false,
    },
    annotations: POSTS,
  },
  {
    name: OrchestratorToolName.WaitHuman,
    title: "Wait for people",
    description:
      "Ends the turn waiting for people: an answer, a decision or the next request wakes the conversation. Set asked (one line) when you asked people something and wait for their answer: AgentFlow shows the case as needing a person. Omit it when you only wait for the next request.",
    inputSchema: {
      type: "object",
      properties: {
        asked: { type: "string", maxLength: ORCHESTRATOR_ASKED_HUMAN_MAX },
      },
      additionalProperties: false,
    },
    annotations: KEEPS,
  },
  {
    name: OrchestratorToolName.CloseCase,
    title: "Close the case",
    description:
      "Ends the turn and closes the case: the work is done. A new message reopens it.",
    inputSchema: {
      type: "object",
      properties: { summary: { type: "string", maxLength: 2000 } },
      additionalProperties: false,
    },
    annotations: KEEPS,
  },
  {
    name: OrchestratorToolName.PagePublish,
    title: "Publish a Confluence page",
    description:
      "Creates or updates a Confluence page of the project's spaces from a task's Markdown file. With page it updates that page, else it finds the page with that title under the parent (default the project's parent page, \"root\" for the top of the space) or creates it. attachments (screenshots) are uploaded to the page and images are shown in it. It refuses to replace people's edits unless overwrite. Returns pageId, url, version; the case records it under Documents.",
    inputSchema: {
      type: "object",
      properties: {
        file: TASK_FILE_REF,
        title: { type: "string", minLength: 1, maxLength: 255 },
        kind: {
          type: "string",
          enum: Object.values(OrchestratorDocumentKind),
        },
        page: { type: "string", description: "A page id or URL to update." },
        parent: {
          type: "string",
          description: 'A page id or URL, or "root".',
        },
        space: { type: "string" },
        attachments: { type: "array", maxItems: 10, items: TASK_FILE_REF },
        overwrite: { type: "boolean" },
        connection: { type: "string" },
      },
      required: ["file", "title"],
      additionalProperties: false,
    },
    annotations: POSTS,
  },
  {
    name: OrchestratorToolName.PageGet,
    title: "Read a Confluence page",
    description:
      "Reads a page of the project's spaces: its current Markdown, version, url and last editor.",
    inputSchema: {
      type: "object",
      properties: { page: { type: "string" }, connection: { type: "string" } },
      required: ["page"],
      additionalProperties: false,
    },
    annotations: READS,
  },
  {
    name: OrchestratorToolName.PullRequestOpen,
    title: "Open the pull request of a task",
    description:
      "Opens the pull request of each branch a succeeded task pushed (a command with push on an auto runner); reuses an open one.",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        title: { type: "string", minLength: 1 },
        description: { type: "string" },
        draft: { type: "boolean" },
      },
      required: ["taskId", "title"],
      additionalProperties: false,
    },
    annotations: POSTS,
  },
  {
    name: OrchestratorToolName.CaseNotify,
    title: "Notify another case",
    description:
      "Sends a message to the case of another item in this workflow (itemKey, e.g. a key from blocks of source_item_get) and wakes its orchestrator, which re-reads its item and acts on its current status. Use it when this item reaches a status the other item waits for (a blocker resolved). Refused when no case of this workflow is about that item, or for this case's own item. Needs no grant.",
    inputSchema: {
      type: "object",
      properties: {
        itemKey: { type: "string", minLength: 1, maxLength: 255 },
        message: {
          type: "string",
          minLength: 1,
          maxLength: NOTIFY_MESSAGE_MAX,
        },
      },
      required: ["itemKey", "message"],
      additionalProperties: false,
    },
    annotations: POSTS,
  },
  {
    name: OrchestratorToolName.CaseLookup,
    title: "Read another item's case",
    description:
      "The CASE.md of each case of this project about itemKey (any workflow), read only: notes, tasks, decisions, conversations. Use it to answer questions about another item in this conversation; it changes nothing and links nothing.",
    inputSchema: {
      type: "object",
      properties: {
        itemKey: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["itemKey"],
      additionalProperties: false,
    },
    annotations: READS,
  },
  {
    name: OrchestratorToolName.CaseHandoff,
    title: "Send an approved summary to another item's case",
    description:
      "Writes the summary people approved in this conversation (the question of an approved decision of this case, copied by AgentFlow) into the case of itemKey in this project, where its orchestrator acts on it. Only after request_decision with that summary was approved. Each decision is sent once. Refused when several cases are about the item and caseId is missing (the refusal lists them).",
    inputSchema: {
      type: "object",
      properties: {
        decisionId: { type: "string" },
        itemKey: { type: "string", minLength: 1, maxLength: 200 },
        caseId: { type: "string" },
      },
      required: ["decisionId", "itemKey"],
      additionalProperties: false,
    },
    annotations: POSTS,
  },
];

/** The tools whose grant is on the source item, by the operation they need. */
const SOURCE_TOOL_OPERATIONS: Record<string, OrchestratorSourceOperation> = {
  [OrchestratorToolName.SourceItemTransition]:
    OrchestratorSourceOperation.Transition,
  [OrchestratorToolName.SourceItemLabel]: OrchestratorSourceOperation.Label,
  [OrchestratorToolName.SourceItemLink]: OrchestratorSourceOperation.Link,
};

/** The instructions of a turn: the base text and the writes it was granted. */
export function buildInstructions(
  grants: OrchestratorGrantSet,
  features: OrchestratorToolFeatures
): string {
  return `${INSTRUCTIONS} ${describeGrants(grants)} A tool that is not granted is refused.${describeFeatures(features)}`;
}

/** The tools a turn may use: the ones whose grant is absent are left out. */
export function visibleTools(
  grants: OrchestratorGrantSet,
  features: OrchestratorToolFeatures
): IntegrationToolDescriptor[] {
  const canRead = pageKeysWith(grants, OrchestratorPageAccess.Read).length > 0;
  const canPublish =
    pageKeysWith(grants, OrchestratorPageAccess.Publish).length > 0;
  return TOOLS.filter((tool) => {
    const operation = SOURCE_TOOL_OPERATIONS[tool.name];
    if (operation) {
      return grants.source.has(operation);
    }
    switch (tool.name) {
      case OrchestratorToolName.PageGet:
        return canRead;
      case OrchestratorToolName.PagePublish:
        return canPublish;
      case OrchestratorToolName.PullRequestOpen:
        return grants.pullRequestOpen;
      case OrchestratorToolName.CaseLookup:
        return features.caseLookup;
      case OrchestratorToolName.CaseHandoff:
        return features.caseHandoff;
      default:
        return true;
    }
  });
}

function describeGrants(grants: OrchestratorGrantSet): string {
  const parts: string[] = [];
  if (grants.source.size > 0) {
    parts.push(`on the ticket: ${[...grants.source].join(", ")}`);
  }
  const publish = pageKeysWith(grants, OrchestratorPageAccess.Publish);
  const readOnly = pageKeysWith(grants, OrchestratorPageAccess.Read).filter(
    (key) => !publish.includes(key)
  );
  if (readOnly.length > 0) {
    parts.push(
      `Confluence read: ${readOnly.join(", ")} (${OrchestratorToolName.PageGet})`
    );
  }
  if (publish.length > 0) {
    parts.push(
      `Confluence publish: ${publish.join(", ")} (${OrchestratorToolName.PageGet}, ${OrchestratorToolName.PagePublish})`
    );
  }
  if (grants.pullRequestOpen) {
    parts.push(`pull requests: open (${OrchestratorToolName.PullRequestOpen})`);
  }
  if (parts.length === 0) {
    return "Granted writes: none, you only read the ticket.";
  }
  return `Granted writes: ${parts.join("; ")}.`;
}

function describeFeatures(features: OrchestratorToolFeatures): string {
  const parts: string[] = [];
  if (features.caseLookup) {
    parts.push(
      `${OrchestratorToolName.CaseLookup} reads the case of another item of this project (read only).`
    );
  }
  if (features.caseHandoff) {
    parts.push(
      `${OrchestratorToolName.CaseHandoff} sends a summary people approved (${OrchestratorToolName.RequestDecision}) to another item's case.`
    );
  }
  if (features.approvalsRequired) {
    parts.push(
      `Approvals are required: ${OrchestratorToolName.Reply} on the thread, ${OrchestratorToolName.EditReply} and the source_item_* writes are refused; put the comment or the move in ${OrchestratorToolName.RequestDecision}'s draft, where: case_page; AgentFlow carries it out once an admin presses Approve (${OrchestratorToolName.RecordDecision} cannot approve a draft).`
    );
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}
