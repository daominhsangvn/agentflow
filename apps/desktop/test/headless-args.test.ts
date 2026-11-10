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
      server: null,
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

test("check needs --project and only works as the first argument", () => {
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

test("--server is reduced to the server slug", () => {
  const result = parseRunnerArgs([
    "--project",
    "pro-1",
    "--server",
    "http://LocalHost:3002",
  ]);
  assert.equal(result.ok && result.value.server, "localhost-3002");
});

test("--server works with run, setup, uninstall and check", () => {
  for (const command of ["setup", "uninstall", "check"]) {
    const result = parseRunnerArgs([
      command,
      "--project",
      "PRO-1",
      "--server",
      "host",
    ]);
    assert.equal(result.ok && result.value.server, "host");
  }
});

test("--server needs --project and a valid value", () => {
  assert.equal(parseRunnerArgs(["--server", "x"]).ok, false);
  assert.equal(parseRunnerArgs(["--project", "PRO-1", "--server"]).ok, false);
  assert.equal(
    parseRunnerArgs(["--project", "PRO-1", "--server", "a b"]).ok,
    false
  );
});
