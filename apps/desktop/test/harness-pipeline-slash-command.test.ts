import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import {
  buildClaudePipeline,
  slashCommandConversionPrefix,
} from "../src/server/operations/harness-pipeline.js";

const STEP_PROMPT = "/writing-plans LD-7\n\nRevise the plan.";
const AMEND_PROMPT = '/code:amend-plan --workdir C:/w --message "fix"';

test("Windows: the slash commands of the arguments are excluded from Git Bash path conversion", () => {
  assert.equal(
    slashCommandConversionPrefix(
      ["-p", "--verbose", "--", STEP_PROMPT, AMEND_PROMPT, STEP_PROMPT],
      "win32"
    ),
    `MSYS2_ARG_CONV_EXCL="\${MSYS2_ARG_CONV_EXCL:+$MSYS2_ARG_CONV_EXCL;}"'/writing-plans;/code:amend-plan' `
  );
});

test("no prefix without a slash command, or off Windows", () => {
  assert.equal(
    slashCommandConversionPrefix(
      ["-p", "-", "Plain prompt /not-a-command"],
      "win32"
    ),
    ""
  );
  assert.equal(slashCommandConversionPrefix(["/", "/ x"], "win32"), "");
  assert.equal(slashCommandConversionPrefix(["--", STEP_PROMPT], "darwin"), "");
  assert.equal(slashCommandConversionPrefix(["--", STEP_PROMPT], "linux"), "");
});

test("the prefix keeps an exclusion list the environment already has", () => {
  const prefix = slashCommandConversionPrefix(["--", STEP_PROMPT], "win32");
  const value = execFileSync(
    "bash",
    ["-c", `${prefix}printenv MSYS2_ARG_CONV_EXCL`],
    { env: { ...process.env, MSYS2_ARG_CONV_EXCL: "/x" }, encoding: "utf8" }
  ).trim();
  assert.equal(value, "/x;/writing-plans");
  const alone = execFileSync(
    "bash",
    ["-c", `${prefix}printenv MSYS2_ARG_CONV_EXCL`],
    {
      env: { ...process.env, MSYS2_ARG_CONV_EXCL: "" },
      encoding: "utf8",
    }
  ).trim();
  assert.equal(alone, "/writing-plans");
});

test("the claude invocation is unchanged off Windows", () => {
  const pipeline = buildClaudePipeline(
    ["-p", "--", STEP_PROMPT],
    "/tmp/work",
    "/usr/local/bin/claude",
    undefined,
    "darwin"
  );
  const script = pipeline.args[1] ?? "";
  assert.ok(script.startsWith("'/usr/local/bin/claude' '-p' '--' "), script);
  assert.ok(!script.includes("MSYS2_ARG_CONV_EXCL"));
});
