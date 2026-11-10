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
import {
  type ServiceLocation,
  ServiceOutcome,
} from "../src/headless/headless-windows-service.js";

const BASE = path.resolve("/data/agent");

function fakeDeps(overrides: Partial<UninstallDeps> = {}) {
  const calls = {
    removed: [] as string[],
    service: 0,
    confirms: 0,
    locations: [] as ServiceLocation[],
  };
  const deps: UninstallDeps = {
    say: () => undefined,
    confirm: () => {
      calls.confirms++;
      return Promise.resolve(true);
    },
    isWindows: true,
    homeDir: path.resolve("/home/me"),
    exists: () => false,
    readApiUrl: () => null,
    installedServiceId: () => null,
    removeService: (location) => {
      calls.service++;
      calls.locations.push(location);
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

describe("runUninstall with servers", () => {
  it("removes the keyed dir and its service", async () => {
    const keyed = path.join(BASE, "personal", "PRO-1@host-3002");
    const { deps, calls } = fakeDeps({ exists: (d) => d === keyed });
    assert.equal(
      await runUninstall(
        { baseDataDir: BASE, projectKey: "PRO-1", server: "host-3002" },
        deps
      ),
      0
    );
    assert.deepEqual(calls.removed, [keyed]);
    assert.equal(calls.locations[0]?.id, "agentflow-agent-pro-1-host-3002");
  });

  it("uses the installed service id", async () => {
    const { deps, calls } = fakeDeps({ installedServiceId: () => "custom-id" });
    await runUninstall({ baseDataDir: BASE, projectKey: "PRO-1" }, deps);
    assert.equal(calls.locations[0]?.id, "custom-id");
  });

  it("refuses an ambiguous project", async () => {
    const lines: string[] = [];
    const { deps, calls } = fakeDeps({
      say: (l) => lines.push(l),
      listDir: () => ["PRO-1@a", "PRO-1@b"],
    });
    assert.equal(
      await runUninstall({ baseDataDir: BASE, projectKey: "PRO-1" }, deps),
      1
    );
    assert.equal(calls.service, 0);
    assert.deepEqual(calls.removed, []);
    assert.ok(lines.some((l) => l.includes("--server a")));
  });

  it("lists remaining Agents with their server option", async () => {
    const lines: string[] = [];
    const { deps } = fakeDeps({
      say: (l) => lines.push(l),
      listDir: (dir) =>
        dir === BASE ? ["personal"] : ["PRO-1", "PRO-1@host-3002"],
    });
    await runUninstall({ baseDataDir: BASE, projectKey: null }, deps);
    assert.ok(
      lines.some((l) => l.includes("--project PRO-1 --server host-3002"))
    );
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
