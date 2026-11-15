import { onTestFinished, vi } from "vitest";
import type { LogRecordInput } from "../log-sink";

// Generic module-with-fetch importer: stub fetch, reset the module graph, then
// dynamically import the caller-supplied module. Used directly by tests that
// need to re-import sibling modules under the same fresh-module guarantee.
export function importModuleWithFetch<T>(
  fetchMock: ReturnType<typeof vi.fn>,
  importFn: () => Promise<T>
): Promise<T> {
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  return importFn();
}

// Import a module from a fresh module graph with a log-record sink registered
// first, so every record the code under test emits is captured in `records`.
export async function importModuleWithSink<T>(
  importFn: () => Promise<T>
): Promise<{ mod: T; records: LogRecordInput[] }> {
  vi.resetModules();
  const sink = await import("../log-sink");
  const records: LogRecordInput[] = [];
  sink.setLogRecordSink((record) => {
    records.push(record);
  });
  onTestFinished(sink.resetLogRecordSink);
  const mod = await importFn();
  return { mod, records };
}

export async function importLogWithSink(): Promise<{
  log: typeof import("../log")["log"];
  records: LogRecordInput[];
}> {
  const { mod, records } = await importModuleWithSink(() => import("../log"));
  return { log: mod.log, records };
}

// Delete an env var for the current test and register a restore callback so
// the parent environment's value is reinstated when the test finishes —
// even on failure. vi.unstubAllEnvs() does NOT restore keys mutated by
// Reflect.deleteProperty, so a bare delete would leak into sibling tests in
// the same worker whenever the runner starts with the key defined.
export function deleteEnvForTest(...keys: readonly string[]): void {
  const originals: [string, string | undefined][] = keys.map((key) => [
    key,
    process.env[key],
  ]);
  for (const key of keys) {
    Reflect.deleteProperty(process.env, key);
  }
  onTestFinished(() => {
    for (const [key, value] of originals) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key);
      } else {
        process.env[key] = value;
      }
    }
  });
}
