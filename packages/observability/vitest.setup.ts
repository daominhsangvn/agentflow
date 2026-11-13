import { afterEach } from "vitest";

// Set OTEL_SERVICE_NAME before any observability module is imported so that
// the module-level ORIGIN constant resolves to a known value in tests.
process.env.OTEL_SERVICE_NAME = "api";

// Registries live on globalThis (shared across module copies), so
// `vi.resetModules()` no longer isolates them between tests. Reset the VALUES
// in place: already-loaded modules keep a reference to the slot object.
const REGISTRY_DEFAULTS: Record<string, unknown> = {
  "log-sink": undefined,
  "trace-context": () => undefined,
  "flush-hook": undefined,
};

afterEach(() => {
  for (const [name, initial] of Object.entries(REGISTRY_DEFAULTS)) {
    const slot = Reflect.get(
      globalThis,
      Symbol.for(`agentflow.observability.${name}`)
    );
    if (slot) {
      slot.value = initial;
    }
  }
});
