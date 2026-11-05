import type { InboundEvent, IntegrationAccount } from "../../types";
import { JiraChangelogField } from "./constants";
import { parseJiraDate } from "./dates";
import { isJiraBotUser, jiraUserActor } from "./identity";
import {
  type JiraIssueOccurrence,
  jiraChangedField,
  jiraChangeEvents,
  jiraCommentMentionEvents,
  jiraCommentMessage,
  jiraCommentReplyEvent,
  jiraCreatedEvents,
  labelTokens,
} from "./issue-events";
import type {
  JiraChangeItem,
  JiraComment,
  JiraHistory,
  JiraIssue,
  JiraUser,
} from "./schemas";

/**
 * Turns one polled Jira issue into the InboundEvents its webhooks would have
 * produced. The issue is replayed back to its state at each change (a
 * "snapshot"), then the webhook builders in issue-events.ts run unchanged, so
 * dedupKey, item, attributes, itemChange and message match the webhook path.
 *
 * Known limits (everything else is deep-equal to the webhook events):
 *  1. occurredAt: a webhook carries its delivery timestamp, a poll the
 *     changelog / comment `created` date; they can differ by milliseconds.
 *  2. jira.comment_reply attributes: the comment webhook has a trimmed issue
 *     (no labels), the poll uses the snapshot (real labels). A reply is only
 *     read through answerReply, never trigger-matched.
 *  3. A comment created and edited inside one window: the mention is
 *     attributed to the creation. That matches the webhook when the mention
 *     was in the original text, not when an edit added it. message.text is the
 *     latest body.
 *  4. Snapshots replay assignee, labels, status, issue type, summary and
 *     description; issue moves (project / key change) are not replayed.
 */

export type JiraPollIssueInput = {
  siteUrl: string;
  issue: JiraIssue;
  histories: JiraHistory[];
  comments: JiraComment[];
  windowStart: Date;
  account: IntegrationAccount;
};

type EventGroup = { at: Date; order: number; events: InboundEvent[] };

const GROUP_ORDER_CREATED = 0;
const GROUP_ORDER_HISTORY = 1;
const GROUP_ORDER_COMMENT = 2;

/** Events of every change to `input.issue` at or after `input.windowStart`, oldest first. */
export function jiraPollIssueEvents(input: JiraPollIssueInput): InboundEvent[] {
  const histories = sortedHistories(input.histories);
  const { initial, after } = replayIssueSnapshots(input.issue, histories);
  const groups: EventGroup[] = [
    ...createdGroups(input, initial),
    ...historyGroups(input, histories, after),
    ...commentGroups(input, histories, initial, after),
  ];
  return groups
    .map((group, index) => ({ group, index }))
    .sort(
      (a, b) =>
        a.group.at.getTime() - b.group.at.getTime() ||
        a.group.order - b.group.order ||
        a.index - b.index
    )
    .flatMap(({ group }) => group.events);
}

/**
 * `initial` is the issue before any history; `after[i]` the issue right after
 * history i (histories oldest first). The input issue is never mutated.
 */
export function replayIssueSnapshots(
  issue: JiraIssue,
  histories: JiraHistory[]
): { initial: JiraIssue; after: JiraIssue[] } {
  const after: JiraIssue[] = new Array<JiraIssue>(histories.length);
  let current = issue;
  for (let index = histories.length - 1; index >= 0; index--) {
    after[index] = current;
    current = undoHistory(current, histories[index]?.items ?? []);
  }
  return { initial: current, after };
}

function undoHistory(
  issue: JiraIssue,
  items: readonly JiraChangeItem[]
): JiraIssue {
  let fields = issue.fields;
  for (const item of [...items].reverse()) {
    fields = undoItem(fields, item);
  }
  return fields === issue.fields ? issue : { ...issue, fields };
}

function undoItem(
  fields: JiraIssue["fields"],
  item: JiraChangeItem
): JiraIssue["fields"] {
  switch (jiraChangedField(item)) {
    case JiraChangelogField.Assignee:
      return { ...fields, assignee: previousAssignee(item) };
    case JiraChangelogField.Labels:
      return { ...fields, labels: labelTokens(item.fromText ?? item.from) };
    case JiraChangelogField.Status:
      return { ...fields, status: previousNamed(fields.status, item) };
    case JiraChangelogField.IssueType:
      return { ...fields, issuetype: previousNamed(fields.issuetype, item) };
    case JiraChangelogField.Summary:
      return { ...fields, summary: item.fromText ?? item.from };
    case JiraChangelogField.Description:
      return { ...fields, description: item.fromText ?? item.from };
    default:
      return fields;
  }
}

function previousAssignee(item: JiraChangeItem): JiraUser | null {
  const accountId = item.tmpFromAccountId ?? item.from;
  if (!accountId) {
    return null;
  }
  return {
    accountId,
    key: item.from,
    name: item.from,
    displayName: item.fromText,
  };
}

function previousNamed(
  current: JiraIssue["fields"]["status"],
  item: JiraChangeItem
): NonNullable<JiraIssue["fields"]["status"]> {
  return { ...current, id: item.from ?? null, name: item.fromText ?? null };
}

function sortedHistories(histories: readonly JiraHistory[]): JiraHistory[] {
  return histories
    .map((history, index) => ({ history, index }))
    .sort(
      (a, b) =>
        (parseJiraDate(a.history.created)?.getTime() ?? 0) -
          (parseJiraDate(b.history.created)?.getTime() ?? 0) ||
        a.index - b.index
    )
    .map(({ history }) => history);
}

function occurrence(
  input: JiraPollIssueInput,
  issue: JiraIssue,
  at: Date,
  user: JiraUser | null | undefined
): JiraIssueOccurrence {
  return {
    siteUrl: input.siteUrl,
    issue,
    occurredAt: at,
    actor: jiraUserActor(user),
  };
}

function createdGroups(
  input: JiraPollIssueInput,
  initial: JiraIssue
): EventGroup[] {
  const created = parseJiraDate(input.issue.fields.created);
  const creator = input.issue.fields.creator ?? input.issue.fields.reporter;
  if (
    !created ||
    created < input.windowStart ||
    isJiraBotUser(input.account, creator)
  ) {
    return [];
  }
  const events = jiraCreatedEvents(
    occurrence(input, initial, created, creator),
    input.account
  );
  return [{ at: created, order: GROUP_ORDER_CREATED, events }];
}

function historyGroups(
  input: JiraPollIssueInput,
  histories: readonly JiraHistory[],
  after: readonly JiraIssue[]
): EventGroup[] {
  const groups: EventGroup[] = [];
  histories.forEach((history, index) => {
    const created = parseJiraDate(history.created);
    const snapshot = after[index];
    if (
      !(created && snapshot) ||
      created < input.windowStart ||
      isJiraBotUser(input.account, history.author)
    ) {
      return;
    }
    const events = jiraChangeEvents(
      occurrence(input, snapshot, created, history.author),
      history.items ?? [],
      history.id,
      input.account
    );
    groups.push({ at: created, order: GROUP_ORDER_HISTORY, events });
  });
  return groups;
}

function commentGroups(
  input: JiraPollIssueInput,
  histories: readonly JiraHistory[],
  initial: JiraIssue,
  after: readonly JiraIssue[]
): EventGroup[] {
  const times = histories.map((history) => parseJiraDate(history.created));
  const snapshotAt = (at: Date): JiraIssue => {
    let snapshot = initial;
    times.forEach((time, index) => {
      if (time && time <= at) {
        snapshot = after[index] ?? snapshot;
      }
    });
    return snapshot;
  };
  const groups: EventGroup[] = [];
  for (const comment of input.comments) {
    const group = commentGroup(input, comment, snapshotAt);
    if (group) {
      groups.push(group);
    }
  }
  return groups;
}

function commentGroup(
  input: JiraPollIssueInput,
  comment: JiraComment,
  snapshotAt: (at: Date) => JiraIssue
): EventGroup | null {
  const created = parseJiraDate(comment.created);
  if (!created) {
    return null;
  }
  const events = [
    ...commentReplyEvents(input, comment, created, snapshotAt),
    ...commentMentionEvents(input, comment, created, snapshotAt),
  ];
  if (events.length === 0) {
    return null;
  }
  const message = jiraCommentMessage(comment);
  return {
    at: events[0]?.occurredAt ?? created,
    order: GROUP_ORDER_COMMENT,
    events: events.map((event) => ({ ...event, message })),
  };
}

function commentReplyEvents(
  input: JiraPollIssueInput,
  comment: JiraComment,
  created: Date,
  snapshotAt: (at: Date) => JiraIssue
): InboundEvent[] {
  if (
    !comment.parentId ||
    created < input.windowStart ||
    isJiraBotUser(input.account, comment.author)
  ) {
    return [];
  }
  return [
    jiraCommentReplyEvent(
      occurrence(input, snapshotAt(created), created, comment.author),
      { id: comment.id, parentId: comment.parentId }
    ),
  ];
}

function commentMentionEvents(
  input: JiraPollIssueInput,
  comment: JiraComment,
  created: Date,
  snapshotAt: (at: Date) => JiraIssue
): InboundEvent[] {
  const isNew = created >= input.windowStart;
  const at = isNew ? created : (parseJiraDate(comment.updated) ?? created);
  const user = isNew
    ? comment.author
    : (comment.updateAuthor ?? comment.author);
  if (at < input.windowStart || isJiraBotUser(input.account, user)) {
    return [];
  }
  return jiraCommentMentionEvents(
    occurrence(input, snapshotAt(at), at, user),
    comment,
    input.account
  );
}
