import { beforeEach, describe, expect, it, vi } from "vitest";

const { logMock, spanMock } = vi.hoisted(() => ({
  logMock: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
  spanMock: { recordError: vi.fn(), setSpanOutcome: vi.fn() },
}));

vi.mock("@repo/observability/log", () => ({ log: logMock }));
vi.mock("@repo/observability/span", () => spanMock);

import { AfOutcome } from "@repo/observability/af-attributes";
import {
  observeFailedResponse,
  observeThrownError,
} from "../observe-failed-response";

const request = {
  method: "POST",
  url: "https://api.test/compute-targets/1/operations?x=1",
};

function jsonResponse(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

describe("observeFailedResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records a 503 failure value as a span error and warn log with the reason", async () => {
    await observeFailedResponse(
      request,
      jsonResponse({ success: false, error: "Compute target offline" }, 503)
    );

    expect(spanMock.setSpanOutcome).toHaveBeenCalledWith(
      AfOutcome.Error,
      "Compute target offline"
    );
    expect(logMock.warn).toHaveBeenCalledWith("request.failed", {
      path: "/compute-targets/1/operations",
      method: "POST",
      status_code: 503,
      reason: "Compute target offline",
    });
  });

  it("marks 4xx as rejected and logs at info", async () => {
    await observeFailedResponse(
      request,
      jsonResponse({ error: "Bad input" }, 400)
    );

    expect(spanMock.setSpanOutcome).toHaveBeenCalledWith(
      AfOutcome.Rejected,
      "Bad input"
    );
    expect(logMock.info).toHaveBeenCalledWith(
      "request.failed",
      expect.objectContaining({ status_code: 400, reason: "Bad input" })
    );
    expect(logMock.warn).not.toHaveBeenCalled();
  });

  it("ignores successful responses", async () => {
    await observeFailedResponse(request, jsonResponse({ ok: true }, 200));

    expect(spanMock.setSpanOutcome).not.toHaveBeenCalled();
    expect(logMock.info).not.toHaveBeenCalled();
  });

  it("falls back to the status for a non-JSON body without throwing", async () => {
    await expect(
      observeFailedResponse(
        request,
        new Response("<html>bad gateway</html>", {
          status: 502,
          headers: { "content-type": "text/html" },
        })
      )
    ).resolves.toBeUndefined();

    expect(spanMock.setSpanOutcome).toHaveBeenCalledWith(
      AfOutcome.Error,
      "HTTP 502"
    );
  });

  it("does not parse a body above the cap and leaves the original readable", async () => {
    const response = jsonResponse({ error: "x".repeat(20_000) }, 500);

    await observeFailedResponse(request, response);

    expect(spanMock.setSpanOutcome).toHaveBeenCalledWith(
      AfOutcome.Error,
      "HTTP 500"
    );
    const body = (await response.json()) as { error: string };
    expect(body.error).toHaveLength(20_000);
  });

  it("truncates a long reason", async () => {
    await observeFailedResponse(
      request,
      jsonResponse({ error: "y".repeat(2000) }, 409)
    );

    const reason = spanMock.setSpanOutcome.mock.calls[0][1] as string;
    expect(reason.length).toBeLessThanOrEqual(512);
  });
});

describe("observeThrownError", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("records the exception on the span and logs name, message and stack", () => {
    const error = new TypeError("boom");

    observeThrownError("Authentication failed", error);

    expect(spanMock.recordError).toHaveBeenCalledWith(error);
    expect(logMock.error).toHaveBeenCalledWith(
      "Authentication failed",
      expect.objectContaining({
        "error.name": "TypeError",
        "error.message": "boom",
        "error.stack": expect.any(String),
      })
    );
  });
});
