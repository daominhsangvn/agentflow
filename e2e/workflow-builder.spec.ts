/**
 * The optional workflow builder assistant on the New workflow page. The status
 * and chat endpoints are mocked with `page.route` (the real model path is
 * covered by the api smoke command), so this drives the browser side: the
 * entry only shows when enabled, a streamed proposal is validated in the
 * browser, and Apply replaces the editor text without saving anything.
 */

import {
  WorkflowBuilderDisabledReason,
  WorkflowBuilderToolName,
} from "@repo/api/src/types/workflow-builder";
import { isOrgAdminRole, requireOrgClaims } from "./helpers/better-auth";
import { E2ETag } from "./helpers/tags";
import { createUniqueName } from "./helpers/utils";
import { expect, test } from "./test";

const ADMIN_REQUIRED_MESSAGE =
  "The e2e user must be an org admin to create workflows";
const UI_TIMEOUT_MS = 30_000;
const STATUS_URL = "**/ai/workflow-builder/status";
const CHAT_URL = "**/ai/workflow-builder/chat";
const BUILD_WITH_AI_RE = /Build with AI/;
const SEND_RE = /^Send$/;
const APPLY_RE = /Apply to editor/;
const SAVE_RE = /^\/workflows(\?.*)?$/;

test("workflow builder assistant is hidden when it is not configured", {
  tag: E2ETag.Smoke,
}, async ({ apiToken: token, page }) => {
  const { orgRole, orgSlug } = requireOrgClaims(token);
  expect(isOrgAdminRole(orgRole), ADMIN_REQUIRED_MESSAGE).toBe(true);
  await page.route(STATUS_URL, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          enabled: false,
          reason: WorkflowBuilderDisabledReason.NotConfigured,
        },
      }),
    })
  );

  await page.goto(`/${orgSlug}/workflows/new`);

  await expect(page.getByTestId("workflow-yaml-content")).toBeVisible({
    timeout: UI_TIMEOUT_MS,
  });
  await expect(
    page.getByRole("button", { name: BUILD_WITH_AI_RE })
  ).toHaveCount(0);
});

test("workflow builder assistant proposes YAML and Apply only changes the editor", {
  tag: E2ETag.Smoke,
}, async ({ apiToken: token, page }) => {
  test.setTimeout(120_000);
  const { orgRole, orgSlug } = requireOrgClaims(token);
  expect(isOrgAdminRole(orgRole), ADMIN_REQUIRED_MESSAGE).toBe(true);
  const workflowName = createUniqueName("e2e-builder-workflow");
  const yaml = `name: ${workflowName}\n`;

  const saves: string[] = [];
  page.on("request", (sent) => {
    if (
      sent.method() === "POST" &&
      SAVE_RE.test(new URL(sent.url()).pathname)
    ) {
      saves.push(sent.url());
    }
  });
  await page.route(STATUS_URL, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { enabled: true } }),
    })
  );
  let chatCalls = 0;
  await page.route(CHAT_URL, (route) => {
    chatCalls += 1;
    const chunks =
      chatCalls === 1
        ? proposalStream(yaml)
        : textStream("The workflow is ready.");
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
        "cache-control": "no-cache",
      },
      body: toSse(chunks),
    });
  });

  await page.goto(`/${orgSlug}/workflows/new`);
  await page
    .getByRole("button", { name: BUILD_WITH_AI_RE })
    .click({ timeout: UI_TIMEOUT_MS });
  await page.getByLabel("Message to the assistant").fill("Build a workflow");
  await page.getByRole("button", { name: SEND_RE }).click();

  const card = page.getByTestId("workflow-builder-proposal");
  await expect(card).toBeVisible({ timeout: UI_TIMEOUT_MS });
  await card.getByRole("button", { name: APPLY_RE }).click();

  await expect(page.getByTestId("workflow-yaml-content")).toContainText(
    workflowName,
    { timeout: UI_TIMEOUT_MS }
  );
  expect(saves).toEqual([]);
});

test("workflow builder chat shows bubbles, markdown and a thinking line", {
  tag: E2ETag.Smoke,
}, async ({ apiToken: token, page }) => {
  test.setTimeout(120_000);
  const { orgRole, orgSlug } = requireOrgClaims(token);
  expect(isOrgAdminRole(orgRole), ADMIN_REQUIRED_MESSAGE).toBe(true);
  const sentText = "Build a workflow";

  let releaseChat: () => void = () => undefined;
  const chatGate = new Promise<void>((resolve) => {
    releaseChat = resolve;
  });
  await page.route(STATUS_URL, (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { enabled: true } }),
    })
  );
  await page.route(CHAT_URL, async (route) => {
    await chatGate;
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "text/event-stream",
        "x-vercel-ai-ui-message-stream": "v1",
        "cache-control": "no-cache",
      },
      body: toSse(textStream("**Ready** to build:\n\n- first\n- second")),
    });
  });

  await page.goto(`/${orgSlug}/workflows/new`);
  await page
    .getByRole("button", { name: BUILD_WITH_AI_RE })
    .click({ timeout: UI_TIMEOUT_MS });
  await page.getByLabel("Message to the assistant").fill(sentText);
  await page.getByRole("button", { name: SEND_RE }).click();

  const thinking = page.getByTestId("workflow-builder-thinking");
  await expect(thinking).toBeVisible({ timeout: UI_TIMEOUT_MS });
  releaseChat();

  const assistantBubble = page
    .getByTestId("workflow-builder-message")
    .and(page.locator('[data-role="assistant"]'));
  await expect(assistantBubble.locator("strong")).toHaveText("Ready", {
    timeout: UI_TIMEOUT_MS,
  });
  await expect(assistantBubble.locator("li")).toHaveCount(2);
  await expect(thinking).toHaveCount(0);
  await expect(
    page
      .getByTestId("workflow-builder-message")
      .and(page.locator('[data-role="user"]'))
  ).toContainText(sentText);
});

type StreamChunk = Record<string, unknown> | "[DONE]";

function proposalStream(yaml: string): StreamChunk[] {
  return [
    { type: "start", messageId: "msg-proposal" },
    { type: "start-step" },
    {
      type: "tool-input-available",
      toolCallId: "call-proposal",
      toolName: WorkflowBuilderToolName.ProposeWorkflow,
      input: { yaml, summary: "A minimal workflow" },
    },
    { type: "finish-step" },
    { type: "finish" },
    "[DONE]",
  ];
}

function textStream(text: string): StreamChunk[] {
  return [
    { type: "start", messageId: "msg-proposal" },
    { type: "start-step" },
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: text },
    { type: "text-end", id: "text-1" },
    { type: "finish-step" },
    { type: "finish" },
    "[DONE]",
  ];
}

function toSse(chunks: StreamChunk[]): string {
  return chunks
    .map(
      (chunk) =>
        `data: ${chunk === "[DONE]" ? chunk : JSON.stringify(chunk)}\n\n`
    )
    .join("");
}
