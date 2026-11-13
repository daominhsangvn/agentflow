import http from "node:http";
import type { AddressInfo } from "node:net";
import { KeylessTelemetrySignal } from "@repo/shared-platform/keyless-telemetry";
import { gatewayLog } from "../main/logging/gateway-logger.js";
import {
  makeOtlpReceiverUnavailableState,
  OtlpReceiverUnavailableReason,
  setOtlpReceiverStateForProcess,
} from "../main/telemetry/otlp-receiver-state.js";

const LOG_TAG = "headless-otlp-forwarder";
const LOOPBACK_HOST = "127.0.0.1";
const MAX_BODY_BYTES = 512 * 1024;
const READ_DEADLINE_MS = 5000;
const MAX_IN_FLIGHT = 8;
const RETRY_AFTER_SECONDS = "5";
const PROTOBUF_CONTENT_TYPE = "application/x-protobuf";

const SIGNAL_BY_PATH: Record<string, KeylessTelemetrySignal> = {
  "/v1/traces": KeylessTelemetrySignal.Traces,
  "/v1/logs": KeylessTelemetrySignal.Logs,
  "/v1/metrics": KeylessTelemetrySignal.Metrics,
};

export type HeadlessOtlpForwarder = {
  port: number;
  stop(): Promise<void>;
};

/**
 * Loopback OTLP/HTTP receiver for the CLIs the runner spawns (Claude Code).
 * It forwards protobuf bodies through the runner's own telemetry transport so
 * the API key never reaches the child process.
 */
export async function startHeadlessOtlpForwarder(options: {
  exportSignal: (
    signal: KeylessTelemetrySignal,
    body: Uint8Array
  ) => Promise<boolean>;
}): Promise<HeadlessOtlpForwarder> {
  let inFlight = 0;
  let warned = false;

  const forward = async (
    signal: KeylessTelemetrySignal,
    body: Uint8Array,
    response: http.ServerResponse
  ): Promise<void> => {
    try {
      const exported = await options.exportSignal(signal, body);
      if (!(exported || warned)) {
        warned = true;
        gatewayLog.warn(LOG_TAG, "OTLP forward was refused by the transport");
      }
    } catch (error) {
      if (!warned) {
        warned = true;
        gatewayLog.warn(
          LOG_TAG,
          `OTLP forward failed: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    } finally {
      inFlight -= 1;
    }
    reply(response, 200);
  };

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${LOOPBACK_HOST}`);
    const signal = SIGNAL_BY_PATH[url.pathname];
    if (request.method !== "POST" || !signal) {
      reply(response, 404);
      request.resume();
      return;
    }
    const contentType = request.headers["content-type"] ?? "";
    if (!contentType.toLowerCase().startsWith(PROTOBUF_CONTENT_TYPE)) {
      reply(response, 415);
      request.resume();
      return;
    }
    if (inFlight >= MAX_IN_FLIGHT) {
      reply(response, 503, { "Retry-After": RETRY_AFTER_SECONDS });
      request.resume();
      return;
    }
    inFlight += 1;
    readBounded(request).then(
      (body) => forward(signal, body, response),
      (status: number) => {
        inFlight -= 1;
        reply(response, status);
      }
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, LOOPBACK_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  setOtlpReceiverStateForProcess({
    available: true,
    host: LOOPBACK_HOST,
    port,
  });

  return {
    port,
    stop: async () => {
      setOtlpReceiverStateForProcess(
        makeOtlpReceiverUnavailableState(OtlpReceiverUnavailableReason.Stopped)
      );
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}

/** Rejects with the HTTP status to answer (413 oversize, 408 slow, 400 aborted). */
function readBounded(request: http.IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      action();
    };
    const timer = setTimeout(() => {
      finish(() => {
        request.pause();
        reject(408);
      });
    }, READ_DEADLINE_MS);
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        finish(() => {
          request.pause();
          reject(413);
        });
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => finish(() => resolve(Buffer.concat(chunks))));
    request.on("error", () => finish(() => reject(400)));
    request.on("aborted", () => finish(() => reject(400)));
  });
}

function reply(
  response: http.ServerResponse,
  status: number,
  headers: Record<string, string> = {}
): void {
  if (response.headersSent) {
    return;
  }
  response.writeHead(status, { "Content-Length": "0", ...headers });
  response.end();
}
