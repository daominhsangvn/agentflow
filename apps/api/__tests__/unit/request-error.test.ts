import { log } from "@repo/observability/log";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reportRequestError } from "@/lib/observability/request-error";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reportRequestError", () => {
  it("logs an error-level request.unhandled_error with path and message", () => {
    const error = vi.spyOn(log, "error").mockImplementation(() => undefined);
    const failure = Object.assign(new Error("kaput"), { digest: "d1" });

    reportRequestError(
      failure,
      { path: "/loops?x=1", method: "GET" },
      { routePath: "/loops", routeType: "route" }
    );

    expect(error).toHaveBeenCalledWith(
      "request.unhandled_error",
      expect.objectContaining({
        path: "/loops",
        method: "GET",
        route: "/loops",
        digest: "d1",
        "error.message": "kaput",
      })
    );
  });
});
