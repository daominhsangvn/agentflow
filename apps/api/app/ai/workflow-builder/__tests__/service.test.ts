import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PlatformAgentDisabledReason } from "@repo/api/src/types/platform-agent";
import { WorkflowBuilderDisabledReason } from "@repo/api/src/types/workflow-builder";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    PLATFORM_AGENT_SETTINGS_FILE: undefined as string | undefined,
    PLATFORM_AGENT_CLAUDE_CODE_VERSION: undefined as string | undefined,
    PLATFORM_AGENT_CLAUDE_CODE_PATH: undefined as string | undefined,
  },
  stat: vi.fn(),
  readFile: vi.fn(),
  resolve: vi.fn(),
}));

vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  mocks.stat.mockImplementation(actual.stat);
  mocks.readFile.mockImplementation(actual.readFile);
  return { ...actual, stat: mocks.stat, readFile: mocks.readFile };
});
vi.mock("@/lib/platform-agent/claude-code", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/platform-agent/claude-code")>();
  return {
    ...actual,
    createClaudeCodeResolver: () => ({ resolve: mocks.resolve }),
  };
});

import { dropUnfinishedReadParts, workflowBuilderService } from "../service";

let dir: string;
let settingsFile: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "wb-service-"));
  settingsFile = path.join(dir, "settings.json");
  await writeFile(
    settingsFile,
    JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "dummy-token" } })
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.PLATFORM_AGENT_SETTINGS_FILE = undefined;
  mocks.env.PLATFORM_AGENT_CLAUDE_CODE_VERSION = undefined;
  mocks.env.PLATFORM_AGENT_CLAUDE_CODE_PATH = undefined;
});

describe("workflowBuilderService.getStatus", () => {
  it("is disabled and reads no file when the env is unset", async () => {
    const status = await workflowBuilderService.getStatus();

    expect(status).toEqual({
      enabled: false,
      reason: WorkflowBuilderDisabledReason.NotConfigured,
    });
    expect(mocks.stat).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("reports claude_code_missing when the settings load but no binary is found", async () => {
    mocks.env.PLATFORM_AGENT_SETTINGS_FILE = settingsFile;
    mocks.resolve.mockResolvedValue({
      ok: false,
      reason: PlatformAgentDisabledReason.ClaudeCodeMissing,
    });

    expect(await workflowBuilderService.getStatus()).toEqual({
      enabled: false,
      reason: WorkflowBuilderDisabledReason.ClaudeCodeMissing,
    });
  });

  it("reports claude_code_version_mismatch and passes the version env to the resolver", async () => {
    mocks.env.PLATFORM_AGENT_SETTINGS_FILE = settingsFile;
    mocks.env.PLATFORM_AGENT_CLAUDE_CODE_VERSION = "2.1.322";
    mocks.resolve.mockResolvedValue({
      ok: false,
      reason: PlatformAgentDisabledReason.ClaudeCodeVersionMismatch,
      foundVersion: "2.0.1",
    });

    expect(await workflowBuilderService.getStatus()).toEqual({
      enabled: false,
      reason: WorkflowBuilderDisabledReason.ClaudeCodeVersionMismatch,
    });
    expect(mocks.resolve).toHaveBeenCalledWith({
      requested: "2.1.322",
      explicitPath: undefined,
    });
  });

  it("is enabled when the settings load and Claude Code resolves", async () => {
    mocks.env.PLATFORM_AGENT_SETTINGS_FILE = settingsFile;
    mocks.resolve.mockResolvedValue({
      ok: true,
      command: { file: "claude", prefixArgs: [] },
      version: "2.1.322",
      source: "path",
    });

    expect(await workflowBuilderService.getStatus()).toEqual({ enabled: true });
  });

  it("does not resolve Claude Code when the settings are invalid", async () => {
    mocks.env.PLATFORM_AGENT_SETTINGS_FILE = path.join(dir, "missing.json");

    expect(await workflowBuilderService.getStatus()).toEqual({
      enabled: false,
      reason: WorkflowBuilderDisabledReason.SettingsFileMissing,
    });
    expect(mocks.resolve).not.toHaveBeenCalled();
  });
});

describe("dropUnfinishedReadParts", () => {
  const text = { type: "text", text: "hi" };
  const dangling = {
    type: "tool-read_guide",
    toolCallId: "t1",
    state: "input-available",
    input: {},
  };
  const finished = {
    type: "tool-get_catalog",
    toolCallId: "t2",
    state: "output-available",
    input: {},
    output: { ok: true },
  };
  const proposal = {
    type: "tool-propose_workflow",
    toolCallId: "t3",
    state: "input-available",
    input: { yaml: "a: 1" },
  };

  it("drops read tool parts without output and keeps everything else", () => {
    const result = dropUnfinishedReadParts([
      {
        id: "1",
        role: "assistant",
        parts: [text, dangling, finished, proposal],
      },
    ]);
    expect(result).toEqual([
      { id: "1", role: "assistant", parts: [text, finished, proposal] },
    ]);
  });

  it("drops a message that only held an unfinished part and passes junk through", () => {
    const junk = { nope: true };
    const result = dropUnfinishedReadParts([
      { id: "1", role: "assistant", parts: [dangling] },
      junk,
    ]);
    expect(result).toEqual([junk]);
  });
});
