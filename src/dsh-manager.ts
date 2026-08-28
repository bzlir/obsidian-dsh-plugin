import { ChildProcess, spawn, execFileSync } from "child_process";
import http from "http";
import { createServer, createConnection } from "net";
import { homedir } from "os";
import { existsSync, readdirSync, realpathSync } from "fs";
import { dirname, join } from "path";

const DSH_COMMAND = "dsh";
const STARTUP_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;
const SHUTDOWN_GRACE_MS = 5_000;

interface ResolvedBin {
  node: string;
  dshScript: string;
}

function candidateBinDirs(customPaths: string[] = []): string[] {
  const home = homedir();
  const dirs: string[] = [];
  const nvmRoot = join(home, ".nvm", "versions", "node");
  try {
    for (const ver of readdirSync(nvmRoot)) dirs.push(join(nvmRoot, ver, "bin"));
  } catch {
    // nvm not installed
  }
  dirs.push("/opt/homebrew/bin", "/usr/local/bin");
  dirs.push(join(home, ".volta", "bin"));
  dirs.push(join(home, ".asdf", "shims"));
  dirs.push(join(home, ".local", "bin"));
  dirs.push(join(home, "bin"));
  dirs.push(join(home, ".fnm", "aliases", "default", "bin"));
  // User-provided paths from plugin settings — highest priority, prepended.
  for (const p of customPaths) if (p) dirs.unshift(p);
  return dirs;
}

function augmentedEnv(customPaths: string[] = []): NodeJS.ProcessEnv {
  const base = process.env.PATH ?? "/usr/bin:/bin";
  const prepend: string[] = [];
  const seen = new Set(base.split(":"));
  for (const d of candidateBinDirs(customPaths)) {
    if (existsSync(d) && !seen.has(d)) {
      prepend.push(d);
      seen.add(d);
    }
  }
  return { ...process.env, PATH: [...prepend, ...base.split(":")].join(":") };
}

function runShell(cmd: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("/bin/zsh", ["-l", "-c", cmd], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", () => resolve(null));
    child.on("exit", () => resolve(out.trim() || null));
  });
}

function checkNodeHasZstd(nodePath: string): boolean {
  try {
    require("child_process").execFileSync(
      nodePath,
      ["-e", "process.exit(typeof require('zlib').createZstdDecompress === 'function' ? 0 : 1)"],
      { stdio: "pipe", timeout: 5000 }
    );
    return true;
  } catch {
    return false;
  }
}

function resolveNodeFromDsh(dshAbs: string): string | null {
  const binDir = dirname(dshAbs);
  const nodePath = join(binDir, "node");
  if (existsSync(nodePath) && checkNodeHasZstd(nodePath)) return nodePath;
  return null;
}

function findInDirs(name: string, dirs: string[]): string | null {
  for (const d of dirs) {
    const p = join(d, name);
    if (existsSync(p)) return p;
  }
  return null;
}

async function resolveBin(customPaths: string[] = []): Promise<ResolvedBin | null> {
  const env = augmentedEnv(customPaths);
  const dirs = candidateBinDirs(customPaths);

  const dshAbs = findInDirs(DSH_COMMAND, dirs);
  if (!dshAbs) return null;

  const dshScript = realpathSync(dshAbs);

  let nodePath = resolveNodeFromDsh(dshAbs);
  if (!nodePath) {
    const candidate = findInDirs("node", dirs);
    if (candidate && checkNodeHasZstd(candidate)) {
      nodePath = candidate;
    }
  }
  if (!nodePath) return null;

  return { node: nodePath, dshScript };
}

/**
 * Search the filesystem for `dsh` binaries.
 * Tries macOS Spotlight (mdfind) first — fast, indexed. Falls back to a
 * bounded `find` over common install roots. Returns deduplicated paths
 * whose parent directory could be added to customPaths.
 */
export function searchForDsh(): Promise<string[]> {
  return new Promise((resolve) => {
    const results = new Set<string>();
    // Phase 1: macOS Spotlight (instant if available).
    try {
      const out = execFileSync("mdfind", ["-name", "dsh"], { stdio: ["pipe", "pipe", "pipe"], timeout: 5000 }).toString();
      for (const line of out.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && trimmed.endsWith("/dsh")) results.add(trimmed);
      }
    } catch {
      // mdfind unavailable (non-macOS) or timed out — fall through to find.
    }
    if (results.size > 0) {
      resolve([...results]);
      return;
    }
    // Phase 2: bounded find over common roots.
    const roots = [homedir(), "/usr/local", "/opt/homebrew", "/usr/bin", "/opt"];
    const child = spawn("find", [...roots, "-name", "dsh", "-type", "f", "-maxdepth", "5"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", () => resolve([]));
    child.on("exit", () => {
      for (const line of out.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && trimmed.endsWith("/dsh")) results.add(trimmed);
      }
      resolve([...results]);
    });
    // Safety timeout.
    setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* already dead */ }
    }, 10_000);
  });
}

export class DshManager {
  private process: ChildProcess | null = null;
  private port: number | null = null;
  private stderrLines: string[] = [];
  private resolved: ResolvedBin | null = null;
  private exitHookInstalled = false;
  private trackedPid: number | null = null;
  private customPaths: string[] = [];
  private onUnexpectedExit: ((info: { code: number | null; signal: string | null; stderr: string }) => void) | null = null;

  setOnUnexpectedExit(cb: (info: { code: number | null; signal: string | null; stderr: string }) => void): void {
    this.onUnexpectedExit = cb;
  }

  setCustomPaths(paths: string[]): void {
    this.customPaths = paths.filter((p) => p && p.trim().length > 0);
    // Invalidate cached resolution so next isAvailable/start re-resolves.
    this.resolved = null;
  }

  async isAvailable(): Promise<boolean> {
    if (this.resolved) return true;
    const bin = await resolveBin(this.customPaths);
    if (bin) {
      this.resolved = bin;
      return true;
    }
    return false;
  }

  async start(vaultPath: string): Promise<number> {
    if (this.process) {
      throw new Error("DSH process is already running");
    }
    // Reap any orphaned dsh web processes from a previous crashed session.
    // They would otherwise pile up on every plugin reload / Obsidian restart.
    this.reapOrphanedDsh();
    if (!this.resolved) {
      const bin = await resolveBin(this.customPaths);
      if (!bin) throw new Error("DSH binary not found (need dsh + node>=22 with createZstdDecompress)");
      this.resolved = bin;
    }
    const port = await this.findFreePort();
    this.port = port;
    this.stderrLines = [];

    this.process = spawn(
      this.resolved.node,
      [this.resolved.dshScript, "web", "--port", String(port), "--host", "127.0.0.1", "--no-open"],
      { cwd: vaultPath, stdio: ["pipe", "pipe", "pipe"], env: augmentedEnv(this.customPaths) }
    );

    // Install process-exit guard the first time we spawn, so a hard kill of
    // Obsidian (SIGKILL/crash/Cmd+Q without unload) still tears down dsh.
    // Exit hooks must be minimal and fully synchronous — no child-process
    // spawning, no setTimeout, no async. The event loop is tearing down.
    if (!this.exitHookInstalled) {
      this.exitHookInstalled = true;
      const killSync = () => {
        const pid = this.trackedPid;
        if (pid == null) return;
        try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
      };
      process.on("exit", killSync);
      process.on("SIGTERM", killSync);
      process.on("SIGINT", killSync);
      process.on("SIGUSR2", killSync);
      process.on("SIGHUP", killSync);
    }

    this.trackedPid = this.process.pid ?? null;

    this.process.stderr?.on("data", (data: Buffer) => {
      const lines = data.toString().split("\n").filter((l) => l.trim());
      this.stderrLines.push(...lines);
      if (this.stderrLines.length > 50) {
        this.stderrLines = this.stderrLines.slice(-50);
      }
    });

    this.process.on("exit", (code, signal) => {
      const wasRunning = this.process !== null;
      this.process = null;
      if (wasRunning && this.onUnexpectedExit) {
        this.onUnexpectedExit({
          code,
          signal,
          stderr: this.stderrLines.join("\n"),
        });
      }
    });

    this.process.on("error", (err) => {
      this.process = null;
      if (this.onUnexpectedExit) {
        this.onUnexpectedExit({ code: null, signal: null, stderr: err.message });
      }
    });

    await this.waitForReady(port);
    await this.ensureWorkspace(port, vaultPath);
    return port;
  }

  private async ensureWorkspace(port: number, vaultPath: string): Promise<void> {
    const body = JSON.stringify({
      type: "client-request",
      rpcId: "workspace-init",
      method: "workspace.create",
      payload: { path: vaultPath },
    });
    try {
      const ok = await new Promise<boolean>((resolve) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/api/workspace.create",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": Buffer.byteLength(body),
            },
            timeout: 10_000,
          },
          (res) => {
            let data = "";
            res.on("data", (chunk: Buffer) => (data += chunk.toString()));
            res.on("end", () => {
              resolve(res.statusCode === 200 && data.includes("server-response"));
            });
          },
        );
        req.on("error", () => resolve(false));
        req.on("timeout", () => {
          req.destroy();
          resolve(false);
        });
        req.write(body);
        req.end();
      });
      if (!ok) console.warn("[DSH] workspace.create call may have failed");
    } catch (err) {
      console.warn("[DSH] failed to add vault as workspace:", (err as Error).message);
    }
  }

  stop(): void {
    if (this.process) {
      this.killTree();
      this.process = null;
      this.trackedPid = null;
    }
  }

  private killTree(): void {
    const proc = this.process;
    if (!proc || proc.pid == null) return;
    const rootPid = proc.pid;
    // Collect all descendant PIDs via pgrep -P recursion, then kill the tree.
    const descendants: number[] = [rootPid];
    try {
      const visited = new Set<number>();
      const stack = [rootPid];
      while (stack.length) {
        const parent = stack.pop()!;
        if (visited.has(parent)) continue;
        visited.add(parent);
        const result = execFileSync("pgrep", ["-P", String(parent)], { stdio: ["pipe", "pipe", "pipe"] });
        for (const line of result.toString().split("\n")) {
          const trimmed = line.trim();
          if (trimmed) {
            const childPid = Number(trimmed);
            if (Number.isFinite(childPid) && !visited.has(childPid)) {
              descendants.push(childPid);
              stack.push(childPid);
            }
          }
        }
      }
    } catch {
      // pgrep unavailable or process already gone — fall back to root only.
    }
    // SIGTERM children first, root last; then SIGKILL stragglers.
    for (const pid of [...descendants].reverse()) {
      try { process.kill(pid, "SIGTERM"); } catch { /* already dead */ }
    }
    setTimeout(() => {
      for (const pid of [...descendants].reverse()) {
        try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
      }
    }, SHUTDOWN_GRACE_MS);
  }

  private killTreeSync(): void {
    // Synchronous variant for process exit hooks — setTimeout never fires
    // inside 'exit', so we go straight to SIGKILL for the whole tree.
    const proc = this.process;
    if (!proc || proc.pid == null) return;
    const rootPid = proc.pid;
    const descendants: number[] = [rootPid];
    try {
      const visited = new Set<number>();
      const stack = [rootPid];
      while (stack.length) {
        const parent = stack.pop()!;
        if (visited.has(parent)) continue;
        visited.add(parent);
        const result = execFileSync("pgrep", ["-P", String(parent)], { stdio: ["pipe", "pipe", "pipe"] });
        for (const line of result.toString().split("\n")) {
          const trimmed = line.trim();
          if (trimmed) {
            const childPid = Number(trimmed);
            if (Number.isFinite(childPid) && !visited.has(childPid)) {
              descendants.push(childPid);
              stack.push(childPid);
            }
          }
        }
      }
    } catch {
      // pgrep unavailable or process already gone.
    }
    for (const pid of [...descendants].reverse()) {
      try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
    }
  }

  reapOrphanedDsh(): void {
    // Kill any lingering `dsh web` processes from a previous crashed session.
    // Identified by matching the dsh bin path + "web" in the command line.
    try {
      const out = execFileSync("pgrep", ["-f", "dsh/lib/bin.js web"], { stdio: ["pipe", "pipe", "pipe"] });
      for (const line of out.toString().split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          const pid = Number(trimmed);
          if (Number.isFinite(pid)) {
            try { process.kill(pid, "SIGKILL"); } catch { /* already dead */ }
          }
        }
      }
    } catch {
      // pgrep returns non-zero when no matches — no orphans, nothing to do.
    }
  }

  isRunning(): boolean {
    return this.process !== null;
  }

  getPort(): number | null {
    return this.port;
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          const port = addr.port;
          server.close(() => resolve(port));
        } else {
          server.close();
          reject(new Error("Failed to find a free port"));
        }
      });
      server.on("error", reject);
    });
  }

  private async waitForReady(port: number): Promise<void> {
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    // Phase 1: wait for TCP port to accept connections (webserver bound).
    while (Date.now() < deadline) {
      if (this.process === null) {
        throw new Error(
          `DSH process exited before becoming ready.\nStderr:\n${this.stderrLines.join("\n")}`
        );
      }
      if (await this.checkPort(port)) break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    // Phase 2: wait for the API gateway to actually serve requests.
    // The port opens early (webserver binds), but apiProxy and its 11
    // dependencies take longer to activate. Loading the iframe before
    // the API is ready causes client-side "N entries did not activate".
    while (Date.now() < deadline) {
      if (this.process === null) {
        throw new Error(
          `DSH process exited before API became ready.\nStderr:\n${this.stderrLines.join("\n")}`
        );
      }
      if (await this.checkApiReady(port)) return;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`DSH API did not become ready within ${STARTUP_TIMEOUT_MS / 1000}s`);
  }

  private checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const conn = createConnection({ host: "127.0.0.1", port }, () => {
        conn.destroy();
        resolve(true);
      });
      conn.on("error", () => resolve(false));
      conn.setTimeout(1000, () => {
        conn.destroy();
        resolve(false);
      });
    });
  }

  private checkApiReady(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const body = JSON.stringify({
        type: "client-request",
        rpcId: "ready-probe",
        method: "session.list",
        payload: { cursor: null, limit: 1 },
      });
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/session.list",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: 3000,
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => (data += chunk.toString()));
          res.on("end", () => {
            // 200 with valid JSON-RPC envelope means apiProxy is live.
            resolve(res.statusCode === 200 && data.includes("server-response"));
          });
        },
      );
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
      req.write(body);
      req.end();
    });
  }
}
