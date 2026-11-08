import { randomUUID } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import { AgentKind } from "@repo/api/src/types/agent-fleet";
import {
  type OrchestratorCaseAgent,
  type OrchestratorCaseDetail,
  type OrchestratorCaseListItem,
  OrchestratorCaseStatus,
  OrchestratorCaseWaitingFor,
  OrchestratorConcurrency,
  OrchestratorConversationStatus,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorTaskStatus,
  type WorkflowAgentMap,
} from "@repo/api/src/types/orchestrator";
import type { Workflow } from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { isOrgAdminRole, requireOrgClaims } from "./helpers/better-auth";
import {
  deleteComputeTarget,
  registerComputeTarget,
} from "./helpers/compute-targets";
import { createProject, deleteProject } from "./helpers/create-project";
import { E2ETag } from "./helpers/tags";
import { createUniqueName } from "./helpers/utils";
import { createWorkflow, deleteWorkflow } from "./helpers/workflows";
import { expect, test } from "./test";

// Workflow -> Agents tab. The agent map and the cases come from stubbed API
// reads (an agent and a case need a runner and a chat source the e2e stack
// has none of); the project, runner, orchestrated workflow and the page are real.

/** Trigger key of the built-in webhook provider. */
const WebhookIntegrationKey = { RequestTrigger: "webhook.request" } as const;

const ADMIN_REQUIRED_MESSAGE =
  "The e2e user must be an org admin to use the Agents tab";
const RULES = "Ask BA first.";
const BA_NAME = "ba-agent";
const QC_NAME = "qc-agent";
const ORCHESTRATOR_NAME = "orchestrator-agent";
const SOURCE_KEY = "PRO-21";
const NEEDS_TITLE = "Clarify the export scope";
const ACTIVE_TITLE = "Add rate limiting";
const BA_QUESTION = "Which environment?";
const BA_QUESTION_ID = "env";
const BA_ANSWER = "staging";
const ASK_TEXT = "Is the PRD final?";
const QC_ERROR = "Loop failed: exit code 1";
const CASE_PARAM_PATTERN = /case=/;

test("orchestrator agents tab: select an agent, answer its question and ask it", {
  tag: E2ETag.Smoke,
}, async ({ apiToken: token, page, request }) => {
  const { orgRole, orgSlug } = requireOrgClaims(token);
  expect(isOrgAdminRole(orgRole), ADMIN_REQUIRED_MESSAGE).toBe(true);
  const fixture = new Fixture();
  try {
    const workflow = await setUpOrchestratedWorkflow(request, token, fixture);
    const served = await serveAgents(page, fixture.projectId ?? "", workflow);

    await page.goto(`/${orgSlug}/workflows/${workflow.id}?tab=agents`);

    const orchestratorNode = page.getByRole("button", {
      name: new RegExp(`^${ORCHESTRATOR_NAME}, orchestrator`),
    });
    await expect(orchestratorNode).toBeVisible({ timeout: 30_000 });
    await expect(orchestratorNode.getByTestId("agent-map-count")).toHaveText(
      "1"
    );
    const baNode = page.getByRole("button", {
      name: new RegExp(`^${BA_NAME}, automatic agent`),
    });
    await expect(baNode.getByTestId("agent-map-needs-person")).toBeVisible();
    await expect(baNode.getByTestId("agent-map-count")).toHaveCount(0);
    const qcNode = page.getByRole("button", {
      name: new RegExp(`^${QC_NAME}`),
    });
    await expect(qcNode.getByTestId("agent-map-task-count")).toHaveText("1");
    await expect(qcNode.getByTestId("agent-map-error")).toHaveAttribute(
      "title",
      QC_ERROR
    );
    await expect(
      page.getByRole("button", {
        name: new RegExp(`^${QC_NAME}.*not declared`),
      })
    ).toBeVisible();
    // Every edge is drawn (an edge class Tailwind never generated once
    // rendered as stroke: none), and the agent at work has the moving dashed
    // border, drawn in a generated colour.
    const strokes = await page
      .getByTestId("agent-map-edge")
      .evaluateAll((paths) =>
        paths.map((path) => getComputedStyle(path).stroke)
      );
    expect(strokes).toHaveLength(2);
    expect(strokes).not.toContain("none");
    const working = page.getByTestId("agent-map-working");
    await expect(working).toHaveCount(1);
    await expect(
      page.getByRole("button", {
        name: new RegExp(`^${QC_NAME}.*running a task`),
      })
    ).toBeVisible();
    const borderStroke = await working
      .locator("rect")
      .evaluate((rect) => getComputedStyle(rect).stroke);
    expect(borderStroke).not.toBe("none");

    await baNode.click();
    await expect(baNode).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(new RegExp(`agent=${served.baTargetId}`), {
      timeout: 30_000,
    });

    // The BA inbox holds only the case it has a task in.
    const rows = page.getByTestId("agent-case-row");
    await expect(rows).toHaveCount(1);
    await rows.first().click();
    await expect(page).toHaveURL(new RegExp(`case=${served.caseId}`));

    const thread = page.getByTestId("agent-case-thread");
    await expect(thread).toBeVisible({ timeout: 30_000 });
    await expect(thread.getByTestId("agent-ask-locked")).toBeVisible();
    await expect(
      thread.getByLabel(`Ask ${BA_NAME} about ${SOURCE_KEY}`)
    ).toHaveCount(0);
    await thread.getByLabel(BA_QUESTION).fill(BA_ANSWER);
    await thread.getByRole("button", { name: "Send answers" }).click();
    await expect
      .poll(() => served.messages)
      .toContainEqual({
        conversationId: served.conversationId,
        answers: [
          {
            taskId: served.questionTaskId,
            questionId: BA_QUESTION_ID,
            answer: BA_ANSWER,
          },
        ],
      });

    await thread
      .getByLabel(`Ask ${BA_NAME} about ${SOURCE_KEY}`)
      .fill(ASK_TEXT);
    await thread.getByRole("button", { name: "Send", exact: true }).click();
    await expect
      .poll(() => served.messages)
      .toContainEqual({
        conversationId: served.conversationId,
        text: ASK_TEXT,
        toAgentId: served.baTargetId,
      });
    await expect(page).toHaveURL(new RegExp(`agent=${served.baTargetId}`));
    await expect(page).toHaveURL(new RegExp(`case=${served.caseId}`));

    // Picking another agent clears the open case; its inbox rows show the
    // agent's own task state.
    await qcNode.click();
    await expect(page).toHaveURL(new RegExp(`agent=${served.qcTargetId}`));
    await expect(page).not.toHaveURL(CASE_PARAM_PATTERN);
    const qcRows = page.getByTestId("agent-case-row");
    await expect(qcRows).toHaveCount(2);
    await expect(
      qcRows.filter({ hasText: "PRO-22" }).getByTestId("agent-case-running")
    ).toBeVisible();
    await expect(
      qcRows.filter({ hasText: "PRO-23" }).getByTestId("agent-case-error")
    ).toBeVisible();
  } finally {
    await fixture.cleanUp(request, token);
  }
});

/** Ids created for one test, removed in reverse dependency order. */
class Fixture {
  projectId: string | null = null;
  computeTargetId: string | null = null;
  workflowId: string | null = null;

  async cleanUp(request: APIRequestContext, token: string): Promise<void> {
    await deleteWorkflow(request, this.workflowId, token);
    await deleteComputeTarget(request, this.computeTargetId, token);
    if (this.projectId) {
      await deleteProject(request, this.projectId, token);
    }
  }
}

/** Creates a project, a runner and an orchestrated workflow through the real API. */
async function setUpOrchestratedWorkflow(
  request: APIRequestContext,
  token: string,
  fixture: Fixture
): Promise<Workflow> {
  const project = await createProject(request, {
    name: createUniqueName("e2e-agents-project"),
    token,
  });
  fixture.projectId = project.id;
  const target = await registerComputeTarget(request, {
    machineName: createUniqueName("e2e-agents-target"),
    token,
  });
  fixture.computeTargetId = target.id;
  const workflow = await createWorkflow(request, {
    input: {
      name: createUniqueName("e2e-agents-workflow"),
      projectId: project.id,
      agent: {
        mode: WorkflowAgentMode.Orchestrated,
        computeTargetId: target.id,
        instructions: RULES,
        orchestrator: {
          concurrency: OrchestratorConcurrency.Queue,
          debounceSeconds: 5,
          turnTimeoutMinutes: 3,
        },
      },
      triggers: [
        {
          connectionKey: null,
          type: WebhookIntegrationKey.RequestTrigger,
          config: {},
        },
      ],
      actions: [],
    },
    token,
  });
  fixture.workflowId = workflow.id;
  return workflow;
}

type ServedAgents = {
  caseId: string;
  conversationId: string;
  questionTaskId: string;
  baTargetId: string;
  qcTargetId: string;
  /** Bodies POSTed to the case message endpoint. */
  messages: unknown[];
};

/** Stubs the agent map, the case list, the case read and the message POST. */
async function serveAgents(
  page: Page,
  projectId: string,
  workflow: Pick<Workflow, "id" | "name">
): Promise<ServedAgents> {
  const caseId = randomUUID();
  const conversationId = randomUUID();
  const questionTaskId = randomUUID();
  const orchestratorTargetId = randomUUID();
  const baTargetId = randomUUID();
  const qcTargetId = randomUUID();
  const now = new Date().toISOString();
  const map: WorkflowAgentMap = {
    orchestrator: {
      computeTargetId: orchestratorTargetId,
      name: ORCHESTRATOR_NAME,
      isOnline: true,
    },
    agents: [
      {
        computeTargetId: baTargetId,
        name: BA_NAME,
        isOnline: true,
        role: "BA",
        kind: AgentKind.Automatic,
        declared: true,
      },
      {
        computeTargetId: qcTargetId,
        name: QC_NAME,
        isOnline: false,
        role: "QC",
        kind: AgentKind.Automatic,
        declared: false,
      },
    ],
  };
  const baseItem = {
    projectId,
    workflowId: workflow.id,
    status: OrchestratorCaseStatus.Open,
    conversationCount: 1,
    pendingDecisionCount: 0,
    taskCount: 1,
    turnCount: 1,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    activeMs: 0,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    project: { id: projectId, name: "Project" },
    workflow: { id: workflow.id, name: workflow.name },
    runningAgents: [],
  };
  const needsAgents: OrchestratorCaseAgent[] = [
    {
      computeTargetId: baTargetId,
      activeTaskCount: 0,
      runningTaskCount: 0,
      queuedTaskCount: 0,
      openQuestionCount: 1,
      latestTaskStatus: OrchestratorTaskStatus.Succeeded,
      latestTaskError: null,
      latestTaskWaiting: null,
    },
  ];
  const needsItem: OrchestratorCaseListItem = {
    ...baseItem,
    id: caseId,
    title: NEEDS_TITLE,
    sourceKey: SOURCE_KEY,
    activeTaskCount: 0,
    turnRunning: false,
    waitingFor: OrchestratorCaseWaitingFor.Human,
    needsPerson: true,
    askedHuman: null,
    agents: needsAgents,
  };
  const activeItem: OrchestratorCaseListItem = {
    ...baseItem,
    id: randomUUID(),
    title: ACTIVE_TITLE,
    sourceKey: "PRO-22",
    activeTaskCount: 1,
    turnRunning: true,
    waitingFor: OrchestratorCaseWaitingFor.Turn,
    needsPerson: false,
    askedHuman: null,
    // QC runs a task: its edge is the active (primary, flowing) one.
    agents: [
      {
        computeTargetId: qcTargetId,
        activeTaskCount: 1,
        runningTaskCount: 1,
        queuedTaskCount: 0,
        openQuestionCount: 0,
        latestTaskStatus: OrchestratorTaskStatus.Running,
        latestTaskError: null,
        latestTaskWaiting: null,
      },
    ],
  };
  const failedItem: OrchestratorCaseListItem = {
    ...baseItem,
    id: randomUUID(),
    title: "Fix the export",
    sourceKey: "PRO-23",
    activeTaskCount: 0,
    turnRunning: false,
    waitingFor: OrchestratorCaseWaitingFor.NextMessage,
    needsPerson: false,
    askedHuman: null,
    agents: [
      {
        computeTargetId: qcTargetId,
        activeTaskCount: 0,
        runningTaskCount: 0,
        queuedTaskCount: 0,
        openQuestionCount: 0,
        latestTaskStatus: OrchestratorTaskStatus.Failed,
        latestTaskError: QC_ERROR,
        latestTaskWaiting: null,
      },
    ],
  };
  let answered = false;
  const detail: OrchestratorCaseDetail = {
    ...needsItem,
    notes: "",
    documents: [],
    conversations: [
      {
        id: conversationId,
        channelKey: `jira:${SOURCE_KEY}`,
        status: OrchestratorConversationStatus.Waiting,
        createdAt: now,
        messages: [
          {
            id: randomUUID(),
            conversationId,
            origin: OrchestratorMessageOrigin.External,
            kind: OrchestratorMessageKind.Message,
            actor: "Ann",
            text: "Please clarify the export scope.",
            turnId: null,
            createdAt: now,
          },
        ],
        turns: [],
      },
    ],
    tasks: [
      {
        id: questionTaskId,
        conversationId,
        turnId: null,
        command: "ba-clarify",
        args: "",
        prompt: "Clarify the scope",
        mode: "plan",
        runnerName: BA_NAME,
        computeTargetId: baTargetId,
        status: OrchestratorTaskStatus.Succeeded,
        fork: false,
        resumeTaskId: null,
        loopId: null,
        reply: null,
        files: [],
        filesOmitted: 0,
        openQuestionCount: 1,
        questions: [{ id: BA_QUESTION_ID, question: BA_QUESTION }],
        error: null,
        waiting: null,
        createdAt: now,
        finishedAt: now,
      },
    ],
    waits: [],
    decisions: [],
  };
  const messages: unknown[] = [];

  await page.route(`**/workflows/${workflow.id}/agents`, (route) =>
    route.fulfill({ json: { success: true, data: map } })
  );
  await page.route("**/orchestrator/cases?workflowId=*", (route) =>
    route.fulfill({
      json: { success: true, data: [needsItem, activeItem, failedItem] },
    })
  );
  await page.route(`**/orchestrator/cases/${caseId}`, (route) => {
    const served = answered
      ? {
          ...detail,
          tasks: detail.tasks.map((task) => ({
            ...task,
            openQuestionCount: 0,
          })),
        }
      : detail;
    return route.fulfill({ json: { success: true, data: served } });
  });
  await page.route(`**/orchestrator/cases/${caseId}/messages`, (route) => {
    const body = route.request().postDataJSON();
    messages.push(body);
    if (body && typeof body === "object" && "answers" in body) {
      answered = true;
    }
    return route.fulfill({
      json: {
        success: true,
        data: { messageId: randomUUID(), conversationId },
      },
    });
  });
  return {
    baTargetId,
    caseId,
    conversationId,
    messages,
    qcTargetId,
    questionTaskId,
  };
}
