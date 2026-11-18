// Fake `claude` CLI for tests. Plain node, no dependencies. Run as: node <this file> ...args
//
// --version                     prints "<FAKE_CLAUDE_VERSION or 2.1.322> (Claude Code)" and exits 0.
// otherwise                     reads all of stdin, then
//   FAKE_CLAUDE_RECORD          (path) writes { argv, cwd, env, stdin, files } as JSON.
//   FAKE_CLAUDE_SCENARIO        (path to a JSON array) plays each step:
//     "text"                    a stdout line
//     { "write": "text" }       raw stdout write (no newline added)
//     { "big": n }              one stdout line of n characters
//     { "sleep": ms }           waits
//     { "spawnChild": true }    starts a long-sleeping grandchild; its pid is appended to the file
//                               FAKE_CLAUDE_CHILD_PID_FILE (one pid per line)
//     { "exit": code }          stops playing and exits with code
// The process and its grandchildren always end on their own after a minute, so a failed test
// cannot leave them behind.
import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const SAFETY_EXIT_MS = 60_000;
setTimeout(() => process.exit(3), SAFETY_EXIT_MS).unref();

const argv = process.argv.slice(2);

if (argv.includes("--version")) {
  process.stdout.write(
    `${process.env.FAKE_CLAUDE_VERSION ?? "2.1.322"} (Claude Code)\n`
  );
  process.exit(0);
}

const stdin = await readStdin();

if (process.env.FAKE_CLAUDE_RECORD) {
  writeFileSync(
    process.env.FAKE_CLAUDE_RECORD,
    JSON.stringify({
      argv,
      cwd: process.cwd(),
      env: process.env,
      stdin,
      files: listFiles(process.cwd(), ""),
    })
  );
}

let exitCode = 0;
if (
  process.env.FAKE_CLAUDE_SCENARIO &&
  existsSync(process.env.FAKE_CLAUDE_SCENARIO)
) {
  const steps = JSON.parse(
    readFileSync(process.env.FAKE_CLAUDE_SCENARIO, "utf8")
  );
  for (const step of steps) {
    if (typeof step === "string") {
      process.stdout.write(`${withWorkDir(step)}\n`);
    } else if ("write" in step) {
      process.stdout.write(step.write);
    } else if ("big" in step) {
      process.stdout.write(`${"x".repeat(step.big)}\n`);
    } else if ("sleep" in step) {
      await new Promise((resolve) => setTimeout(resolve, step.sleep));
    } else if ("spawnChild" in step) {
      startGrandchild();
    } else if ("exit" in step) {
      exitCode = step.exit;
      break;
    }
  }
}
process.exitCode = exitCode;

// "{{WORK_DIR}}" in a line becomes the real cwd (JSON-escaped, so lines stay valid JSON).
function withWorkDir(line) {
  return line.replaceAll(
    "{{WORK_DIR}}",
    JSON.stringify(process.cwd()).slice(1, -1)
  );
}

function startGrandchild() {
  const child = spawn(
    process.execPath,
    ["-e", `setTimeout(() => process.exit(0), ${SAFETY_EXIT_MS})`],
    { stdio: "ignore", windowsHide: true }
  );
  child.unref();
  if (process.env.FAKE_CLAUDE_CHILD_PID_FILE) {
    appendFileSync(process.env.FAKE_CLAUDE_CHILD_PID_FILE, `${child.pid}\n`);
  }
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8"))
    );
    process.stdin.on("error", reject);
  });
}

function listFiles(root, prefix) {
  const out = [];
  for (const name of readdirSync(path.join(root, prefix))) {
    const relative = prefix === "" ? name : `${prefix}/${name}`;
    if (statSync(path.join(root, relative)).isDirectory()) {
      out.push(...listFiles(root, relative));
    } else {
      out.push(relative);
    }
  }
  return out.sort();
}
