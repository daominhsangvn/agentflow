import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ProvisionOutcome, readConfig, run } from "./signoz-init.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const provisionDir = path.resolve(here, "..");
const fixturesDir = path.join(here, "fixtures");
// A directory with no dashboards/alerts, so run() tests do not depend on the real files.
const emptyDir = path.join(here, "fixtures", "none");

function json(status, body) {
  return { status, json: async () => body };
}

// routes: map of "METHOD /path" -> response or function(body) -> response
function makeCtx({ env = {}, routes = {}, dir = emptyDir } = {}) {
  const calls = [];
  const logs = [];
  const config = readConfig(
    {
      SIGNOZ_URL: "http://signoz:8080",
      SIGNOZ_ADMIN_EMAIL: "a@b.c",
      SIGNOZ_ADMIN_PASSWORD: "Secret-pass-1",
      SIGNOZ_PROVISION_DIR: dir,
      ...env,
    },
    here
  );
  const fetch = (url, init) => {
    const route = `${init.method} ${new URL(url).pathname}`;
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ route, body });
    const handler = routes[route];
    if (!handler) {
      return Promise.resolve(json(404, { status: "error" }));
    }
    return Promise.resolve(
      typeof handler === "function" ? handler(body) : handler
    );
  };
  let clock = 0;
  return {
    ctx: {
      config,
      fetch,
      log: (line) => logs.push(line),
      now: () => clock,
      sleep: (ms) => {
        clock += ms;
        return Promise.resolve();
      },
      results: [],
    },
    calls,
    logs,
  };
}

const okLogin = json(200, {
  status: "success",
  data: { accessJwt: "jwt-token" },
});
const health = json(200, { status: "ok" });
const alreadyInitialised = json(400, {
  status: "error",
  errorType: "bad_data",
  error: "self-registration is disabled",
});

describe("signoz-init", () => {
  it("creates the admin when register returns 200", async () => {
    const { ctx, logs } = makeCtx({
      routes: {
        "GET /api/v1/health": health,
        "POST /api/v1/register": json(200, { status: "success" }),
        "POST /api/v1/login": okLogin,
      },
    });
    assert.equal(await run(ctx), 0);
    assert.ok(logs.includes("signoz-init: admin created"));
  });

  it("continues when self-registration is disabled", async () => {
    const { ctx, logs } = makeCtx({
      routes: {
        "GET /api/v1/health": health,
        "POST /api/v1/register": alreadyInitialised,
        "POST /api/v1/login": okLogin,
      },
    });
    assert.equal(await run(ctx), 0);
    assert.ok(logs.includes("signoz-init: already initialised"));
  });

  it("exits 1 on a wrong password and never prints it", async () => {
    const { ctx, logs } = makeCtx({
      routes: {
        "GET /api/v1/health": health,
        "POST /api/v1/register": alreadyInitialised,
        "POST /api/v1/login": json(400, {
          status: "error",
          error: { code: "incorrect_password", message: "nope" },
        }),
      },
    });
    assert.equal(await run(ctx), 1);
    assert.ok(
      logs.some((line) =>
        line.includes("differs from the existing SigNoz admin")
      )
    );
    assert.ok(!logs.some((line) => line.includes("Secret-pass-1")));
  });

  it("skips without calling anything but health when the password is unset", async () => {
    const { ctx, calls, logs } = makeCtx({
      env: { SIGNOZ_ADMIN_PASSWORD: "" },
      routes: { "GET /api/v1/health": health },
    });
    assert.equal(await run(ctx), 0);
    assert.deepEqual(
      calls.map((call) => call.route),
      ["GET /api/v1/health"]
    );
    assert.ok(logs.some((line) => line.includes("skipped")));
  });

  it("PUTs an existing dashboard title and POSTs a new one", async () => {
    const { ctx, calls } = makeCtx({
      dir: fixturesDir,
      routes: {
        "GET /api/v1/health": health,
        "POST /api/v1/register": alreadyInitialised,
        "POST /api/v1/login": okLogin,
        "GET /api/v1/dashboards": json(200, {
          data: [{ id: "d-1", data: { title: "Existing" } }],
        }),
        "PUT /api/v1/dashboards/d-1": json(200, { status: "success" }),
        "POST /api/v1/dashboards": json(200, { status: "success" }),
        "GET /api/v1/rules": json(200, { data: { rules: [] } }),
        "POST /api/v1/rules": json(200, { status: "success" }),
      },
    });
    assert.equal(await run(ctx), 0);
    const routes = calls.map((call) => call.route);
    assert.ok(routes.includes("PUT /api/v1/dashboards/d-1"));
    assert.ok(routes.includes("POST /api/v1/dashboards"));
    const outcomes = ctx.results.filter((item) => item.kind === "dashboard");
    assert.deepEqual(outcomes.map((item) => item.outcome).sort(), [
      ProvisionOutcome.Created,
      ProvisionOutcome.Updated,
    ]);
  });

  it("sets preferredChannels on rules from the configured channels", async () => {
    const { ctx, calls } = makeCtx({
      env: {
        SIGNOZ_ALERT_WEBHOOK_URL: "http://hook.invalid/x",
        SIGNOZ_ALERT_EMAIL_TO: "ops@b.c",
      },
      dir: fixturesDir,
      routes: {
        "GET /api/v1/health": health,
        "POST /api/v1/register": alreadyInitialised,
        "POST /api/v1/login": okLogin,
        "GET /api/v1/channels": json(200, { data: [] }),
        "POST /api/v1/channels": json(200, { status: "success" }),
        "GET /api/v1/dashboards": json(200, { data: [] }),
        "POST /api/v1/dashboards": json(200, {}),
        "GET /api/v1/rules": json(200, { data: { rules: [] } }),
        "POST /api/v1/rules": json(200, {}),
      },
    });
    assert.equal(await run(ctx), 0);
    const rule = calls.find((call) => call.route === "POST /api/v1/rules");
    assert.deepEqual(rule.body.preferredChannels, ["af-webhook", "af-email"]);
  });

  it("exits 1 when an item fails", async () => {
    const { ctx } = makeCtx({
      dir: fixturesDir,
      routes: {
        "GET /api/v1/health": health,
        "POST /api/v1/register": alreadyInitialised,
        "POST /api/v1/login": okLogin,
        "GET /api/v1/dashboards": json(200, { data: [] }),
        "POST /api/v1/dashboards": json(500, { errorType: "internal" }),
        "GET /api/v1/rules": json(200, { data: { rules: [] } }),
        "POST /api/v1/rules": json(200, {}),
      },
    });
    assert.equal(await run(ctx), 1);
  });
});

describe("provisioned JSON files", () => {
  for (const [dir, key] of [
    ["dashboards", "title"],
    ["alerts", "alert"],
  ]) {
    it(`every ${dir}/*.json parses and has ${key}`, async () => {
      const folder = path.join(provisionDir, dir);
      const names = (await readdir(folder)).filter((name) =>
        name.endsWith(".json")
      );
      for (const name of names) {
        const parsed = JSON.parse(
          await readFile(path.join(folder, name), "utf8")
        );
        assert.ok(parsed[key], `${dir}/${name} is missing "${key}"`);
      }
    });
  }
});
