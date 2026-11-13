// Dependency-free on purpose: `rejected-command-loop-failure.ts` is reached from the
// desktop gateway socket server, which runs under tsx outside Next.js. Importing these
// from `launch-failure-cleanup.ts` pulled `@/app/loops/service` and, through it, a
// `server-only` module into that graph and crashed `server.ts` at startup.

/** Which failure helper wrote the `loop.fail` span (low-cardinality). */
export const LoopFailKind = {
  WithError: "with_error",
  AfterLaunch: "after_launch",
  RejectedCommand: "rejected_command",
  TerminalCommandError: "terminal_command_error",
} as const;
export type LoopFailKind = (typeof LoopFailKind)[keyof typeof LoopFailKind];

export const LOOP_FAIL_KIND_ATTRIBUTE = "af.loop.fail_kind";
