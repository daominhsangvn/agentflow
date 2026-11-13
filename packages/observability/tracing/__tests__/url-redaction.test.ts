import { describe, expect, it } from "vitest";
import {
  httpUrlAttributes,
  redactUrlQuery,
  undiciUrlAttributes,
} from "../url-redaction";

describe("url redaction", () => {
  it("redacts sensitive query values and keeps the rest", () => {
    expect(redactUrlQuery("https://h/p?api-version=1&sig=abc123&sv=2")).toBe(
      "https://h/p?api-version=1&sig=[redacted]&sv=2"
    );
  });

  it("overrides undici url attributes with redacted values", () => {
    const attrs = undiciUrlAttributes({
      origin: "https://prod.logic.azure.com",
      path: "/workflows/x/triggers/manual?sig=SECRET&sp=1",
    });
    expect(attrs["url.full"]).not.toContain("SECRET");
    expect(attrs["url.query"]).toBe("?sig=[redacted]&sp=1");
  });

  it("overrides http.url for outgoing http requests", () => {
    const attrs = httpUrlAttributes({
      protocol: "https:",
      hostname: "example.com",
      path: "/a?token=SECRET",
    });
    expect(attrs["http.url"]).toBe("https://example.com/a?token=[redacted]");
  });

  it("returns no overrides for an unparseable request", () => {
    expect(undiciUrlAttributes({ origin: "not a url", path: "/x" })).toEqual(
      {}
    );
  });
});
