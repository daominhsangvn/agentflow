import { describe, expect, it } from "vitest";
import { JiraSignalType, JiraTriggerType } from "../constants";
import { type JiraPollIssueInput, jiraPollIssueEvents } from "../poll-events";
import {
  jiraCommentSchema,
  jiraHistorySchema,
  jiraIssueSchema,
} from "../schemas";
import {
  assigneeItem,
  BOT_MENTION_ADF,
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
} from "./jira.test-helpers";

const WINDOW_START = new Date("2026-10-04T10:00:00.000Z");
const IN_WINDOW_1 = "2026-10-04T10:01:00.000+0000";
const IN_WINDOW_2 = "2026-10-04T10:02:00.000+0000";
const IN_WINDOW_3 = "2026-10-04T10:03:00.000+0000";
const BEFORE_WINDOW = "2026-10-04T09:30:00.000+0000";

type Raw = {
  issue?: Parameters<typeof polledIssue>[0];
  histories?: Parameters<typeof history>[0][];
  comments?: Parameters<typeof polledComment>[0][];
};

function build(raw: Raw): JiraPollIssueInput {
  return {
    siteUrl: CLOUD_SITE_URL,
    issue: jiraIssueSchema.parse(polledIssue(raw.issue)),
    histories: (raw.histories ?? []).map((item) =>
      jiraHistorySchema.parse(history(item))
    ),
    comments: (raw.comments ?? []).map((item) =>
      jiraCommentSchema.parse(polledComment(item))
    ),
    windowStart: WINDOW_START,
    account: CLOUD_BOT_ACCOUNT,
  };
}

function eventsOf(raw: Raw) {
  return jiraPollIssueEvents(build(raw));
}

function byKey(events: ReturnType<typeof eventsOf>, dedupKey: string) {
  return events.find((event) => event.dedupKey === dedupKey);
}

describe("jiraPollIssueEvents histories", () => {
  it("turns a status change into a status event with from and to", () => {
    const events = eventsOf({
      issue: { status: "Done" },
      histories: [
        {
          id: "h1",
          created: IN_WINDOW_1,
          items: [statusItem("To Do", "Done")],
        },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      triggerType: JiraTriggerType.IssueStatusChanged,
      dedupKey: "PROJ-1:status:h1",
      itemChange: { status: { from: "To Do", to: "Done" } },
    });
  });

  it("turns added and removed labels into one labels event", () => {
    const events = eventsOf({
      issue: { labels: ["b", "c"] },
      histories: [
        { id: "h1", created: IN_WINDOW_1, items: [labelsItem("a b", "b c")] },
      ],
    });

    expect(events).toHaveLength(2);
    expect(byKey(events, "PROJ-1:labels:h1")).toMatchObject({
      triggerType: JiraTriggerType.IssueLabeled,
      itemChange: { labels: { added: ["c"], removed: ["a"] } },
    });
  });

  it("gives each change the issue state after it, even when a later change altered it", () => {
    const events = eventsOf({
      issue: { assignee: HUMAN_USER, labels: [], status: "Done" },
      histories: [
        {
          id: "h1",
          created: IN_WINDOW_1,
          items: [
            assigneeItem(null, BOT_ACCOUNT_ID),
            labelsItem("", "ai-ready"),
          ],
        },
        {
          id: "h2",
          created: IN_WINDOW_2,
          items: [
            assigneeItem(BOT_ACCOUNT_ID, HUMAN_USER.accountId),
            labelsItem("ai-ready", ""),
            statusItem("To Do", "Done"),
          ],
        },
      ],
    });

    const assigned = byKey(events, "PROJ-1:assignee:h1");
    expect(assigned?.triggerType).toBe(JiraTriggerType.IssueAssigned);
    expect(assigned?.attributes.status).toBe("To Do");
    const conditions = byKey(events, "PROJ-1:conditions:h1");
    expect(conditions?.attributes).toMatchObject({
      assignedToBot: true,
      labels: ["ai-ready"],
      becameAssigned: true,
      addedLabels: ["ai-ready"],
      status: "To Do",
    });
    expect(byKey(events, "PROJ-1:status:h2")?.attributes).toMatchObject({
      status: "Done",
      labels: [],
    });
    expect(byKey(events, "PROJ-1:conditions:h2")).toBeUndefined();
  });

  it("detects a description edited to mention the bot", () => {
    const events = eventsOf({
      issue: { description: `${BOT_MENTION_WIKI} more` },
      histories: [
        {
          id: "h1",
          created: IN_WINDOW_1,
          items: [
            {
              field: "description",
              fieldId: "description",
              fromString: "old text",
              toString: BOT_MENTION_WIKI,
            },
          ],
        },
      ],
    });

    expect(byKey(events, "PROJ-1:mention:h1")?.triggerType).toBe(
      JiraTriggerType.IssueMentioned
    );
    expect(byKey(events, "PROJ-1:conditions:h1")).toBeDefined();
  });

  it("skips histories by the bot and histories before the window", () => {
    const events = eventsOf({
      issue: { status: "Done" },
      histories: [
        { id: "old", created: BEFORE_WINDOW, items: [statusItem("A", "B")] },
        {
          id: "bot",
          created: IN_WINDOW_1,
          author: BOT_USER,
          items: [statusItem("B", "C")],
        },
        { id: "h3", created: IN_WINDOW_2, items: [statusItem("C", "Done")] },
      ],
    });

    expect(events.map((event) => event.dedupKey)).toEqual(["PROJ-1:status:h3"]);
  });

  it("does not mutate the input issue", () => {
    const input = build({
      issue: { labels: ["b"], status: "Done" },
      histories: [
        { id: "h1", created: IN_WINDOW_1, items: [labelsItem("a", "b")] },
        {
          id: "h2",
          created: IN_WINDOW_2,
          items: [statusItem("To Do", "Done")],
        },
      ],
    });
    const before = structuredClone(input.issue);

    jiraPollIssueEvents(input);

    expect(input.issue).toEqual(before);
  });
});

describe("jiraPollIssueEvents creation", () => {
  const created = "2026-10-04T10:00:30.000+0000";

  it("builds the created events from the initial snapshot, ignoring later changes", () => {
    const events = eventsOf({
      issue: { created, labels: [], assignee: null, description: "later text" },
      histories: [
        {
          id: "h1",
          created: IN_WINDOW_1,
          items: [
            assigneeItem(BOT_ACCOUNT_ID, null),
            labelsItem("ai-ready", ""),
            {
              field: "description",
              fieldId: "description",
              fromString: BOT_MENTION_WIKI,
              toString: "later text",
            },
          ],
        },
      ],
    });

    const keys = events.map((event) => event.dedupKey);
    expect(keys.filter((key) => key === "PROJ-1:created")).toHaveLength(3);
    expect(events.map((event) => event.triggerType)).toEqual([
      JiraTriggerType.IssueAssigned,
      JiraTriggerType.IssueLabeled,
      JiraTriggerType.IssueMentioned,
      JiraTriggerType.IssueConditions,
      JiraTriggerType.IssueLabeled,
    ]);
    expect(keys).toContain("PROJ-1:conditions:created");
    expect(
      byKey(events, "PROJ-1:conditions:created")?.attributes
    ).toMatchObject({
      assignedToBot: true,
      labels: ["ai-ready"],
    });
  });

  it("emits nothing for an issue created by the bot", () => {
    const events = eventsOf({
      issue: { created, creator: BOT_USER, assignee: BOT_USER },
    });

    expect(events).toEqual([]);
  });

  it("emits nothing for an issue created before the window", () => {
    expect(eventsOf({ issue: { assignee: BOT_USER } })).toEqual([]);
  });
});

describe("jiraPollIssueEvents comments", () => {
  it("turns a reply into a reply event with its message", () => {
    const events = eventsOf({
      comments: [
        { id: "c2", parentId: "c1", created: IN_WINDOW_1, body: "an answer" },
      ],
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      triggerType: JiraSignalType.CommentReply,
      dedupKey: "PROJ-1:reply:c2",
      message: { id: "c2", parentId: "c1", text: "an answer" },
    });
  });

  it("detects wiki and ADF mentions, with conditions and message", () => {
    const events = eventsOf({
      comments: [
        { id: "c3", created: IN_WINDOW_1, body: BOT_MENTION_WIKI },
        { id: "c4", created: IN_WINDOW_2, body: BOT_MENTION_ADF },
      ],
    });

    expect(events.map((event) => event.dedupKey)).toEqual([
      "PROJ-1:mention:comment-c3",
      "PROJ-1:conditions:comment-c3",
      "PROJ-1:mention:comment-c4",
      "PROJ-1:conditions:comment-c4",
    ]);
    expect(events[0]?.message).toEqual({
      id: "c3",
      parentId: null,
      text: BOT_MENTION_WIKI,
    });
  });

  it("takes an old comment edited in the window as a mention by the editor, not a reply", () => {
    const events = eventsOf({
      comments: [
        {
          id: "c5",
          parentId: "c1",
          created: BEFORE_WINDOW,
          updated: IN_WINDOW_2,
          updateAuthor: HUMAN_USER,
          body: BOT_MENTION_WIKI,
        },
      ],
    });

    expect(events.map((event) => event.dedupKey)).toEqual([
      "PROJ-1:mention:comment-c5",
      "PROJ-1:conditions:comment-c5",
    ]);
    expect(events[0]?.occurredAt).toEqual(
      new Date(IN_WINDOW_2.replace("+0000", "Z"))
    );
    expect(events[0]?.actor?.id).toBe(HUMAN_USER.accountId);
  });

  it("skips comments by the bot", () => {
    const events = eventsOf({
      comments: [
        {
          id: "c6",
          created: IN_WINDOW_1,
          author: BOT_USER,
          body: BOT_MENTION_WIKI,
          parentId: "c1",
        },
      ],
    });

    expect(events).toEqual([]);
  });

  it("uses the issue state at the time of the comment", () => {
    const events = eventsOf({
      issue: { status: "Done" },
      histories: [
        {
          id: "h1",
          created: IN_WINDOW_2,
          items: [statusItem("To Do", "Done")],
        },
      ],
      comments: [{ id: "c7", created: IN_WINDOW_1, body: BOT_MENTION_WIKI }],
    });

    expect(byKey(events, "PROJ-1:mention:comment-c7")?.attributes.status).toBe(
      "To Do"
    );
  });
});

describe("jiraPollIssueEvents ordering", () => {
  it("returns events oldest first across histories and comments", () => {
    const events = eventsOf({
      issue: { status: "Done" },
      histories: [
        {
          id: "h1",
          created: IN_WINDOW_2,
          items: [statusItem("To Do", "Done")],
        },
      ],
      comments: [
        { id: "c1", created: IN_WINDOW_3, parentId: "c0" },
        { id: "c2", created: IN_WINDOW_1, parentId: "c0" },
      ],
    });

    expect(events.map((event) => event.dedupKey)).toEqual([
      "PROJ-1:reply:c2",
      "PROJ-1:status:h1",
      "PROJ-1:reply:c1",
    ]);
  });
});
