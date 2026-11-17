/**
 * Route tests for GET /ai/workflow-builder/status and POST /ai/workflow-builder/chat.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { OrgPermission } from "@repo/api/src/types/org-permissions";
import { PlatformAgentDisabledReason } from "@repo/api/src/types/platform-agent";
import {
  WORKFLOW_BUILDER_MAX_MESSAGES,
  WorkflowBuilderDisabledReason,
  WorkflowBuilderErrorCode,
} from "@repo/api/src/types/workflow-builder";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createFakeClaudeScratch,
  FAKE_CLAUDE_COMMAND,
} from "@/__tests__/support/platform-agent/fake-claude.test-helpers";
import {
  resultLine,
  textDeltaLine,
} from "@/__tests__/support/platform-agent/stream-json-fixtures";
import type { AuthContext } from "@/lib/auth/with-auth";
import { ClaudeCodeSource } from "@/lib/platform-agent/claude-code";
import {
  createMockRequest,
  createMockRouteContext,
  createTestAuthContext,
} from "../utils/auth-helpers";

// --- Mocks (must come before imports) ---

const TOKEN = "tok-secret-for-test-123";

const mocks = vi.hoisted(() => ({
  env: {
    PLATFORM_AGENT_SETTINGS_FILE: undefined as string | undefined,
    PLATFORM_AGENT_CLAUDE_CODE_VERSION: undefined as string | undefined,
    PLATFORM_AGENT_CLAUDE_CODE_PATH: undefined as string | undefined,
  },
  resolve: vi.fn(),
  authResult: { current: null as unknown },
  permission: { current: null as unknown },
}));

let mockAuthContext: AuthContext;

vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("@/lib/auth/with-any-auth", () => ({
  withAnyAuth: (handler: any) => async (request: any, context: any) =>
    handler(mockAuthContext, request, context?.params),
}));
vi.mock("@/lib/auth/resolve-any-auth-context", () => ({
  resolveAnyAuthContext: vi.fn(() => Promise.resolve(mocks.authResult.current)),
}));
vi.mock("@/lib/auth/org-permissions", () => ({
  getOrgPermissionStatus: vi.fn(() =>
    Promise.resolve(mocks.permission.current)
  ),
}));
vi.mock("@/app/users/service", () => ({
  usersService: {
    findById: vi.fn(() =>
      Promise.resolve({ id: "user-1", clerkId: "clerk_u" })
    ),
  },
}));
vi.mock("@/app/organizations/service", () => ({
  organizationsService: {
    findById: vi.fn(() => Promise.resolve({ id: "org-1", clerkId: "clerk_o" })),
  },
}));

vi.mock("@/lib/platform-agent/claude-code", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/platform-agent/claude-code")>();
  return {
    ...actual,
    createClaudeCodeResolver: () => ({ resolve: mocks.resolve }),
  };
});
vi.mock("@/app/ai/workflow-builder/service/catalog-tool", () => ({
  loadWorkflowBuilderCatalog: vi.fn(() => Promise.resolve({ projects: [] })),
}));

// --- Imports (after mocks) ---

import { POST } from "@/app/ai/workflow-builder/chat/route";
import { GET as statusGET } from "@/app/ai/workflow-builder/status/route";

const validMessages = [
  { id: "1", role: "user", parts: [{ type: "text", text: "Build it" }] },
];

const PROPOSED_YAML = "name: Demo\nsteps: []";
const FENCE_MARK = "```";
const SUCCESS_SCENARIO = [
  textDeltaLine(`Here is the workflow.\n${FENCE_MARK}workflow-yaml\n`),
  textDeltaLine(`${PROPOSED_YAML}\n${FENCE_MARK}`),
  resultLine({ result: "Here is the workflow." }),
];

let dir: string;
let settingsFile: string;
let scratch: Awaited<ReturnType<typeof createFakeClaudeScratch>>;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "wb-routes-"));
  scratch = await createFakeClaudeScratch();
  settingsFile = path.join(dir, "settings.json");
  await writeFile(
    settingsFile,
    JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: TOKEN, ...scratch.env() } })
  );
});

afterAll(async () => {
  await scratch.cleanup();
  await rm(dir, { recursive: true, force: true });
});

function memberStatus(permissions: OrgPermission[], isOwner = false) {
  return { kind: "member", isOwner, permissions: new Set(permissions) };
}

function authorized(organizationId = "org-1") {
  mocks.authResult.current = {
    ok: true,
    context: { organizationId, userId: "user-1" },
  };
  mocks.permission.current = memberStatus([OrgPermission.WorkflowManage]);
}

function chat(body: unknown) {
  return POST(
    createMockRequest({
      method: "POST",
      url: "http://localhost:3002/ai/workflow-builder/chat",
      body,
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthContext = createTestAuthContext();
  mocks.env.PLATFORM_AGENT_SETTINGS_FILE = undefined;
  mocks.env.PLATFORM_AGENT_CLAUDE_CODE_VERSION = undefined;
  mocks.env.PLATFORM_AGENT_CLAUDE_CODE_PATH = undefined;
  mocks.resolve.mockResolvedValue({
    ok: true,
    command: FAKE_CLAUDE_COMMAND,
    version: "2.1.322",
    source: ClaudeCodeSource.Path,
  });
  authorized();
});

describe("GET /ai/workflow-builder/status", () => {
  it("returns 403 without WorkflowManage", async () => {
    mocks.permission.current = memberStatus([]);
    const response = await statusGET(
      createMockRequest({
        url: "http://localhost:3002/ai/workflow-builder/status",
      }),
      createMockRouteContext({})
    );
    expect(response.status).toBe(403);
  });

  it("reports not configured when the env is unset", async () => {
    mocks.permission.current = memberStatus([OrgPermission.WorkflowManage]);
    const response = await statusGET(
      createMockRequest({
        url: "http://localhost:3002/ai/workflow-builder/status",
      }),
      createMockRouteContext({})
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        enabled: false,
        reason: WorkflowBuilderDisabledReason.NotConfigured,
      },
    });
  });

  it("reports claude_code_version_mismatch", async () => {
    mocks.env.PLATFORM_AGENT_SETTINGS_FILE = settingsFile;
    mocks.resolve.mockResolvedValue({
      ok: false,
      reason: PlatformAgentDisabledReason.ClaudeCodeVersionMismatch,
    });
    const response = await statusGET(
      createMockRequest({
        url: "http://localhost:3002/ai/workflow-builder/status",
      }),
      createMockRouteContext({})
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        enabled: false,
        reason: WorkflowBuilderDisabledReason.ClaudeCodeVersionMismatch,
      },
    });
  });
});

describe("POST /ai/workflow-builder/chat", () => {
  it("returns 401 when unauthenticated", async () => {
    mocks.authResult.current = { ok: false, failure: "unauthenticated" };
    const response = await chat({ messages: validMessages, editorYaml: "" });
    expect(response.status).toBe(401);
  });

  it("returns 403 without WorkflowManage", async () => {
    mocks.permission.current = memberStatus([]);
    const response = await chat({ messages: validMessages, editorYaml: "" });
    expect(response.status).toBe(403);
  });

  it("returns 503 with the not-configured code when the env is unset", async () => {
    const response = await chat({ messages: validMessages, editorYaml: "" });
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe(
      WorkflowBuilderErrorCode.NotConfigured
    );
  });

  it("returns 400 for too many messages", async () => {
    mocks.env.PLATFORM_AGENT_SETTINGS_FILE = settingsFile;
    const messages = Array.from(
      { length: WORKFLOW_BUILDER_MAX_MESSAGES + 1 },
      () => validMessages[0]
    );
    const response = await chat({ messages, editorYaml: "" });
    expect(response.status).toBe(400);
  });

  it("returns 400 for invalid UI messages", async () => {
    mocks.env.PLATFORM_AGENT_SETTINGS_FILE = settingsFile;
    const response = await chat({
      messages: [{ nope: true }],
      editorYaml: "",
    });
    expect(response.status).toBe(400);
  });

  it("streams a proposal from the CLI when configured, without leaking settings", async () => {
    mocks.env.PLATFORM_AGENT_SETTINGS_FILE = settingsFile;
    await scratch.writeScenario(SUCCESS_SCENARIO);
    const response = await chat({
      messages: validMessages,
      editorYaml: "name: x",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body).toContain('"type":"start-step"');
    expect(body).toContain('"type":"text-delta"');
    expect(body).toContain('"toolName":"propose_workflow"');
    expect(body).toContain("name: Demo");
    expect(body).not.toContain("workflow-yaml");
    expect(body).not.toContain(TOKEN);
  });

  it("accepts a stored chat whose read tool part never got an output", async () => {
    mocks.env.PLATFORM_AGENT_SETTINGS_FILE = settingsFile;
    authorized("org-dangling");
    await scratch.writeScenario(SUCCESS_SCENARIO);
    const messages = [
      ...validMessages,
      {
        id: "2",
        role: "assistant",
        parts: [
          { type: "text", text: "Reading the guide." },
          {
            type: "tool-read_guide",
            toolCallId: "toolu_dangling",
            state: "input-available",
            input: { tool: "Read", target: "guides/yaml-reference.md" },
            providerExecuted: true,
          },
        ],
      },
      { id: "3", role: "user", parts: [{ type: "text", text: "Go on" }] },
    ];
    const response = await chat({ messages, editorYaml: "" });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"toolName":"propose_workflow"');
  });

  it("returns 503 unavailable when Claude Code cannot be resolved", async () => {
    mocks.env.PLATFORM_AGENT_SETTINGS_FILE = settingsFile;
    mocks.resolve.mockResolvedValue({
      ok: false,
      reason: PlatformAgentDisabledReason.ClaudeCodeMissing,
    });
    const response = await chat({ messages: validMessages, editorYaml: "" });
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe(
      WorkflowBuilderErrorCode.Unavailable
    );
  });

  it("returns 429 busy with Retry-After when all run slots are taken", async () => {
    mocks.env.PLATFORM_AGENT_SETTINGS_FILE = settingsFile;
    authorized("org-busy");
    await scratch.writeScenario([{ sleep: 3000 }]);
    const responses: Response[] = [];
    for (let i = 0; i < 5; i++) {
      responses.push(await chat({ messages: validMessages, editorYaml: "" }));
    }
    const busy = responses[4];
    expect(busy.status).toBe(429);
    expect(busy.headers.get("Retry-After")).toBe("15");
    expect((await busy.json()).code).toBe(WorkflowBuilderErrorCode.Busy);
    for (const response of responses.slice(0, 4)) {
      expect(response.status).toBe(200);
      await response.text();
    }
  }, 30_000);

  it("returns 429 with Retry-After once the window is exhausted", async () => {
    mocks.env.PLATFORM_AGENT_SETTINGS_FILE = settingsFile;
    authorized("org-rate-limited");
    await scratch.writeScenario(SUCCESS_SCENARIO);
    let last: Response | null = null;
    for (let i = 0; i < 31; i++) {
      last = await chat({ messages: validMessages, editorYaml: "" });
      if (last.status === 200) {
        await last.text();
      }
    }
    expect(last?.status).toBe(429);
    expect(last?.headers.get("Retry-After")).toBe("60");
    const body = await last?.json();
    expect(body.code).toBe(WorkflowBuilderErrorCode.RateLimited);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  }, 60_000);
});
