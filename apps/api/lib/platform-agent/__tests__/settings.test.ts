import { X509Certificate } from "node:crypto";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { rootCertificates } from "node:tls";
import { PlatformAgentDisabledReason } from "@repo/api/src/types/platform-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPlatformAgentSettingsLoader,
  isHttpUrl,
  parseCustomHeaders,
  resolveCaPath,
  toCaPems,
} from "../settings";

const PEM_ONE = rootCertificates[0] as string;
const PEM_TWO = rootCertificates[1] as string;

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "wb-settings-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function writeSettings(
  env: Record<string, string>,
  extra: Record<string, unknown> = {}
): Promise<string> {
  const file = path.join(dir, "settings.json");
  await writeFile(file, JSON.stringify({ env, ...extra }));
  return file;
}

describe("settings loader", () => {
  it("reports a missing file", async () => {
    const result = await createPlatformAgentSettingsLoader().load(
      path.join(dir, "nope.json")
    );
    expect(result).toEqual({
      ok: false,
      reason: PlatformAgentDisabledReason.SettingsFileMissing,
    });
  });

  it("reports invalid JSON and invalid shape", async () => {
    const file = path.join(dir, "settings.json");
    await writeFile(file, "{not json");
    const loader = createPlatformAgentSettingsLoader();
    expect(await loader.load(file)).toEqual({
      ok: false,
      reason: PlatformAgentDisabledReason.SettingsInvalidJson,
    });
    await writeFile(file, JSON.stringify({ env: { A: 1 } }));
    const second = await createPlatformAgentSettingsLoader().load(file);
    expect(second).toEqual({
      ok: false,
      reason: PlatformAgentDisabledReason.SettingsInvalid,
    });
  });

  it("requires a token", async () => {
    const file = await writeSettings({ ANTHROPIC_BASE_URL: "https://x" });
    const result = await createPlatformAgentSettingsLoader().load(file);
    expect(result).toEqual({
      ok: false,
      reason: PlatformAgentDisabledReason.TokenMissing,
    });
  });

  it("passes the env block through unchanged and summarizes it", async () => {
    const file = await writeSettings(
      {
        ANTHROPIC_AUTH_TOKEN: "tok",
        ANTHROPIC_API_KEY: "key",
        DISABLE_TELEMETRY: "1",
        ANTHROPIC_MODEL: "m",
        ANTHROPIC_CUSTOM_HEADERS: "X-A: 1\nX-B: 2",
        HTTPS_PROXY: "http://proxy.local:3128",
      },
      { skipDangerousModePermissionPrompt: true }
    );
    const result = await createPlatformAgentSettingsLoader().load(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.settings.env).toEqual({
        ANTHROPIC_AUTH_TOKEN: "tok",
        ANTHROPIC_API_KEY: "key",
        DISABLE_TELEMETRY: "1",
        ANTHROPIC_MODEL: "m",
        ANTHROPIC_CUSTOM_HEADERS: "X-A: 1\nX-B: 2",
        HTTPS_PROXY: "http://proxy.local:3128",
      });
      expect(result.settings.summary).toEqual({
        hasProxy: true,
        hasExtraCa: false,
        customHeaderCount: 2,
        hasCustomModel: true,
        hasCustomBaseUrl: false,
      });
    }
  });

  it("accepts the api key alone", async () => {
    const file = await writeSettings({ ANTHROPIC_API_KEY: "key" });
    const result = await createPlatformAgentSettingsLoader().load(file);
    expect(result.ok).toBe(true);
  });

  it("rejects an invalid proxy and base url", async () => {
    const proxyFile = await writeSettings({
      ANTHROPIC_API_KEY: "k",
      HTTPS_PROXY: "not a url",
    });
    expect(await createPlatformAgentSettingsLoader().load(proxyFile)).toEqual({
      ok: false,
      reason: PlatformAgentDisabledReason.ProxyUrlInvalid,
    });
    const baseFile = await writeSettings({
      ANTHROPIC_API_KEY: "k",
      ANTHROPIC_BASE_URL: "ftp://x",
    });
    expect(await createPlatformAgentSettingsLoader().load(baseFile)).toEqual({
      ok: false,
      reason: PlatformAgentDisabledReason.BaseUrlInvalid,
    });
  });

  it("loads a relative CA bundle with two certificates", async () => {
    await writeFile(path.join(dir, "ca.crt"), `${PEM_ONE}\n${PEM_TWO}\n`);
    const file = await writeSettings({
      ANTHROPIC_API_KEY: "k",
      NODE_EXTRA_CA_CERTS: "ca.crt",
    });
    const result = await createPlatformAgentSettingsLoader().load(file);
    expect(result.ok && result.settings.env.NODE_EXTRA_CA_CERTS).toBe(
      path.resolve(dir, "ca.crt")
    );
    expect(result.ok && result.settings.summary.hasExtraCa).toBe(true);
  });

  it("falls back to the CA next to the settings for a foreign absolute path", async () => {
    await writeFile(path.join(dir, "ca_179.crt"), PEM_ONE);
    const file = await writeSettings({
      ANTHROPIC_API_KEY: "k",
      NODE_EXTRA_CA_CERTS: String.raw`C:\Users\x\.claude\ca_179.crt`,
    });
    const result = await createPlatformAgentSettingsLoader().load(file);
    expect(result.ok && result.settings.env.NODE_EXTRA_CA_CERTS).toBe(
      path.join(dir, "ca_179.crt")
    );
  });

  it("reports a missing and an invalid CA", async () => {
    const file = await writeSettings({
      ANTHROPIC_API_KEY: "k",
      NODE_EXTRA_CA_CERTS: "ca.crt",
    });
    expect(await createPlatformAgentSettingsLoader().load(file)).toEqual({
      ok: false,
      reason: PlatformAgentDisabledReason.CaFileMissing,
    });
    await writeFile(path.join(dir, "ca.crt"), "garbage");
    expect(await createPlatformAgentSettingsLoader().load(file)).toEqual({
      ok: false,
      reason: PlatformAgentDisabledReason.CaFileInvalid,
    });
  });

  it("reloads when the settings file changes", async () => {
    const file = await writeSettings({ ANTHROPIC_AUTH_TOKEN: "old" });
    const loader = createPlatformAgentSettingsLoader();
    const first = await loader.load(file);
    expect(await loader.load(file)).toBe(first);
    await writeFile(
      file,
      JSON.stringify({ env: { ANTHROPIC_AUTH_TOKEN: "new-token" } })
    );
    const future = new Date(Date.now() + 1000);
    await utimes(file, future, future);
    const second = await loader.load(file);
    expect(second.ok && second.settings.env.ANTHROPIC_AUTH_TOKEN).toBe(
      "new-token"
    );
  });
});

describe("isHttpUrl", () => {
  it("accepts http(s) only", () => {
    expect(isHttpUrl("https://x")).toBe(true);
    expect(isHttpUrl("HTTP://x/v1")).toBe(true);
    expect(isHttpUrl("ftp://x")).toBe(false);
    expect(isHttpUrl("x")).toBe(false);
  });
});

describe("parseCustomHeaders", () => {
  it("parses lines, keeps colons in values and counts invalid lines", () => {
    const parsed = parseCustomHeaders(
      "X-Api-Key:pk_1\r\nX-Url: https://a:1\n\nbad line\n: nope"
    );
    expect(parsed.headers).toEqual({
      "X-Api-Key": "pk_1",
      "X-Url": "https://a:1",
    });
    expect(parsed.invalidLineCount).toBe(2);
  });
});

describe("resolveCaPath and toCaPems", () => {
  it("resolves relative paths against the settings directory", async () => {
    const resolved = await resolveCaPath(dir, "ca.crt");
    expect(resolved).toEqual({
      path: path.resolve(dir, "ca.crt"),
      fellBack: false,
    });
  });

  it("parses DER and rejects garbage", () => {
    const der = new X509Certificate(PEM_ONE).raw;
    expect(toCaPems(der)).toHaveLength(1);
    expect(toCaPems(Buffer.from("garbage"))).toBeNull();
  });
});
