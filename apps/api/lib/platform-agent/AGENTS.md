# Platform Agent Guidelines

Headless Claude Code runs (`claude -p`) spawned from `apps/api`, opt-in via `PLATFORM_AGENT_SETTINGS_FILE`.
This is a deliberate exception to the rule that CLI processes are spawned only through the desktop gateway:
read-only tools in a temp work dir, no shell, no MCP, minimal environment. Do not widen it (no git, no
repo access, no write tools). The first consumer is the workflow builder (`apps/api/app/ai/workflow-builder/`).

## Modules

- `settings.ts` loads and validates the settings file, resolves the CA path, reports `PlatformAgentSettings`.
- `claude-code.ts` finds the `claude` binary (explicit path, PATH, or `~/.local/share/claude/versions/<v>`)
  and checks the pinned version; never installs anything.
- `child-env.ts` builds the child environment: base allowlist + settings `env` + isolated `CLAUDE_CONFIG_DIR`.
- `work-dir.ts` creates and removes the per-run temp dir (`work/` cwd, sibling `config/`).
- `cli-runner.ts` argv, spawn, timeout/abort, process-tree kill (`process-tree.ts`); `stream-json.ts` reads output.
- `run-slots.ts` concurrency cap; `agent-run.ts` ties work dir, env and runner into `runPlatformAgent`.

## Rules

- No feature knowledge here: system prompt, files, tools, turn cap and timeout are parameters.
- No `@/env` and no database access; callers pass configuration in.
- argv never carries user text: the prompt goes on stdin. Spawn with an argv array, never a shell.
- The child env is an allowlist plus the settings `env`; never set anything process-wide.
- The consumer chooses the tools; every run goes through the run slots.
- Kill the whole process tree on timeout and abort; remove the temp dir in `finally`.
- Never log or return settings values, CLI stderr or result text; log ids and a snake_case `reason`.
- Disabled reasons live in `packages/api/src/types/platform-agent.ts`; feature contracts spread them.
- The settings loader, Claude Code resolver and run slots are singletons in the first consumer's `service.ts`.
  Move them to a shared composition when a second consumer appears.
