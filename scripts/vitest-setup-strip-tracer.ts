/**
 * Vitest setup file: removes the dd-trace preload tokens from `NODE_OPTIONS`
 * inside each worker, so a child process a test spawns (often with a temp
 * `cwd`) does not inherit `-r dd-trace/ci/init` and fail with
 * `Cannot find module 'dd-trace/ci/init'`. The token list lives in
 * `tracer-preload-tokens.mjs`; `apps/desktop/scripts/node-test-lane-settings.mjs`
 * applies the same rule before spawning the legacy node:test pool.
 *
 * Exports nothing: importing it strips `process.env` as a side effect. Only
 * the tracer tokens go; everything else in `NODE_OPTIONS` stays.
 */

import { TRACER_PRELOAD_TOKENS } from "./tracer-preload-tokens.mjs";

const nodeOptions = process.env.NODE_OPTIONS;

if (nodeOptions !== undefined && nodeOptions.length > 0) {
  let stripped = nodeOptions;
  for (const token of TRACER_PRELOAD_TOKENS) {
    stripped = stripped.replaceAll(token, "");
  }
  stripped = stripped.replaceAll(/\s+/g, " ").trim();
  if (stripped.length > 0) {
    process.env.NODE_OPTIONS = stripped;
  } else {
    Reflect.deleteProperty(process.env, "NODE_OPTIONS");
  }
}
