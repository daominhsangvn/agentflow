/**
 * The workflow builder assistant against the real platform agent (a real
 * Claude Code run, a real model). Opt-in: it costs model tokens and needs
 * `PLATFORM_AGENT_SETTINGS_FILE` configured on the api, so it only runs with
 * `E2E_WORKFLOW_BUILDER_REAL=1` (and `E2E_INCLUDE_EXTERNAL=1` for the tag).
 *
 * It checks what the mocked spec cannot: that the YAML the agent proposes
 * passes the editor's validation, uses only names the organization has, keeps
 * what the user typed by hand, and is accepted by the api when saved.
 */

import type { APIRequestContext, Page } from "@playwright/test";
import {
  IntegrationDeliveryMode,
  IntegrationProviderKey,
} from "@repo/api/src/types/integration";
import { isOrgAdminRole, requireOrgClaims } from "./helpers/better-auth";
import {
  deleteComputeTarget,
  registerComputeTarget,
} from "./helpers/compute-targets";
import { createProject, deleteProject } from "./helpers/create-project";
import { startFakeAzureDevOps } from "./helpers/fake-azure-devops";
import { FAKE_JIRA_BOT, startFakeJira } from "./helpers/fake-jira";
import {
  createIntegrationConnection,
  createProjectConnection,
  deleteIntegrationConnection,
} from "./helpers/integrations";
import { E2ETag } from "./helpers/tags";
import { createUniqueName } from "./helpers/utils";
import { deleteWorkflow } from "./helpers/workflows";
import { expect, test } from "./test";

const ADMIN_REQUIRED_MESSAGE =
  "The e2e user must be an org admin to create workflows";
const REAL_RUN_ENABLED = process.env.E2E_WORKFLOW_BUILDER_REAL === "1";
const TEST_TIMEOUT_MS = 900_000;
const UI_TIMEOUT_MS = 30_000;
/** One user turn may take several agent runs (a proposal, then fixes). */
const TURN_TIMEOUT_MS = 420_000;
const BUILD_WITH_AI_RE = /Build with AI/;
const SEND_RE = /^Send$/;
const APPLY_RE = /Apply to editor/;
const VALID_RE = /Valid/;
const CREATE_RE = /Create workflow/;
const WORKFLOW_PAGE_RE = /\/workflows\/([0-9a-f-]{36})(?:[/?#]|$)/;
const GHOST_RUNNER = "ghost-runner-does-not-exist";
const FAILURE_HOOK_URL = "https://example.com/e2e-builder-hook";
const NBSP = String.fromCodePoint(160);
const NOTIFY_EMAIL = "builder-e2e@example.com";
const SAVE_RE = /Save workflow/;
const NEW_CHAT_RE = /New chat/;
const GUIDE_ME_RE = /Guide me/;
const DONE_EVENT_RE = /(execute|workflow)\.completed/;
/** At least a first and a second numbered question. */
const QUESTION_LIST_RE = /(^|\n)\s*1[.)][\s\S]*\n\s*2[.)]/;
const JIRA_PROJECT_KEY = "SHOP";
const JIRA_CONNECTION_KEY = "jira-shop";
const ADO_PROJECT = "Web Shop";
const ADO_CONNECTION_KEY = "ado-shop";
const ORCHESTRATOR_RULE = "Ask the BA agent before closing a case";

type Fixture = {
  projectId: string | null;
  computeTargetId: string | null;
  workflowId: string | null;
  connectionIds: string[];
};

function emptyFixture(): Fixture {
  return {
    projectId: null,
    computeTargetId: null,
    workflowId: null,
    connectionIds: [],
  };
}

// Defined only on request: every run spends model tokens.
const describeReal = REAL_RUN_ENABLED ? test.describe : () => undefined;

describeReal(
  "workflow builder assistant, real model",
  {
    tag: E2ETag.External,
  },
  () => {
    test("builds a valid workflow, keeps a hand edit on the next turn, and the api accepts the result", async ({
      apiToken: token,
      page,
      request,
    }) => {
      test.setTimeout(TEST_TIMEOUT_MS);
      const { orgRole, orgSlug } = requireOrgClaims(token);
      expect(isOrgAdminRole(orgRole), ADMIN_REQUIRED_MESSAGE).toBe(true);

      const fixture = emptyFixture();
      const projectName = createUniqueName("e2e-builder-project");
      const runnerName = createUniqueName("e2e-builder-runner");
      const workflowName = createUniqueName("e2e-builder-real");
      const handEdit = createUniqueName("hand-edited");

      try {
        const project = await createProject(request, {
          name: projectName,
          token,
        });
        fixture.projectId = project.id;
        const runner = await registerComputeTarget(request, {
          machineName: runnerName,
          token,
        });
        fixture.computeTargetId = runner.id;

        await openAssistant(page, orgSlug);

        // Turn 1: a workflow from a plain description.
        await sendTurn(
          page,
          `Create a workflow named "${workflowName}" in the project "${projectName}". ` +
            "It is triggered by the workflow's own HTTP endpoint. " +
            `The agent team runs on the runner "${runnerName}" and plans and then executes. ` +
            `When the run fails, call ${FAILURE_HOOK_URL} with a plain HTTPS call. ` +
            "Do not add a description."
        );
        await applyLatestValidProposal(page);
        const first = await editorText(page);
        expect(first).toContain(workflowName);
        expect(first).toContain(projectName);
        expect(first).toContain(runnerName);
        expect(first).toContain("webhook.post");
        expect(first).toContain(FAILURE_HOOK_URL);
        expect(first).toContain("workflow.failed");

        // The user edits by hand, then asks for one more thing.
        const editor = page.getByTestId("workflow-yaml-content");
        await editor.click();
        await page.keyboard.press("ControlOrMeta+Home");
        await page.keyboard.press("End");
        await page.keyboard.insertText(`\ndescription: ${handEdit}`);
        await expect(editor).toContainText(handEdit);

        await sendTurn(
          page,
          `Also email ${NOTIFY_EMAIL} when the run needs input from a person. Change nothing else.`
        );
        await applyLatestValidProposal(page);
        const second = await editorText(page);
        expect(second, "the hand edit survives the next proposal").toContain(
          handEdit
        );
        expect(second).toContain("agentflow.email");
        expect(second).toContain(NOTIFY_EMAIL);
        expect(second).toContain("input.needed");
        expect(second, "the first turn's action is kept").toContain(
          FAILURE_HOOK_URL
        );
        expect(second).toContain(runnerName);

        // The api validates again on save: the proposal must pass it too.
        await page.getByRole("button", { name: CREATE_RE }).click();
        await page.waitForURL(WORKFLOW_PAGE_RE, { timeout: UI_TIMEOUT_MS });
        fixture.workflowId = WORKFLOW_PAGE_RE.exec(page.url())?.[1] ?? null;
        expect(fixture.workflowId).not.toBeNull();

        // Editing the saved workflow: its own chat, starting from the stored YAML.
        await expect(page.getByTestId("workflow-yaml-content")).toContainText(
          workflowName,
          { timeout: UI_TIMEOUT_MS }
        );
        await openAssistantPanel(page);
        await expect(
          page.getByTestId("workflow-builder-proposal"),
          "a saved workflow starts with its own empty chat"
        ).toHaveCount(0);
        await sendTurn(
          page,
          "Turn this workflow off for now and stop calling the URL when a run fails. Keep everything else."
        );
        await applyLatestValidProposal(page);
        const edited = await editorText(page);
        expect(edited).toContain("enabled: false");
        expect(edited).not.toContain(FAILURE_HOOK_URL);
        expect(edited, "the email action is kept").toContain(NOTIFY_EMAIL);
        expect(edited, "the hand edit is still there").toContain(handEdit);
        expect(edited).toContain(workflowName);
        expect(edited).toContain(runnerName);
        await page.getByRole("button", { name: SAVE_RE }).click();
        await expect(page.getByText("Workflow saved")).toBeVisible({
          timeout: UI_TIMEOUT_MS,
        });
      } finally {
        await cleanUp(request, fixture, token);
      }
    });

    test("builds workflows on Jira and Azure DevOps triggers that the api accepts", async ({
      apiToken: token,
      page,
      request,
    }) => {
      test.setTimeout(TEST_TIMEOUT_MS);
      const { orgRole, orgSlug } = requireOrgClaims(token);
      expect(isOrgAdminRole(orgRole), ADMIN_REQUIRED_MESSAGE).toBe(true);

      const fixture = emptyFixture();
      const projectName = createUniqueName("e2e-builder-project");
      const runnerName = createUniqueName("e2e-builder-runner");
      const jiraName = createUniqueName("e2e-builder-jira");
      const adoName = createUniqueName("e2e-builder-ado");
      const jira = await startFakeJira();
      const ado = await startFakeAzureDevOps([ADO_PROJECT]);

      try {
        const project = await createProject(request, {
          name: projectName,
          token,
        });
        fixture.projectId = project.id;
        const runner = await registerComputeTarget(request, {
          machineName: runnerName,
          token,
        });
        fixture.computeTargetId = runner.id;

        const jiraConnection = await createIntegrationConnection(request, {
          input: {
            provider: IntegrationProviderKey.Jira,
            name: jiraName,
            deliveryMode: IntegrationDeliveryMode.Webhook,
            config: {
              deployment: "cloud",
              siteUrl: jira.url,
              email: FAKE_JIRA_BOT.emailAddress,
            },
            secrets: { apiToken: "fake-token" },
          },
          token,
        });
        fixture.connectionIds.push(jiraConnection.id);
        await createProjectConnection(request, {
          projectId: project.id,
          input: {
            connectionId: jiraConnection.id,
            key: JIRA_CONNECTION_KEY,
            name: jiraName,
            settings: { projectKeys: [JIRA_PROJECT_KEY] },
          },
          token,
        });
        const adoConnection = await createIntegrationConnection(request, {
          input: {
            provider: IntegrationProviderKey.AzureDevOps,
            name: adoName,
            deliveryMode: IntegrationDeliveryMode.Webhook,
            config: { organizationUrl: ado.url },
            secrets: { pat: "fake-pat" },
          },
          token,
        });
        fixture.connectionIds.push(adoConnection.id);
        await createProjectConnection(request, {
          projectId: project.id,
          input: {
            connectionId: adoConnection.id,
            key: ADO_CONNECTION_KEY,
            name: adoName,
            settings: { projects: [ADO_PROJECT] },
          },
          token,
        });

        // Jira: assigned to the bot, a transition before the team, a comment after.
        const jiraWorkflow = createUniqueName("e2e-builder-jira-wf");
        await openAssistant(page, orgSlug);
        await sendTurn(
          page,
          `Create a workflow named "${jiraWorkflow}" in the project "${projectName}". ` +
            `It starts when a Jira issue of the Jira project ${JIRA_PROJECT_KEY} is assigned to the bot, through the project's Jira connection. ` +
            `The agent team runs on the runner "${runnerName}" and plans and then executes. ` +
            'Before the agent team starts, move the issue to "In Progress" with a typed Jira action. ' +
            "When the implementation is done, an agent comments a summary of the work on the issue."
        );
        await applyLatestValidProposal(page);
        const jiraYaml = await editorText(page);
        expect(jiraYaml).toContain(jiraWorkflow);
        expect(jiraYaml).toContain(`connection: ${JIRA_CONNECTION_KEY}`);
        expect(jiraYaml).toContain("jira.issue_assigned");
        expect(jiraYaml).toContain(JIRA_PROJECT_KEY);
        expect(jiraYaml).toContain("workflow.triggered");
        expect(jiraYaml).toContain("jira.transition_issue");
        expect(jiraYaml).toContain("In Progress");
        expect(jiraYaml).toContain("execute.completed");
        expect(jiraYaml, "the instruction may comment").toContain("comment");
        expect(jiraYaml).toContain(runnerName);
        await createAndDelete(page, request, token);

        // Azure DevOps: a work item assigned to the bot, plan only, a comment on the plan.
        const adoWorkflow = createUniqueName("e2e-builder-ado-wf");
        await openAssistant(page, orgSlug);
        await startNewChat(page);
        await sendTurn(
          page,
          `Create a workflow named "${adoWorkflow}" in the project "${projectName}". ` +
            `It starts when an Azure DevOps work item of the Azure DevOps project "${ADO_PROJECT}" is assigned to the bot, through the project's Azure DevOps connection. ` +
            `The agent team runs on the runner "${runnerName}" and only plans. ` +
            "When the plan is ready, an agent comments the plan summary on the work item."
        );
        await applyLatestValidProposal(page);
        const adoYaml = await editorText(page);
        expect(adoYaml).toContain(adoWorkflow);
        expect(adoYaml).toContain(`connection: ${ADO_CONNECTION_KEY}`);
        expect(adoYaml).toContain("azure_devops.");
        expect(adoYaml).toContain(ADO_PROJECT);
        expect(adoYaml).toContain("mode: plan");
        expect(adoYaml).not.toContain("plan_and_execute");
        expect(adoYaml).toContain("plan.completed");
        expect(adoYaml).not.toContain(`connection: ${JIRA_CONNECTION_KEY}`);
        expect(adoYaml).toContain(runnerName);
        await createAndDelete(page, request, token);
      } finally {
        await jira.close();
        await ado.close();
        await cleanUp(request, fixture, token);
      }
    });

    test("builds an orchestrated workflow that the api accepts", async ({
      apiToken: token,
      page,
      request,
    }) => {
      test.setTimeout(TEST_TIMEOUT_MS);
      const { orgRole, orgSlug } = requireOrgClaims(token);
      expect(isOrgAdminRole(orgRole), ADMIN_REQUIRED_MESSAGE).toBe(true);

      const fixture = emptyFixture();
      const projectName = createUniqueName("e2e-builder-project");
      const runnerName = createUniqueName("e2e-builder-orch");
      const workflowName = createUniqueName("e2e-builder-orchestrated");

      try {
        const project = await createProject(request, {
          name: projectName,
          token,
        });
        fixture.projectId = project.id;
        const runner = await registerComputeTarget(request, {
          machineName: runnerName,
          token,
        });
        fixture.computeTargetId = runner.id;

        await openAssistant(page, orgSlug);
        await startNewChat(page);
        await sendTurn(
          page,
          `Create an orchestrated workflow named "${workflowName}" in the project "${projectName}", ` +
            "triggered by the workflow's own HTTP endpoint. " +
            `The orchestrator runs on the runner "${runnerName}". ` +
            "New messages for a case queue instead of superseding the running turn, the orchestrator waits 30 seconds of quiet before a turn, and a turn may take 15 minutes. " +
            `Its rules are exactly: "${ORCHESTRATOR_RULE}".`
        );
        await applyLatestValidProposal(page);
        const yaml = await editorText(page);
        expect(yaml).toContain(workflowName);
        expect(yaml).toContain("mode: orchestrated");
        expect(yaml).toContain("concurrency: queue");
        expect(yaml).toContain("debounceSeconds: 30");
        expect(yaml).toContain("turnTimeoutMinutes: 15");
        expect(yaml).toContain(ORCHESTRATOR_RULE);
        expect(yaml).toContain(runnerName);
        await createAndDelete(page, request, token);
      } finally {
        await cleanUp(request, fixture, token);
      }
    });

    test("guides a new workflow with one bundle of questions grounded in the organization, then builds it", async ({
      apiToken: token,
      page,
      request,
    }, testInfo) => {
      test.setTimeout(TEST_TIMEOUT_MS);
      const { orgRole, orgSlug } = requireOrgClaims(token);
      expect(isOrgAdminRole(orgRole), ADMIN_REQUIRED_MESSAGE).toBe(true);

      const fixture = emptyFixture();
      const projectName = createUniqueName("e2e-builder-project");
      const runnerName = createUniqueName("e2e-builder-runner");
      const jiraName = createUniqueName("e2e-builder-jira");
      const jira = await startFakeJira();

      try {
        const project = await createProject(request, {
          name: projectName,
          token,
        });
        fixture.projectId = project.id;
        const runner = await registerComputeTarget(request, {
          machineName: runnerName,
          token,
        });
        fixture.computeTargetId = runner.id;
        const connection = await createIntegrationConnection(request, {
          input: {
            provider: IntegrationProviderKey.Jira,
            name: jiraName,
            deliveryMode: IntegrationDeliveryMode.Webhook,
            config: {
              deployment: "cloud",
              siteUrl: jira.url,
              email: FAKE_JIRA_BOT.emailAddress,
            },
            secrets: { apiToken: "fake-token" },
          },
          token,
        });
        fixture.connectionIds.push(connection.id);
        await createProjectConnection(request, {
          projectId: project.id,
          input: {
            connectionId: connection.id,
            key: JIRA_CONNECTION_KEY,
            name: jiraName,
            settings: { projectKeys: [JIRA_PROJECT_KEY] },
          },
          token,
        });

        await openAssistant(page, orgSlug);
        await startNewChat(page);
        const panel = page.getByRole("complementary", {
          name: BUILD_WITH_AI_RE,
        });

        // The opening: questions, not a proposal, naming what the organization has.
        await page.getByRole("button", { name: GUIDE_ME_RE }).click();
        await waitForTurnEnd(page);
        const opening = await panel.innerText();
        await testInfo.attach("opening-questions", { body: opening });
        await expect(page.getByTestId("workflow-builder-proposal")).toHaveCount(
          0
        );
        expect(opening, "one bundle: several numbered questions").toMatch(
          QUESTION_LIST_RE
        );
        expect(opening, "names the project's real connection").toContain(
          JIRA_CONNECTION_KEY
        );
        expect(opening, "names a real runner").toContain(runnerName);
        expect(opening, "names a real project").toContain(projectName);

        // One bundled answer.
        await sendTurn(
          page,
          `1. Implement the Jira issues assigned to our bot. 2. Project "${projectName}". ` +
            `3. Jira through ${JIRA_CONNECTION_KEY}. 4. Plan and execute on "${runnerName}". ` +
            "5. When the implementation is done, comment a summary on the issue."
        );
        await waitForTurnEnd(page);
        const followUp = await panel.innerText();
        await testInfo.attach("after-first-answer", { body: followUp });

        // At most one more round of details: accept the defaults it offers.
        if ((await validProposals(page).count()) === 0) {
          await sendTurn(page, "Use your defaults for the rest and build it.");
        }
        await applyLatestValidProposal(page);
        const yaml = await editorText(page);
        expect(yaml).toContain(`connection: ${JIRA_CONNECTION_KEY}`);
        expect(yaml).toContain("jira.issue_assigned");
        expect(yaml).toContain(runnerName);
        expect(yaml).toContain("plan_and_execute");
        // "When the implementation is done" fits either event.
        expect(yaml).toMatch(DONE_EVENT_RE);
        expect(yaml, "the summary is a comment on the issue").toContain(
          "comment"
        );
        await createAndDelete(page, request, token);
      } finally {
        await jira.close();
        await cleanUp(request, fixture, token);
      }
    });

    test("does not invent a runner the organization does not have", async ({
      apiToken: token,
      page,
      request,
    }) => {
      test.setTimeout(TEST_TIMEOUT_MS);
      const { orgRole, orgSlug } = requireOrgClaims(token);
      expect(isOrgAdminRole(orgRole), ADMIN_REQUIRED_MESSAGE).toBe(true);

      const fixture = emptyFixture();
      const projectName = createUniqueName("e2e-builder-project");
      const proposals: string[] = [];
      page.on("response", async (response) => {
        if (response.url().includes("/ai/workflow-builder/chat")) {
          try {
            proposals.push(await response.text());
          } catch {
            // observability: a body that cannot be read (aborted stream) holds no proposal to check
          }
        }
      });

      try {
        const project = await createProject(request, {
          name: projectName,
          token,
        });
        fixture.projectId = project.id;

        await openAssistant(page, orgSlug);
        const before = await editorText(page);
        await sendTurn(
          page,
          `Create a workflow in the project "${projectName}" triggered by its own HTTP endpoint, ` +
            `running on the runner "${GHOST_RUNNER}".`
        );
        await waitForTurnEnd(page);

        // Whatever the agent answered, it never hands over YAML naming the runner.
        expect(proposals.join("\n")).not.toContain(`runner: ${GHOST_RUNNER}`);
        expect(await editorText(page), "nothing changes without Apply").toBe(
          before
        );
        await expect(
          page.getByTestId("workflow-builder-proposal").filter({
            hasText: VALID_RE,
          })
        ).toHaveCount(0);
      } finally {
        await cleanUp(request, fixture, token);
      }
    });
  }
);

async function openAssistant(page: Page, orgSlug: string): Promise<void> {
  await page.goto(`/${orgSlug}/workflows/new`);
  await expect(page.getByTestId("workflow-yaml-content")).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  });
  await openAssistantPanel(page);
}

async function openAssistantPanel(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: BUILD_WITH_AI_RE })
    .click({ timeout: UI_TIMEOUT_MS });
  await expect(page.getByLabel("Message to the assistant")).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  });
}

/** Unsaved workflows share one draft chat: start an empty one. */
async function startNewChat(page: Page): Promise<void> {
  const button = page.getByRole("button", { name: NEW_CHAT_RE });
  if (await button.isEnabled()) {
    await button.click();
  }
  await expect(page.getByTestId("workflow-builder-proposal")).toHaveCount(0);
}

/** Saves the editor's YAML through the api (its own validation), then removes the workflow. */
async function createAndDelete(
  page: Page,
  request: APIRequestContext,
  token: string
): Promise<void> {
  await page.getByRole("button", { name: CREATE_RE }).click();
  await page.waitForURL(WORKFLOW_PAGE_RE, { timeout: UI_TIMEOUT_MS });
  const workflowId = WORKFLOW_PAGE_RE.exec(page.url())?.[1];
  expect(workflowId).toBeTruthy();
  if (workflowId) {
    await deleteWorkflow(request, workflowId, token);
  }
}

async function cleanUp(
  request: APIRequestContext,
  fixture: Fixture,
  token: string
): Promise<void> {
  if (fixture.workflowId) {
    await deleteWorkflow(request, fixture.workflowId, token);
  }
  await deleteComputeTarget(request, fixture.computeTargetId, token);
  if (fixture.projectId) {
    await deleteProject(request, fixture.projectId, token);
  }
  for (const connectionId of fixture.connectionIds) {
    await deleteIntegrationConnection(request, connectionId, token);
  }
}

async function sendTurn(page: Page, text: string): Promise<void> {
  await page.getByLabel("Message to the assistant").fill(text);
  await page.getByRole("button", { name: SEND_RE }).click();
}

/** The chat is idle again: the Send button is back and enabled once a draft is typed. */
async function waitForTurnEnd(page: Page): Promise<void> {
  const input = page.getByLabel("Message to the assistant");
  await expect(async () => {
    await input.fill("x");
    await expect(page.getByRole("button", { name: SEND_RE })).toBeEnabled({
      timeout: 2000,
    });
  }).toPass({ timeout: TURN_TIMEOUT_MS, intervals: [5000] });
  await input.fill("");
}

async function applyLatestValidProposal(page: Page): Promise<void> {
  await waitForTurnEnd(page);
  const card = page.getByTestId("workflow-builder-proposal").last();
  await expect(
    card,
    "the last proposal passes the editor's check"
  ).toContainText(VALID_RE, { timeout: UI_TIMEOUT_MS });
  await card.getByRole("button", { name: APPLY_RE }).click();
  await expect(card).toContainText("Applied");
}

function validProposals(page: Page) {
  return page
    .getByTestId("workflow-builder-proposal")
    .filter({ hasText: VALID_RE });
}

async function editorText(page: Page): Promise<string> {
  return (
    await page.getByTestId("workflow-yaml-content").innerText()
  ).replaceAll(NBSP, " ");
}
