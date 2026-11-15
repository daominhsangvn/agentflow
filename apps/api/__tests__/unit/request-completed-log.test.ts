import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { log } from "@repo/observability/log";
import {
  buildRequestCompletedContractAttributes,
  REQUEST_COMPLETED_CONTRACT_EVENT_NAME,
} from "@repo/observability/telemetry/request-completed";
import { afterEach, describe, expect, it, vi } from "vitest";
import { trackRequestCompleted } from "@/lib/observability/request-completed-log";

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeResponse(
  statusCode: number,
  writableFinished: boolean,
  headers: Record<string, string> = {}
) {
  return Object.assign(new EventEmitter(), {
    statusCode,
    writableFinished,
    getHeader: (name: string) => headers[name.toLowerCase()],
    write: vi.fn(() => true),
    end: vi.fn(function end(this: unknown) {
      return this;
    }),
  }) as unknown as ServerResponse;
}

function failedRequest(
  statusCode: number,
  body: string,
  headers: Record<string, string> = { "content-type": "application/json" },
  path = "/x"
) {
  const request = { url: path, method: "GET" } as unknown as IncomingMessage;
  const response = fakeResponse(statusCode, true, headers);
  trackRequestCompleted(request, response, () => 1);
  response.end(body);
  response.emit("close");
}

describe("trackRequestCompleted", () => {
  // ISS-5039: exactly ONE log line per request, contract attributes included.
  it("emits one log line carrying both the snake_case and contract fields", () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
    const now = vi.fn().mockReturnValueOnce(125).mockReturnValueOnce(150);
    const request = {
      url: "/loops?secret=x",
      method: "POST",
    } as unknown as IncomingMessage;
    const response = fakeResponse(201, true);

    trackRequestCompleted(request, response, now);
    response.emit("close");

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith("request_completed", {
      ...buildRequestCompletedContractAttributes({
        requestUrl: "http://api.internal/loops?secret=x",
        method: "POST",
        statusCode: 201,
        durationMs: 25,
      }),
      path: "/loops",
      method: "POST",
      status_code: 201,
      duration_ms: 25,
    });
    expect(info).not.toHaveBeenCalledWith(
      REQUEST_COMPLETED_CONTRACT_EVENT_NAME,
      expect.anything()
    );
  });

  it("marks aborted only when the response did not finish", () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
    const request = { url: "/x", method: "GET" } as unknown as IncomingMessage;
    const response = fakeResponse(200, false);

    trackRequestCompleted(request, response, () => 1);
    response.emit("close");

    expect(info).toHaveBeenCalledWith(
      "request_completed",
      expect.objectContaining({ aborted: true })
    );
  });

  it("logs a 404 JSON body reason at info", () => {
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
    failedRequest(404, JSON.stringify({ error: "Not found" }));
    expect(info).toHaveBeenCalledWith(
      "request_completed",
      expect.objectContaining({ reason: "Not found", status_code: 404 })
    );
  });

  it("logs a 500 at warn with the reason", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    failedRequest(500, JSON.stringify({ error: "boom" }));
    expect(warn).toHaveBeenCalledWith(
      "request_completed",
      expect.objectContaining({ reason: "boom", status_code: 500 })
    );
  });

  it("logs a hot path success at debug", () => {
    const debug = vi.spyOn(log, "debug").mockImplementation(() => undefined);
    const info = vi.spyOn(log, "info").mockImplementation(() => undefined);
    failedRequest(200, "", {}, "/cron/workflows");
    expect(debug).toHaveBeenCalledWith(
      "request_completed",
      expect.objectContaining({ status_code: 200 })
    );
    expect(info).not.toHaveBeenCalled();
  });

  it("falls back to the status for an encoded body", () => {
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    failedRequest(500, "not-json", {
      "content-type": "application/json",
      "content-encoding": "gzip",
    });
    expect(warn).toHaveBeenCalledWith(
      "request_completed",
      expect.objectContaining({ reason: "HTTP 500" })
    );
  });

  it("preserves write and end return values", () => {
    const request = { url: "/x", method: "GET" } as unknown as IncomingMessage;
    const response = fakeResponse(500, true, {
      "content-type": "application/json",
    });
    const originalEnd = response.end;
    trackRequestCompleted(request, response, () => 1);
    expect(response.write("a")).toBe(true);
    expect(response.end("b")).toBe(response);
    expect(originalEnd).toHaveBeenCalledWith("b");
  });
});
