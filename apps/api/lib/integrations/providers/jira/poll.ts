import type { JsonValue } from "@repo/api/src/types/common";
import { Result } from "@repo/api/src/types/result";
import {
  HttpMethod,
  type InboundEvent,
  type IntegrationAccount,
  type PollInput,
  type PollResult,
  type PollScope,
} from "../../types";
import { JiraRestVersion } from "./auth";
import {
  type JiraContext,
  type JiraError,
  jiraIssuePath,
  jiraRequest,
} from "./client";
import { JiraDeployment, JiraPollScope } from "./constants";
import { parseJiraDate } from "./dates";
import { isJiraBotIdentity, isJiraBotUser, jiraUserActor } from "./identity";
import {
  addedLabels,
  assignsFromBot,
  assignsToBot,
  hasConditionFacts,
  isAssignedToBot,
  isAssigneeChange,
  isLabelsChange,
  type JiraConditionFacts,
  type JiraIssueOccurrence,
  type JiraIssueState,
  jiraAssignedEvent,
  jiraConditionsEvent,
  jiraIssueState,
  labelTokens,
} from "./issue-events";
import { jiraPollIssueEvents } from "./poll-events";
import { jiraProjectSettingsSchema } from "./project";
import {
  type JiraComment,
  type JiraHistory,
  type JiraIssue,
  type JiraSearchResult,
  jiraChangelogPageSchema,
  jiraCommentPageSchema,
  jiraIssueSchema,
  jiraPollCursorSchema,
  jiraPollScopeOf,
  jiraSearchResultSchema,
} from "./schemas";

/**
 * Poll mode: every scheduler tick (per the connection's poll interval) asks
 * Jira, as the bot, for issues assigned to it that changed recently, and
 * emits `jira.issue_assigned` events for assignments that happened in the
 * window. dedupKeys match the webhook path ("{key}:assignee:{historyId}",
 * "{key}:created"), so overlapping windows and mode switches never duplicate
 * runs.
 *
 * - The JQL window is relative (`updated >= "-Nm"`), so it does not depend
 *   on the bot's time zone; events are then filtered by exact timestamps.
 * - Windows overlap by two minutes, and the cursor stays one minute behind
 *   now, to absorb clock skew and search index lag.
 * - At most 50 issues per poll (oldest change first); when more match, the
 *   cursor advances to the newest issue seen and the next poll continues.
 * - `jira.issue_labeled` is not polled: Jira search cannot tell when a label
 *   was added (labels are not supported by `CHANGED`), and polling every
 *   labeled issue on the site would flood the delivery log.
 * - `jira.issue_conditions` events are emitted for the assignments and the
 *   label changes of the polled issues (so only issues assigned to the bot),
 *   each with the issue state right after that change, replayed from the
 *   changelog. Mentions are not polled.
 *
 * Poll scope `project_changes` (connection config `pollScope`) polls instead
 * the Jira projects claimed by the connection's project connections, narrowed
 * by each one's `issueFilter` JQL. It reads only the last poll interval (plus
 * the overlap; older changes are skipped), follows search pages (3 x 100
 * issues per poll, then continues next poll), reads descriptions and comments
 * on REST v2 (wiki markup, like webhooks; the comment endpoint is read when a
 * human comment changed in the window, since only it carries `parentId`), and turns every change into the
 * events the webhook path builds (see poll-events.ts).
 */

export const JIRA_POLL_MAX_ISSUES = 50;

const MINUTE_MS = 60_000;
/** First poll (null cursor): no backlog older than this. */
const FIRST_POLL_LOOKBACK_MS = 5 * MINUTE_MS;
/** A cursor older than this (polling was off for a long time) is clamped: no flood of stale runs. */
const MAX_LOOKBACK_MS = 24 * 60 * MINUTE_MS;
const WINDOW_OVERLAP_MS = 2 * MINUTE_MS;
const INDEX_LAG_MS = MINUTE_MS;
/** Minimum cursor progress when a full page did not move past the cursor. */
const MIN_PROGRESS_MS = MINUTE_MS;
/** Cloud `GET /issue/{id}/changelog` page size. */
const CHANGELOG_PAGE_SIZE = 100;

const POLL_FIELDS = [
  "summary",
  "issuetype",
  "labels",
  "status",
  "assignee",
  "reporter",
  "creator",
  "project",
  "created",
  "updated",
].join(",");

export const JIRA_POLL_NO_SCOPES_ERROR =
  'Poll scope "Every change" has no Jira projects: add this connection to a project (Project settings → Integrations) with Jira project keys.';

export const JIRA_POLL_BOT_UNKNOWN_ERROR =
  "The bot account of this Jira connection is unknown. Test the connection to look it up.";

export async function pollJira(
  ctx: JiraContext,
  cursor: JsonValue | null,
  pollInput?: PollInput
): Promise<PollResult> {
  const account = ctx.connection.account;
  if (!account) {
    throw new Error(JIRA_POLL_BOT_UNKNOWN_ERROR);
  }
  if (jiraPollScopeOf(ctx.connection.config) === JiraPollScope.ProjectChanges) {
    if (!pollInput) {
      throw new Error("Polling project changes needs the poll interval");
    }
    return await pollProjectChanges(ctx, cursor, pollInput, account);
  }
  const now = ctx.now();
  const since = resolveSince(cursor, now);
  const windowStart = new Date(since.getTime() - WINDOW_OVERLAP_MS);
  const page = await searchAssignedIssues(ctx, windowStart, now);
  if (!page.ok) {
    throw new Error(`Jira search failed: ${page.error.message}`);
  }
  const events: InboundEvent[] = [];
  for (const issue of page.value.issues) {
    const histories = await loadHistories(ctx, issue);
    if (!histories.ok) {
      throw new Error(
        `Could not read the changelog of ${issue.key}: ${histories.error.message}`
      );
    }
    const input: IssueEventsInput = {
      siteUrl: ctx.connection.config.siteUrl,
      issue,
      histories: histories.value,
      windowStart,
      account,
    };
    events.push(
      ...issueAssignmentEvents(input),
      ...issueConditionEvents(input)
    );
  }
  if (page.value.truncated) {
    ctx.log.warn("Jira poll returned a full page; continuing next poll", {
      connectionId: ctx.connection.id,
      issues: page.value.issues.length,
    });
  }
  const next = nextSince({
    since,
    now,
    issues: page.value.issues,
    truncated: page.value.truncated,
  });
  return { events, cursor: { since: next.toISOString() } };
}

type SearchPage = { issues: JiraIssue[]; truncated: boolean };

async function searchAssignedIssues(
  ctx: JiraContext,
  windowStart: Date,
  now: Date
): Promise<Result<SearchPage, JiraError>> {
  const minutes = Math.max(
    1,
    Math.ceil((now.getTime() - windowStart.getTime()) / MINUTE_MS) + 1
  );
  const result = await jiraRequest(
    ctx,
    {
      method: HttpMethod.Get,
      path:
        ctx.connection.config.deployment === JiraDeployment.Cloud
          ? "search/jql"
          : "search",
      query: {
        jql: `assignee = currentUser() AND updated >= "-${minutes}m" ORDER BY updated ASC`,
        fields: POLL_FIELDS,
        expand: "changelog",
        maxResults: JIRA_POLL_MAX_ISSUES,
      },
    },
    jiraSearchResultSchema
  );
  if (!result.ok) {
    return result;
  }
  const issues = result.value.issues ?? [];
  return Result.ok({
    issues: issues.slice(0, JIRA_POLL_MAX_ISSUES),
    truncated:
      issues.length > JIRA_POLL_MAX_ISSUES || hasMoreResults(result.value),
  });
}

/**
 * The changelog that came with the search result; fetched separately when
 * the search did not include it, and (Cloud) completed with the newest page
 * when Jira returned only part of a long history.
 */
async function loadHistories(
  ctx: JiraContext,
  issue: JiraIssue,
  restVersion?: JiraRestVersion
): Promise<Result<JiraHistory[], JiraError>> {
  let changelog = issue.changelog;
  if (!changelog?.histories) {
    const fetched = await jiraRequest(
      ctx,
      {
        method: HttpMethod.Get,
        path: jiraIssuePath(issue.id),
        query: { fields: "assignee", expand: "changelog" },
        restVersion,
      },
      jiraIssueSchema
    );
    if (!fetched.ok) {
      return fetched;
    }
    changelog = fetched.value.changelog;
  }
  const histories = changelog?.histories ?? [];
  const total = changelog?.total ?? histories.length;
  if (
    total <= histories.length ||
    ctx.connection.config.deployment !== JiraDeployment.Cloud
  ) {
    return Result.ok(histories);
  }
  return await loadNewestHistories(ctx, issue, histories, total, restVersion);
}

async function loadNewestHistories(
  ctx: JiraContext,
  issue: JiraIssue,
  partial: JiraHistory[],
  total: number,
  restVersion?: JiraRestVersion
): Promise<Result<JiraHistory[], JiraError>> {
  const page = await jiraRequest(
    ctx,
    {
      method: HttpMethod.Get,
      path: jiraIssuePath(issue.id, "changelog"),
      query: {
        startAt: Math.max(0, total - CHANGELOG_PAGE_SIZE),
        maxResults: CHANGELOG_PAGE_SIZE,
      },
      restVersion,
    },
    jiraChangelogPageSchema
  );
  if (!page.ok) {
    return page;
  }
  const byId = new Map(partial.map((history) => [history.id, history]));
  for (const history of page.value.values ?? []) {
    byId.set(history.id, history);
  }
  return Result.ok([...byId.values()]);
}

type IssueEventsInput = {
  siteUrl: string;
  issue: JiraIssue;
  histories: JiraHistory[];
  windowStart: Date;
  account: IntegrationAccount;
};

/** Assignments to the bot inside the window, oldest first. Changes made by the bot are skipped. */
export function issueAssignmentEvents(input: IssueEventsInput): InboundEvent[] {
  const histories = sortByCreated(input.histories);
  const events = histories
    .filter((history) => isRecentAssignmentToBot(history, input))
    .map((history) =>
      jiraAssignedEvent(
        occurrence(input, parseJiraDate(history.created), history.author),
        history.id
      )
    );
  const created = createdAssignedEvent(input, histories);
  return created ? [created, ...events] : events;
}

function isRecentAssignmentToBot(
  history: JiraHistory,
  input: IssueEventsInput
): boolean {
  const created = parseJiraDate(history.created);
  if (!created || created < input.windowStart) {
    return false;
  }
  if (isJiraBotUser(input.account, history.author)) {
    return false;
  }
  return (history.items ?? []).some((item) =>
    assignsToBot(item, input.account)
  );
}

/** An issue created in the window with the bot as its first assignee. */
function createdAssignedEvent(
  input: IssueEventsInput,
  sortedHistories: JiraHistory[]
): InboundEvent | null {
  const fields = input.issue.fields;
  const createdAt = parseJiraDate(fields.created);
  if (!createdAt || createdAt < input.windowStart) {
    return null;
  }
  if (isJiraBotUser(input.account, fields.creator)) {
    return null;
  }
  const firstAssigneeChange = sortedHistories
    .flatMap((history) => history.items ?? [])
    .find(isAssigneeChange);
  const createdWithBot = firstAssigneeChange
    ? assignsFromBot(firstAssigneeChange, input.account)
    : isAssignedToBot(input.issue, input.account);
  if (!createdWithBot) {
    return null;
  }
  return jiraAssignedEvent(
    occurrence(input, createdAt, fields.creator ?? fields.reporter),
    null
  );
}

function occurrence(
  input: IssueEventsInput,
  occurredAt: Date | null,
  actor: JiraHistory["author"]
): JiraIssueOccurrence {
  return {
    siteUrl: input.siteUrl,
    issue: input.issue,
    occurredAt: occurredAt ?? input.windowStart,
    actor: jiraUserActor(actor),
  };
}

function resolveSince(
  cursor: JsonValue | null,
  now: Date,
  maxLookbackMs = MAX_LOOKBACK_MS,
  firstLookbackMs = FIRST_POLL_LOOKBACK_MS
): Date {
  const oldest = new Date(now.getTime() - maxLookbackMs);
  const parsed = jiraPollCursorSchema.safeParse(cursor);
  if (!parsed.success) {
    return new Date(now.getTime() - firstLookbackMs);
  }
  const since = new Date(parsed.data.since);
  if (since < oldest) {
    return oldest;
  }
  // A cursor ahead of this clock (Jira's clock is ahead) never skips the present.
  return since > now ? now : since;
}

type NextSinceInput = {
  since: Date;
  now: Date;
  issues: JiraIssue[];
  truncated: boolean;
};

/**
 * Complete page: everything up to one minute ago is covered (or up to the
 * newest change seen). Truncated page: continue from the newest change seen,
 * moving at least a minute forward so a burst of simultaneous changes cannot
 * stall polling.
 */
function nextSince(input: NextSinceInput): Date {
  const newestUpdate = latestDate(
    input.issues.map((issue) => parseJiraDate(issue.fields.updated))
  );
  const floor = input.truncated
    ? new Date(input.since.getTime() + MIN_PROGRESS_MS)
    : new Date(input.now.getTime() - INDEX_LAG_MS);
  return latestDate([newestUpdate, floor, input.since]) ?? floor;
}

function hasMoreResults(result: JiraSearchResult): boolean {
  if (result.nextPageToken || result.isLast === false) {
    return true;
  }
  if (typeof result.total !== "number") {
    return false;
  }
  return (result.startAt ?? 0) + (result.issues?.length ?? 0) < result.total;
}

function sortByCreated(histories: JiraHistory[]): JiraHistory[] {
  return [...histories].sort(
    (left, right) =>
      (parseJiraDate(left.created)?.getTime() ?? 0) -
      (parseJiraDate(right.created)?.getTime() ?? 0)
  );
}

function latestDate(dates: ReadonlyArray<Date | null>): Date | null {
  let latest: Date | null = null;
  for (const date of dates) {
    if (date && (!latest || date > latest)) {
      latest = date;
    }
  }
  return latest;
}

/**
 * jira.issue_conditions events of the issue's changes inside the window
 * (and of its creation, when it was created inside it), oldest first. Each
 * carries the issue state right after that change, so a combination is
 * judged as a webhook delivered at that moment would have been.
 */
export function issueConditionEvents(input: IssueEventsInput): InboundEvent[] {
  const histories = sortByCreated(input.histories);
  const replay = replayIssueStates(input, histories);
  const events: InboundEvent[] = [];
  const created = createdConditionsEvent(input, replay.initial);
  if (created) {
    events.push(created);
  }
  histories.forEach((history, index) => {
    const createdAt = parseJiraDate(history.created);
    const state = replay.after[index];
    if (
      !(state && createdAt) ||
      createdAt < input.windowStart ||
      isJiraBotUser(input.account, history.author)
    ) {
      return;
    }
    const facts = historyConditionFacts(history, input.account);
    if (hasConditionFacts(facts)) {
      events.push(
        jiraConditionsEvent({
          occurrence: occurrence(input, createdAt, history.author),
          facts,
          state,
          changeId: history.id,
        })
      );
    }
  });
  return events;
}

/** An issue created in the window, with the state it was created in. */
function createdConditionsEvent(
  input: IssueEventsInput,
  initial: JiraIssueState
): InboundEvent | null {
  const fields = input.issue.fields;
  const createdAt = parseJiraDate(fields.created);
  if (
    !createdAt ||
    createdAt < input.windowStart ||
    isJiraBotUser(input.account, fields.creator)
  ) {
    return null;
  }
  const facts: JiraConditionFacts = {
    becameAssigned: initial.assignedToBot,
    addedLabels: initial.labels,
    mentioned: false,
  };
  if (!hasConditionFacts(facts)) {
    return null;
  }
  return jiraConditionsEvent({
    occurrence: occurrence(input, createdAt, fields.creator ?? fields.reporter),
    facts,
    state: initial,
    changeId: null,
  });
}

function historyConditionFacts(
  history: JiraHistory,
  account: IntegrationAccount
): JiraConditionFacts {
  const items = history.items ?? [];
  return {
    becameAssigned: items.some((item) => assignsToBot(item, account)),
    addedLabels: [
      ...new Set(items.filter(isLabelsChange).flatMap(addedLabels)),
    ],
    mentioned: false,
  };
}

type IssueStateReplay = {
  /** The state the issue was created in (before its first change). */
  initial: JiraIssueState;
  /** The state right after each history (same order as the histories). */
  after: JiraIssueState[];
};

/**
 * Walks the changelog back from the issue's current state: the state after
 * a history is the state before the next one, and undoing a history restores
 * its `from` values.
 */
function replayIssueStates(
  input: IssueEventsInput,
  sortedHistories: JiraHistory[]
): IssueStateReplay {
  let state = jiraIssueState(input.issue, input.account);
  const after: JiraIssueState[] = [];
  for (let index = sortedHistories.length - 1; index >= 0; index--) {
    after[index] = state;
    state = undoHistory(state, sortedHistories[index], input.account);
  }
  return { initial: state, after };
}

function undoHistory(
  state: JiraIssueState,
  history: JiraHistory | undefined,
  account: IntegrationAccount
): JiraIssueState {
  let { assignedToBot, labels } = state;
  for (const item of history?.items ?? []) {
    if (isAssigneeChange(item)) {
      assignedToBot = isJiraBotIdentity(account, [
        item.tmpFromAccountId,
        item.from,
      ]);
    } else if (isLabelsChange(item)) {
      labels = [...new Set(labelTokens(item.fromText ?? item.from))];
    }
  }
  return { assignedToBot, labels };
}

/** Cloud REST v2 returns wiki markup like webhooks, so snapshots match webhook events. */
const PROJECT_CHANGES_REST_VERSION = JiraRestVersion.DataCenter;
const PROJECT_CHANGES_FIELDS = `${POLL_FIELDS},description,comment`;
const JIRA_POLL_PAGE_SIZE = 100;
const JIRA_POLL_MAX_PAGES = 3;
const COMMENT_PAGE_SIZE = 100;

async function pollProjectChanges(
  ctx: JiraContext,
  cursor: JsonValue | null,
  input: PollInput,
  account: IntegrationAccount
): Promise<PollResult> {
  const now = ctx.now();
  const oldestMs =
    input.intervalSeconds * 1000 + INDEX_LAG_MS + WINDOW_OVERLAP_MS;
  const since = resolveSince(
    cursor,
    now,
    oldestMs,
    Math.min(FIRST_POLL_LOOKBACK_MS, oldestMs)
  );
  warnWhenCursorSkipped(ctx, cursor, since, now, oldestMs);
  const windowStart = new Date(since.getTime() - WINDOW_OVERLAP_MS);
  const jql = buildJiraPollJql(
    await input.loadScopes(),
    windowMinutes(windowStart, now)
  );
  if (!jql) {
    throw new Error(JIRA_POLL_NO_SCOPES_ERROR);
  }
  const page = await searchScopedIssues(ctx, jql);
  const events: InboundEvent[] = [];
  for (const issue of page.issues) {
    const histories = await loadHistories(
      ctx,
      issue,
      PROJECT_CHANGES_REST_VERSION
    );
    if (!histories.ok) {
      throw new Error(
        `Could not read the changelog of ${issue.key}: ${histories.error.message}`
      );
    }
    events.push(
      ...jiraPollIssueEvents({
        siteUrl: ctx.connection.config.siteUrl,
        issue,
        histories: histories.value,
        comments: await loadComments(ctx, issue, { account, windowStart }),
        windowStart,
        account,
      })
    );
  }
  if (page.truncated) {
    ctx.log.warn("Jira poll returned a full page; continuing next poll", {
      connectionId: ctx.connection.id,
      issues: page.issues.length,
    });
  }
  const next = nextSince({
    since,
    now,
    issues: page.issues,
    truncated: page.truncated,
  });
  return { events, cursor: { since: next.toISOString() } };
}

function warnWhenCursorSkipped(
  ctx: JiraContext,
  cursor: JsonValue | null,
  since: Date,
  now: Date,
  oldestMs: number
): void {
  const parsed = jiraPollCursorSchema.safeParse(cursor);
  if (
    parsed.success &&
    new Date(parsed.data.since) < new Date(now.getTime() - oldestMs)
  ) {
    ctx.log.warn("Jira poll skipped changes older than the poll interval", {
      connectionId: ctx.connection.id,
      cursor: parsed.data.since,
      since: since.toISOString(),
    });
  }
}

function windowMinutes(windowStart: Date, now: Date): number {
  return Math.max(
    1,
    Math.ceil((now.getTime() - windowStart.getTime()) / MINUTE_MS) + 1
  );
}

function jqlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** JQL of the project connections' Jira projects (and issue filters) changed in the last `minutes`; null without projects. */
export function buildJiraPollJql(
  scopes: readonly PollScope[],
  minutes: number
): string | null {
  const clauses: string[] = [];
  for (const scope of scopes) {
    if (scope.containers.length === 0) {
      continue;
    }
    const settings = jiraProjectSettingsSchema.safeParse(scope.settings);
    if (!settings.success) {
      continue;
    }
    const projects = `project in (${scope.containers.map(jqlString).join(", ")})`;
    const filter = settings.data.issueFilter;
    clauses.push(filter ? `(${projects} AND (${filter}))` : `(${projects})`);
  }
  if (clauses.length === 0) {
    return null;
  }
  const where = clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`;
  return `${where} AND updated >= "-${minutes}m" ORDER BY updated ASC`;
}

/** Follows the search pages (Cloud `nextPageToken`, Data Center `startAt`) up to the page cap. */
async function searchScopedIssues(
  ctx: JiraContext,
  jql: string
): Promise<SearchPage> {
  const cloud = ctx.connection.config.deployment === JiraDeployment.Cloud;
  const issues: JiraIssue[] = [];
  let pageToken: string | undefined;
  let last: JiraSearchResult | null = null;
  for (let pageNo = 0; pageNo < JIRA_POLL_MAX_PAGES; pageNo++) {
    const result = await jiraRequest(
      ctx,
      {
        method: HttpMethod.Get,
        path: cloud ? "search/jql" : "search",
        query: {
          jql,
          fields: PROJECT_CHANGES_FIELDS,
          expand: "changelog",
          maxResults: JIRA_POLL_PAGE_SIZE,
          ...(cloud
            ? { nextPageToken: pageToken }
            : { startAt: issues.length }),
        },
        restVersion: PROJECT_CHANGES_REST_VERSION,
      },
      jiraSearchResultSchema
    );
    if (!result.ok) {
      throw new Error(`Jira search failed: ${result.error.message}`);
    }
    last = result.value;
    const returned = last.issues ?? [];
    issues.push(...returned);
    pageToken = last.nextPageToken ?? undefined;
    if (returned.length === 0 || !hasMoreResults(last)) {
      return { issues, truncated: false };
    }
    if (cloud && !pageToken) {
      return { issues, truncated: false };
    }
  }
  return { issues, truncated: last ? hasMoreResults(last) : false };
}

/**
 * The comments of the issue. The search returns comments without `parentId`, so
 * when a human comment changed inside the window (or the search returned only
 * part of them) the newest page is read from the comment endpoint, the only one
 * that carries `parentId`. Otherwise the search comments are enough.
 */
async function loadComments(
  ctx: JiraContext,
  issue: JiraIssue,
  window: { account: IntegrationAccount; windowStart: Date }
): Promise<JiraComment[]> {
  const inline = issue.fields.comment;
  const comments = inline?.comments ?? [];
  const total = inline?.total ?? comments.length;
  const complete =
    inline !== null && inline !== undefined && total <= comments.length;
  if (
    complete &&
    !comments.some((comment) => changedByHuman(comment, window))
  ) {
    return comments;
  }
  const page = await jiraRequest(
    ctx,
    {
      method: HttpMethod.Get,
      path: jiraIssuePath(issue.id, "comment"),
      query: {
        startAt: Math.max(0, total - COMMENT_PAGE_SIZE),
        maxResults: COMMENT_PAGE_SIZE,
      },
      restVersion: PROJECT_CHANGES_REST_VERSION,
    },
    jiraCommentPageSchema
  );
  if (!page.ok) {
    throw new Error(
      `Could not read the comments of ${issue.key}: ${page.error.message}`
    );
  }
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  for (const comment of page.value.comments ?? []) {
    byId.set(comment.id, comment);
  }
  return [...byId.values()];
}

/** A comment created or edited inside the window by someone other than the bot. */
function changedByHuman(
  comment: JiraComment,
  window: { account: IntegrationAccount; windowStart: Date }
): boolean {
  const changedAt = parseJiraDate(comment.updated ?? comment.created);
  if (!changedAt || changedAt < window.windowStart) {
    return false;
  }
  return !isJiraBotUser(window.account, comment.author);
}
