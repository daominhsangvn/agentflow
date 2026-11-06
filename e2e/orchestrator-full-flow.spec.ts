/**
 * The orchestrator end to end on the local stack, with a fake Jira site and
 * fake Agents instead of Jira, computers and Claude (helpers/fake-jira.ts,
 * helpers/fake-agent.ts). Everything else is real: the API, its engine tick,
 * the database, the orchestrator's tools and the Agents tab.
 *
 * One case walks through: a Jira event opens it on the project's orchestrator
 * Agent; the BA Agent asks a question; the Agents tab shows who needs a
 * person and answers it; the BA task resumes; a question to the BA from the
 * Agents tab is relayed as a fork; wait_human asked; a question the BA asked
 * on the ticket under its own account (commentId) and the reply to that
 * comment without a mention; and a removed Agent getting no more tasks.
 */

import { randomInt } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import {
  IntegrationDeliveryMode,
  IntegrationProviderKey,
} from "@repo/api/src/types/integration";
import {
  type OrchestratorCaseDetail,
  type OrchestratorCaseListItem,
  OrchestratorCaseStatus,
  OrchestratorConcurrency,
  OrchestratorMessageKind,
  OrchestratorToolName,
  type WorkflowAgentMap,
} from "@repo/api/src/types/orchestrator";
import { RunnerCapabilitiesSource } from "@repo/api/src/types/runner-capabilities";
import type { Workflow } from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { bearer, readApiResult } from "./helpers/api-result";
import { getApiBaseUrl } from "./helpers/api-url";
import { isOrgAdminRole, requireOrgClaims } from "./helpers/better-auth";
import { createProject, deleteProject } from "./helpers/create-project";
import { FakeAgent, type TurnContext } from "./helpers/fake-agent";
import {
  assignedToBotWebhook,
  commentCreatedWebhook,
  FAKE_JIRA_BOT,
  FAKE_JIRA_PERSON,
  FAKE_JIRA_PROJECT_KEY,
  type FakeJira,
  jiraWebhookHeaders,
  startFakeJira,
} from "./helpers/fake-jira";
import {
  createIntegrationConnection,
  createProjectConnection,
  deleteIntegrationConnection,
  deleteProjectConnection,
  getIntegrationInboundDetails,
  toLocalInboundUrl,
} from "./helpers/integrations";
import { E2ETag } from "./helpers/tags";
import { createUniqueName } from "./helpers/utils";
import { deleteWorkflow } from "./helpers/workflows";
import { expect, test } from "./test";

const ADMIN_REQUIRED_MESSAGE =
  "The e2e user must be an org admin to set up connections and workflows";
const FLOW_TIMEOUT_MS = 10 * 60_000;
/** A turn or task waits for the engine tick (seconds) and the debounce. */
const STEP_TIMEOUT_MS = 90_000;
const QUIET_MS = 8000;
const JIRA_KEY = "jira-e2e";
const AGENTS_TAB_RE = /Agents/;
const CASE_PARAM_RE = /case=/;
const UI_TIMEOUT_MS = 30_000;
const COMMAND = "/ba-clarify";
const AGENTFLOW_MD = `---\nrunner: BA\ncommands:\n  - { name: ${COMMAND}, mode: read, asks: true }\n---\n# BA\n`;

const ENV_QUESTION = "Which environment should the export run in?";
const ENV_ANSWER = "staging";
const SCOPE_REPLY = "Scope: CSV export only, on staging.";
const ASK_TEXT = "Is the PRD final?";
const FORK_REPLY = "The PRD is final.";
const ASKED_HUMAN = "Confirm the PRD is final before planning.";
const DELIM_QUESTION = "Which CSV delimiter?";
/**
 * Comment ids are per Jira site, and the orchestrator's anchors are unique per
 * org and provider: runs in parallel must not reuse them.
 */
const COMMENT_BASE = randomInt(1_000_000, 9_000_000);
const PLAIN_COMMENT_ID = String(COMMENT_BASE);
const DELIM_COMMENT_ID = String(COMMENT_BASE + 1);
const DELIM_REPLY_ID = String(COMMENT_BASE + 2);
const DELIM_ANSWER = "Semicolon";

// A UI action that cannot happen fails the step instead of the whole flow.
test.use({ actionTimeout: UI_TIMEOUT_MS });

type Ids = { task1: string; task2: string; task3: string; task4: string };

test("orchestrator full flow: Jira event, agents, questions, answers and project scope", {
  tag: E2ETag.Smoke,
}, async ({ apiToken: token, page, request }) => {
  test.setTimeout(FLOW_TIMEOUT_MS);
  const { orgRole, orgSlug } = requireOrgClaims(token);
  expect(isOrgAdminRole(orgRole), ADMIN_REQUIRED_MESSAGE).toBe(true);
  const env = new FlowEnv(request, token);
  const ids: Ids = { task1: "", task2: "", task3: "", task4: "" };
  try {
    const flow = await env.setUp();
    const { orch, ba, outside, jira, issue } = flow;

    await test.step("1. a Jira event opens a case; the turn runs on the orchestrator's Agent and the task on the BA", async () => {
      let runnersListed = "";
      orch.onTurn(async (turn) => {
        expect(turn.request.prompt).toContain(issue.summary);
        runnersListed = JSON.stringify(
          await turn.tool(OrchestratorToolName.RunnersList)
        );
        ids.task1 = await runTask(turn, ba, {
          args: issue.key,
          prompt: "Clarify the export scope.",
        });
        return { answer: "Asked the BA to clarify." };
      });
      ba.onTask((loop) => {
        expect(loop.parentLoopId).toBeNull();
        return Promise.resolve({
          questions: [{ id: "env", question: ENV_QUESTION }],
        });
      });
      orch.onTurn(async (turn) => {
        expect(turn.request.prompt).toContain(ENV_QUESTION);
        await turn.tool(OrchestratorToolName.WaitHuman, {
          asked: "The BA needs the target environment.",
        });
        return { answer: "Waiting for the BA's answer." };
      });

      await env.webhook(assignedToBotWebhook(issue));
      const item = await env.waitForCase((c) => c.needsPerson);
      expect(item.sourceKey).toBe(`jira:${issue.key}`);
      expect(orch.turns()).toHaveLength(2);
      expect(ba.loops()).toHaveLength(1);
      // Each task's STEP loop carries the task id as its step id.
      expect(ba.loops()[0]?.step?.stepId).toBe(ids.task1);
      expect(runnersListed).toContain(ba.name);
      expect(runnersListed).not.toContain(outside.name);
      env.expectNoAgentErrors();
    });

    await test.step("2. the BA's open question: needs a person on the list, the workflow and the agent map", async () => {
      const item = await env.caseItem();
      expect(item.needsPerson).toBe(true);
      expect(item.askedHuman).toBe("The BA needs the target environment.");
      expect(item.agents).toEqual([
        { computeTargetId: ba.id, activeTaskCount: 0, openQuestionCount: 1 },
      ]);
      const workflow = await env.workflowRead();
      expect(workflow.caseCounts?.needsPerson).toBe(1);
      const map = await env.agentMap();
      expect(map.orchestrator?.computeTargetId).toBe(orch.id);
      const agentIds = map.agents.map((agent) => agent.computeTargetId);
      expect(agentIds).toContain(ba.id);
      expect(agentIds).not.toContain(outside.id);
      expect(map.agents.find((a) => a.computeTargetId === ba.id)?.role).toBe(
        "BA"
      );
    });

    await test.step("3. the Agents tab answers the question; the BA task resumes on the BA", async () => {
      orch.onTurn(async (turn) => {
        expect(turn.request.prompt).toContain(ENV_ANSWER);
        ids.task2 = await runTask(turn, ba, {
          resumeTaskId: ids.task1,
          prompt: `Answers: env=${ENV_ANSWER}`,
        });
        return { answer: "Resumed the BA with the answer." };
      });
      ba.onTask((loop) => {
        expect(loop.parentLoopId).toBe(ba.loops()[0]?.loopId);
        expect(loop.step?.forkSession ?? false).toBe(false);
        return Promise.resolve({ reply: SCOPE_REPLY });
      });
      orch.onTurn(async (turn) => {
        expect(turn.request.prompt).toContain(SCOPE_REPLY);
        await turn.tool(OrchestratorToolName.WaitHuman, {});
        return { answer: "Scope is clear." };
      });

      await openAgentsTab(page, orgSlug, flow.workflow.id);
      await expect(
        page
          .getByRole("tab", { name: AGENTS_TAB_RE })
          .getByLabel("1 case needs a person")
      ).toBeVisible();
      const baNode = agentNode(page, ba.name);
      await expect(baNode.getByTestId("agent-map-count")).toHaveText("1");
      await selectAgentCase(page, ba);
      const thread = page.getByTestId("agent-case-thread");
      await expect(thread).toBeVisible({ timeout: 30_000 });
      await thread.getByLabel(ENV_QUESTION).fill(ENV_ANSWER);
      await thread.getByRole("button", { name: "Send answers" }).click();

      await expect
        .poll(
          async () =>
            (await env.caseDetail()).tasks.find((t) => t.id === ids.task1)
              ?.openQuestionCount,
          { timeout: STEP_TIMEOUT_MS }
        )
        .toBe(0);
      await env.waitForCase(
        (c) =>
          orch.turns().length === 4 &&
          !(c.needsPerson || c.turnRunning) &&
          c.activeTaskCount === 0
      );
      expect(ba.loops()).toHaveLength(2);
      expect(ba.loops()[1]?.step?.stepId).toBe(ids.task2);
      await page.reload();
      await expect(
        agentNode(page, ba.name).getByTestId("agent-map-count")
      ).toHaveCount(0, { timeout: 30_000 });
      env.expectNoAgentErrors();
    });

    await test.step("4. asking the BA from the Agents tab is relayed as a fork; wait_human asked needs a person", async () => {
      orch.onTurn(async (turn) => {
        expect(turn.request.prompt).toContain(`to="${ba.name}"`);
        expect(turn.request.prompt).toContain(ASK_TEXT);
        ids.task3 = await runTask(turn, ba, {
          resumeTaskId: ids.task2,
          fork: true,
          prompt: ASK_TEXT,
        });
        return { answer: "Relayed the question to the BA." };
      });
      ba.onTask((loop) => {
        expect(loop.step?.forkSession).toBe(true);
        expect(loop.parentLoopId).toBe(ba.loops()[1]?.loopId);
        return Promise.resolve({ reply: FORK_REPLY });
      });
      orch.onTurn(async (turn) => {
        expect(turn.request.prompt).toContain(FORK_REPLY);
        await turn.tool(OrchestratorToolName.WaitHuman, { asked: ASKED_HUMAN });
        return { answer: "Asked people to confirm." };
      });

      await openAgentsTab(page, orgSlug, flow.workflow.id);
      await selectAgentCase(page, ba);
      const thread = page.getByTestId("agent-case-thread");
      await thread
        .getByLabel(`Ask ${ba.name} about jira:${issue.key}`)
        .fill(ASK_TEXT);
      await thread.getByRole("button", { name: "Send", exact: true }).click();

      // needsPerson holds once the turn that asked has ended.
      const item = await env.waitForCase(
        (c) => c.askedHuman === ASKED_HUMAN && !c.turnRunning
      );
      expect(item.needsPerson).toBe(true);
      expect(item.agents[0]?.openQuestionCount).toBe(0);
      const detail = await env.caseDetail();
      const asked = detail.conversations
        .flatMap((c) => c.messages)
        .find((m) => m.text === ASK_TEXT);
      expect(asked?.toAgentId).toBe(ba.id);
      expect(detail.tasks.find((t) => t.id === ids.task3)?.fork).toBe(true);
      expect(ba.loops()[2]?.step?.stepId).toBe(ids.task3);

      // An agent with no task in the case cannot be addressed.
      const refused = await env.postCaseMessage({
        text: "Hello?",
        toAgentId: outside.id,
      });
      expect(refused.status()).toBe(409);
      env.expectNoAgentErrors();
    });

    await test.step("5. the next message clears wait_human asked", async () => {
      const turnsBefore = orch.turns().length;
      orch.onTurn(async (turn) => {
        expect(turn.request.prompt).toContain("Yes, it is final.");
        await turn.tool(OrchestratorToolName.WaitHuman, {});
        return { answer: "Noted." };
      });
      const posted = await env.postCaseMessage({ text: "Yes, it is final." });
      expect(posted.status()).toBe(200);
      const item = await env.waitForCase(
        (c) =>
          c.askedHuman === null &&
          !c.turnRunning &&
          orch.turns().length === turnsBefore + 1
      );
      expect(item.needsPerson).toBe(false);
    });

    await test.step("6. mention-only: a plain comment does not wake; the BA's question on the ticket and the reply to it do", async () => {
      const turnsBefore = orch.turns().length;
      await env.webhook(
        commentCreatedWebhook(issue, {
          id: PLAIN_COMMENT_ID,
          body: "Looks good to me.",
        })
      );
      await page.waitForTimeout(QUIET_MS);
      expect(orch.turns()).toHaveLength(turnsBefore);

      orch.onTurn(async (turn) => {
        ids.task4 = await runTask(turn, ba, {
          prompt: "Check the edge cases.",
        });
        return { answer: "Asked the BA about edge cases." };
      });
      ba.onTask(() => {
        // The BA asks on the ticket itself, under its person's account.
        jira.addComment(issue.key, {
          id: DELIM_COMMENT_ID,
          parentId: null,
          authorAccountId: FAKE_JIRA_PERSON.accountId,
          body: DELIM_QUESTION,
        });
        return Promise.resolve({
          questions: [
            {
              id: "delim",
              question: DELIM_QUESTION,
              commentId: DELIM_COMMENT_ID,
            },
          ],
        });
      });
      orch.onTurn(async (turn) => {
        expect(turn.request.prompt).toContain(
          "Questions agents asked on the item"
        );
        await turn.tool(OrchestratorToolName.WaitHuman, {});
        return { answer: "Waiting for the reply on the ticket." };
      });
      await env.postCaseMessage({ text: "Please check the edge cases." });

      const waiting = await env.waitForCase(
        (c) =>
          c.needsPerson &&
          !c.turnRunning &&
          orch.turns().length === turnsBefore + 2
      );
      expect(waiting.agents[0]?.openQuestionCount).toBe(1);
      const detail = await env.caseDetail();
      expect(
        detail.conversations
          .flatMap((c) => c.messages)
          .some((m) => m.kind === OrchestratorMessageKind.TaskAsked)
      ).toBe(true);
      // AgentFlow did not post the question again.
      expect(
        jira
          .postedComments(issue.key)
          .some((c) => c.body.includes(DELIM_QUESTION))
      ).toBe(false);

      orch.onTurn(async (turn) => {
        expect(turn.request.prompt).toContain(`task="${ids.task4}"`);
        expect(turn.request.prompt).toContain('question="delim"');
        expect(turn.request.prompt).toContain(DELIM_ANSWER);
        await runTask(turn, ba, {
          resumeTaskId: ids.task4,
          prompt: `delim=${DELIM_ANSWER}`,
        });
        return { answer: "Resumed the BA with the reply." };
      });
      ba.onTask((loop) => {
        expect(loop.step?.forkSession ?? false).toBe(false);
        return Promise.resolve({ reply: "Edge cases noted." });
      });
      orch.onTurn(async (turn) => {
        await turn.tool(OrchestratorToolName.WaitHuman, {});
        return { answer: "Done." };
      });
      // A reply to the BA's comment, without mentioning the bot.
      await env.webhook(
        commentCreatedWebhook(issue, {
          id: DELIM_REPLY_ID,
          parentId: DELIM_COMMENT_ID,
          body: DELIM_ANSWER,
        })
      );
      const done = await env.waitForCase(
        (c) =>
          !(c.turnRunning || c.needsPerson) &&
          c.activeTaskCount === 0 &&
          orch.turns().length === turnsBefore + 4
      );
      expect(done.agents[0]?.openQuestionCount).toBe(0);
      expect(ba.loops()).toHaveLength(5);
      env.expectNoAgentErrors();
    });

    await test.step("7. an Agent removed from the project gets no more tasks; an Agent outside it never does", async () => {
      await env.setProjectAgents([orch.id]);
      const baLoops = ba.loops().length;
      let listed = "";
      let toBa = "";
      let toOutside = "";
      orch.onTurn(async (turn) => {
        listed = JSON.stringify(
          await turn.tool(OrchestratorToolName.RunnersList)
        );
        toBa = JSON.stringify(
          await turn.toolResult(OrchestratorToolName.TaskRun, taskInput(ba, {}))
        );
        toOutside = JSON.stringify(
          await turn.toolResult(
            OrchestratorToolName.TaskRun,
            taskInput(outside, {})
          )
        );
        await turn.tool(OrchestratorToolName.CloseCase, {
          summary: "Scope agreed.",
        });
        return { answer: "Closed." };
      });
      await env.postCaseMessage({ text: "Run the BA once more, then close." });
      const closed = await env.waitForCase(
        (c) => c.status === OrchestratorCaseStatus.Closed
      );
      expect(closed.status).toBe(OrchestratorCaseStatus.Closed);
      expect(listed).not.toContain(ba.name);
      expect(toBa).toContain('"ok":false');
      expect(toOutside).toContain('"ok":false');
      expect(ba.loops()).toHaveLength(baLoops);
      env.expectNoAgentErrors();
    });

    await test.step("8. only the orchestrator ran turns and only the BA ran tasks", () => {
      expect(outside.operations()).toEqual([]);
      expect(orch.loops()).toEqual([]);
      expect(ba.turns()).toEqual([]);
      expect(jira.unhandled()).toEqual([]);
      return Promise.resolve();
    });
  } finally {
    await env.cleanUp();
  }
});

/** task_run on an Agent, then wait_for it; returns the task id. */
async function runTask(
  turn: TurnContext,
  agent: FakeAgent,
  input: {
    args?: string;
    prompt: string;
    resumeTaskId?: string;
    fork?: boolean;
  }
): Promise<string> {
  const started = (await turn.tool(
    OrchestratorToolName.TaskRun,
    taskInput(agent, input)
  )) as { taskId: string; error: string | null };
  expect(started.error).toBeNull();
  await turn.tool(OrchestratorToolName.WaitFor, { taskIds: [started.taskId] });
  return started.taskId;
}

function taskInput(
  agent: FakeAgent,
  input: {
    args?: string;
    prompt?: string;
    resumeTaskId?: string;
    fork?: boolean;
  }
): Record<string, unknown> {
  return {
    runner: agent.name,
    command: COMMAND,
    args: input.args ?? "",
    prompt: input.prompt ?? "Again.",
    ...(input.resumeTaskId ? { resumeTaskId: input.resumeTaskId } : {}),
    ...(input.fork ? { fork: true } : {}),
  };
}

/** Selects the agent's node, waits for its inbox, then opens its first case. */
async function selectAgentCase(page: Page, agent: FakeAgent): Promise<void> {
  const node = agentNode(page, agent.name);
  await node.click();
  await expect(node).toHaveAttribute("aria-pressed", "true");
  await expect(page).toHaveURL(new RegExp(`agent=${agent.id}`), {
    timeout: UI_TIMEOUT_MS,
  });
  await page.getByTestId("agent-case-row").first().click();
  await expect(page).toHaveURL(CASE_PARAM_RE, { timeout: UI_TIMEOUT_MS });
}

function agentNode(page: Page, name: string) {
  return page.getByRole("button", { name: new RegExp(`^${name}, `) });
}

async function openAgentsTab(page: Page, orgSlug: string, workflowId: string) {
  await page.goto(`/${orgSlug}/workflows/${workflowId}?tab=agents`);
  await expect(
    page
      .getByTestId("agent-case-list")
      .or(page.getByTestId("agent-case-row").first())
  ).toBeVisible({ timeout: 30_000 });
}

type Flow = {
  orch: FakeAgent;
  ba: FakeAgent;
  outside: FakeAgent;
  jira: FakeJira;
  issue: { key: string; summary: string };
  workflow: Workflow;
};

/** Everything one run creates, and its cleanup. */
class FlowEnv {
  private readonly api = getApiBaseUrl();
  private projectId: string | null = null;
  private connectionId: string | null = null;
  private projectConnectionId: string | null = null;
  private workflowId: string | null = null;
  private inbound: { url: string; secret: string } | null = null;
  private caseId: string | null = null;
  private readonly agents: FakeAgent[] = [];
  private jira: FakeJira | null = null;

  private readonly request: APIRequestContext;
  private readonly token: string;

  constructor(request: APIRequestContext, token: string) {
    this.request = request;
    this.token = token;
  }

  async setUp(): Promise<Flow> {
    const jira = await startFakeJira();
    this.jira = jira;
    const issue = {
      key: `${FAKE_JIRA_PROJECT_KEY}-${randomInt(100_000, 999_999)}`,
      summary: `Export the leave report as CSV ${createUniqueName("e2e")}`,
    };
    jira.addIssue(issue);

    const project = await createProject(this.request, {
      name: createUniqueName("e2e-flow-project"),
      token: this.token,
    });
    this.projectId = project.id;
    await this.addRepository(project.id);

    const orch = await this.agent("e2e-orch");
    const ba = await this.agent("e2e-ba");
    const outside = await this.agent("e2e-outside");
    await this.uploadAgentflowMd(ba.id, project.id);
    await this.uploadAgentflowMd(outside.id, project.id);
    await this.setProjectAgents([orch.id, ba.id]);

    const connection = await createIntegrationConnection(this.request, {
      input: {
        provider: IntegrationProviderKey.Jira,
        name: createUniqueName("e2e-fake-jira"),
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

    const workflow = await readApiResult<Workflow>(
      await this.request.post(`${this.api}/workflows`, {
        data: {
          name: createUniqueName("e2e-flow-workflow"),
          projectId: project.id,
          agent: {
            mode: WorkflowAgentMode.Orchestrated,
            computeTargetId: orch.id,
            instructions: "Ask the BA first.",
            orchestrator: {
              concurrency: OrchestratorConcurrency.Queue,
              debounceSeconds: 0,
              turnTimeoutMinutes: 5,
              mentionOnly: true,
            },
          },
          triggers: [
            {
              connectionKey: JIRA_KEY,
              type: "jira.issue_assigned",
              config: {},
            },
          ],
          actions: [],
        },
        headers: bearer(this.token),
      }),
      "Create the orchestrated workflow"
    );
    this.workflowId = workflow.id;
    return { orch, ba, outside, jira, issue, workflow };
  }

  async webhook(body: unknown): Promise<void> {
    if (!this.inbound) {
      throw new Error("No inbound URL");
    }
    const response = await this.request.post(this.inbound.url, {
      data: JSON.stringify(body),
      headers: jiraWebhookHeaders(this.inbound.secret),
    });
    expect(response.status(), await response.text()).toBe(200);
  }

  /** Polls the workflow's case until `ready`; fails with the last state. */
  async waitForCase(
    ready: (item: OrchestratorCaseListItem) => boolean
  ): Promise<OrchestratorCaseListItem> {
    let last: OrchestratorCaseListItem | undefined;
    await expect
      .poll(
        async () => {
          last = await this.findCase();
          this.expectNoAgentErrors();
          return last ? ready(last) : false;
        },
        { timeout: STEP_TIMEOUT_MS, message: "case state" }
      )
      .toBe(true)
      .catch(async (error: unknown) => {
        throw new Error(`${String(error)}\n${await this.describe(last)}`);
      });
    if (!last) {
      throw new Error("No case");
    }
    this.caseId = last.id;
    return last;
  }

  /** The case, its turns, tasks and messages and the fake Agents, for a failure. */
  async describe(item?: OrchestratorCaseListItem): Promise<string> {
    const lines = [`Case: ${JSON.stringify(item ?? null)}`];
    if (item) {
      this.caseId = item.id;
      const detail = await this.caseDetail().catch(() => null);
      for (const conversation of detail?.conversations ?? []) {
        for (const turn of conversation.turns) {
          lines.push(
            `turn ${turn.status} ended=${turn.ended} error=${turn.error ?? ""} summary=${turn.summary ?? ""}`
          );
        }
        for (const message of conversation.messages) {
          lines.push(
            `message ${message.kind} ${message.origin}: ${message.text.slice(0, 80).replaceAll("\n", " ")}`
          );
        }
      }
      for (const task of detail?.tasks ?? []) {
        lines.push(
          `task ${task.id} ${task.status} fork=${task.fork} questions=${task.openQuestionCount} error=${task.error ?? ""} waiting=${task.waiting ?? ""}`
        );
      }
    }
    for (const agent of this.agents) {
      lines.push(
        `agent ${agent.name}: turns=${agent.turns().length} loops=${agent.loops().length} errors=${JSON.stringify(agent.errors())}`
      );
    }
    lines.push(
      `fake Jira unhandled: ${JSON.stringify(this.jira?.unhandled())}`
    );
    return lines.join("\n");
  }

  async caseItem(): Promise<OrchestratorCaseListItem> {
    const item = await this.findCase();
    if (!item) {
      throw new Error("No case");
    }
    return item;
  }

  async caseDetail(): Promise<OrchestratorCaseDetail> {
    return readApiResult<OrchestratorCaseDetail>(
      await this.request.get(`${this.api}/orchestrator/cases/${this.caseId}`, {
        headers: bearer(this.token),
      }),
      "Read the case"
    );
  }

  async workflowRead(): Promise<Workflow> {
    return readApiResult<Workflow>(
      await this.request.get(`${this.api}/workflows/${this.workflowId}`, {
        headers: bearer(this.token),
      }),
      "Read the workflow"
    );
  }

  async agentMap(): Promise<WorkflowAgentMap> {
    return readApiResult<WorkflowAgentMap>(
      await this.request.get(
        `${this.api}/workflows/${this.workflowId}/agents`,
        {
          headers: bearer(this.token),
        }
      ),
      "Read the agent map"
    );
  }

  async postCaseMessage(input: { text: string; toAgentId?: string }) {
    const detail = await this.caseDetail();
    const conversationId = detail.conversations[0]?.id ?? "";
    return this.request.post(
      `${this.api}/orchestrator/cases/${this.caseId}/messages`,
      {
        data: {
          conversationId,
          text: input.text,
          answers: [],
          ...(input.toAgentId ? { toAgentId: input.toAgentId } : {}),
        },
        headers: bearer(this.token),
      }
    );
  }

  async setProjectAgents(runnerIds: string[]): Promise<void> {
    const response = await this.request.put(
      `${this.api}/projects/${this.projectId}/runners`,
      {
        data: { runnerIds },
        headers: bearer(this.token),
      }
    );
    expect(response.status(), await response.text()).toBe(200);
  }

  expectNoAgentErrors(): void {
    const errors = this.agents.flatMap((agent) =>
      agent.errors().map((e) => `${agent.name}: ${e}`)
    );
    expect(errors, "fake Agent errors").toEqual([]);
  }

  async cleanUp(): Promise<void> {
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

  private async findCase(): Promise<OrchestratorCaseListItem | undefined> {
    const cases = await readApiResult<OrchestratorCaseListItem[]>(
      await this.request.get(
        `${this.api}/orchestrator/cases?workflowId=${this.workflowId}`,
        {
          headers: bearer(this.token),
        }
      ),
      "List the workflow's cases"
    );
    return cases[0];
  }

  private async agent(prefix: string): Promise<FakeAgent> {
    const agent = await FakeAgent.register(
      this.token,
      createUniqueName(prefix)
    );
    this.agents.push(agent);
    await agent.connect();
    return agent;
  }

  private async uploadAgentflowMd(
    computeTargetId: string,
    projectId: string
  ): Promise<void> {
    await readApiResult(
      await this.request.put(
        `${this.api}/compute-targets/${computeTargetId}/capabilities`,
        {
          data: {
            project: projectId,
            source: RunnerCapabilitiesSource.Toolkit,
            content: AGENTFLOW_MD,
            warnings: [],
          },
          headers: bearer(this.token),
        }
      ),
      "Upload AGENTFLOW.md"
    );
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
