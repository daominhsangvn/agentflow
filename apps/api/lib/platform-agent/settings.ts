import { X509Certificate } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { PlatformAgentDisabledReason } from "@repo/api/src/types/platform-agent";
import { log } from "@repo/observability/log";
import { z } from "zod";

export type PlatformAgentSettings = {
  /** The file's whole `env` block, with `NODE_EXTRA_CA_CERTS` resolved to an absolute path. */
  env: Record<string, string>;
  summary: {
    hasProxy: boolean;
    hasExtraCa: boolean;
    customHeaderCount: number;
    hasCustomModel: boolean;
    hasCustomBaseUrl: boolean;
  };
};

export type PlatformAgentSettingsResult =
  | { ok: true; settings: PlatformAgentSettings }
  | { ok: false; reason: PlatformAgentDisabledReason };

export type PlatformAgentSettingsLoader = {
  load(settingsFile: string): Promise<PlatformAgentSettingsResult>;
};

const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const PEM_CERTIFICATE_PATTERN =
  /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const HTTP_URL_PATTERN = /^https?:\/\//i;
const LINE_BREAK_PATTERN = /\r?\n/;
const MISSING_STAMP = "missing";
const NO_CA_STAMP = "none";

const settingsFileSchema = z.looseObject({
  env: z.record(z.string(), z.string()).optional(),
});
const proxyUrlSchema = z.url();

type FsError = { code?: string; name?: string };

type SettingsStat =
  | { kind: "ok"; key: string }
  | { kind: "error"; reason: PlatformAgentDisabledReason; name: string };

type DiskLoad = {
  result: PlatformAgentSettingsResult;
  caPath: string | null;
  caKey: string;
  errorName: string;
};

type LoaderCache = {
  file: string;
  settingsKey: string;
  caPath: string | null;
  caKey: string;
  result: PlatformAgentSettingsResult;
};

export function createPlatformAgentSettingsLoader(): PlatformAgentSettingsLoader {
  let cache: LoaderCache | null = null;

  async function load(
    settingsFile: string
  ): Promise<PlatformAgentSettingsResult> {
    const settingsStat = await statSettingsKey(settingsFile);
    if (settingsStat.kind === "error") {
      return rememberFailure(settingsFile, settingsStat);
    }
    if (
      cache?.file === settingsFile &&
      cache.settingsKey === settingsStat.key
    ) {
      const caKey = cache.caPath ? await statKey(cache.caPath) : NO_CA_STAMP;
      if (caKey === cache.caKey) {
        return cache.result;
      }
    }
    const loaded = await loadFromDisk(settingsFile);
    cache = {
      file: settingsFile,
      settingsKey: settingsStat.key,
      caPath: loaded.caPath,
      caKey: loaded.caKey,
      result: loaded.result,
    };
    logSettingsOutcome(loaded.result, loaded.errorName);
    return loaded.result;
  }

  function rememberFailure(
    settingsFile: string,
    settingsStat: Extract<SettingsStat, { kind: "error" }>
  ): PlatformAgentSettingsResult {
    const previous = cache;
    const result = fail(settingsStat.reason);
    cache = {
      file: settingsFile,
      settingsKey: MISSING_STAMP,
      caPath: null,
      caKey: NO_CA_STAMP,
      result,
    };
    const unchanged =
      previous?.file === settingsFile &&
      previous.settingsKey === MISSING_STAMP &&
      !previous.result.ok &&
      previous.result.reason === settingsStat.reason;
    if (!unchanged) {
      logSettingsOutcome(result, settingsStat.name);
    }
    return result;
  }

  return { load };
}

export function isHttpUrl(raw: string): boolean {
  return HTTP_URL_PATTERN.test(raw.trim());
}

export function parseCustomHeaders(raw?: string): {
  headers: Record<string, string>;
  invalidLineCount: number;
} {
  const headers: Record<string, string> = {};
  let invalidLineCount = 0;
  for (const line of (raw ?? "").split(LINE_BREAK_PATTERN)) {
    if (line.trim() === "") {
      continue;
    }
    const separator = line.indexOf(":");
    const name = separator > 0 ? line.slice(0, separator).trim() : "";
    const value = separator > 0 ? line.slice(separator + 1).trim() : "";
    if (HEADER_NAME_PATTERN.exec(name) === null || value === "") {
      invalidLineCount += 1;
      continue;
    }
    headers[name] = value;
  }
  return { headers, invalidLineCount };
}

/**
 * Resolves the configured CA path. A relative path is anchored at the settings
 * directory. An absolute path that does not exist on this machine (for example a
 * Windows path copied from a developer laptop) falls back to the same file name
 * next to the settings file.
 */
export async function resolveCaPath(
  settingsDir: string,
  configured: string
): Promise<{ path: string; fellBack: boolean }> {
  const isAbsolute =
    path.isAbsolute(configured) || path.win32.isAbsolute(configured);
  if (!isAbsolute) {
    return { path: path.resolve(settingsDir, configured), fellBack: false };
  }
  if ((await statKey(configured)) !== MISSING_STAMP) {
    return { path: configured, fellBack: false };
  }
  return {
    path: path.join(settingsDir, path.win32.basename(configured)),
    fellBack: true,
  };
}

export function toCaPems(buffer: Buffer): string[] | null {
  try {
    const text = buffer.toString("latin1");
    const blocks = [...text.matchAll(PEM_CERTIFICATE_PATTERN)].map(
      (match) => match[0]
    );
    if (blocks.length > 0) {
      for (const block of blocks) {
        new X509Certificate(block);
      }
      return blocks;
    }
    return [new X509Certificate(buffer).toString()];
  } catch {
    // observability: an unparseable CA is reported by the caller as ca_file_invalid
    return null;
  }
}

function fail(
  reason: PlatformAgentDisabledReason
): PlatformAgentSettingsResult {
  return { ok: false, reason };
}

async function statSettingsKey(file: string): Promise<SettingsStat> {
  try {
    const info = await stat(file);
    return { kind: "ok", key: `${info.mtimeMs}:${info.size}` };
  } catch (error) {
    const fsError = error as FsError;
    return {
      kind: "error",
      reason:
        fsError.code === "ENOENT"
          ? PlatformAgentDisabledReason.SettingsFileMissing
          : PlatformAgentDisabledReason.SettingsFileUnreadable,
      name: fsError.name ?? "Error",
    };
  }
}

async function statKey(file: string): Promise<string> {
  try {
    const info = await stat(file);
    return `${info.mtimeMs}`;
  } catch {
    // observability: a missing CA is surfaced as ca_file_missing by the loader
    return MISSING_STAMP;
  }
}

function failedLoad(
  reason: PlatformAgentDisabledReason,
  errorName = ""
): DiskLoad {
  return {
    result: fail(reason),
    caPath: null,
    caKey: NO_CA_STAMP,
    errorName,
  };
}

async function loadFromDisk(settingsFile: string): Promise<DiskLoad> {
  let raw: string;
  try {
    raw = await readFile(settingsFile, "utf8");
  } catch (error) {
    return failedLoad(
      PlatformAgentDisabledReason.SettingsFileUnreadable,
      (error as FsError).name
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    return failedLoad(
      PlatformAgentDisabledReason.SettingsInvalidJson,
      (error as FsError).name
    );
  }
  const parsed = settingsFileSchema.safeParse(json);
  if (!parsed.success) {
    return failedLoad(PlatformAgentDisabledReason.SettingsInvalid, "ZodError");
  }
  const env = parsed.data.env ?? {};
  const base = buildBaseSettings(env);
  if (!base.ok) {
    return failedLoad(base.reason);
  }
  const caConfigured = nonEmpty(env.NODE_EXTRA_CA_CERTS);
  if (!caConfigured) {
    return {
      result: { ok: true, settings: base.settings },
      caPath: null,
      caKey: NO_CA_STAMP,
      errorName: "",
    };
  }
  return await loadWithCa({
    settingsFile,
    caConfigured,
    settings: base.settings,
  });
}

async function loadWithCa(input: {
  settingsFile: string;
  caConfigured: string;
  settings: PlatformAgentSettings;
}): Promise<DiskLoad> {
  const resolved = await resolveCaPath(
    path.dirname(input.settingsFile),
    input.caConfigured
  );
  if (resolved.fellBack) {
    log.warn("platform_agent.ca_path_fallback", {
      reason: "ca_absolute_path_missing",
      error: null,
    });
  }
  const caKey = await statKey(resolved.path);
  const failed = (
    reason: PlatformAgentDisabledReason,
    errorName = ""
  ): DiskLoad => ({
    result: fail(reason),
    caPath: resolved.path,
    caKey,
    errorName,
  });
  if (caKey === MISSING_STAMP) {
    return failed(PlatformAgentDisabledReason.CaFileMissing);
  }
  let buffer: Buffer;
  try {
    buffer = await readFile(resolved.path);
  } catch (error) {
    return failed(
      PlatformAgentDisabledReason.CaFileMissing,
      (error as FsError).name
    );
  }
  if (!toCaPems(buffer)) {
    return failed(PlatformAgentDisabledReason.CaFileInvalid);
  }
  return {
    result: {
      ok: true,
      settings: {
        ...input.settings,
        env: { ...input.settings.env, NODE_EXTRA_CA_CERTS: resolved.path },
        summary: { ...input.settings.summary, hasExtraCa: true },
      },
    },
    caPath: resolved.path,
    caKey,
    errorName: "",
  };
}

function buildBaseSettings(
  env: Record<string, string>
):
  | { ok: true; settings: PlatformAgentSettings }
  | { ok: false; reason: PlatformAgentDisabledReason } {
  if (
    !(nonEmpty(env.ANTHROPIC_AUTH_TOKEN) ?? nonEmpty(env.ANTHROPIC_API_KEY))
  ) {
    return { ok: false, reason: PlatformAgentDisabledReason.TokenMissing };
  }
  const baseUrl = nonEmpty(env.ANTHROPIC_BASE_URL);
  if (baseUrl !== undefined && !isHttpUrl(baseUrl)) {
    return { ok: false, reason: PlatformAgentDisabledReason.BaseUrlInvalid };
  }
  const proxyUrls = [nonEmpty(env.HTTP_PROXY), nonEmpty(env.HTTPS_PROXY)];
  for (const url of proxyUrls) {
    if (url !== undefined && !proxyUrlSchema.safeParse(url).success) {
      return {
        ok: false,
        reason: PlatformAgentDisabledReason.ProxyUrlInvalid,
      };
    }
  }
  return {
    ok: true,
    settings: {
      env: { ...env },
      summary: {
        hasProxy: proxyUrls.some((url) => url !== undefined),
        hasExtraCa: false,
        customHeaderCount: Object.keys(
          parseCustomHeaders(env.ANTHROPIC_CUSTOM_HEADERS).headers
        ).length,
        hasCustomModel: nonEmpty(env.ANTHROPIC_MODEL) !== undefined,
        hasCustomBaseUrl: baseUrl !== undefined,
      },
    },
  };
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function logSettingsOutcome(
  result: PlatformAgentSettingsResult,
  errorName: string
): void {
  if (result.ok) {
    log.info("platform_agent.settings_loaded", { ...result.settings.summary });
    return;
  }
  log.error("platform_agent.settings_rejected", {
    reason: result.reason,
    error: { name: errorName },
  });
}
