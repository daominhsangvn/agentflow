import { randomInt } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import {
  IntegrationDeliveryMode,
  IntegrationProviderKey,
} from "@repo/api/src/types/integration";
import {
  type OrchestratorCaseDetail,
  type OrchestratorCaseListItem,
  OrchestratorConcurrency,
  type WorkflowAgentMap,
} from "@repo/api/src/types/orchestrator";
import { OrchestratorSourceOperation } from "@repo/api/src/types/orchestrator-grants";
import { RunnerCapabilitiesSource } from "@repo/api/src/types/runner-capabilities";
import type { Workflow } from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { expect } from "../test";
import { bearer, readApiResult } from "./api-result";
import { getApiBaseUrl } from "./api-url";
import { createProject, deleteProject } from "./create-project";
import { FakeAgent } from "./fake-agent";
import {
  FAKE_JIRA_BOT,
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
import { createUniqueName } from "./utils";
import { deleteWorkflow } from "./workflows";

/**
 * The setup of orchestrator-full-flow.spec.ts: a fake Jira site, a project
 * with a repository, three fake Agents (orchestrator, BA, one outside the
 * project), the Jira connection and the orchestrated workflow; the API reads
 * the flow polls; and the cleanup.
 */

/** A turn or task waits for the engine tick (seconds) and the debounce. */
export const STEP_TIMEOUT_MS = 90_000;
export const COMMAND = "/ba-clarify";
const JIRA_KEY = "jira-e2e";
const AGENTFLOW_MD = `---\nrunner: BA\ncommands:\n  - { name: ${COMMAND}, mode: read, asks: true }\n---\n# BA\n`;

export type Flow = {
  orch: FakeAgent;
  ba: FakeAgent;
  outside: FakeAgent;
  jira: FakeJira;
  issue: { key: string; summary: string };
  workflow: Workflow;
};

/** Everything one run creates, and its cleanup. */
export class FlowEnv {
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
              connections: { source: [OrchestratorSourceOperation.Comment] },
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

  /** GET a stored file of a task of the case. */
  taskFile(taskId: string, name: string) {
    return this.request.get(
      `${this.api}/orchestrator/cases/${this.caseId}/tasks/${taskId}/file?name=${encodeURIComponent(name)}`,
      { headers: bearer(this.token) }
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

  /** The case page of the flow's case, once a case was found. */
  casePath(orgSlug: string): string | null {
    return this.caseId ? `/${orgSlug}/orchestrator/cases/${this.caseId}` : null;
  }

  /**
   * Deletes what the run created. With `keep` (E2E_KEEP_DATA=1) the project,
   * workflow, case and Agents stay for a look in the UI: only the fake Agents'
   * streams and the fake Jira site are stopped.
   */
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
