/** Any env-shaped record (`process.env` is assignable). */
export type EnvLike = Record<string, string | undefined>;

/**
 * Environment for the Claude Code child process: an explicit allowlist of base variables plus the
 * settings `env` block. Nothing else from the api process is inherited.
 */
export const CLAUDE_CHILD_BASE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "TEMP",
  "TMP",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "SYSTEMDRIVE",
  "COMSPEC",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "COMMONPROGRAMFILES",
  "COMMONPROGRAMFILES(X86)",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "OS",
  "COMPUTERNAME",
  "USERNAME",
  "USERDOMAIN",
  "CLAUDE_CODE_GIT_BASH_PATH",
] as const;

const ALLOWED_KEYS = new Set<string>(CLAUDE_CHILD_BASE_ENV_KEYS);

export function pickBaseEnv(
  baseEnv: EnvLike,
  platform: NodeJS.Platform = process.platform
): Record<string, string> {
  const picked: Record<string, string> = {};
  const caseInsensitive = platform === "win32";
  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value !== "string") {
      continue;
    }
    const probe = caseInsensitive ? key.toUpperCase() : key;
    if (ALLOWED_KEYS.has(probe)) {
      picked[key] = value;
    }
  }
  return picked;
}

export function buildClaudeChildEnv(input: {
  baseEnv: EnvLike;
  settingsEnv: Record<string, string>;
  configDir: string;
  platform?: NodeJS.Platform;
}): Record<string, string> {
  const platform = input.platform ?? process.platform;
  const base = pickBaseEnv(input.baseEnv, platform);
  if (platform === "win32") {
    const settingsKeys = new Set(
      Object.keys(input.settingsEnv).map((key) => key.toUpperCase())
    );
    for (const key of Object.keys(base)) {
      if (settingsKeys.has(key.toUpperCase())) {
        delete base[key];
      }
    }
  }
  return {
    ...base,
    ...input.settingsEnv,
    CLAUDE_CONFIG_DIR: input.configDir,
    DISABLE_AUTOUPDATER: "1",
  };
}

export function buildProbeEnv(
  baseEnv: EnvLike,
  platform: NodeJS.Platform = process.platform
): Record<string, string> {
  return { ...pickBaseEnv(baseEnv, platform), DISABLE_AUTOUPDATER: "1" };
}
