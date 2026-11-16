/**
 * checkPython3 on Windows: the shared Python 3 detection fallback feeds the
 * health check, and the version gate still applies to the detected interpreter.
 */

import assert from "node:assert/strict";
import os from "node:os";
import { afterEach, describe, test } from "node:test";
import {
  _setKnownBinaryLocationsForTesting,
  _setRunCommandForTesting,
  runHealthCheck,
} from "../src/server/operations/health-check.js";
import type { ProcessManager } from "../src/server/process-manager.js";
import {
  _setPython3ResolveDepsForTesting,
  resetShellPathCache,
  setShellPathForTest,
  withShellPathEnvForTest,
} from "../src/server/shell-path.js";
import { unavailableMcp } from "./fixtures/health-check-route.js";

const DETECTED = String.raw`C:\Python312\python.exe`;
const BELOW_MINIMUM_RE = /below the required minimum of 3\.10/;

type RecordedCall = { cmd: string; args: string[] };

afterEach(() => {
  resetShellPathCache();
  _setRunCommandForTesting();
  _setPython3ResolveDepsForTesting(null);
  _setKnownBinaryLocationsForTesting(null);
});

async function runPythonCheck(pythonVersionOutput: string) {
  const calls: RecordedCall[] = [];
  _setKnownBinaryLocationsForTesting({ claude: [], git: [], python3: [] });
  _setPython3ResolveDepsForTesting({
    platform: "win32",
    resolve: () => Promise.resolve({ path: "python3", source: "fallback" }),
    findPython3: () => Promise.resolve(DETECTED),
  });
  _setRunCommandForTesting((cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    if (cmd === DETECTED) {
      return Promise.resolve({ stdout: pythonVersionOutput });
    }
    return Promise.resolve({ stdout: "1.0.0" });
  });

  let python: Record<string, unknown> | undefined;
  await withShellPathEnvForTest(
    { PATH: os.tmpdir(), SHELL: "/bin/sh" },
    async () => {
      setShellPathForTest();
      const response = await runHealthCheck({
        processManager: {} as unknown as ProcessManager,
        configDir: () => os.tmpdir(),
        detectMcp: unavailableMcp,
        requestedPluginAutoUpdate: false,
      });
      python = (response.checks as unknown as Record<string, unknown>[]).find(
        (check) => check.id === "python3"
      );
    }
  );
  return { python, calls };
}

describe("checkPython3 — Windows detection fallback", () => {
  test("uses the detected python.exe and reports its version", async () => {
    const { python, calls } = await runPythonCheck("Python 3.12.4");

    assert.equal(python?.passed, true);
    assert.equal(python?.version, "3.12.4");
    const pythonCall = calls.find((call) => call.cmd === DETECTED);
    assert.deepEqual(pythonCall?.args, ["--version"]);
  });

  test("rejects a detected Python below 3.10", async () => {
    const { python } = await runPythonCheck("Python 3.9.1");

    assert.equal(python?.passed, false);
    assert.equal(python?.version, "3.9.1");
    assert.match(String(python?.error), BELOW_MINIMUM_RE);
  });
});
