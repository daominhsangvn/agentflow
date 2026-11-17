import { describe, expect, it } from "vitest";
import { buildClaudeChildEnv, buildProbeEnv, pickBaseEnv } from "../child-env";

const baseEnv = {
  PATH: "/usr/bin",
  HOME: "/home/x",
  DATABASE_URL: "postgres://secret",
  BETTER_AUTH_SECRET: "secret",
  HTTPS_PROXY: "http://base-proxy",
  CLAUDECODE: "1",
  CLAUDE_CODE_ENTRYPOINT: "cli",
  ANTHROPIC_API_KEY: "base-key",
};

describe("child env", () => {
  it("copies only allowlisted base keys", () => {
    const env = buildClaudeChildEnv({
      baseEnv,
      settingsEnv: {},
      configDir: "/cfg",
      platform: "linux",
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.HOME).toBe("/home/x");
    for (const key of [
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "HTTPS_PROXY",
      "CLAUDECODE",
      "CLAUDE_CODE_ENTRYPOINT",
      "ANTHROPIC_API_KEY",
    ]) {
      expect(env).not.toHaveProperty(key);
    }
  });

  it("applies settings env and forces config dir and autoupdater", () => {
    const env = buildClaudeChildEnv({
      baseEnv,
      settingsEnv: {
        HTTPS_PROXY: "http://settings-proxy",
        ANTHROPIC_API_KEY: "dummy",
        CLAUDE_CONFIG_DIR: "/evil",
        DISABLE_AUTOUPDATER: "0",
      },
      configDir: "/cfg",
      platform: "linux",
    });
    expect(env.HTTPS_PROXY).toBe("http://settings-proxy");
    expect(env.ANTHROPIC_API_KEY).toBe("dummy");
    expect(env.CLAUDE_CONFIG_DIR).toBe("/cfg");
    expect(env.DISABLE_AUTOUPDATER).toBe("1");
  });

  it("keeps the original key spelling on win32 and matches case-insensitively", () => {
    const picked = pickBaseEnv(
      { Path: "C:\\bin", SystemRoot: "C:\\Windows" },
      "win32"
    );
    expect(picked).toEqual({ Path: "C:\\bin", SystemRoot: "C:\\Windows" });
    expect(pickBaseEnv({ Path: "C:\\bin" }, "linux")).toEqual({});
  });

  it("does not duplicate a key that differs only in case on win32", () => {
    const env = buildClaudeChildEnv({
      baseEnv: { Path: "C:\\base" },
      settingsEnv: { PATH: "C:\\settings" },
      configDir: "C:\\cfg",
      platform: "win32",
    });
    const pathKeys = Object.keys(env).filter((k) => k.toUpperCase() === "PATH");
    expect(pathKeys).toEqual(["PATH"]);
    expect(env.PATH).toBe("C:\\settings");
  });

  it("builds a probe env without secrets", () => {
    const env = buildProbeEnv(baseEnv, "linux");
    expect(env.DISABLE_AUTOUPDATER).toBe("1");
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("HTTPS_PROXY");
  });
});
