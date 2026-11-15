// ---------------------------------------------------------------------------
// Process-wide registry slots.
//
// A single process can load several copies of this package (Next bundles
// workspace packages while a custom server loads them from node_modules). Any
// state that `initTelemetry` writes and other modules read must therefore live
// on `globalThis` under a `Symbol.for` key, or each copy sees its own empty
// registry. This module is browser-safe: it imports nothing.
// ---------------------------------------------------------------------------

const KEY_PREFIX = "agentflow.observability.";

type Slot<T> = { value: T };

/** Get (creating on first use) the process-wide slot named `name`. */
export function globalSlot<T>(name: string, initial: () => T): Slot<T> {
  const key = Symbol.for(`${KEY_PREFIX}${name}`);
  let slot: Slot<T> | undefined = Reflect.get(globalThis, key);
  if (!slot) {
    slot = { value: initial() };
    Reflect.set(globalThis, key, slot);
  }
  return slot;
}
