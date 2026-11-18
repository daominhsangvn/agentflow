import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  type AgentSettings,
  agentNameSlug,
  agentsOfProject,
  checkPersonalAgentName,
  chooseAgentToStart,
  findPersonalAgent,
  type InstanceDirFs,
  listPersonalAgents,
  type PersonalAgent,
  parseAgentChoice,
  personalAgentDir,
  personalAgentOptions,
  resolvePersonalAgent,
  setupNameDefault,
} from "../src/headless/headless-instance-dir.js";

const BASE = path.resolve("/data");
const PERSONAL_ROOT = path.join(BASE, "personal");
const NAME_A_RE = /--name a/;
const NAME_B_RE = /--name b/;
const RE_1 = /No personal Agent named "nope"/;
const RE_2 = /belongs to project PRO-1, not PRO-2/;
const RE_3 = /Several personal Agents of PRO-1/;
const RE_4 = /--name a \(running\) or --name b/;
const RE_5 = /already running: a, b/;
const RE_6 = /already the name of a personal Agent of PRO-1/;
const RE_7 = /letter or digit/;

/** Entries of personal/: folder name to the settings of its runner.env. */
function fakeFs(entries: Record<string, AgentSettings | null>): InstanceDirFs {
  return {
    exists: (dir) => path.dirname(dir) === PERSONAL_ROOT,
    listDir: (dir) => (dir === PERSONAL_ROOT ? Object.keys(entries) : []),
    readAgentSettings: (dir) =>
      entries[path.basename(dir)] ?? { projectKey: null, runnerName: null },
  };
}

const settings = (projectKey: string, runnerName = "x"): AgentSettings => ({
  projectKey,
  runnerName,
});

function agent(slug: string, projectKey: string | null): PersonalAgent {
  return {
    slug,
    projectKey,
    runnerName: slug,
    dataDir: personalAgentDir(BASE, slug),
  };
}

describe("agentNameSlug", () => {
  it("builds slugs", () => {
    assert.equal(agentNameSlug("Sang Dao-PRO-1"), "sang-dao-pro-1");
    assert.equal(agentNameSlug("Nguyễn Văn An"), "nguyen-van-an");
    assert.equal(agentNameSlug("運用"), null);
    assert.equal(agentNameSlug("  "), null);
  });

  it("cuts to 40 characters without a trailing dash", () => {
    const slug = agentNameSlug(`${"a".repeat(39)} ${"b".repeat(20)}`);
    assert.equal(slug, "a".repeat(39));
    assert.equal(agentNameSlug("a".repeat(60))?.length, 40);
  });
});

describe("setupNameDefault", () => {
  it("keeps the saved name when its slug is the typed --name", () => {
    assert.equal(
      setupNameDefault("sang-dao-pro-1", "Sang-Dao-PRO-1"),
      "Sang-Dao-PRO-1"
    );
  });

  it("takes the typed name for a new Agent", () => {
    assert.equal(
      setupNameDefault("sang-dao-pro-1", undefined),
      "sang-dao-pro-1"
    );
    assert.equal(setupNameDefault("sang-dao-pro-1", "  "), "sang-dao-pro-1");
  });

  it("replaces a saved name with another slug", () => {
    assert.equal(
      setupNameDefault("other-agent", "Sang-Dao-PRO-1"),
      "other-agent"
    );
  });
});

describe("personalAgentDir and options", () => {
  it("joins the flat layout", () => {
    assert.equal(
      personalAgentDir(BASE, "an"),
      path.join(BASE, "personal", "an")
    );
    assert.equal(personalAgentOptions("PRO-1", "an"), "--name an");
    assert.equal(personalAgentOptions("PRO-1", null), "--project PRO-1");
  });
});

describe("listPersonalAgents", () => {
  it("lists valid slugs sorted, with their settings", () => {
    const list = listPersonalAgents(
      BASE,
      fakeFs({ b: settings("PRO-1"), a: settings("PRO-2"), env: null })
    );
    assert.deepEqual(
      list.map((entry) => [entry.slug, entry.projectKey]),
      [
        ["a", "PRO-2"],
        ["b", "PRO-1"],
        ["env", null],
      ]
    );
    assert.equal(list[0].dataDir, personalAgentDir(BASE, "a"));
  });

  it("ignores non-slug entries and old-layout folders", () => {
    const list = listPersonalAgents(
      BASE,
      fakeFs({ "PRO-1": null, "PRO-1@host": null, "has space": null, ok: null })
    );
    assert.deepEqual(
      list.map((entry) => entry.slug),
      ["ok"]
    );
  });

  it("ignores entries that do not exist as directories", () => {
    const fsApi: InstanceDirFs = {
      ...fakeFs({ a: null }),
      exists: () => false,
    };
    assert.deepEqual(listPersonalAgents(BASE, fsApi), []);
  });
});

describe("agentsOfProject and findPersonalAgent", () => {
  const fsApi = fakeFs({
    a: settings("PRO-1"),
    b: settings("PRO-2"),
    env: null,
  });
  it("an env-only Agent belongs to no key", () => {
    const list = listPersonalAgents(BASE, fsApi);
    assert.deepEqual(
      agentsOfProject(list, "PRO-1").map((entry) => entry.slug),
      ["a"]
    );
    assert.deepEqual(agentsOfProject(list, "PRO-3"), []);
  });

  it("finds by slug", () => {
    assert.equal(findPersonalAgent(BASE, "b", fsApi)?.projectKey, "PRO-2");
    assert.equal(findPersonalAgent(BASE, "zz", fsApi), null);
  });
});

describe("resolvePersonalAgent by name", () => {
  const fsApi = fakeFs({
    a: settings("PRO-1"),
    b: settings("PRO-2"),
    env: null,
  });
  const resolve = (projectKey: string | null, name: string) =>
    resolvePersonalAgent({ baseDataDir: BASE, projectKey, name }, fsApi);

  it("finds an Agent by name, compared by slug", () => {
    const result = resolve(null, "A");
    assert.ok(result.ok && result.agent?.slug === "a");
  });

  it("reports a missing Agent with the choices", () => {
    const result = resolve(null, "nope");
    assert.ok(!result.ok);
    assert.match(result.error, RE_1);
    assert.match(result.error, NAME_A_RE);
    assert.match(result.error, NAME_B_RE);
  });

  it("rejects an invalid name", () => {
    assert.equal(resolve(null, "運用").ok, false);
  });

  it("names both keys on a mismatch", () => {
    const result = resolve("PRO-2", "a");
    assert.ok(!result.ok);
    assert.match(result.error, RE_2);
  });

  it("accepts a matching key and an env-only Agent with a key", () => {
    assert.equal(resolve("PRO-1", "a").ok, true);
    const env = resolve("PRO-9", "env");
    assert.ok(env.ok && env.agent?.slug === "env");
  });
});

describe("resolvePersonalAgent by key", () => {
  const resolve = (entries: Record<string, AgentSettings | null>) =>
    resolvePersonalAgent(
      { baseDataDir: BASE, projectKey: "PRO-1", name: null },
      fakeFs(entries)
    );

  it("gives null for no Agent, the Agent for one", () => {
    const none = resolve({ x: settings("PRO-2") });
    assert.ok(none.ok && none.agent === null);
    const one = resolve({ x: settings("PRO-1"), y: settings("PRO-2") });
    assert.ok(one.ok && one.agent?.slug === "x");
  });

  it("errors with the choices for several", () => {
    const result = resolve({ a: settings("PRO-1"), b: settings("PRO-1") });
    assert.ok(!result.ok);
    assert.match(result.error, RE_3);
    assert.match(result.error, NAME_A_RE);
    assert.match(result.error, NAME_B_RE);
  });
});

describe("chooseAgentToStart", () => {
  const a = agent("a", "PRO-1");
  const b = agent("b", "PRO-1");
  const c = agent("c", "PRO-1");
  const none = () => false;

  it("uses a single Agent as is", () => {
    const result = chooseAgentToStart("PRO-1", [a], none, false);
    assert.deepEqual(result, { ok: true, agent: a, picked: false });
  });

  it("without a terminal lists the choices and marks running ones", () => {
    const result = chooseAgentToStart(
      "PRO-1",
      [a, b],
      (dir) => dir === a.dataDir,
      false
    );
    assert.ok(result.ok === false);
    assert.match(result.error, RE_4);
  });

  it("in a terminal fails when every Agent runs", () => {
    const result = chooseAgentToStart("PRO-1", [a, b], () => true, true);
    assert.ok(result.ok === false);
    assert.match(result.error, RE_5);
  });

  it("in a terminal picks the single free Agent", () => {
    const result = chooseAgentToStart(
      "PRO-1",
      [a, b],
      (dir) => dir === a.dataDir,
      true
    );
    assert.deepEqual(result, { ok: true, agent: b, picked: true });
  });

  it("in a terminal asks when several are free", () => {
    const result = chooseAgentToStart(
      "PRO-1",
      [a, b, c],
      (dir) => dir === a.dataDir,
      true
    );
    assert.deepEqual(result, { ok: "ask", candidates: [b, c] });
  });
});

describe("parseAgentChoice", () => {
  const candidates = [agent("a", "K"), agent("b-2", "K")];
  it("takes a 1-based number", () => {
    assert.equal(parseAgentChoice("2", candidates)?.slug, "b-2");
    assert.equal(parseAgentChoice("0", candidates), null);
    assert.equal(parseAgentChoice("3", candidates), null);
  });
  it("takes a name compared by slug", () => {
    assert.equal(parseAgentChoice(" B 2 ", candidates)?.slug, "b-2");
    assert.equal(parseAgentChoice("zz", candidates), null);
    assert.equal(parseAgentChoice("", candidates), null);
  });
});

describe("checkPersonalAgentName", () => {
  const fsApi = fakeFs({ a: settings("PRO-1"), env: null });
  const check = (key: string, name: string) =>
    checkPersonalAgentName(BASE, key, name, fsApi);

  it("refuses another project's Agent name", () => {
    assert.match(check("PRO-2", "A") ?? "", RE_6);
  });
  it("allows the same key, an env-only dir and a new name", () => {
    assert.equal(check("PRO-1", "a"), null);
    assert.equal(check("PRO-2", "env"), null);
    assert.equal(check("PRO-2", "fresh"), null);
  });
  it("refuses a name without letter or digit", () => {
    assert.match(check("PRO-1", "運用") ?? "", RE_7);
  });
});
