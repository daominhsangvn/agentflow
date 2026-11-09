import { randomUUID } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";
import {
  type OrchestratorCaseDetail,
  OrchestratorCaseStatus,
  type OrchestratorCaseSummary,
  OrchestratorConcurrency,
  OrchestratorConversationStatus,
  OrchestratorDecisionStatus,
  OrchestratorMessageKind,
  OrchestratorMessageOrigin,
  OrchestratorTaskStatus,
} from "@repo/api/src/types/orchestrator";
import { SESSION_STATUS } from "@repo/api/src/types/session-status";
import type { Workflow } from "@repo/api/src/types/workflow";
import { WorkflowAgentMode } from "@repo/api/src/types/workflow-agent-mode";
import { bearer, readApiResult } from "./helpers/api-result";
import { getApiBaseUrl } from "./helpers/api-url";
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

// Workflow → Cases list and the case page. The cases come from stubbed API
// reads (a case needs a runner and a chat source the e2e stack has none of);
// the project, runner, orchestrated workflow and the page are real.

/** Trigger key of the built-in webhook provider. */
const WebhookIntegrationKey = { RequestTrigger: "webhook.request" } as const;

const ADMIN_REQUIRED_MESSAGE =
  "The e2e user must be an org admin to decide on an orchestrator case";
const CASE_TITLE = "Add rate limiting to the export endpoint";
const MESSAGE_TEXT = "Please plan the rate limiting work.";
const DECISION_QUESTION = "Ship the plan to the dev runner?";
const LOOP_COMMAND = "ba-prd";
// LoopStatus.Completed; @agentflow-ai/loops-api does not resolve from the e2e root.
const LOOP_STATUS_COMPLETED = "COMPLETED";
const SESSION_NAME = "BA session";
const TASK_FILE_NAME = "prd-summary.md";
const PR_URL = "https://example.test/pr/1";
const OPERATOR_MESSAGE = "Use the staging database.";
const PENDING_QUESTION = "Which environment?";
const PENDING_QUESTION_ID = "env";
const PENDING_ANSWER = "staging";
const DRAFT_TEXT = "Scope agreed:\n- CSV export only\n- Staging first";

test("orchestrator cases: open a case from the workflow and approve its decision", {
  tag: E2ETag.Smoke,
}, async ({ apiToken: token, page, request }) => {
  const { orgRole, orgSlug } = requireOrgClaims(token);
  expect(isOrgAdminRole(orgRole), ADMIN_REQUIRED_MESSAGE).toBe(true);
  const fixture = new Fixture();
  try {
    const workflow = await setUpOrchestratedWorkflow(request, token, fixture);
    const served = await serveCases(page, fixture.projectId ?? "", workflow);

    await page.goto(`/${orgSlug}/workflows/${workflow.id}?tab=cases`);

    // The real API: an orchestrated workflow without cases.
    await expect(page.getByText("No cases yet").first()).toBeVisible({
      timeout: 30_000,
    });

    const list = page.getByTestId("orchestrator-case-list");
    await expect(list).toBeVisible({ timeout: 30_000 });
    for (const header of ["Tasks", "Turns", "Cost"]) {
      await expect(
        list.getByRole("columnheader", { name: header })
      ).toBeVisible();
    }
    await expect(list.getByText("$0.42")).toBeVisible();
    const link = list.getByRole("link", { name: CASE_TITLE });
    await expect(link).toHaveAttribute(
      "href",
      `/${orgSlug}/orchestrator/cases/${served.caseId}`
    );
    await link.click();

    await expect(page).toHaveURL(
      new RegExp(`/${orgSlug}/orchestrator/cases/${served.caseId}$`),
      { timeout: 30_000 }
    );
    const detail = page.getByTestId("orchestrator-case-detail");
    await expect(detail).toBeVisible({ timeout: 30_000 });
    await expect(detail.getByText(MESSAGE_TEXT)).toBeVisible();
    await expect(detail.getByText(DECISION_QUESTION)).toBeVisible();
    await expect(detail.getByText("Agent loops")).toBeVisible();
    await expect(
      detail.getByRole("link", { name: LOOP_COMMAND }).first()
    ).toHaveAttribute("href", `/${orgSlug}/loops/${served.loopId}`);
    await expect(
      detail.getByTestId("run-session").filter({ hasText: SESSION_NAME })
    ).toBeVisible();
    await expect(detail.getByText(TASK_FILE_NAME)).toBeVisible();

    await expect(
      detail.getByRole("link", { name: workflow.name })
    ).toHaveAttribute("href", `/${orgSlug}/workflows/${workflow.id}?tab=cases`);

    const draft = detail.getByTestId("decision-draft");
    await expect(draft).toContainText("Scope agreed:");
    await expect(draft).toContainText("CSV export only");
    await expect(draft).toContainText("Staging first");
    await expect(detail.getByText("Comment on PROJ-7")).toBeVisible();
    await expect(detail.getByText("Move PROJ-7 to Planning")).toBeVisible();
    await detail.getByRole("button", { name: "Approve" }).click();
    await expect.poll(() => served.decisions).toEqual([{ approved: true }]);

    await detail.getByLabel("Message the orchestrator").fill(OPERATOR_MESSAGE);
    await detail.getByRole("button", { name: "Send", exact: true }).click();
    await expect
      .poll(() => served.messages)
      .toEqual([
        { conversationId: served.conversationId, text: OPERATOR_MESSAGE },
      ]);

    await detail.getByLabel(PENDING_QUESTION).fill(PENDING_ANSWER);
    await detail.getByRole("button", { name: "Send answers" }).click();
    await expect
      .poll(() => served.messages)
      .toContainEqual({
        conversationId: served.conversationId,
        answers: [
          {
            taskId: served.questionTaskId,
            questionId: PENDING_QUESTION_ID,
            answer: PENDING_ANSWER,
          },
        ],
      });
  } finally {
    await fixture.cleanUp(request, token);
  }
});

test("orchestrator config: the orchestrator settings are saved on the workflow", async ({
  apiToken: token,
  request,
}) => {
  const fixture = new Fixture();
  try {
    const workflow = await setUpOrchestratedWorkflow(request, token, fixture);
    const response = await request.get(
      `${getApiBaseUrl()}/workflows/${workflow.id}`,
      { headers: bearer(token) }
    );
    const saved = await readApiResult<Workflow>(response, "Read workflow");
    expect(saved.agent.orchestrator?.concurrency).toBe(
      OrchestratorConcurrency.Queue
    );
    expect(saved.agent.instructions).toBe(RULES);
  } finally {
    await fixture.cleanUp(request, token);
  }
});

const RULES = "Ask BA first.";

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
    name: createUniqueName("e2e-cases-project"),
    token,
  });
  fixture.projectId = project.id;
  const target = await registerComputeTarget(request, {
    machineName: createUniqueName("e2e-cases-target"),
    token,
  });
  fixture.computeTargetId = target.id;
  const workflow = await createWorkflow(request, {
    input: {
      name: createUniqueName("e2e-cases-workflow"),
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

type ServedCases = {
  caseId: string;
  loopId: string;
  /** Bodies POSTed to the decision endpoint. */
  decisions: unknown[];
  conversationId: string;
  questionTaskId: string;
  /** Bodies POSTed to the case message endpoint. */
  messages: unknown[];
};

/** Stubs the workflow case list, the case read and the decision POST. */
async function serveCases(
  page: Page,
  projectId: string,
  workflow: Pick<Workflow, "id" | "name">
): Promise<ServedCases> {
  const caseId = randomUUID();
  const decisionId = randomUUID();
  const loopId = randomUUID();
  const conversationId = randomUUID();
  const questionTaskId = randomUUID();
  const now = new Date().toISOString();
  const summary: OrchestratorCaseSummary = {
    id: caseId,
    projectId,
    workflowId: workflow.id,
    title: CASE_TITLE,
    sourceKey: "PRO-12",
    status: OrchestratorCaseStatus.Open,
    conversationCount: 1,
    pendingDecisionCount: 1,
    activeTaskCount: 0,
    turnRunning: false,
    taskCount: 2,
    turnCount: 3,
    costUsd: 0.42,
    inputTokens: 1200,
    outputTokens: 300,
    activeMs: 90_000,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
  };
  const detail: OrchestratorCaseDetail = {
    ...summary,
    notes: "",
    documents: [],
    project: { id: projectId, name: "Project" },
    workflow: { id: workflow.id, name: workflow.name },
    conversations: [
      {
        id: conversationId,
        channelKey: "jira:PRO-12",
        status: OrchestratorConversationStatus.Waiting,
        createdAt: now,
        messages: [
          {
            id: randomUUID(),
            conversationId,
            origin: OrchestratorMessageOrigin.External,
            kind: OrchestratorMessageKind.Message,
            actor: "Ann",
            text: MESSAGE_TEXT,
            turnId: null,
            createdAt: now,
          },
        ],
        turns: [],
      },
    ],
    tasks: [
      {
        id: randomUUID(),
        conversationId,
        turnId: null,
        command: LOOP_COMMAND,
        args: "",
        prompt: "Write the PRD",
        mode: "execute",
        runnerName: null,
        computeTargetId: null,
        status: OrchestratorTaskStatus.Succeeded,
        fork: false,
        resumeTaskId: null,
        loopId,
        reply: null,
        files: [
          { name: TASK_FILE_NAME, size: 2048, stored: true, skipped: null },
        ],
        filesOmitted: 0,
        openQuestionCount: 0,
        questions: [],
        error: null,
        waiting: null,
        createdAt: now,
        finishedAt: now,
      },
      {
        id: questionTaskId,
        conversationId,
        turnId: null,
        command: "ba-clarify",
        args: "",
        prompt: "Clarify the scope",
        mode: "plan",
        runnerName: null,
        computeTargetId: null,
        status: OrchestratorTaskStatus.Succeeded,
        fork: false,
        resumeTaskId: null,
        loopId: null,
        reply: null,
        files: [],
        filesOmitted: 0,
        // The server's count of unanswered questions gates the answer form.
        openQuestionCount: 1,
        questions: [{ id: PENDING_QUESTION_ID, question: PENDING_QUESTION }],
        error: null,
        waiting: null,
        createdAt: now,
        finishedAt: now,
      },
    ],
    waits: [],
    decisions: [
      {
        id: decisionId,
        conversationId,
        question: DECISION_QUESTION,
        status: OrchestratorDecisionStatus.Pending,
        via: null,
        decidedBy: null,
        comment: null,
        decidedAt: null,
        draft: {
          itemKey: "PROJ-7",
          comment: { text: DRAFT_TEXT, replyTo: null, attachments: [] },
          transitionName: "Planning",
        },
        draftResult: null,
        createdAt: now,
      },
    ],
  };
  const decisions: unknown[] = [];
  const messages: unknown[] = [];

  await page.route(`**/workflows/${workflow.id}/cases`, (route) =>
    route.fulfill({ json: { success: true, data: [summary] } })
  );
  await page.route(`**/orchestrator/cases/${caseId}`, (route) =>
    route.fulfill({ json: { success: true, data: detail } })
  );
  await page.route(`**/orchestrator/cases/${caseId}/loops`, (route) =>
    route.fulfill({
      json: {
        success: true,
        data: {
          loops: [
            {
              loopId,
              command: LOOP_COMMAND,
              status: LOOP_STATUS_COMPLETED,
              adopted: false,
              stepId: null,
              prUrl: PR_URL,
              startedAt: now,
              completedAt: now,
            },
          ],
          sessions: [
            {
              id: randomUUID(),
              slug: "ba-session",
              name: SESSION_NAME,
              loopId,
              command: LOOP_COMMAND,
              stepId: null,
              status: SESSION_STATUS.INACTIVE,
              harness: "claude",
              model: null,
              startedAt: now,
              lastActivityAt: now,
              endedAt: now,
            },
          ],
          pullRequests: [
            { url: PR_URL, number: 1, repository: null, branch: null },
          ],
        },
      },
    })
  );
  await page.route(`**/orchestrator/decisions/${decisionId}`, (route) => {
    decisions.push(route.request().postDataJSON());
    return route.fulfill({ json: { success: true, data: {} } });
  });
  await page.route(`**/orchestrator/cases/${caseId}/messages`, (route) => {
    messages.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        success: true,
        data: { messageId: randomUUID(), conversationId },
      },
    });
  });
  return {
    caseId,
    conversationId,
    decisions,
    loopId,
    messages,
    questionTaskId,
  };
}
