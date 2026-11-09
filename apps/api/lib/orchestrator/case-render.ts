import {
  DOCUMENT_KIND_LABELS,
  OrchestratorDraftOutcome,
  OrchestratorMessageOrigin,
  OrchestratorMessageVia,
  OrchestratorTaskStatus,
  orchestratorDecisionDraftResultSchema,
  readOrchestratorMessageVia,
} from "@repo/api/src/types/orchestrator";
import { withDb } from "@repo/database";
import { askedOnItem } from "./asked-questions";
import { listCaseDocuments } from "./case-documents";
import { readChannel } from "./channel";
import { readStoredDraft, type StoredDecisionDraft } from "./decision-draft";
import { readTaskResult } from "./task-result";
import { isTicketChangeKind } from "./ticket-change";

/**
 * CASE.md: a case as the database knows it, rendered for the orchestrator's
 * prompt and `case_get` (docs/orchestrator.md). The orchestrator's session is
 * a cache; this is the record a turn trusts. Each task line says what started
 * it (a status, a label or a message), so task_cancel can stop the right ones.
 * Tasks and Decisions come before the conversations so that the prompt's
 * CASE_MAX slice (turn-prompt.ts) cuts conversations first.
 */

const RECENT_MESSAGES = 5;
const RECENT_TASKS = 20;
const TEXT_PREVIEW = 600;
const STARTED_FOR_MESSAGES = 10;

export async function renderCase(caseId: string): Promise<string> {
  const found = await withDb((db) =>
    db.orchestratorCase.findUnique({
      where: { id: caseId },
      select: {
        organizationId: true,
        title: true,
        status: true,
        sourceKey: true,
        notes: true,
        conversations: {
          orderBy: { createdAt: "asc" },
          select: {
            channelKey: true,
            status: true,
            channel: true,
            messages: {
              orderBy: { createdAt: "desc" },
              take: RECENT_MESSAGES,
              select: {
                actor: true,
                kind: true,
                text: true,
                payload: true,
                createdAt: true,
              },
            },
          },
        },
        tasks: {
          orderBy: { createdAt: "desc" },
          take: RECENT_TASKS,
          select: {
            id: true,
            command: true,
            args: true,
            mode: true,
            status: true,
            result: true,
            computeTarget: { select: { machineName: true } },
            conversation: { select: { channelKey: true } },
            turn: {
              select: {
                messages: {
                  where: { origin: OrchestratorMessageOrigin.External },
                  orderBy: { createdAt: "asc" },
                  take: STARTED_FOR_MESSAGES,
                  select: { kind: true, text: true },
                },
              },
            },
          },
        },
        decisions: {
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            question: true,
            status: true,
            decidedBy: true,
            draft: true,
            draftResult: true,
          },
        },
      },
    })
  );
  if (!found) {
    return "(the case no longer exists)";
  }
  const lines = [
    `# ${found.title}`,
    `Status: ${found.status}${found.sourceKey ? ` · source ${found.sourceKey}` : ""}`,
    "",
    "## Notes",
    found.notes.trim() || "(none yet)",
    "",
    "## Documents",
  ];
  const documents = await listCaseDocuments(found.organizationId, caseId);
  if (documents.length === 0) {
    lines.push("(none yet)");
  }
  for (const document of documents) {
    lines.push(
      `- ${DOCUMENT_KIND_LABELS[document.kind]} "${document.title}" → ${document.url} (v${document.version}, page ${document.pageId})`
    );
  }
  lines.push("", "## Tasks");
  if (found.tasks.length === 0) {
    lines.push("(none)");
  }
  for (const task of found.tasks) {
    lines.push(
      `- ${task.id} ${task.command}${task.args ? ` ${task.args}` : ""} on ${task.computeTarget?.machineName ?? "a removed runner"} (${task.mode}): ${task.status}${taskNote(task)}${taskFilesNote(task)}${taskReplyToNote(task)}${taskQuestionsNote(task)} — started for: ${startedFor(task)}`
    );
  }
  lines.push("", "## Decisions");
  if (found.decisions.length === 0) {
    lines.push("(none)");
  }
  for (const decision of found.decisions) {
    lines.push(
      `- ${decision.id} ${decision.status}${decision.decidedBy ? ` by ${decision.decidedBy}` : ""}: ${preview(decision.question)}${decisionDraftNote(decision)}`
    );
  }
  lines.push("", "## Conversations");
  for (const conversation of found.conversations) {
    const channel = readChannel(conversation.channel);
    lines.push(
      `### ${conversation.channelKey} (${conversation.status})${channel?.item.url ? ` ${channel.item.url}` : ""}`
    );
    for (const message of [...conversation.messages].reverse()) {
      lines.push(
        `- ${message.createdAt.toISOString()} ${messageActor(message)} (${message.kind}): ${preview(message.text)}`
      );
    }
  }
  return lines.join("\n");
}

function preview(text: string): string {
  const flat = text.replaceAll(/\s+/g, " ").trim();
  return flat.length > TEXT_PREVIEW ? `${flat.slice(0, TEXT_PREVIEW)}…` : flat;
}

/** Why a queued task waits, or why a failed one failed. */
function taskNote(task: { status: string; result: unknown }): string {
  const result = readTaskResult(task.result);
  if (task.status === OrchestratorTaskStatus.Queued && result?.waiting) {
    return ` — waiting: ${preview(result.waiting)}`;
  }
  if (task.status === OrchestratorTaskStatus.Failed && result?.error) {
    return ` — error: ${preview(result.error)}`;
  }
  if (task.status === OrchestratorTaskStatus.Cancelled && result?.cancelled) {
    return ` — cancelled: ${preview(result.cancelled)}`;
  }
  return "";
}

/** The names of the files a task left, or nothing. */
function taskFilesNote(task: { result: unknown }): string {
  const files = readTaskResult(task.result)?.files ?? [];
  if (files.length === 0) {
    return "";
  }
  const names = files.map((file) =>
    file.skipped ? `${file.name} (not collected)` : file.name
  );
  return ` — files: ${names.join(", ")}`;
}

/** The message ref a task answers, or nothing. */
function taskReplyToNote(task: { result: unknown }): string {
  const replyTo = readTaskResult(task.result)?.replyTo;
  return replyTo ? ` — answers ref ${replyTo}` : "";
}

function taskQuestionsNote(task: { result: unknown }): string {
  const questions = readTaskResult(task.result)?.questions ?? [];
  if (questions.length === 0) {
    return "";
  }
  const asked = new Map(askedOnItem(questions).map((q) => [q.id, q.commentId]));
  const names = questions.map((q) =>
    asked.has(q.id)
      ? `${q.id} (asked on the item, comment ${asked.get(q.id)})`
      : q.id
  );
  return ` — questions: ${names.join(", ")}`;
}

type StartedForTask = {
  conversation: { channelKey: string } | null;
  turn: { messages: Array<{ kind: string; text: string }> } | null;
};

/** The ticket change (the last of the turn), message or channel that started a task. */
function startedFor(task: StartedForTask): string {
  const channelKey = task.conversation?.channelKey ?? "a removed conversation";
  const messages = task.turn?.messages ?? [];
  const changes = messages.filter((message) =>
    isTicketChangeKind(message.kind)
  );
  const change = changes.at(-1);
  if (change) {
    return `${change.kind} "${preview(change.text)}"`;
  }
  const last = messages.at(-1);
  if (last) {
    return `message in ${channelKey}: "${preview(last.text)}"`;
  }
  return channelKey;
}

function messageActor(message: {
  actor: string | null;
  payload: unknown;
}): string {
  const actor = message.actor ?? "AgentFlow";
  return readOrchestratorMessageVia(message.payload) ===
    OrchestratorMessageVia.AgentFlow
    ? `${actor} (AgentFlow)`
    : actor;
}

/** " — draft: comment (N chars) + move to X; posted (reference R)", or "" without a draft. */
function decisionDraftNote(decision: {
  draft: unknown;
  draftResult: unknown;
}): string {
  const draft = readStoredDraft(decision.draft);
  if (!draft) {
    return "";
  }
  return ` — draft: ${draftWhat(draft)}; ${draftState(decision.draftResult)}`;
}

function draftWhat(draft: StoredDecisionDraft): string {
  const parts: string[] = [];
  if (draft.comment) {
    parts.push(`comment (${draft.comment.text.length} chars)`);
  }
  if (draft.transitionName !== null) {
    parts.push(`move to ${draft.transitionName}`);
  }
  return parts.join(" + ");
}

function draftState(value: unknown): string {
  const parsed = orchestratorDecisionDraftResultSchema.safeParse(value);
  if (!parsed.success) {
    return "not posted";
  }
  const result = parsed.data;
  if (result.outcome === OrchestratorDraftOutcome.Done) {
    return result.commentRef === null
      ? "done"
      : `posted (reference ${result.commentRef})`;
  }
  if (result.outcome === OrchestratorDraftOutcome.Failed) {
    return `failed: ${result.error ?? "unknown error"}`;
  }
  return "being carried out";
}
