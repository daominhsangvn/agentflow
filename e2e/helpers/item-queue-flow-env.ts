import { randomInt } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import {
  IntegrationDeliveryMode,
  IntegrationProviderKey,
} from "@repo/api/src/types/integration";
import {
  ProcessQuestionsPolicy,
  ProcessStepFinish,
  ProcessStepType,
} from "@repo/api/src/types/project-process";
import {
  type Workflow,
  type WorkflowRunDetail,
  WorkflowRunEvent,
  type WorkflowRunSummary,
} from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import type {
  WorkflowEventSummary,
  WorkflowEventsResponse,
} from "@repo/api/src/types/workflow-event";
import { WorkflowSameItem } from "@repo/api/src/types/workflow-same-item";
import { expect } from "../test";
import { bearer, readApiResult } from "./api-result";
import { getApiBaseUrl } from "./api-url";
import { createProject, deleteProject } from "./create-project";
import {
  FakeAgent,
  type LoopBody,
  type TaskOutcome,
  type TaskScript,
} from "./fake-agent";
import {
  commentCreatedWebhook,
  FAKE_JIRA_BOT,
  FAKE_JIRA_PERSON,
  FAKE_JIRA_PROJECT_KEY,
  type FakeJira,
  jiraWebhookHeaders,
  startFakeJira,
} from "./fake-jira";
import {
  createIntegrationConnection,
  createProjectConnection,
  deleteIntegrationConnection,
  deleteProjectConnection,
  getIntegrationInboundDetails,
  toLocalInboundUrl,
} from "./integrations";
import { PollAbortError, pollUntil } from "./poll";
import { createUniqueName } from "./utils";
import {
  createWorkflow,
  deleteWorkflow,
  getWorkflowRun,
  listWorkflowRuns,
} from "./workflows";

/**
 * The setup of workflow-item-queue.spec.ts: a fake Jira site, a project with a
 * repository, two fake Agents that can fork a session and report a missing
 * resume session, and a plan_and_execute workflow with one agent step and
 * `agent.sameItem: queue_resume` that answers a mention and posts the reply on
 * the issue. Fake Agent loops follow one shared script queue, so a test names
 * the loops in the order the engine starts them, whichever Agent takes each.
 */

/** A run waits for the engine tick, the lock and the reply of the earlier run. */
export const QUEUE_STEP_TIMEOUT_MS = 120_000;
/** The workflow's step; its reply is the answer posted on the issue. */
export const ANSWER_STEP_ID = "answer";
export const ANSWER_REPLY_PATH = ".agentflow-ai/work/answer.md";
export const ANSWER_INSTRUCTION = "/ask Answer the mention in {{issue.file}}.";
/** Trigger and action types of the Jira provider (apps/api/lib/integrations/providers/jira/constants.ts). */
const JIRA_TRIGGER_ISSUE_MENTIONED = "jira.issue_mentioned";
const JIRA_ACTION_ADD_COMMENT = "jira.add_comment";
const JIRA_KEY = "jira-queue-e2e";
const SCRIPTS_PER_AGENT = 12;
const POLL_INTERVAL_MS = 1000;
const EVENTS_LIMIT = 100;
const MENTION_ORDER_GAP_MS = 25;

export type ItemQueueFlow = {
  agentA: FakeAgent;
  agentB: FakeAgent;
  jira: FakeJira;
  workflow: Workflow;
};

export type Issue = { key: string; summary: string };

/** One loop as the shared script queue ran it. */
export type LoopRecord = {
  loopId: string;
  agent: FakeAgent;
  body: LoopBody;
  startedAt: number;
  endedAt: number | null;
};

/** A script of one loop; `agent` is the Agent the engine dispatched it to. */
export type LoopScript = (
  loop: LoopBody,
  agent: FakeAgent
) => Promise<TaskOutcome>;

export type RunView = {
  summary: WorkflowRunSummary;
  detail: WorkflowRunDetail;
};

export type QueueSnapshot = {
  runs: RunView[];
  /** Results of the workflow's events, oldest first. */
  events: WorkflowEventSummary[];
};

/** A promise a script waits on until the test opens it. */
export type Gate = { wait: Promise<void>; open(): void };

export function createGate(): Gate {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

export class ItemQueueEnv {
  private readonly api = getApiBaseUrl();
  private projectId: string | null = null;
  private connectionId: string | null = null;
  private projectConnectionId: string | null = null;
  private workflowId: string | null = null;
  private inbound: { url: string; secret: string } | null = null;
  private jira: FakeJira | null = null;
  private readonly agents: FakeAgent[] = [];
  private readonly scripts: LoopScript[] = [];
  private readonly records: LoopRecord[] = [];
  private nextCommentId = 8_000_000 + randomInt(0, 900_000);

  private readonly request: APIRequestContext;
  private readonly token: string;

  constructor(request: APIRequestContext, token: string) {
    this.request = request;
    this.token = token;
  }

  async setUp(): Promise<ItemQueueFlow> {
    const jira = await startFakeJira();
    this.jira = jira;
    const project = await createProject(this.request, {
      name: createUniqueName("e2e-queue-project"),
      token: this.token,
    });
    this.projectId = project.id;
    await this.addRepository(project.id);

    const resumeAgent = { loopStepForkSession: true, loopStepResumeMiss: true };
    const agentA = await this.agent("e2e-queue-a", resumeAgent);
    const agentB = await this.agent("e2e-queue-b", resumeAgent);
    await this.setProjectAgents([agentA.id, agentB.id]);

    const connection = await createIntegrationConnection(this.request, {
      input: {
        provider: IntegrationProviderKey.Jira,
        name: createUniqueName("e2e-queue-jira"),
        deliveryMode: IntegrationDeliveryMode.Webhook,
        config: {
          deployment: "cloud",
          siteUrl: jira.url,
          email: FAKE_JIRA_BOT.emailAddress,
        },
        secrets: { apiToken: "fake-token" },
      },
      token: this.token,
    });
    this.connectionId = connection.id;
    const projectConnection = await createProjectConnection(this.request, {
      projectId: project.id,
      input: {
        connectionId: connection.id,
        key: JIRA_KEY,
        name: connection.name,
        settings: { projectKeys: [FAKE_JIRA_PROJECT_KEY] },
      },
      token: this.token,
    });
    this.projectConnectionId = projectConnection.id;
    const inbound = await getIntegrationInboundDetails(
      this.request,
      connection.id,
      this.token
    );
    this.inbound = {
      url: toLocalInboundUrl(inbound.inboundUrl),
      secret: inbound.inboundSecret,
    };

    const workflow = await createWorkflow(this.request, {
      token: this.token,
      input: {
        name: createUniqueName("e2e-queue-workflow"),
        projectId: project.id,
        agent: {
          mode: WorkflowAgentMode.PlanAndExecute,
          sameItem: WorkflowSameItem.QueueResume,
          computeTargetId: agentA.id,
          process: {
            toolkit: null,
            steps: [
              {
                type: ProcessStepType.Agent,
                id: ANSWER_STEP_ID,
                name: "Answer",
                instruction: ANSWER_INSTRUCTION,
                reply: ANSWER_REPLY_PATH,
                finish: ProcessStepFinish.None,
                questions: ProcessQuestionsPolicy.Continue,
              },
            ],
          },
        },
        triggers: [
          {
            connectionKey: JIRA_KEY,
            type: JIRA_TRIGGER_ISSUE_MENTIONED,
            config: {},
          },
        ],
        actions: [
          {
            connectionKey: JIRA_KEY,
            type: JIRA_ACTION_ADD_COMMENT,
            config: { message: "{{reply}}" },
            events: [WorkflowRunEvent.Succeeded],
          },
        ],
      },
    });
    this.workflowId = workflow.id;
    return { agentA, agentB, jira, workflow };
  }

  /** A new issue on the fake Jira site. */
  newIssue(): Issue {
    const issue = {
      key: `${FAKE_JIRA_PROJECT_KEY}-${randomInt(100_000, 999_999)}`,
      summary: `Queue e2e ${createUniqueName("issue")}`,
    };
    this.fakeJira().addIssue(issue);
    return issue;
  }

  /**
   * The next loop any Agent runs follows `script`; scripts are taken in the
   * order the engine starts the loops.
   */
  script(script: LoopScript): void {
    this.scripts.push(script);
  }

  /** A person's comment on the issue that mentions the bot; returns the webhook body. */
  mention(issue: Issue, text: string): Promise<unknown> {
    return this.comment(
      issue,
      `[~accountid:${FAKE_JIRA_BOT.accountId}] ${text}`
    );
  }

  /** A person's comment that does not mention the bot. */
  plainComment(issue: Issue, text: string): Promise<unknown> {
    return this.comment(issue, text);
  }

  /** Delivers a webhook body (again, for a redelivery). */
  async deliver(body: unknown): Promise<void> {
    if (!this.inbound) {
      throw new Error("No inbound URL");
    }
    const response = await this.request.post(this.inbound.url, {
      data: JSON.stringify(body),
      headers: jiraWebhookHeaders(this.inbound.secret),
    });
    expect(response.status(), await response.text()).toBe(200);
  }

  /** The loops the shared script queue ran, in start order. */
  loopRecords(): readonly LoopRecord[] {
    return this.records;
  }

  /** Loops started so far, by the dispatched loop bodies of every Agent. */
  startedLoops(): number {
    return this.records.length;
  }

  async snapshot(): Promise<QueueSnapshot> {
    const summaries = await listWorkflowRuns(
      this.request,
      this.requireWorkflowId(),
      this.token
    );
    const ordered = [...summaries].sort(
      (left, right) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    );
    const runs: RunView[] = [];
    for (const summary of ordered) {
      runs.push({
        summary,
        detail: await getWorkflowRun(this.request, summary.id, this.token),
      });
    }
    const page = await readApiResult<WorkflowEventsResponse>(
      await this.request.get(
        `${this.api}/workflows/${this.workflowId}/events?limit=${EVENTS_LIMIT}`,
        { headers: bearer(this.token) }
      ),
      "List the workflow's events"
    );
    const events = [...page.events].sort(
      (left, right) =>
        new Date(left.deliveredAt).getTime() -
        new Date(right.deliveredAt).getTime()
    );
    return { runs, events };
  }

  /**
   * Polls until `ready` holds; the timeout error lists the runs, loops, events
   * and what the fake Agents and Jira saw. A fake Agent error stops the wait.
   */
  async waitFor(
    description: string,
    ready: (snapshot: QueueSnapshot) => boolean
  ): Promise<QueueSnapshot> {
    let last = "no snapshot yet";
    return await pollUntil(
      async () => {
        const snapshot = await this.snapshot();
        last = this.describe(snapshot);
        const errors = this.agentErrors();
        if (errors.length > 0) {
          throw new PollAbortError(
            `Fake Agent errors while waiting for ${description}: ${JSON.stringify(errors)}\n${last}`
          );
        }
        return ready(snapshot) ? snapshot : null;
      },
      {
        description,
        timeoutMs: QUEUE_STEP_TIMEOUT_MS,
        intervalMs: POLL_INTERVAL_MS,
        describeLastAttempt: () => `\n${last}`,
      }
    );
  }

  /** Statuses of the runs, their loops, the events, the Agents' requests and Jira's strays. */
  describe(snapshot: QueueSnapshot): string {
    const lines: string[] = [];
    snapshot.runs.forEach(({ summary, detail }, index) => {
      lines.push(
        `run ${index + 1} ${summary.id} ${summary.status} source=${summary.source.key} error=${JSON.stringify(summary.error)} queuedBehind=${JSON.stringify(detail.queuedBehind)} sessionCarry=${JSON.stringify(detail.sessionCarry)}`
      );
      for (const loop of detail.loops) {
        lines.push(`  loop ${loop.loopId} ${loop.status} step=${loop.stepId}`);
      }
    });
    lines.push(
      `events: ${snapshot.events.map((event) => event.result).join(", ")}`
    );
    for (const agent of this.agents) {
      lines.push(
        `agent ${agent.name}: errors=${JSON.stringify(agent.errors())}`
      );
      for (const loop of agent.loops()) {
        lines.push(`  received ${describeLoopBody(loop)}`);
      }
    }
    lines.push(
      `fake Jira posted: ${this.postedBodies(snapshot).length}, unhandled: ${JSON.stringify(this.jira?.unhandled())}`
    );
    return lines.join("\n");
  }

  /** The loop body an Agent received for a loop id. */
  loopBody(loopId: string): LoopBody {
    for (const agent of this.agents) {
      const body = agent.loops().find((loop) => loop.loopId === loopId);
      if (body) {
        return body;
      }
    }
    throw new Error(`No Agent received loop ${loopId}`);
  }

  /** The record of the loop the shared script queue ran. */
  loopRecord(loopId: string): LoopRecord {
    const record = this.records.find((entry) => entry.loopId === loopId);
    if (!record) {
      throw new Error(`No script ran loop ${loopId}`);
    }
    return record;
  }

  /** The loops of one issue ran one at a time: no loop started before the previous one ended. */
  loopsOverlap(loopIds: readonly string[]): boolean {
    const ranges = loopIds
      .map((loopId) => this.loopRecord(loopId))
      .sort((left, right) => left.startedAt - right.startedAt);
    return ranges.some((range, index) => {
      const previous = ranges[index - 1];
      return (
        previous !== undefined &&
        (previous.endedAt === null || previous.endedAt > range.startedAt)
      );
    });
  }

  /** The bodies the bot posted on the issue, in order. */
  postedOn(issue: Issue): string[] {
    return this.fakeJira()
      .postedComments(issue.key)
      .map((comment) => comment.body);
  }

  fakeJira(): FakeJira {
    if (!this.jira) {
      throw new Error("The fake Jira site is not started");
    }
    return this.jira;
  }

  expectNoAgentErrors(): void {
    expect(this.agentErrors(), "fake Agent errors").toEqual([]);
  }

  /** Deletes what the run created; with `keep` only the fake processes stop. */
  async cleanUp(keep = false): Promise<void> {
    if (keep) {
      for (const agent of this.agents) {
        await agent.disconnect();
      }
      await this.jira?.close();
      return;
    }
    await deleteWorkflow(this.request, this.workflowId, this.token);
    await deleteProjectConnection(
      this.request,
      this.projectId,
      this.projectConnectionId,
      this.token
    );
    await deleteIntegrationConnection(
      this.request,
      this.connectionId,
      this.token
    );
    if (this.projectId) {
      await deleteProject(this.request, this.projectId, this.token);
    }
    for (const agent of this.agents) {
      await agent.delete();
    }
    await this.jira?.close();
  }

  private postedBodies(snapshot: QueueSnapshot): string[] {
    return snapshot.runs.flatMap(({ summary }) =>
      this.fakeJira()
        .postedComments(summary.source.key)
        .map((comment) => comment.body)
    );
  }

  private agentErrors(): string[] {
    return this.agents.flatMap((agent) =>
      agent.errors().map((error) => `${agent.name}: ${error}`)
    );
  }

  private async comment(issue: Issue, body: string): Promise<unknown> {
    this.nextCommentId += 1;
    const id = String(this.nextCommentId);
    this.fakeJira().addComment(issue.key, {
      id,
      parentId: null,
      authorAccountId: FAKE_JIRA_PERSON.accountId,
      body,
    });
    const webhook = commentCreatedWebhook(issue, { id, body });
    await this.deliver(webhook);
    // Comments are ordered by their millisecond timestamps.
    await new Promise((resolve) => setTimeout(resolve, MENTION_ORDER_GAP_MS));
    return webhook;
  }

  private requireWorkflowId(): string {
    if (!this.workflowId) {
      throw new Error("No workflow");
    }
    return this.workflowId;
  }

  private async agent(
    prefix: string,
    capabilities: Record<string, unknown>
  ): Promise<FakeAgent> {
    const agent = await FakeAgent.register(
      this.token,
      createUniqueName(prefix),
      capabilities
    );
    this.agents.push(agent);
    for (let index = 0; index < SCRIPTS_PER_AGENT; index += 1) {
      agent.onTask(this.delegate(agent));
    }
    await agent.connect();
    return agent;
  }

  /** A task script that runs the next script of the shared queue and records the loop. */
  private delegate(agent: FakeAgent): TaskScript {
    return async (loop) => {
      const script = this.scripts.shift();
      if (!script) {
        throw new Error(`No script for loop ${loop.loopId} on ${agent.name}`);
      }
      const record: LoopRecord = {
        loopId: loop.loopId,
        agent,
        body: loop,
        startedAt: Date.now(),
        endedAt: null,
      };
      this.records.push(record);
      try {
        return await script(loop, agent);
      } finally {
        record.endedAt = Date.now();
      }
    };
  }

  async setProjectAgents(runnerIds: string[]): Promise<void> {
    const response = await this.request.put(
      `${this.api}/projects/${this.projectId}/runners`,
      { data: { runnerIds }, headers: bearer(this.token) }
    );
    expect(response.status(), await response.text()).toBe(200);
  }

  /** The project's loops need a repository: one of the org's Local Git repositories. */
  private async addRepository(projectId: string): Promise<void> {
    const connections = await readApiResult<
      | { connections: { id: string; provider: string }[] }
      | { id: string; provider: string }[]
    >(
      await this.request.get(`${this.api}/integrations/connections`, {
        headers: bearer(this.token),
      }),
      "List connections"
    );
    const list = Array.isArray(connections)
      ? connections
      : connections.connections;
    const localGit = list.find(
      (c) => c.provider === IntegrationProviderKey.LocalGit
    );
    if (!localGit) {
      throw new Error(
        "The org has no Local Git connection (LOCAL_GIT_TOKEN on the API): a task needs a project repository."
      );
    }
    const repos = await readApiResult<{
      repositories: { externalId: string }[];
    }>(
      await this.request.get(
        `${this.api}/integrations/connections/${localGit.id}/repositories`,
        { headers: bearer(this.token) }
      ),
      "List Local Git repositories"
    );
    const first = repos.repositories[0];
    if (!first) {
      throw new Error("Local Git has no repository to add to the project.");
    }
    await readApiResult(
      await this.request.post(
        `${this.api}/projects/${projectId}/repositories`,
        {
          data: { connectionId: localGit.id, externalId: first.externalId },
          headers: bearer(this.token),
        }
      ),
      "Add a repository to the project"
    );
  }
}

function describeLoopBody(loop: LoopBody): string {
  const step = loop.step;
  return `${loop.loopId} parent=${loop.parentLoopId} fork=${step?.forkSession ?? false} fresh=${step?.fresh ?? false} reportResumeMiss=${step?.reportResumeMiss ?? false} inputs=${(step?.inputs ?? []).map((input) => input.name).join("+")} prompt=${JSON.stringify((loop.prompt ?? "").slice(0, 80))}`;
}
