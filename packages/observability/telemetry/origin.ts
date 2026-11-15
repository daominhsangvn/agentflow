// ---------------------------------------------------------------------------
// Origin — identifies which service process emitted a telemetry event.
// Resolved once at module load from OTEL_SERVICE_NAME; never re-read.
// ---------------------------------------------------------------------------

export const Origin = {
  Desktop: "desktop",
  Api: "api",
  Relay: "relay",
  Mcp: "mcp",
  Unknown: "unknown",
} as const;

export type Origin = (typeof Origin)[keyof typeof Origin];

// Whitelist of origins that identify a real service process.
// Excludes `Origin.Unknown` — that value is the fallback sentinel for
// misconfigured/absent `OTEL_SERVICE_NAME`, not a valid service identity. Exported
// so `log.ts`'s `buildEntry()` meta-override check and this module-load
// `OTEL_SERVICE_NAME` match share a single source of truth.
export const KNOWN_ORIGINS: readonly Origin[] = Object.values(Origin).filter(
  (v) => v !== Origin.Unknown
);

function resolveOrigin(): Origin {
  const serviceName = process.env.OTEL_SERVICE_NAME;
  const normalized = serviceName?.startsWith("af-")
    ? serviceName.slice(3)
    : serviceName;

  const matched = KNOWN_ORIGINS.find((o) => o === normalized);

  if (matched !== undefined) {
    return matched;
  }

  // Use console.warn directly to avoid circular import with ../log. That same
  // cycle is why the severity is a literal rather than `LogLevel.Warn`: log.ts
  // evaluates this module while its own consts are still in TDZ.
  // Guarded to server-only: in browser bundles OTEL_SERVICE_NAME is never
  // defined (not a NEXT_PUBLIC_ var), so firing the warning on every client
  // page load would pollute end-user DevTools consoles with an ops-level signal.
  if (globalThis.window === undefined) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "telemetry.origin_fallback",
        message:
          "observability: OTEL_SERVICE_NAME did not match a known origin; defaulting to 'unknown'",
        OTEL_SERVICE_NAME: serviceName,
        stripped: normalized,
      })
    );
  }

  return Origin.Unknown;
}

export const ORIGIN: Origin = resolveOrigin();
