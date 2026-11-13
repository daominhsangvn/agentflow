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
 * comment without a mention; the files a task leaves, listed, previewed and
 * downloaded on the case page and attached to a case-page reply; and a removed
 * Agent getting no more tasks.
 *
 * E2E_KEEP_DATA=1 keeps the project, workflow and case afterwards and prints
 * the case page's URL, to look at them in the UI (same org as the e2e user).
 */

import type { Page } from "@playwright/test";
import {
  OrchestratorCaseStatus,
  OrchestratorDecisionStatus,
  OrchestratorDraftOutcome,
  OrchestratorMessageKind,
  OrchestratorReplyTarget,
  OrchestratorToolName,
} from "@repo/api/src/types/orchestrator";
import { bearer } from "./helpers/api-result";
import { getApiBaseUrl, getAppBaseUrl } from "./helpers/api-url";
import { isOrgAdminRole, requireOrgClaims } from "./helpers/better-auth";
import { readEnv } from "./helpers/env";
import type { FakeAgent, TurnContext } from "./helpers/fake-agent";
import {
  assignedToBotWebhook,
  commentCreatedWebhook,
  FAKE_JIRA_PERSON,
} from "./helpers/fake-jira";
import {
  COMMAND,
  FlowEnv,
  STEP_TIMEOUT_MS,
} from "./helpers/orchestrator-flow-env";
import { E2ETag } from "./helpers/tags";
import { expect, test } from "./test";

const ADMIN_REQUIRED_MESSAGE =
  "The e2e user must be an org admin to set up connections and workflows";
const FLOW_TIMEOUT_MS = 10 * 60_000;
const QUIET_MS = 8000;
const AGENTS_TAB_RE = /Agents/;
const CASE_PARAM_RE = /case=/;
const UI_TIMEOUT_MS = 30_000;

const ENV_QUESTION = "Which environment should the export run in?";
const ENV_ANSWER = "staging";
const SCOPE_REPLY = "Scope: CSV export only, on staging.";
const ASK_TEXT = "Is the PRD final?";
const FORK_REPLY = "The PRD is final.";
const DRAFT_COMMENT = "Scope agreed: CSV export only, on staging.";
const ASKED_HUMAN = "Confirm the PRD is final before planning.";
const DELIM_QUESTION = "Which CSV delimiter?";
/**
 * Comment ids are per Jira site, and the orchestrator's anchors are unique per
 * org, connection and comment id. Each run creates its own Jira connection, so
 * runs may reuse the same ids.
 */
const PLAIN_COMMENT_ID = "7000001";
const DELIM_COMMENT_ID = "7000002";
const DELIM_REPLY_ID = "7000003";
const DELIM_ANSWER = "Semicolon";

/** Files of a task are named relative to its work directory (`.agentflow-ai/work`). */
const WORK_DIR = ".agentflow-ai/work";
const PRD_FILE = "PRD-export.md";
const PRD_HEADING = "Leave report CSV export";
const PRD_CONTENT = `# ${PRD_HEADING}\n\nExport the leave report as **CSV** on staging.\n`;
const SCREENSHOT_FILE = "screens/export.png";
/** A 1x1 transparent PNG. */
const SCREENSHOT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
);
const BUNDLE_FILE = "bundle.zip";
const BIG_FILE = "recording.mp4";
const BIG_FILE_SKIPPED = "larger than 4 MB";
const FILES_REPLY = "The PRD is ready, see the file below.";

// A UI action that cannot happen fails the step instead of the whole flow.
test.use({ actionTimeout: UI_TIMEOUT_MS });

type Ids = {
  task1: string;
  task2: string;
  task3: string;
  task4: string;
  task5: string;
};

test("orchestrator full flow: Jira event, agents, questions, answers and project scope", {
  tag: E2ETag.Smoke,
}, async ({ apiToken: token, page, request }) => {
  test.setTimeout(FLOW_TIMEOUT_MS);
  const { orgRole, orgSlug } = requireOrgClaims(token);
  expect(isOrgAdminRole(orgRole), ADMIN_REQUIRED_MESSAGE).toBe(true);
  const env = new FlowEnv(request, token);
  const ids: Ids = { task1: "", task2: "", task3: "", task4: "", task5: "" };
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
        expect.objectContaining({
          computeTargetId: ba.id,
          activeTaskCount: 0,
          openQuestionCount: 1,
        }),
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
      // The block's icon says the BA waits for a person (its task count stays a number).
      await expect(baNode.getByTestId("agent-map-needs-person")).toBeVisible();
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
        agentNode(page, ba.name).getByTestId("agent-map-needs-person")
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

    await test.step("7. task files: listed on the case page, previewed, downloaded and attached to a case-page reply", async () => {
      const turnsBefore = orch.turns().length;
      orch.onTurn(async (turn) => {
        ids.task5 = await runTask(turn, ba, { prompt: "Write the PRD." });
        return { answer: "Asked the BA for the PRD." };
      });
      ba.onTask(() =>
        Promise.resolve({
          reply: "PRD written.",
          attachments: [
            { path: `${WORK_DIR}/${PRD_FILE}`, content: PRD_CONTENT },
            { path: `${WORK_DIR}/${SCREENSHOT_FILE}`, content: SCREENSHOT_PNG },
            { path: `${WORK_DIR}/${BUNDLE_FILE}`, content: "PK fake zip" },
            {
              path: `${WORK_DIR}/${BIG_FILE}`,
              size: 5 * 1024 * 1024,
              skipped: BIG_FILE_SKIPPED,
            },
          ],
        })
      );
      orch.onTurn(async (turn) => {
        expect(turn.request.prompt).toContain(PRD_FILE);
        await turn.tool(OrchestratorToolName.Reply, {
          text: FILES_REPLY,
          where: OrchestratorReplyTarget.CasePage,
          attachments: [{ taskId: ids.task5, name: PRD_FILE }],
        });
        await turn.tool(OrchestratorToolName.WaitHuman, {});
        return { answer: "Shared the PRD." };
      });
      await env.postCaseMessage({ text: "Write the PRD." });
      const item = await env.waitForCase(
        (c) =>
          !(c.turnRunning || c.needsPerson) &&
          c.activeTaskCount === 0 &&
          orch.turns().length === turnsBefore + 2
      );

      const task = (await env.caseDetail()).tasks.find(
        (t) => t.id === ids.task5
      );
      expect(task?.files).toEqual([
        expect.objectContaining({ name: PRD_FILE, stored: true }),
        expect.objectContaining({ name: SCREENSHOT_FILE, stored: true }),
        expect.objectContaining({ name: BUNDLE_FILE, stored: true }),
        expect.objectContaining({
          name: BIG_FILE,
          stored: false,
          skipped: BIG_FILE_SKIPPED,
        }),
      ]);
      const file = await env.taskFile(ids.task5, PRD_FILE);
      expect(file.status()).toBe(200);
      expect(file.headers()["content-type"]).toContain("text/markdown");
      expect(await file.text()).toBe(PRD_CONTENT);
      expect((await env.taskFile(ids.task5, BIG_FILE)).status()).toBe(404);

      await page.goto(`/${orgSlug}/orchestrator/cases/${item.id}`);
      const files = page.getByTestId("orchestrator-task-files");
      await expect(files).toContainText(BIG_FILE_SKIPPED, {
        timeout: UI_TIMEOUT_MS,
      });
      await expect(files.getByRole("button", { name: BIG_FILE })).toHaveCount(
        0
      );
      const dialog = page.getByRole("dialog");

      await files.getByRole("button", { name: PRD_FILE }).click();
      await expect(
        dialog.getByRole("heading", { name: PRD_HEADING })
      ).toBeVisible();
      const downloaded = page.waitForEvent("download");
      await dialog.getByRole("button", { name: "Download" }).click();
      const download = await downloaded;
      expect(download.suggestedFilename()).toBe(PRD_FILE);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();

      await files.getByRole("button", { name: SCREENSHOT_FILE }).click();
      await expect(dialog.locator("img")).toBeVisible();
      await page.keyboard.press("Escape");

      await files.getByRole("button", { name: BUNDLE_FILE }).click();
      await expect(dialog).toContainText("No preview for this file type");
      await page.keyboard.press("Escape");

      await expect(page.getByText(FILES_REPLY)).toBeVisible();
      await page
        .getByTestId("orchestrator-message-files")
        .getByRole("button", { name: PRD_FILE })
        .click();
      await expect(
        dialog.getByRole("heading", { name: PRD_HEADING })
      ).toBeVisible();
      await page.keyboard.press("Escape");
      env.expectNoAgentErrors();
    });

    await test.step("8. a decision with a draft: the admin sees it in full; Approve posts it on Jira once", async () => {
      const posted = () =>
        jira
          .postedComments(issue.key)
          .filter((c) => JSON.stringify(c.body).includes(DRAFT_COMMENT));
      let carriedOutTurn = false;
      orch.onTurn(async (turn) => {
        await turn.tool(OrchestratorToolName.RequestDecision, {
          question: "Post the scope summary on the ticket?",
          where: OrchestratorReplyTarget.CasePage,
          draft: { comment: { text: DRAFT_COMMENT } },
        });
        await turn.tool(OrchestratorToolName.WaitHuman, {});
        return { answer: "Asked for approval." };
      });
      orch.onTurn(async (turn) => {
        expect(turn.request.prompt).toContain("Do not post or move it again");
        await turn.tool(OrchestratorToolName.WaitHuman, {});
        carriedOutTurn = true;
        return { answer: "Posted by AgentFlow." };
      });

      const response = await env.postCaseMessage({
        text: "Draft the scope comment for the ticket.",
      });
      expect(response.status()).toBe(200);
      await expect
        .poll(
          async () =>
            (await env.caseDetail()).decisions.some(
              (d) => d.status === OrchestratorDecisionStatus.Pending
            ),
          { timeout: STEP_TIMEOUT_MS }
        )
        .toBe(true);
      expect(posted()).toHaveLength(0);

      await openAgentsTab(page, orgSlug, flow.workflow.id);
      // With no agent selected the tab lists the orchestrator's cases.
      await page.getByTestId("agent-case-row").first().click();
      await expect(page).toHaveURL(CASE_PARAM_RE, { timeout: UI_TIMEOUT_MS });
      const draft = page.getByTestId("decision-draft");
      await expect(draft).toContainText(DRAFT_COMMENT, {
        timeout: UI_TIMEOUT_MS,
      });
      await expect(
        page.getByText(`Comment on ${issue.key}`).first()
      ).toBeVisible();
      await page.getByRole("button", { name: "Approve" }).click();

      await env.waitForCase(
        (c) => carriedOutTurn && !(c.turnRunning || c.needsPerson)
      );
      expect(posted()).toHaveLength(1);
      const detail = await env.caseDetail();
      const decision = detail.decisions.find((d) => d.draft !== null);
      expect(decision?.draftResult?.outcome).toBe(
        OrchestratorDraftOutcome.Done
      );
      expect(decision?.draftResult?.commentRef).not.toBeNull();

      const again = await request.post(
        `${getApiBaseUrl()}/orchestrator/decisions/${decision?.id}`,
        { data: { approved: true }, headers: bearer(token) }
      );
      expect(again.status()).toBe(404);
      expect(posted()).toHaveLength(1);
      env.expectNoAgentErrors();
    });

    await test.step("9. an Agent removed from the project gets no more tasks; an Agent outside it never does", async () => {
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

    await test.step("10. only the orchestrator ran turns and only the BA ran tasks", () => {
      expect(outside.operations()).toEqual([]);
      expect(orch.loops()).toEqual([]);
      expect(ba.turns()).toEqual([]);
      expect(jira.unhandled()).toEqual([]);
      return Promise.resolve();
    });
  } finally {
    const keep = readEnv("E2E_KEEP_DATA") === "1";
    await env.cleanUp(keep);
    const casePath = env.casePath(orgSlug);
    if (keep && casePath) {
      console.log(`E2E_KEEP_DATA: case page ${getAppBaseUrl()}${casePath}`);
    }
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
