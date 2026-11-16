import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  findPython3Executable,
  type Python3ResolveDeps,
  resolvePython3FromLoginShell,
} from "../src/server/shell-path.js";

const DETECTED = String.raw`C:\Python312\python.exe`;
const STORE_STUB = String.raw`C:\Users\Dev\AppData\Local\Microsoft\WindowsApps\python3.exe`;

function makeDeps(
  platform: NodeJS.Platform,
  resolved: { path: string; source: "fallback" | "path" },
  detected: string | null
): Python3ResolveDeps & {
  detections: number;
  overrides: (string | undefined)[];
} {
  const state = {
    detections: 0,
    overrides: [] as (string | undefined)[],
  };
  return Object.assign(state, {
    platform,
    resolve: (_name: string, override?: string) => {
      state.overrides.push(override);
      return Promise.resolve(
        override ? { path: override, source: "override" as const } : resolved
      );
    },
    findPython3: () => {
      state.detections += 1;
      return Promise.resolve(detected);
    },
  });
}

describe("findPython3Executable", () => {
  test("tries python3, python, py -3 in order and returns the first hit", async () => {
    const calls: string[] = [];
    const found = await findPython3Executable((command, args) => {
      calls.push([command, ...args].join(" "));
      return Promise.resolve(command === "py" ? DETECTED : null);
    });
    assert.equal(found, DETECTED);
    assert.deepEqual(calls, ["python3", "python", "py -3"]);
  });

  test("returns null when every probe fails", async () => {
    assert.equal(await findPython3Executable(async () => null), null);
  });
});

describe("resolvePython3FromLoginShell", () => {
  test("uses detection on win32 when PATH resolution falls back", async () => {
    const deps = makeDeps(
      "win32",
      { path: "python3", source: "fallback" },
      DETECTED
    );
    const result = await resolvePython3FromLoginShell(undefined, deps);
    assert.deepEqual(result, { path: DETECTED, source: "known_location" });
  });

  test("treats a WindowsApps store stub as a miss", async () => {
    const deps = makeDeps(
      "win32",
      { path: STORE_STUB, source: "path" },
      DETECTED
    );
    const result = await resolvePython3FromLoginShell(undefined, deps);
    assert.equal(result.path, DETECTED);
  });

  test("keeps the original result when detection finds nothing", async () => {
    const deps = makeDeps(
      "win32",
      { path: "python3", source: "fallback" },
      null
    );
    const result = await resolvePython3FromLoginShell(undefined, deps);
    assert.deepEqual(result, { path: "python3", source: "fallback" });
  });

  test("skips detection on linux", async () => {
    const deps = makeDeps(
      "linux",
      { path: "python3", source: "fallback" },
      DETECTED
    );
    await resolvePython3FromLoginShell(undefined, deps);
    assert.equal(deps.detections, 0);
  });

  test("skips detection when an override is passed", async () => {
    const deps = makeDeps(
      "win32",
      { path: "python3", source: "fallback" },
      DETECTED
    );
    const result = await resolvePython3FromLoginShell(
      "C:custompython.exe",
      deps
    );
    assert.equal(deps.detections, 0);
    assert.equal(result.source, "override");
  });

  test("skips detection for a non-stub PATH hit", async () => {
    const deps = makeDeps("win32", { path: DETECTED, source: "path" }, "other");
    const result = await resolvePython3FromLoginShell(undefined, deps);
    assert.equal(deps.detections, 0);
    assert.equal(result.path, DETECTED);
  });
});
