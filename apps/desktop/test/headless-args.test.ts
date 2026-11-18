import assert from "node:assert/strict";
import test from "node:test";
import { parseRunnerArgs } from "../src/headless/headless-args.js";

const ROLE = "Dev (LeaveDesk, An)";

test("no arguments is the auto runner", () => {
  assert.deepEqual(parseRunnerArgs([]), {
    ok: true,
    value: {
      setup: false,
      uninstall: false,
      check: false,
      projectKey: null,
      role: null,
      name: null,
    },
  });
});

test("--project is normalized", () => {
  const result = parseRunnerArgs(["--project", "pro-1"]);
  assert.equal(result.ok && result.value.projectKey, "PRO-1");
});

test("setup with a project", () => {
  const result = parseRunnerArgs(["setup", "--project", "PRO-1"]);
  assert.equal(result.ok && result.value.setup, true);
  assert.equal(result.ok && result.value.projectKey, "PRO-1");
});

test("--role is trimmed", () => {
  const result = parseRunnerArgs(["--project", "PRO-1", "--role", ` ${ROLE} `]);
  assert.equal(result.ok && result.value.role, ROLE);
});

test("--role needs a valid value", () => {
  assert.equal(parseRunnerArgs(["--project", "PRO-1", "--role"]).ok, false);
  assert.equal(
    parseRunnerArgs(["--project", "PRO-1", "--role", "x".repeat(121)]).ok,
    false
  );
});

test("--role needs --project and a start", () => {
  assert.equal(parseRunnerArgs(["--role", "X"]).ok, false);
  assert.equal(
    parseRunnerArgs(["setup", "--project", "PRO-1", "--role", "X"]).ok,
    false
  );
  assert.equal(
    parseRunnerArgs(["uninstall", "--project", "PRO-1", "--role", "X"]).ok,
    false
  );
});

test("an unknown argument is an error", () => {
  assert.equal(parseRunnerArgs(["--nope"]).ok, false);
});

test("check needs --project or --name and only works as the first argument", () => {
  const ok = parseRunnerArgs(["check", "--project", "pro-1"]);
  assert.equal(ok.ok && ok.value.check, true);
  assert.equal(ok.ok && ok.value.projectKey, "PRO-1");
  assert.equal(parseRunnerArgs(["check"]).ok, false);
  assert.equal(
    parseRunnerArgs(["check", "--project", "PRO-1", "--role", "X"]).ok,
    false
  );
  assert.equal(parseRunnerArgs(["--project", "PRO-1", "check"]).ok, false);
});

test("--name is kept as typed and trimmed", () => {
  const result = parseRunnerArgs(["--name", "  Sang Dao-PRO-1 "]);
  assert.equal(result.ok && result.value.name, "Sang Dao-PRO-1");
});

test("--name works with run, setup, uninstall and check, alone or with --project", () => {
  for (const command of [null, "setup", "uninstall", "check"]) {
    const prefix = command ? [command] : [];
    const alone = parseRunnerArgs([...prefix, "--name", "an-pro-1"]);
    assert.equal(alone.ok && alone.value.name, "an-pro-1");
    const both = parseRunnerArgs([
      ...prefix,
      "--project",
      "PRO-1",
      "--name",
      "an-pro-1",
    ]);
    assert.equal(both.ok && both.value.name, "an-pro-1");
    assert.equal(both.ok && both.value.projectKey, "PRO-1");
  }
});

test("--name needs a valid value", () => {
  assert.equal(parseRunnerArgs(["--name"]).ok, false);
  assert.equal(parseRunnerArgs(["--name", "  "]).ok, false);
  assert.equal(parseRunnerArgs(["--name", "運用"]).ok, false);
});

test("check --name works without --project", () => {
  const result = parseRunnerArgs(["check", "--name", "x"]);
  assert.equal(result.ok && result.value.check, true);
});

test("--role with --name alone is valid", () => {
  const result = parseRunnerArgs(["--name", "x", "--role", ROLE]);
  assert.equal(result.ok && result.value.role, ROLE);
});

test("--server is an unknown argument", () => {
  assert.equal(
    parseRunnerArgs(["--project", "PRO-1", "--server", "h"]).ok,
    false
  );
});
