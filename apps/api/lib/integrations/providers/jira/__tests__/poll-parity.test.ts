import { describe, expect, it } from "vitest";
import {
  HttpMethod,
  type InboundEvent,
  type InboundRequest,
} from "../../../types";
import { JIRA_WEBHOOK_IDENTIFIER_HEADER } from "../constants";
import { parseJiraRequest } from "../inbound";
import { jiraPollIssueEvents } from "../poll-events";
import {
  jiraCommentSchema,
  jiraHistorySchema,
  jiraIssueSchema,
} from "../schemas";
import {
  assigneeItem,
  BOT_MENTION_WIKI,
  BOT_USER,
  HUMAN_USER,
  history,
  labelsItem,
  polledComment,
  polledIssue,
  statusItem,
} from "./jira.test-fixtures";
import {
  BOT_ACCOUNT_ID,
  CLOUD_BOT_ACCOUNT,
  CLOUD_SITE_URL,
  cloudConfig,
  jsonResponse,
  makeJiraContext,
  routedHttp,
} from "./jira.test-helpers";

/**
 * Parity between the webhook path and the project poll: for the same change
 * (changelog id / comment id) the polled InboundEvent must deep-equal the
 * event parseJiraRequest builds from the webhook delivery.
 *
 * Fields that cannot always be identical (also documented in poll-events.ts):
 *  1. occurredAt: webhook = delivery timestamp, poll = changelog / comment
 *     `created`. They are equal here; in practice they can differ by ms.
 *  2. jira.comment_reply attributes: the comment webhook has a trimmed issue
 *     (no labels), the poll uses the snapshot with real labels. The reply is
 *     only read through answerReply (attributes.repliedTo).
 *  3. A comment created and edited inside one window: the poll attributes the
 *     mention to the creation, and message.text is the latest body.
 *  4. Snapshots replay assignee, labels, status, issue type, summary and
 *     description; issue moves are not replayed.
 */

const WINDOW_START = new Date("2026-10-04T10:00:00.000Z");
const T1 = "2026-10-04T10:01:00.000Z";
const T2 = "2026-10-04T10:02:00.000Z";
const DELIVERY_ID = "0b6c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2e";

describe("poll and webhook produce identical events", () => {
  it("status change", async () => {
    const items = [statusItem("To Do", "Done")];
    const webhook = await webhookEvents({
      ...updatedBody("h1", T1, items),
      issue: polledIssue({ status: "Done" }),
    });

    const poll = pollEvents({
      issue: { status: "Done" },
      histories: [{ id: "h1", created: T1, items }],
    });

    expect(keysOf(webhook)).toEqual(["PROJ-1:status:h1"].sort());
    expect(byKey(ofSameChange(poll, webhook))).toEqual(byKey(webhook));
  });

  it("labels added and removed", async () => {
    const items = [labelsItem("a b", "b c")];
    const webhook = await webhookEvents({
      ...updatedBody("h1", T1, items),
      issue: polledIssue({ labels: ["b", "c"] }),
    });

    const poll = pollEvents({
      issue: { labels: ["b", "c"] },
      histories: [{ id: "h1", created: T1, items }],
    });

    expect(keysOf(webhook)).toEqual(
      ["PROJ-1:labels:h1", "PROJ-1:conditions:h1"].sort()
    );
    expect(byKey(ofSameChange(poll, webhook))).toEqual(byKey(webhook));
  });

  it("assignment to the bot with its conditions event, although a later change moved it away", async () => {
    const items = [assigneeItem(null, BOT_ACCOUNT_ID)];
    const webhook = await webhookEvents({
      ...updatedBody("h1", T1, items),
      issue: polledIssue({ assignee: BOT_USER }),
    });

    const poll = pollEvents({
      issue: { assignee: HUMAN_USER },
      histories: [
        { id: "h1", created: T1, items },
        {
          id: "h2",
          created: T2,
          items: [assigneeItem(BOT_ACCOUNT_ID, HUMAN_USER.accountId)],
        },
      ],
    });

    expect(keysOf(webhook)).toEqual(
      ["PROJ-1:assignee:h1", "PROJ-1:conditions:h1"].sort()
    );
    expect(byKey(ofSameChange(poll, webhook))).toEqual(byKey(webhook));
  });

  it("description edited to mention the bot", async () => {
    const items = [
      {
        field: "description",
        fieldId: "description",
        fromString: "old text",
        toString: BOT_MENTION_WIKI,
      },
    ];
    const webhook = await webhookEvents({
      ...updatedBody("h1", T1, items),
      issue: polledIssue({ description: BOT_MENTION_WIKI }),
    });

    const poll = pollEvents({
      issue: { description: "newer text" },
      histories: [
        { id: "h1", created: T1, items },
        {
          id: "h2",
          created: T2,
          items: [
            {
              field: "description",
              fieldId: "description",
              fromString: BOT_MENTION_WIKI,
              toString: "newer text",
            },
          ],
        },
      ],
    });

    expect(keysOf(webhook)).toEqual(
      ["PROJ-1:mention:h1", "PROJ-1:conditions:h1"].sort()
    );
    expect(byKey(ofSameChange(poll, webhook))).toEqual(byKey(webhook));
  });

  it("issue created with assignee, labels and a mention", async () => {
    const created = "2026-10-04T10:00:30.000Z";
    const webhook = await webhookEvents({
      timestamp: Date.parse(created),
      webhookEvent: "jira:issue_created",
      user: HUMAN_USER,
      issue: polledIssue({
        created,
        assignee: BOT_USER,
        labels: ["ai-ready"],
        description: BOT_MENTION_WIKI,
      }),
    });

    const poll = pollEvents({
      issue: { created, assignee: null, labels: [], description: "cleared" },
      histories: [
        {
          id: "h1",
          created: T1,
          items: [
            assigneeItem(BOT_ACCOUNT_ID, null),
            labelsItem("ai-ready", ""),
            {
              field: "description",
              fieldId: "description",
              fromString: BOT_MENTION_WIKI,
              toString: "cleared",
            },
          ],
        },
      ],
    });

    expect(keysOf(webhook)).toEqual(
      [
        "PROJ-1:created",
        "PROJ-1:created",
        "PROJ-1:created",
        "PROJ-1:conditions:created",
      ].sort()
    );
    expect(byKey(ofSameChange(poll, webhook))).toEqual(byKey(webhook));
  });

  it("comment mentioning the bot, with conditions and message", async () => {
    const comment = polledComment({
      id: "c3",
      created: T1,
      body: BOT_MENTION_WIKI,
    });
    const asOf = polledIssue({ status: "To Do", labels: ["ai-ready"] });
    const webhook = await webhookEvents(
      {
        timestamp: Date.parse(T1),
        webhookEvent: "comment_created",
        user: HUMAN_USER,
        comment,
        issue: polledIssue(),
      },
      asOf
    );

    const poll = pollEvents({
      issue: { status: "Done", labels: ["ai-ready"] },
      histories: [
        { id: "h2", created: T2, items: [statusItem("To Do", "Done")] },
      ],
      comments: [comment],
    });

    expect(keysOf(webhook)).toEqual(
      ["PROJ-1:mention:comment-c3", "PROJ-1:conditions:comment-c3"].sort()
    );
    expect(byKey(ofSameChange(poll, webhook))).toEqual(byKey(webhook));
  });

  it("comment reply", async () => {
    const comment = polledComment({
      id: "c2",
      parentId: "c1",
      created: T1,
      body: "an answer",
    });
    const webhook = await webhookEvents({
      timestamp: Date.parse(T1),
      webhookEvent: "comment_created",
      user: HUMAN_USER,
      comment,
      issue: polledIssue({ status: "To Do" }),
    });

    const poll = pollEvents({
      issue: { status: "To Do" },
      comments: [comment],
    });

    expect(keysOf(webhook)).toEqual(["PROJ-1:reply:c2"].sort());
    expect(byKey(ofSameChange(poll, webhook))).toEqual(byKey(webhook));
  });
});

function updatedBody(changeId: string, created: string, items: unknown[]) {
  return {
    timestamp: Date.parse(created),
    webhookEvent: "jira:issue_updated",
    user: HUMAN_USER,
    changelog: { id: changeId, items },
  };
}

async function webhookEvents(
  body: unknown,
  commentedIssue: unknown = polledIssue()
): Promise<InboundEvent[]> {
  const issueResponse = jsonResponse(200, commentedIssue);
  const fake = routedHttp([
    {
      method: HttpMethod.Get,
      path: "/rest/api/3/issue/10001",
      respond: issueResponse,
    },
    {
      method: HttpMethod.Get,
      path: "/rest/api/2/issue/10001",
      respond: issueResponse,
    },
  ]);
  const request: InboundRequest = {
    rawBody: JSON.stringify(body),
    headers: new Headers({ [JIRA_WEBHOOK_IDENTIFIER_HEADER]: DELIVERY_ID }),
    url: new URL("https://api.example.com/webhooks/integrations/key-1"),
  };
  const ctx = makeJiraContext({
    http: fake.http,
    config: cloudConfig(),
    account: CLOUD_BOT_ACCOUNT,
  });
  const result = await parseJiraRequest(request, ctx);
  return result.events;
}

function pollEvents(raw: {
  issue?: Parameters<typeof polledIssue>[0];
  histories?: Parameters<typeof history>[0][];
  comments?: Parameters<typeof polledComment>[0][];
}): InboundEvent[] {
  return jiraPollIssueEvents({
    siteUrl: CLOUD_SITE_URL,
    issue: jiraIssueSchema.parse(polledIssue(raw.issue)),
    histories: (raw.histories ?? []).map((item) =>
      jiraHistorySchema.parse(history(item))
    ),
    comments: (raw.comments ?? []).map((item) => jiraCommentSchema.parse(item)),
    windowStart: WINDOW_START,
    account: CLOUD_BOT_ACCOUNT,
  });
}

/** Sorted dedupKeys of events. */
function keysOf(events: InboundEvent[]): string[] {
  return events.map((event) => event.dedupKey).sort();
}

/** Events ordered by dedupKey, so extra or missing poll events fail the comparison. */
function byKey(events: InboundEvent[]): InboundEvent[] {
  return [...events].sort((a, b) => a.dedupKey.localeCompare(b.dedupKey));
}

/** The poll events of the webhook's change (same `:h1`, `comment-c3` or `created` suffix), extras included. */
function ofSameChange(poll: InboundEvent[], webhook: InboundEvent[]) {
  const suffixes = new Set(
    webhook.map((event) => event.dedupKey.split(":").at(-1))
  );
  return poll.filter((event) => suffixes.has(event.dedupKey.split(":").at(-1)));
}
