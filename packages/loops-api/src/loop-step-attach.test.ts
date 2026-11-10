import { describe, expect, it } from "vitest";
import {
  attachRootPath,
  isSafeAttachPattern,
  LoopStepConfigSchema,
  splitAttachGlob,
} from "./loop-step";

describe("splitAttachGlob", () => {
  it("splits a named glob", () => {
    expect(splitAttachGlob("features:**/*.md")).toEqual({
      root: "features",
      pattern: "**/*.md",
    });
  });

  it("leaves unprefixed and non-name prefixes alone", () => {
    expect(splitAttachGlob("PRD-*.md")).toEqual({
      root: null,
      pattern: "PRD-*.md",
    });
    expect(splitAttachGlob("Features:x")).toEqual({
      root: null,
      pattern: "Features:x",
    });
  });
});

describe("isSafeAttachPattern", () => {
  it("rejects unsafe patterns", () => {
    for (const p of [
      "../x",
      "a/../b",
      "/abs",
      "~/x",
      "",
      "./a",
      "a/./b",
      "a//b",
      "a/",
    ]) {
      expect(isSafeAttachPattern(p)).toBe(false);
    }
  });

  it("accepts a plain glob", () => {
    expect(isSafeAttachPattern("**/*.md")).toBe(true);
  });
});

describe("attachRootPath", () => {
  it("joins root and path", () => {
    expect(attachRootPath("features", "a/b.md")).toBe("features:a/b.md");
  });
});

describe("LoopStepConfigSchema attach", () => {
  it("has attachChanged and named globs in the shape", () => {
    const shape = LoopStepConfigSchema.shape;
    expect(shape.attachChanged.safeParse(true).success).toBe(true);
    expect(shape.attach.safeParse(["features:**/*.md"]).success).toBe(true);
  });
});
