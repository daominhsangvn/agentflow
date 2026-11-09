import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { isInstanceLockHeld } from "../src/headless/headless-instance-lock.js";
import {
  runUninstall,
  type UninstallDeps,
} from "../src/headless/headless-uninstall.js";
import { ServiceOutcome } from "../src/headless/headless-windows-service.js";

const BASE = path.resolve("/data/agent");

function fakeDeps(overrides: Partial<UninstallDeps> = {}) {
  const calls = { removed: [] as string[], service: 0, confirms: 0 };
  const deps: UninstallDeps = {
    say: () => undefined,
    confirm: () => {
      calls.confirms++;
      return Promise.resolve(true);
    },
    isWindows: true,
    homeDir: path.resolve("/home/me"),
    removeService: () => {
      calls.service++;
      return Promise.resolve(ServiceOutcome.Removed);
    },
    isLockHeld: () => false,
    listDir: (dir) =>
      dir === BASE ? ["runner.env", "identity", "personal"] : ["PRO-1"],
    removeDir: (target) => calls.removed.push(target),
    ...overrides,
  };
  return { deps, calls };
}

describe("runUninstall", () => {
  it("keeps the data when not confirmed", async () => {
    const { deps, calls } = fakeDeps({ confirm: () => Promise.resolve(false) });
    assert.equal(
      await runUninstall({ baseDataDir: BASE, projectKey: null }, deps),
      0
    );
    assert.equal(calls.service, 1);
    assert.deepEqual(calls.removed, []);
  });

  it("deletes the base entries except personal", async () => {
    const lines: string[] = [];
    const { deps, calls } = fakeDeps({ say: (l) => lines.push(l) });
    assert.equal(
      await runUninstall({ baseDataDir: BASE, projectKey: null }, deps),
      0
    );
    assert.deepEqual(calls.removed, [
      path.join(BASE, "runner.env"),
      path.join(BASE, "identity"),
    ]);
    assert.ok(lines.some((l) => l.includes("PRO-1")));
  });

  it("deletes only the personal directory for a project", async () => {
    const { deps, calls } = fakeDeps();
    assert.equal(
      await runUninstall({ baseDataDir: BASE, projectKey: "PRO-1" }, deps),
      0
    );
    assert.deepEqual(calls.removed, [path.join(BASE, "personal", "PRO-1")]);
  });

  it("refuses while the lock is held", async () => {
    const { deps, calls } = fakeDeps({ isLockHeld: () => true });
    assert.equal(
      await runUninstall({ baseDataDir: BASE, projectKey: null }, deps),
      1
    );
    assert.deepEqual(calls.removed, []);
  });

  it("stops without asking when the service removal is cancelled", async () => {
    const { deps, calls } = fakeDeps({
      removeService: () => Promise.resolve(ServiceOutcome.Cancelled),
    });
    assert.equal(
      await runUninstall({ baseDataDir: BASE, projectKey: null }, deps),
      1
    );
    assert.equal(calls.confirms, 0);
    assert.deepEqual(calls.removed, []);
  });

  it("does not touch services off Windows", async () => {
    const { deps, calls } = fakeDeps({ isWindows: false });
    assert.equal(
      await runUninstall({ baseDataDir: BASE, projectKey: null }, deps),
      0
    );
    assert.equal(calls.service, 0);
  });

  it("refuses the home directory as base", async () => {
    const home = path.resolve("/home/me");
    const { deps, calls } = fakeDeps({ homeDir: home });
    assert.equal(
      await runUninstall({ baseDataDir: home, projectKey: null }, deps),
      1
    );
    assert.deepEqual(calls.removed, []);
  });
});

describe("isInstanceLockHeld", () => {
  it("is true for a live pid and false for a dead pid or no file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-"));
    try {
      assert.equal(isInstanceLockHeld(dir), false);
      fs.writeFileSync(path.join(dir, "runner.lock"), "4242\n");
      assert.equal(
        isInstanceLockHeld(dir, (pid) => pid === 4242),
        true
      );
      assert.equal(
        isInstanceLockHeld(dir, () => false),
        false
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
