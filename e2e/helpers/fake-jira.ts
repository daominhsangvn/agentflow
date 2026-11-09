import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A Jira Cloud site on 127.0.0.1 for e2e runs (plain http is accepted for a
 * local site, docs/workflows.md). It serves the REST calls the API makes for
 * a connection and an issue (myself, the issue, its comments, transitions,
 * links), keeps the comments posted to it, and builds the admin webhooks a
 * real site would send. Shapes follow
 * apps/api/lib/integrations/providers/jira/__tests__/jira.test-fixtures.ts.
 */

export const FAKE_JIRA_BOT = {
  accountId: "557058:bot-e2e",
  displayName: "AgentFlow Bot",
  emailAddress: "bot@e2e.example",
} as const;

export const FAKE_JIRA_PERSON = {
  accountId: "557058:person-e2e",
  displayName: "Bea Analyst",
} as const;

export const FAKE_JIRA_PROJECT_KEY = "PROJ";

export type FakeJiraComment = {
  id: string;
  parentId: number | null;
  authorAccountId: string;
  body: string;
  created: string;
};

export type FakeJiraRequest = { method: string; path: string; body: unknown };

export type FakeJira = {
  /** Site URL for the connection, e.g. http://127.0.0.1:53211. */
  url: string;
  /** Adds an issue the site serves; key like PROJ-123. */
  addIssue(input: { key: string; summary: string }): void;
  /** A comment written on the site (by a person), e.g. an agent's question. */
  addComment(key: string, input: Omit<FakeJiraComment, "created">): void;
  /** Comments AgentFlow posted (POST .../comment). */
  postedComments(key: string): FakeJiraComment[];
  requests(): readonly FakeJiraRequest[];
  /** REST calls the fake has no answer for (404), to explain a failure. */
  unhandled(): readonly FakeJiraRequest[];
  close(): Promise<void>;
};

type Issue = {
  id: string;
  key: string;
  summary: string;
  comments: FakeJiraComment[];
  posted: FakeJiraComment[];
};

const HOST = "127.0.0.1";
const REST_PREFIX_RE = /^\/rest\/api\/[23]\//;
const ISSUE_PATH_RE = /^issue\/([^/]+)(?:\/([^/]+))?$/;

export async function startFakeJira(): Promise<FakeJira> {
  const issues = new Map<string, Issue>();
  const requests: FakeJiraRequest[] = [];
  const unhandled: FakeJiraRequest[] = [];
  let nextId = 20_000;

  const findIssue = (idOrKey: string): Issue | undefined =>
    issues.get(idOrKey) ??
    [...issues.values()].find((issue) => issue.id === idOrKey);

  const server = createServer((request, response) => {
    readBody(request)
      .then((body) => {
        const url = new URL(request.url ?? "/", `http://${HOST}`);
        const entry = {
          method: request.method ?? "GET",
          path: url.pathname,
          body,
        };
        requests.push(entry);
        const answer = route(entry, url);
        if (answer === null) {
          unhandled.push(entry);
          send(response, 404, { errorMessages: ["Not served by the fake"] });
          return;
        }
        send(response, answer.status, answer.json);
      })
      .catch(() => send(response, 500, {}));
  });

  function route(
    entry: FakeJiraRequest,
    url: URL
  ): { status: number; json: unknown } | null {
    if (!REST_PREFIX_RE.test(entry.path)) {
      return null;
    }
    const path = entry.path.replace(REST_PREFIX_RE, "");
    if (path === "myself") {
      return ok({ ...FAKE_JIRA_BOT, accountType: "atlassian", active: true });
    }
    if (path === "issueLinkType") {
      return ok({ issueLinkTypes: [] });
    }
    if (path === "jql/parse") {
      return ok({ queries: [] });
    }
    if (path.startsWith("search")) {
      return ok({ issues: [], total: 0, startAt: 0, maxResults: 50 });
    }
    const match = ISSUE_PATH_RE.exec(path);
    if (!match) {
      return null;
    }
    const issue = findIssue(decodeURIComponent(match[1] ?? ""));
    if (!issue) {
      return { status: 404, json: { errorMessages: ["Issue does not exist"] } };
    }
    return issueRoute(issue, match[2] ?? null, entry, url);
  }

  function issueRoute(
    issue: Issue,
    suffix: string | null,
    entry: FakeJiraRequest,
    url: URL
  ): { status: number; json: unknown } | null {
    switch (suffix) {
      case null:
        return entry.method === "GET"
          ? ok(restIssue(issue, url.origin))
          : ok({});
      case "comment":
        if (entry.method === "POST") {
          nextId += 1;
          const comment: FakeJiraComment = {
            id: String(nextId),
            parentId: null,
            authorAccountId: FAKE_JIRA_BOT.accountId,
            body: JSON.stringify(entry.body),
            created: new Date().toISOString(),
          };
          issue.posted.push(comment);
          return { status: 201, json: restComment(comment) };
        }
        return ok({
          startAt: 0,
          maxResults: 100,
          total: issue.comments.length + issue.posted.length,
          comments: [...issue.comments, ...issue.posted].map(restComment),
        });
      case "transitions":
        return ok({ transitions: [] });
      case "remotelink":
        return ok([]);
      case "changelog":
        return ok({ values: [], isLast: true, startAt: 0, total: 0 });
      case "attachments":
        return ok([]);
      default:
        return null;
    }
  }

  await new Promise<void>((resolve) => server.listen(0, HOST, resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://${HOST}:${port}`,
    addIssue({ key, summary }) {
      nextId += 1;
      issues.set(key, {
        id: String(nextId),
        key,
        summary,
        comments: [],
        posted: [],
      });
    },
    addComment(key, input) {
      const issue = issues.get(key);
      if (!issue) {
        throw new Error(`No fake issue ${key}`);
      }
      issue.comments.push({ ...input, created: new Date().toISOString() });
    },
    postedComments: (key) => [...(issues.get(key)?.posted ?? [])],
    requests: () => requests,
    unhandled: () => unhandled,
    close: () => closeServer(server),
  };
}

/** Admin webhook: the issue was assigned to the bot. */
export function assignedToBotWebhook(issue: { key: string; summary: string }) {
  return {
    timestamp: Date.now(),
    webhookEvent: "jira:issue_updated",
    issue_event_type_name: "issue_assigned",
    user: personUser(),
    issue: webhookIssue(issue, botUser()),
    changelog: {
      id: String(Date.now()),
      items: [
        {
          field: "assignee",
          fieldtype: "jira",
          fieldId: "assignee",
          from: null,
          fromString: null,
          to: FAKE_JIRA_BOT.accountId,
          toString: FAKE_JIRA_BOT.displayName,
          tmpFromAccountId: null,
          tmpToAccountId: FAKE_JIRA_BOT.accountId,
        },
      ],
    },
  };
}

/** Admin webhook: a person commented, optionally as a reply to a comment. */
export function commentCreatedWebhook(
  issue: { key: string; summary: string },
  comment: { id: string; body: string; parentId?: string }
) {
  const created = new Date().toISOString();
  return {
    timestamp: Date.now(),
    webhookEvent: "comment_created",
    comment: {
      id: comment.id,
      ...(comment.parentId ? { parentId: Number(comment.parentId) } : {}),
      author: personUser(),
      body: comment.body,
      updateAuthor: personUser(),
      created,
      updated: created,
    },
    issue: webhookIssue(issue, botUser()),
  };
}

/** Headers of a webhook delivery: the inbound secret and a delivery id. */
export function jiraWebhookHeaders(secret: string): Record<string, string> {
  return {
    "content-type": "application/json",
    "x-agentflow-token": secret,
    "x-atlassian-webhook-identifier": randomUUID(),
  };
}

function webhookIssue(
  issue: { key: string; summary: string },
  assignee: unknown
) {
  return {
    id: issueIdFromKey(issue.key),
    key: issue.key,
    fields: {
      summary: issue.summary,
      issuetype: { id: "10001", name: "Story", subtask: false },
      project: {
        id: "10000",
        key: FAKE_JIRA_PROJECT_KEY,
        name: "Project",
        projectTypeKey: "software",
      },
      labels: [],
      status: { name: "To Do", statusCategory: { key: "new" } },
      priority: { id: "3", name: "Medium" },
      assignee,
      reporter: personUser(),
      creator: personUser(),
      description: "Users can export the report as CSV.",
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    },
  };
}

/** The webhook carries the key; the fake's REST id must match it. */
function issueIdFromKey(key: string): string {
  return key;
}

function restIssue(issue: Issue, origin: string) {
  return {
    id: issueIdFromKey(issue.key),
    key: issue.key,
    self: `${origin}/rest/api/3/issue/${issue.key}`,
    fields: {
      summary: issue.summary,
      issuetype: { id: "10001", name: "Story" },
      project: { id: "10000", key: FAKE_JIRA_PROJECT_KEY, name: "Project" },
      labels: [],
      status: { name: "To Do", statusCategory: { key: "new" } },
      priority: { name: "Medium" },
      assignee: botUser(),
      reporter: personUser(),
      description: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Users can export the report." }],
          },
        ],
      },
      attachment: [],
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    },
    renderedFields: { description: "<p>Users can export the report.</p>" },
    names: { summary: "Summary", description: "Description" },
  };
}

function restComment(comment: FakeJiraComment) {
  const author =
    comment.authorAccountId === FAKE_JIRA_BOT.accountId
      ? botUser()
      : personUser();
  return {
    id: comment.id,
    ...(comment.parentId === null ? {} : { parentId: comment.parentId }),
    author,
    updateAuthor: author,
    body: comment.body,
    renderedBody: `<p>${comment.body}</p>`,
    created: comment.created,
    updated: comment.created,
  };
}

function botUser() {
  return {
    accountId: FAKE_JIRA_BOT.accountId,
    displayName: FAKE_JIRA_BOT.displayName,
    active: true,
    accountType: "atlassian",
  };
}

function personUser() {
  return {
    accountId: FAKE_JIRA_PERSON.accountId,
    displayName: FAKE_JIRA_PERSON.displayName,
    active: true,
    accountType: "atlassian",
  };
}

function ok(json: unknown): { status: number; json: unknown } {
  return { status: 200, json };
}

function send(response: ServerResponse, status: number, json: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(json));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}
