import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
  type InstanceDirFs,
  normalizeServerOption,
  parsePersonalDirName,
  personalAgentOptions,
  personalSetupTarget,
  resolvePersonalInstance,
  serverSlug,
} from "../src/headless/headless-instance-dir.js";

const BASE = path.resolve("/data");
const SERVER_A_RE = /--server a/;
const SERVER_B_RE = /--server b/;
const SERVER_S1_RE = /--server s-1/;
const personal = (name: string) => path.join(BASE, "personal", name);

function fakeFs(
  dirs: string[],
  urls: Record<string, string> = {}
): InstanceDirFs {
  const set = new Set(dirs.map(personal));
  return {
    exists: (dir) => set.has(dir),
    listDir: (dir) =>
      dir === path.join(BASE, "personal")
        ? [...set].map((entry) => path.basename(entry))
        : [],
    readApiUrl: (dir) => urls[path.basename(dir)] ?? null,
  };
}

describe("serverSlug", () => {
  it("builds slugs", () => {
    assert.equal(serverSlug("http://localhost:3002"), "localhost-3002");
    assert.equal(
      serverSlug("https://AgentFlow.Example.com"),
      "agentflow.example.com"
    );
    assert.equal(serverSlug("https://x.com:443"), "x.com");
    assert.equal(serverSlug("http://[::1]:3002"), null);
    assert.equal(serverSlug("http://[fe80::1]:3002"), "fe80--1-3002");
    assert.equal(serverSlug("not a url"), null);
  });
});

describe("normalizeServerOption", () => {
  it("accepts hosts, slugs and URLs", () => {
    assert.equal(normalizeServerOption("host:3002"), "host-3002");
    assert.equal(normalizeServerOption("host-3002"), "host-3002");
    assert.equal(normalizeServerOption("https://Host.com/api"), "host.com");
    assert.equal(normalizeServerOption(""), null);
  });
});

describe("resolvePersonalInstance without --server", () => {
  const resolve = (fsApi: InstanceDirFs) =>
    resolvePersonalInstance(
      { baseDataDir: BASE, projectKey: "PRO-1", server: null },
      fsApi
    );

  it("uses the legacy dir when it exists, even with a keyed one", () => {
    const result = resolve(fakeFs(["PRO-1", "PRO-1@b"]));
    assert.deepEqual(result, {
      ok: true,
      instance: {
        dataDir: personal("PRO-1"),
        projectKey: "PRO-1",
        server: null,
      },
    });
  });

  it("uses a single keyed dir", () => {
    const result = resolve(fakeFs(["PRO-1@a", "PRO-2@z"]));
    assert.deepEqual(result, {
      ok: true,
      instance: {
        dataDir: personal("PRO-1@a"),
        projectKey: "PRO-1",
        server: "a",
      },
    });
  });

  it("fails when several keyed dirs exist", () => {
    const result = resolve(fakeFs(["PRO-1@a", "PRO-1@b"]));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, SERVER_A_RE);
      assert.match(result.error, SERVER_B_RE);
    }
  });

  it("falls back to the legacy path when nothing exists", () => {
    const result = resolve(fakeFs([]));
    assert.equal(result.ok && result.instance.dataDir, personal("PRO-1"));
  });
});

describe("resolvePersonalInstance with --server", () => {
  const resolve = (fsApi: InstanceDirFs) =>
    resolvePersonalInstance(
      { baseDataDir: BASE, projectKey: "PRO-1", server: "s-1" },
      fsApi
    );

  it("uses the keyed dir", () => {
    const result = resolve(fakeFs(["PRO-1@s-1", "PRO-1"]));
    assert.equal(result.ok && result.instance.dataDir, personal("PRO-1@s-1"));
  });

  it("uses the legacy dir of the same server", () => {
    const result = resolve(fakeFs(["PRO-1"], { "PRO-1": "http://s:1" }));
    assert.equal(result.ok && result.instance.server, null);
    assert.equal(result.ok && result.instance.dataDir, personal("PRO-1"));
  });

  it("fails for another server", () => {
    const result = resolve(fakeFs(["PRO-1"], { "PRO-1": "http://other:1" }));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, SERVER_S1_RE);
    }
  });
});

describe("personalSetupTarget", () => {
  const target = (fsApi: InstanceDirFs, apiUrl = "http://b:1") =>
    personalSetupTarget(
      { baseDataDir: BASE, projectKey: "PRO-1", apiUrl },
      fsApi
    );

  it("takes a free legacy dir", () => {
    assert.equal(target(fakeFs([])).server, null);
    assert.equal(target(fakeFs(["PRO-1"])).server, null);
  });

  it("keeps the legacy dir of the same server", () => {
    assert.equal(
      target(fakeFs(["PRO-1"], { "PRO-1": "http://b:1" })).server,
      null
    );
  });

  it("uses a keyed dir for another server", () => {
    const result = target(fakeFs(["PRO-1"], { "PRO-1": "http://a:1" }));
    assert.deepEqual(result, {
      dataDir: personal("PRO-1@b-1"),
      projectKey: "PRO-1",
      server: "b-1",
    });
  });

  it("prefers an existing keyed dir", () => {
    const result = target(fakeFs(["PRO-1@b-1"]));
    assert.equal(result.dataDir, personal("PRO-1@b-1"));
  });
});

describe("dir names and options", () => {
  it("parses dir names", () => {
    assert.deepEqual(parsePersonalDirName("PRO-1"), {
      projectKey: "PRO-1",
      server: null,
    });
    assert.deepEqual(parsePersonalDirName("PRO-1@h-1"), {
      projectKey: "PRO-1",
      server: "h-1",
    });
  });

  it("renders options", () => {
    assert.equal(personalAgentOptions("PRO-1", null), "--project PRO-1");
    assert.equal(
      personalAgentOptions("PRO-1", "h"),
      "--project PRO-1 --server h"
    );
  });
});
