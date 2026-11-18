import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { AgentSettings } from "../src/headless/headless-instance-dir.js";
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
const PERSONAL_ROOT = path.join(BASE, "personal");
const NAME_A_RE = /--name a( |$)/;
const NAME_B_RE = /--name b( |$)/;

const agentOf = (projectKey: string): AgentSettings => ({
  projectKey,
  runnerName: null,
});
const DEFAULT_AGENTS: Record<string, AgentSettings> = {
  "an-pro-1": agentOf("PRO-1"),
};

function fakeDeps(
  overrides: Partial<UninstallDeps> = {},
  agents: Record<string, AgentSettings> = DEFAULT_AGENTS
) {
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
    exists: (dir) => path.dirname(dir) === PERSONAL_ROOT,
    readAgentSettings: (dir) =>
      agents[path.basename(dir)] ?? { projectKey: null, runnerName: null },
    installedServiceId: () => null,
    removeService: (location) => {
      calls.service++;
      calls.locations.push(location);
      return Promise.resolve(ServiceOutcome.Removed);
    },
    isLockHeld: () => false,
    listDir: (dir) => {
      if (dir === BASE) {
        return ["runner.env", "identity", "personal"];
      }
      return dir === PERSONAL_ROOT ? Object.keys(agents) : [];
    },
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
    assert.ok(
      lines.some((l) => l.includes("uninstall-runner.cmd --name an-pro-1"))
    );
  });

  it("deletes only the personal directory for a project", async () => {
    const { deps, calls } = fakeDeps();
    assert.equal(
      await runUninstall({ baseDataDir: BASE, projectKey: "PRO-1" }, deps),
      0
    );
    assert.deepEqual(calls.removed, [path.join(PERSONAL_ROOT, "an-pro-1")]);
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

describe("runUninstall by name or key", () => {
  const two = {
    a: agentOf("PRO-1"),
    b: agentOf("PRO-1"),
    other: agentOf("PRO-2"),
  };

  it("--name alone removes that Agent's dir and its service", async () => {
    const { deps, calls } = fakeDeps({}, two);
    assert.equal(
      await runUninstall(
        { baseDataDir: BASE, projectKey: null, agentName: "B" },
        deps
      ),
      0
    );
    assert.deepEqual(calls.removed, [path.join(PERSONAL_ROOT, "b")]);
    assert.equal(calls.locations[0]?.id, "agentflow-agent-b");
  });

  it("uses the installed service id", async () => {
    const { deps, calls } = fakeDeps({ installedServiceId: () => "custom-id" });
    await runUninstall(
      { baseDataDir: BASE, projectKey: null, agentName: "an-pro-1" },
      deps
    );
    assert.equal(calls.locations[0]?.id, "custom-id");
  });

  it("--project with one Agent works", async () => {
    const { deps, calls } = fakeDeps({}, two);
    assert.equal(
      await runUninstall({ baseDataDir: BASE, projectKey: "PRO-2" }, deps),
      0
    );
    assert.deepEqual(calls.removed, [path.join(PERSONAL_ROOT, "other")]);
    assert.equal(calls.locations[0]?.id, "agentflow-agent-other");
  });

  it("--project with several Agents lists the --name choices and removes nothing", async () => {
    const lines: string[] = [];
    const { deps, calls } = fakeDeps({ say: (l) => lines.push(l) }, two);
    assert.equal(
      await runUninstall({ baseDataDir: BASE, projectKey: "PRO-1" }, deps),
      1
    );
    assert.equal(calls.service, 0);
    assert.deepEqual(calls.removed, []);
    assert.ok(lines.some((l) => NAME_A_RE.test(l) && NAME_B_RE.test(l)));
  });

  it("--project with --name of another key's Agent is a mismatch", async () => {
    const lines: string[] = [];
    const { deps, calls } = fakeDeps({ say: (l) => lines.push(l) }, two);
    assert.equal(
      await runUninstall(
        { baseDataDir: BASE, projectKey: "PRO-1", agentName: "other" },
        deps
      ),
      1
    );
    assert.equal(calls.service, 0);
    assert.deepEqual(calls.removed, []);
    assert.ok(lines.some((l) => l.includes("belongs to project PRO-2")));
  });

  it("--project with no Agent of the key says so", async () => {
    const lines: string[] = [];
    const { deps, calls } = fakeDeps({ say: (l) => lines.push(l) });
    assert.equal(
      await runUninstall({ baseDataDir: BASE, projectKey: "PRO-9" }, deps),
      1
    );
    assert.equal(calls.service, 0);
    assert.ok(lines.some((l) => l.includes("No personal Agent of PRO-9")));
  });

  it("an unknown --name is an error", async () => {
    const { deps, calls } = fakeDeps();
    assert.equal(
      await runUninstall(
        { baseDataDir: BASE, projectKey: null, agentName: "ghost" },
        deps
      ),
      1
    );
    assert.equal(calls.service, 0);
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
