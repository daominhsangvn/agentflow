import { describe, expect, it } from "vitest";
import { logJsonReplacer, toLogAttributes } from "../log-attributes";

const LIVE_TOKEN = "ya29.a0AfB_bZlFAKEtokenVALUE1234567890abcdefXYZ";

describe("toLogAttributes", () => {
  it("aliases camelCase ids to af.* and keeps the originals", () => {
    const attrs = toLogAttributes({ loopId: "l1", runId: "r1" });
    expect(attrs["af.loop_id"]).toBe("l1");
    expect(attrs["af.workflow_run_id"]).toBe("r1");
    expect(attrs.loopId).toBe("l1");
    expect(attrs.runId).toBe("r1");
  });

  it("does not alias non-string ids", () => {
    expect(toLogAttributes({ loopId: 5 })["af.loop_id"]).toBeUndefined();
  });

  it("keeps an explicit af.* key", () => {
    const attrs = toLogAttributes({ "af.loop_id": "x", loopId: "l1" });
    expect(attrs["af.loop_id"]).toBe("x");
  });

  it("returns {} for undefined meta", () => {
    expect(toLogAttributes(undefined)).toEqual({});
  });

  it("redacts sensitive keys", () => {
    expect(toLogAttributes({ apiKey: "abc123" }).apiKey).toBe("[redacted]");
  });

  it("redacts secret-shaped and email text inside values", () => {
    const attrs = toLogAttributes({
      detail: `bad credential ${LIVE_TOKEN}`,
      note: "contact someone@example.com now",
    });
    expect(String(attrs.detail)).not.toContain("ya29.");
    expect(String(attrs.note)).not.toContain("someone@example.com");
  });

  it("keeps numbers as numbers", () => {
    expect(toLogAttributes({ inputTokens: 42 }).inputTokens).toBe(42);
  });

  it("drops null and undefined values", () => {
    expect(toLogAttributes({ a: null, b: undefined, c: 1 })).toEqual({ c: 1 });
  });

  it("flattens an Error with redaction applied", () => {
    const attrs = toLogAttributes({
      error: new Error(`failed token=${LIVE_TOKEN}`),
    });
    expect(attrs["error.name"]).toBe("Error");
    expect(String(attrs["error.message"])).toContain("failed");
    expect(String(attrs["error.message"])).not.toContain("ya29.");
    expect(typeof attrs["error.stack"]).toBe("string");
  });

  it("flattens nested objects to dotted keys", () => {
    expect(toLogAttributes({ a: { b: { c: 1 } } })).toEqual({ "a.b.c": 1 });
  });

  it("serializes objects deeper than 3 levels as JSON strings", () => {
    const attrs = toLogAttributes({ a: { b: { c: { d: 1 } } } });
    expect(attrs["a.b.c"]).toBe('{"d":1}');
  });

  it("keeps homogeneous primitive arrays", () => {
    expect(toLogAttributes({ tags: ["a", "b"] }).tags).toEqual(["a", "b"]);
  });

  it("stringifies mixed arrays", () => {
    expect(toLogAttributes({ mixed: ["a", 1] }).mixed).toBe('["a",1]');
  });

  it("flags unserializable meta", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toLogAttributes(circular)).toEqual({
      "log.meta_unserializable": true,
    });
    expect(toLogAttributes({ big: BigInt(1) })).toEqual({
      "log.meta_unserializable": true,
    });
  });
});

describe("logJsonReplacer", () => {
  it("expands Errors", () => {
    const out = logJsonReplacer("e", new TypeError("x")) as Record<
      string,
      unknown
    >;
    expect(out.name).toBe("TypeError");
  });
});
