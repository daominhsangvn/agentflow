const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Compact active agent time: `45s`, `12m`, `1h 30m`, `1d 2h`. Null, negative or
 * non-finite input renders `-` (unknown is not zero).
 */
export function formatActiveTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) {
    return "-";
  }
  if (ms < MINUTE_MS) {
    return `${Math.floor(ms / SECOND_MS)}s`;
  }
  if (ms < HOUR_MS) {
    return `${Math.floor(ms / MINUTE_MS)}m`;
  }
  if (ms < DAY_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
    return `${hours}h ${minutes}m`;
  }
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
  return `${days}d ${hours}h`;
}
