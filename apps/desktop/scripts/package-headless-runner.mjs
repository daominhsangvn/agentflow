#!/usr/bin/env node
/**
 * Packages the headless runner for direct installation on a Linux server
 * (systemd), as an alternative to the Docker image:
 *
 *   dist-headless/agentflow-runner-<version>-linux.tar.gz
 *     agentflow-runner/
 *       runner.mjs, healthcheck.mjs      the bundle (build-headless-runner.mjs)
 *       agent-plugins/                   the vendored Claude Code plugins
 *       entrypoint.sh                    git/gh setup, shared with the image
 *       install.sh                       installer (Ubuntu/Debian)
 *       agentflow-runner.service        systemd unit
 *       runner.env.example               configuration template
 *
 *   pnpm -C apps/desktop package:headless
 *
 * On the server: tar -xzf <file> && sudo bash agentflow-runner/install.sh
 *
 * With --windows, packages it for running directly on Windows instead
 * (docs/runner.md "Option D: Windows"):
 *
 *   dist-headless/agentflow-runner-<version>-windows.zip
 *     agentflow-runner/
 *       runner.mjs, healthcheck.mjs      the bundle
 *       agent-plugins/                   the vendored Claude Code plugins
 *       start-runner.cmd                 starts it (asks the setup questions
 *                                        on the first start)
 *       setup-runner.cmd                 asks the setup questions again
 *       uninstall-runner.cmd             removes the Windows service, optionally
 *                                        the data
 *       winsw/WinSW.exe, winsw/LICENSE.txt
 *                                        WinSW v2.12.0 (MIT), the service wrapper
 *       README.txt
 *
 *   pnpm -C apps/desktop package:headless --windows
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(appDir, "../..");
const distDir = path.join(appDir, "dist-headless");
const stageRoot = path.join(distDir, "package");
const stageDir = path.join(stageRoot, "agentflow-runner");
const deployDir = path.join(repoRoot, "deploy/runner");
const EXCLUDED_PLUGIN_DIRS = new Set(["tests", "__pycache__", ".pytest_cache"]);
const WINDOWS_FILES = [
  "start-runner.cmd",
  "setup-runner.cmd",
  "uninstall-runner.cmd",
  "README.txt",
];
const WINSW_URL =
  "https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe";
const WINSW_SHA256 =
  "b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f";
const WINSW_CACHE = path.join(distDir, "cache", "WinSW.NET461-v2.12.0.exe");
const LINE_END_RE = /\r?\n/g;
const forWindows = process.argv.includes("--windows");

execFileSync(
  process.execPath,
  [path.join(appDir, "scripts/build-headless-runner.mjs")],
  {
    stdio: "inherit",
  }
);

rmSync(stageRoot, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

for (const file of [
  "runner.mjs",
  "runner.mjs.map",
  "runner.mjs.LEGAL.txt",
  "healthcheck.mjs",
  "healthcheck.mjs.map",
]) {
  cpSync(path.join(distDir, file), path.join(stageDir, file), { force: true });
}
cpSync(
  path.join(repoRoot, "agent-plugins"),
  path.join(stageDir, "agent-plugins"),
  {
    recursive: true,
    filter: (source) => !EXCLUDED_PLUGIN_DIRS.has(path.basename(source)),
  }
);
const { version } = JSON.parse(
  readFileSync(path.join(appDir, "package.json"), "utf8")
);
const archive = forWindows
  ? await packageForWindows(version)
  : packageForLinux(version);
console.log(`Packaged ${path.relative(appDir, archive)}`);

function packageForLinux(version) {
  cpSync(
    path.join(deployDir, "entrypoint.sh"),
    path.join(stageDir, "entrypoint.sh")
  );
  for (const file of [
    "install.sh",
    "agentflow-runner.service",
    "runner.env.example",
  ]) {
    cpSync(path.join(deployDir, "linux", file), path.join(stageDir, file));
  }
  const archive = path.join(
    distDir,
    `agentflow-runner-${version}-linux.tar.gz`
  );
  rmSync(archive, { force: true });
  // Relative paths: GNU tar reads "D:\..." on Windows as a remote host.
  execFileSync(
    "tar",
    [
      "-czf",
      path.basename(archive),
      "-C",
      path.basename(stageRoot),
      "agentflow-runner",
    ],
    { cwd: distDir, stdio: "inherit" }
  );
  return archive;
}

async function packageForWindows(version) {
  // cmd.exe misreads some LF-only batch files; Notepad wants CRLF too.
  for (const file of WINDOWS_FILES) {
    const content = readFileSync(path.join(deployDir, "windows", file), "utf8");
    writeFileSync(
      path.join(stageDir, file),
      content.replace(LINE_END_RE, "\r\n")
    );
  }
  const winswDir = path.join(stageDir, "winsw");
  mkdirSync(winswDir, { recursive: true });
  writeFileSync(path.join(winswDir, "WinSW.exe"), await ensureWinsw());
  const license = readFileSync(
    path.join(deployDir, "windows", "winsw-LICENSE.txt"),
    "utf8"
  );
  writeFileSync(
    path.join(winswDir, "LICENSE.txt"),
    license.replace(LINE_END_RE, "\r\n")
  );
  const archive = path.join(distDir, `agentflow-runner-${version}-windows.zip`);
  rmSync(archive, { force: true });
  const zip = new AdmZip();
  zip.addLocalFolder(stageDir, "agentflow-runner");
  zip.writeZip(archive);
  return archive;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// WinSW v2.12.0, cached in dist-headless/cache and verified against a pinned hash.
async function ensureWinsw() {
  if (existsSync(WINSW_CACHE)) {
    const cached = readFileSync(WINSW_CACHE);
    if (sha256(cached) === WINSW_SHA256) {
      return cached;
    }
  }
  const response = await fetch(WINSW_URL);
  if (!response.ok) {
    throw new Error(`WinSW download failed: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const actual = sha256(buffer);
  if (actual !== WINSW_SHA256) {
    throw new Error(
      `WinSW download sha256 mismatch: expected ${WINSW_SHA256}, got ${actual}`
    );
  }
  mkdirSync(path.dirname(WINSW_CACHE), { recursive: true });
  writeFileSync(WINSW_CACHE, buffer);
  return buffer;
}
