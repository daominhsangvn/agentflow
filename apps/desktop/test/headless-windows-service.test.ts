import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import {
  applyServiceChoice,
  elevationCommand,
  parseServiceState,
  programFolderWarning,
  renderElevatedScript,
  renderServiceXml,
  ServiceOutcome,
  type ServiceSpec,
  ServiceState,
  serviceDisplayName,
  serviceFiles,
  serviceId,
  UAC_CANCELLED_EXIT_CODE,
  type WindowsServiceDeps,
  winswSourcePath,
} from "../src/headless/headless-windows-service.js";

const BASE = path.resolve("/data");
const PROGRAM = path.resolve("/prog");

function spec(
  projectKey: string | null = null,
  programDir = PROGRAM
): ServiceSpec {
  return {
    id: serviceId(projectKey),
    instanceDataDir: BASE,
    projectKey,
    nodePath: "node.exe",
    programDir,
    baseDataDir: BASE,
  };
}

type Fake = WindowsServiceDeps & {
  runs: { file: string; args: string[] }[];
  scripts: string[];
  written: Map<string, string>;
  copies: [string, string][];
};

function fakeDeps(options: {
  state?: string;
  exeExists?: boolean;
  hashes?: Record<string, string>;
  active?: number;
  confirm?: boolean;
  elevatedCode?: number;
}): Fake {
  const runs: Fake["runs"] = [];
  const scripts: string[] = [];
  const written = new Map<string, string>();
  const copies: [string, string][] = [];
  const source = winswSourcePath(PROGRAM);
  return {
    runs,
    scripts,
    written,
    copies,
    run: (file, args) => {
      runs.push({ file, args });
      if (file === "powershell.exe") {
        return Promise.resolve({
          code: options.elevatedCode ?? 0,
          stdout: "",
          stderr: "",
        });
      }
      return Promise.resolve({
        code: 0,
        stdout: options.state ?? "",
        stderr: "",
      });
    },
    env: { USERDOMAIN: "PC", USERNAME: "dev" },
    say: () => undefined,
    confirm: () => Promise.resolve(options.confirm ?? false),
    activeCommands: () => options.active ?? 0,
    fileSha256: (file) => options.hashes?.[file] ?? null,
    exists: (file) => (file === source ? true : (options.exeExists ?? false)),
    mkdir: () => undefined,
    writeFile: (file, content) => {
      written.set(file, content);
      if (file.endsWith("elevated.cmd")) {
        scripts.push(content);
      }
    },
    copyFile: (from, to) => {
      copies.push([from, to]);
    },
    removeFile: () => undefined,
  };
}

test("service id and display name", () => {
  assert.equal(serviceId(null), "agentflow-agent");
  assert.equal(serviceId("PRO-1"), "agentflow-agent-pro-1");
  assert.equal(serviceDisplayName(null), "AgentFlow Agent");
  assert.equal(serviceDisplayName("PRO-1"), "AgentFlow Agent (PRO-1)");
});

test("personal service xml has project, env and escapes", () => {
  const xml = renderServiceXml({
    ...spec("PRO-1", "/a&b's"),
    baseDataDir: "/d",
  });
  assert.ok(xml.includes("--project PRO-1"));
  assert.ok(!xml.includes("--role"));
  assert.ok(xml.includes("AGENTFLOW_RUNNER_DATA_DIR"));
  assert.ok(
    xml.includes('AGENTFLOW_RUNNER_SERVICE" value="agentflow-agent-pro-1"')
  );
  assert.ok(xml.includes("GIT_TERMINAL_PROMPT"));
  assert.ok(xml.includes("GCM_INTERACTIVE"));
  assert.ok(xml.includes("a&amp;b&apos;s"));
  assert.ok(!renderServiceXml(spec()).includes("--project"));
});

test("parseServiceState", () => {
  assert.equal(parseServiceState("Started\r\n"), ServiceState.Started);
  assert.equal(parseServiceState("stopped"), ServiceState.Stopped);
  assert.equal(parseServiceState("NonExistent"), ServiceState.NonExistent);
  assert.equal(parseServiceState("garbage"), null);
});

test("elevated script and command", () => {
  const script = renderElevatedScript("t", [["a b", "50%"]], [["undo"]]);
  assert.ok(script.includes("\r\n"));
  assert.ok(script.includes('"a b" "50%%"'));
  assert.ok(script.includes("pause"));
  assert.ok(elevationCommand("C:\\it's\\x.cmd").args[3].includes("it''s"));
});

test("fresh install runs install /p then start elevated", async () => {
  const deps = fakeDeps({ state: "NonExistent" });
  const outcome = await applyServiceChoice(spec(), true, deps);
  const files = serviceFiles(spec());
  assert.equal(outcome, ServiceOutcome.Installed);
  assert.ok(deps.written.has(files.xml));
  assert.deepEqual(deps.copies[0], [winswSourcePath(PROGRAM), files.exe]);
  assert.ok(deps.scripts[0].includes('"install" "/p"'));
  assert.ok(deps.scripts[0].indexOf("/p") < deps.scripts[0].indexOf('"start"'));
});

test("existing started service with same hash restarts", async () => {
  const files = serviceFiles(spec());
  const source = winswSourcePath(PROGRAM);
  const deps = fakeDeps({
    state: "Started",
    exeExists: true,
    hashes: { [source]: "h", [files.exe]: "h" },
  });
  assert.equal(
    await applyServiceChoice(spec(), true, deps),
    ServiceOutcome.Updated
  );
  assert.ok(deps.scripts[0].includes('"restart"'));
});

test("changed exe is staged then stop, move, start", async () => {
  const files = serviceFiles(spec());
  const source = winswSourcePath(PROGRAM);
  const deps = fakeDeps({
    state: "Started",
    exeExists: true,
    hashes: { [source]: "new", [files.exe]: "old" },
  });
  await applyServiceChoice(spec(), true, deps);
  assert.deepEqual(deps.copies[0], [source, `${files.exe}.new`]);
  const s = deps.scripts[0];
  const moveLine = `move /y "${files.exe}.new" "${files.exe}"`;
  assert.ok(s.includes(`\r\n${moveLine}\r\n`), s);
  assert.ok(s.indexOf('"stop"') < s.indexOf(moveLine));
  assert.ok(s.indexOf(moveLine) < s.lastIndexOf('"start"'));
});

test("declined active loops runs nothing elevated", async () => {
  const deps = fakeDeps({
    state: "Started",
    exeExists: true,
    active: 2,
    confirm: false,
  });
  assert.equal(
    await applyServiceChoice(spec(), true, deps),
    ServiceOutcome.Declined
  );
  assert.equal(deps.scripts.length, 0);
});

test("not wanted removes via stop and uninstall", async () => {
  const deps = fakeDeps({ state: "Started", exeExists: true });
  assert.equal(
    await applyServiceChoice(spec(), false, deps),
    ServiceOutcome.Removed
  );
  assert.ok(
    deps.scripts[0].indexOf('"stop"') < deps.scripts[0].indexOf('"uninstall"')
  );
});

test("UAC cancel is reported as cancelled", async () => {
  const deps = fakeDeps({
    state: "NonExistent",
    elevatedCode: UAC_CANCELLED_EXIT_CODE,
  });
  assert.equal(
    await applyServiceChoice(spec(), true, deps),
    ServiceOutcome.Cancelled
  );
});

test("programFolderWarning", () => {
  const dirs = { homeDir: "/home/u", tmpDir: "/tmp" };
  assert.ok(
    programFolderWarning(path.join("/home/u", "Downloads", "agent"), dirs)
  );
  assert.ok(programFolderWarning("/tmp/x", dirs));
  assert.equal(programFolderWarning("/opt/agent", dirs), null);
});

test("a server-keyed Agent gets its own service id, name and --server argument", () => {
  const id = serviceId("PRO-1", "host-3002");
  assert.equal(id, "agentflow-agent-pro-1-host-3002");
  assert.equal(
    serviceDisplayName("PRO-1", "host-3002"),
    "AgentFlow Agent (PRO-1 @ host-3002)"
  );
  const xml = renderServiceXml({
    ...spec("PRO-1"),
    id,
    server: "host-3002",
  });
  assert.ok(xml.includes("--project PRO-1 --server host-3002"));
  assert.ok(xml.includes(`value="${id}"`));
  assert.ok(!renderServiceXml(spec("PRO-1")).includes("--server"));
});
