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

function fakeResponse(statusCode: number, writableFinished: boolean) {
  return Object.assign(new EventEmitter(), {
    statusCode,
    writableFinished,
  }) as unknown as ServerResponse;
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
});
