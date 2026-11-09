import { describe, expect, it } from "vitest";
import { HttpMethod, type InboundRequest } from "../../../types";
import { jiraRequest } from "../client";
import {
  JIRA_WEBHOOK_IDENTIFIER_HEADER,
  JiraEventAttribute,
  JiraIgnoredReason,
  JiraSignalType,
  JiraTriggerType,
} from "../constants";
import { parseJiraRequest } from "../inbound";
import { jiraAnswerReply, jiraCommentMessage } from "../issue-events";
import { jiraCommentPageSchema, jiraIssueSchema } from "../schemas";
import {
  HUMAN_USER,
  WEBHOOK_TIMESTAMP,
  webhookIssue,
} from "./jira.test-fixtures";
import {
  BOT_ACCOUNT_ID,
  CLOUD_BOT_ACCOUNT,
  cloudConfig,
  jsonResponse,
  makeJiraContext,
  routedHttp,
} from "./jira.test-helpers";

const DELIVERY_ID = "0b6c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2e";
const QUESTION_COMMENT_ID = "10800";

describe("jira.comment_reply webhooks", () => {
  it("turns a reply in a comment thread into a reply event", async () => {
    const result = await parse(replyWebhook("1a, 2b"));

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      triggerType: JiraSignalType.CommentReply,
      dedupKey: "PROJ-123:reply:10900",
      actor: { id: HUMAN_USER.accountId },
      attributes: { [JiraEventAttribute.RepliedTo]: QUESTION_COMMENT_ID },
    });
    expect(jiraAnswerReply(result.events[0]!)).toBe(QUESTION_COMMENT_ID);
  });

  it("puts the reply event before the mention events of a reply that mentions the bot", async () => {
    // Jira's Reply mentions the author of the replied comment: the bot.
    const result = await parse(
      replyWebhook(`[~accountid:${BOT_ACCOUNT_ID}] 1a, 2b`)
    );

    expect(result.events.map((event) => event.triggerType)).toEqual([
      JiraSignalType.CommentReply,
      JiraTriggerType.IssueMentioned,
      JiraTriggerType.IssueConditions,
    ]);
  });

  it("does not take an edited reply as a new answer", async () => {
    const result = await parse(
      replyWebhook("1a, 2c", { event: "comment_updated" })
    );

    expect(result.events).toEqual([]);
    expect(result.ignoredReason).toBe(JiraIgnoredReason.NoRelevantChange);
  });

  it("answers nothing for an event that is no reply", () => {
    expect(
      jiraAnswerReply({
        triggerType: JiraTriggerType.IssueConditions,
        dedupKey: "PROJ-123:conditions:comment-10900",
        occurredAt: new Date(),
        actor: null,
        item: {
          provider: "jira",
          externalId: "10042",
          key: "PROJ-123",
          url: null,
          title: null,
          container: "PROJ",
        },
        attributes: { [JiraEventAttribute.RepliedTo]: QUESTION_COMMENT_ID },
      })
    ).toBeNull();
  });
});

function parse(body: unknown) {
  const request: InboundRequest = {
    rawBody: JSON.stringify(body),
    headers: new Headers({ [JIRA_WEBHOOK_IDENTIFIER_HEADER]: DELIVERY_ID }),
    url: new URL("https://api.example.com/webhooks/integrations/key-1"),
  };
  const ctx = makeJiraContext({
    http: routedHttp([]).http,
    config: cloudConfig(),
    account: CLOUD_BOT_ACCOUNT,
  });
  return parseJiraRequest(request, ctx);
}

describe("shared comment helpers", () => {
  it("builds a comment message from wiki markup, ADF and a missing parent", () => {
    expect(
      jiraCommentMessage({ id: "1", parentId: "0", body: "wiki" })
    ).toEqual({
      id: "1",
      parentId: "0",
      text: "wiki",
    });
    const adf = {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "adf text" }] },
      ],
    };
    expect(jiraCommentMessage({ id: "2", body: adf })).toEqual({
      id: "2",
      parentId: null,
      text: "adf text",
    });
  });

  it("parses fields.comment and drops invalid comments", () => {
    const issue = jiraIssueSchema.parse({
      id: "1",
      key: "PROJ-1",
      fields: {
        comment: {
          comments: [
            {
              id: "10",
              parentId: "9",
              updated: "2026-10-04T11:59:00.000+0000",
              updateAuthor: HUMAN_USER,
              body: "x",
            },
            { bad: true },
          ],
          total: 3,
        },
      },
    });

    expect(issue.fields.comment?.comments).toHaveLength(1);
    expect(issue.fields.comment?.comments?.[0]?.parentId).toBe("9");
    expect(issue.fields.comment?.total).toBe(3);
  });

  it("reads Cloud through REST v2 when asked to", async () => {
    const fake = routedHttp([
      {
        method: HttpMethod.Get,
        path: "/rest/api/2/issue/1/comment",
        respond: jsonResponse(200, { comments: [] }),
      },
    ]);
    const ctx = makeJiraContext({ http: fake.http, config: cloudConfig() });

    const result = await jiraRequest(
      ctx,
      { method: HttpMethod.Get, path: "issue/1/comment", restVersion: "2" },
      jiraCommentPageSchema
    );

    expect(result.ok).toBe(true);
    expect(new URL(fake.requests[0]!.url).pathname).toBe(
      "/rest/api/2/issue/1/comment"
    );
  });
});

/** Jira Cloud `comment_created` webhook of a reply to comment 10800. */
function replyWebhook(body: string, overrides: { event?: string } = {}) {
  return {
    timestamp: WEBHOOK_TIMESTAMP,
    webhookEvent: overrides.event ?? "comment_created",
    comment: {
      id: "10900",
      parentId: Number(QUESTION_COMMENT_ID),
      author: HUMAN_USER,
      body,
      updateAuthor: HUMAN_USER,
      created: "2026-10-04T11:59:00.000+0000",
      updated: "2026-10-04T11:59:00.000+0000",
    },
    issue: webhookIssue({ assignee: null }),
  };
}
