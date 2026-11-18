/**
 * Why the platform agent (headless Claude Code runner in `apps/api/lib/platform-agent/`) cannot
 * run. Feature status contracts include these values. Never carries settings values.
 */
export const PlatformAgentDisabledReason = {
  SettingsFileMissing: "settings_file_missing",
  SettingsFileUnreadable: "settings_file_unreadable",
  SettingsInvalidJson: "settings_invalid_json",
  SettingsInvalid: "settings_invalid",
  TokenMissing: "token_missing",
  BaseUrlInvalid: "base_url_invalid",
  ProxyUrlInvalid: "proxy_url_invalid",
  CaFileMissing: "ca_file_missing",
  CaFileInvalid: "ca_file_invalid",
  ClaudeCodeMissing: "claude_code_missing",
  ClaudeCodeVersionMismatch: "claude_code_version_mismatch",
} as const;
export type PlatformAgentDisabledReason =
  (typeof PlatformAgentDisabledReason)[keyof typeof PlatformAgentDisabledReason];
