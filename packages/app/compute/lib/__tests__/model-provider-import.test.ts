import { describe, expect, it } from "vitest";
import { importClaudeSettings } from "../model-provider-import";

const DEEPSEEK_SETTINGS = JSON.stringify({
  env: {
    ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
    ANTHROPIC_AUTH_TOKEN: "sk-test-token",
    ANTHROPIC_MODEL: "deepseek-flash[1m]",
    ANTHROPIC_DEFAULT_OPUS_MODEL: "deepseek-flash[1m]",
    ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-flash[1m]",
    ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-flash[1m]",
    CLAUDE_CODE_SUBAGENT_MODEL: "deepseek-flash[1m]",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_EFFORT_LEVEL: "max",
  },
});

describe("importClaudeSettings", () => {
  it("maps a DeepSeek settings.json to the provider fields", () => {
    expect(importClaudeSettings(DEEPSEEK_SETTINGS)).toEqual({
      baseUrl: "https://api.deepseek.com/anthropic",
      token: "sk-test-token",
      model: "deepseek-flash[1m]",
      env: [
        { key: "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", value: "1" },
        { key: "CLAUDE_CODE_EFFORT_LEVEL", value: "max" },
      ],
      ignoredKeys: [],
      caCertificatePath: null,
    });
  });

  it("keeps a model variable that differs from the default model", () => {
    const imported = importClaudeSettings(
      JSON.stringify({
        ANTHROPIC_MODEL: "deepseek-chat",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "deepseek-lite",
        PATH: "/tmp",
      })
    );

    expect(imported).toMatchObject({
      model: "deepseek-chat",
      env: [{ key: "ANTHROPIC_DEFAULT_HAIKU_MODEL", value: "deepseek-lite" }],
      ignoredKeys: ["PATH"],
    });
  });

  it("reports text that is not JSON", () => {
    expect(importClaudeSettings("ANTHROPIC_BASE_URL=x")).toEqual({
      error: "Paste valid JSON: a settings.json file or its env object.",
    });
  });
});

describe("importClaudeSettings with a proxy and a CA certificate", () => {
  it("keeps the proxy variables and asks for the certificate file", () => {
    const imported = importClaudeSettings(
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "https://claude.example.com",
          ANTHROPIC_CUSTOM_HEADERS: "X-Api-Key:pk_test",
          ANTHROPIC_AUTH_TOKEN: "123",
          DISABLE_AUTOUPDATER: "1",
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1,
          HTTPS_PROXY: "http://172.16.0.1:8090",
          HTTP_PROXY: "http://172.16.0.1:8090",
          NODE_EXTRA_CA_CERTS: "/Users/me/.claude/ca_179.crt",
          NO_PROXY: "localhost,127.0.0.1,github.com",
        },
        hasCompletedOnboarding: true,
      })
    );
    expect(imported).toEqual({
      baseUrl: "https://claude.example.com",
      token: "123",
      model: null,
      env: [
        { key: "ANTHROPIC_CUSTOM_HEADERS", value: "X-Api-Key:pk_test" },
        { key: "DISABLE_AUTOUPDATER", value: "1" },
        { key: "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", value: "1" },
        { key: "HTTPS_PROXY", value: "http://172.16.0.1:8090" },
        { key: "HTTP_PROXY", value: "http://172.16.0.1:8090" },
        { key: "NO_PROXY", value: "localhost,127.0.0.1,github.com" },
      ],
      ignoredKeys: [],
      caCertificatePath: "/Users/me/.claude/ca_179.crt",
    });
  });
});
