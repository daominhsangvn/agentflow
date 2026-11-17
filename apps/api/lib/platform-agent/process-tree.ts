import { spawn } from "node:child_process";

const TASKKILL_TIMEOUT_MS = 10_000;
const SIGKILL_DELAY_MS = 3000;

/**
 * Kills a child process we spawned and everything it started. Only ever call it with the pid of a
 * child this process spawned (on POSIX that child is its own process group leader, see
 * `detached` in `cli-runner.ts`). The returned promise never rejects; on Windows it resolves once
 * `taskkill` has finished (or timed out), without blocking the event loop.
 */
export function killProcessTree(
  pid: number,
  platform: NodeJS.Platform = process.platform
): Promise<void> {
  if (platform === "win32") {
    return runTaskkill(pid);
  }
  signalGroup(pid, "SIGTERM");
  setTimeout(() => signalGroup(pid, "SIGKILL"), SIGKILL_DELAY_MS).unref();
  return Promise.resolve();
}

function runTaskkill(pid: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let killer: ReturnType<typeof spawn>;
    try {
      killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      });
    } catch {
      // observability: taskkill could not start; the runner's grace timer reports the end
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      killer.kill();
      resolve();
    }, TASKKILL_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    killer.on("error", done);
    killer.on("close", done);
  });
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // observability: the group already exited (ESRCH) or is not ours to signal
  }
}
