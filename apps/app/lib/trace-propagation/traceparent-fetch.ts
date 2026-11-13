import type { ApiTransportFetch } from "@repo/app/shared/api/api-adapter";

const TRACE_ID_BYTES = 16;
const SPAN_ID_BYTES = 8;
const TRACEPARENT_HEADER = "traceparent";
const ALL_ZERO_RE = /^0+$/;

type RandomBytes = (length: number) => Uint8Array;

/**
 * Fetch that stamps a W3C `traceparent` header on each request so api server
 * spans join a browser-originated trace id. No browser SDK is involved.
 */
export const traceparentFetch: ApiTransportFetch = (input, init) => {
  const headers = new Headers(init?.headers);
  if (!headers.has(TRACEPARENT_HEADER)) {
    headers.set(TRACEPARENT_HEADER, createTraceparent());
  }
  return globalThis.fetch(input, { ...init, headers });
};

/** Builds `00-<trace id>-<span id>-01`; all-zero ids are invalid and regenerated. */
export function createTraceparent(
  random: RandomBytes = (length) =>
    globalThis.crypto.getRandomValues(new Uint8Array(length))
): string {
  return `00-${randomHex(random, TRACE_ID_BYTES)}-${randomHex(random, SPAN_ID_BYTES)}-01`;
}

function randomHex(random: RandomBytes, length: number): string {
  let hex = "";
  do {
    hex = Array.from(random(length), (byte) =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  } while (ALL_ZERO_RE.test(hex));
  return hex;
}
