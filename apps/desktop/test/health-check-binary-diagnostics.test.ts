import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  binaryDebugCandidates,
  classifyBinaryRemediation,
  getInstallRemediation,
} from "../src/server/operations/health-check-binary-diagnostics.js";

const WIN_ENV = { PATHEXT: ".COM;.EXE;.BAT;.CMD" };

describe("binaryDebugCandidates", () => {
  it("emits only PATHEXT file names on win32", () => {
    const candidates = binaryDebugCandidates(
      "python3",
      ["C:\\shims", "C:\\Python312"].join(";"),
      [],
      "win32",
      WIN_ENV
    );
    assert.ok(candidates.includes("C:\\shims\\python3.exe"));
    assert.ok(
      candidates.every(
        (c) => path.win32.basename(c).toLowerCase() !== "python3"
      )
    );
  });

  it("emits plain names on linux", () => {
    const candidates = binaryDebugCandidates(
      "python3",
      "/usr/bin:/opt/bin",
      [],
      "linux",
      {}
    );
    assert.deepEqual(candidates, ["/usr/bin/python3", "/opt/bin/python3"]);
  });

  it("applies PATHEXT to known locations on win32", () => {
    const candidates = binaryDebugCandidates(
      "git",
      "",
      ["C:\\Program Files\\Git\\cmd\\git"],
      "win32",
      WIN_ENV
    );
    assert.ok(candidates.includes("C:\\Program Files\\Git\\cmd\\git.exe"));
    assert.ok(!candidates.includes("C:\\Program Files\\Git\\cmd\\git"));
  });
});

describe("classifyBinaryRemediation", () => {
  const err = { code: "ENOENT", stderr: "", message: "" } as never;

  it("points to the user PATH variable on win32", () => {
    const text = classifyBinaryRemediation("python3", err, {
      errorCode: "ENOENT",
      foundAt: ["C:\\tools\\python3.exe"],
      platform: "win32",
    });
    assert.ok(text.includes("user PATH environment variable"));
    assert.ok(!text.includes("rc"));
  });

  it("keeps the shell rc text on posix", () => {
    const text = classifyBinaryRemediation("python3", err, {
      errorCode: "ENOENT",
      foundAt: ["/x/python3"],
      platform: "darwin",
      shell: "zsh",
    });
    assert.equal(text, "Add /x to PATH in your zsh rc, then restart the app");
  });
});

describe("getInstallRemediation", () => {
  it("recommends winget on win32", () => {
    const text = getInstallRemediation("python3", "win32");
    assert.ok(text.includes("winget install Python.Python.3.12"));
    assert.ok(!text.includes("apt"));
  });

  it("keeps linux and darwin hints", () => {
    assert.ok(
      getInstallRemediation("python3", "linux").includes("package manager")
    );
    assert.ok(getInstallRemediation("python3", "darwin").includes("brew"));
  });
});
