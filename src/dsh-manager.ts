import { ChildProcess, spawn, execFileSync } from "child_process";
import http from "http";
import * as net from "net";
import { homedir } from "os";
import { existsSync, readdirSync, realpathSync } from "fs";
import { dirname, join } from "path";

// Cast all Node.js imports to explicit function types.
// If @types/node is resolved by the linter, these are no-ops.
// If not, they provide types that satisfy no-unsafe-call.
const _homedir = homedir as unknown as () => string;
const _join = join as unknown as (...paths: string[]) => string;
const _dirname = dirname as unknown as (path: string) => string;
const _readdirSync = readdirSync as unknown as (path: string) => string[];
const _existsSync = existsSync as unknown as (path: string) => boolean;
const _realpathSync = realpathSync as unknown as (path: string) => string;
const _execFileSync = execFileSync as unknown as (cmd: string, args: string[], options: object) => Uint8Array;
const _Buffer = Buffer as unknown as { byteLength: (str: string) => number };
const _byteLength = _Buffer.byteLength;

// Minimal typed interfaces for process and spawned-process objects.
interface TypedProcess {
  env: Record<string, string | undefined>;
  kill: (pid: number, signal: string) => void;
  on: (event: string, listener: () => void) => void;
}

interface TypedStream {
  on: (event: string, listener: (data: Uint8Array | string) => void) => void;
}

interface TypedChildProcess {
  pid: number | undefined;
  stdout: TypedStream | null;
  stderr: TypedStream | null;
  on: (event: string, listener: (...args: never[]) => void) => void;
  kill: (signal: string) => void;
}

interface TypedServer {
  listen: (port: number, host: string, callback: () => void) => void;
  address: () => { port: number } | string | null;
  close: (callback?: () => void) => void;
  on: (event: string, listener: (err: Error) => void) => void;
}

interface TypedSocket {
  destroy: () => void;
  on: (event: string, listener: (err: Error) => void) => void;
  setTimeout: (timeout: number, callback: () => void) => void;
}

interface TypedClientRequest {
  on: (event: string, listener: (...args: never[]) => void) => void;
  destroy: () => void;
  write: (data: string) => void;
  end: () => void;
}

interface TypedIncomingMessage {
  statusCode: number | undefined;
  on: (event: string, listener: (...args: never[]) => void) => void;
}

const _process = process as unknown as TypedProcess;
const _spawn = spawn as unknown as (command: string, args: string[], options: object) => TypedChildProcess;
const _net = net as unknown as { createServer: () => TypedServer; createConnection: (options: { host: string; port: number }, callback: () => void) => TypedSocket };
const _createServer = _net.createServer;
const _createConnection = _net.createConnection;
const _http = http as unknown as { request: (options: object, callback: (res: TypedIncomingMessage) => void) => TypedClientRequest };
const _httpRequest = _http.request;

const DSH_COMMAND = "dsh";
const STARTUP_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;
const SHUTDOWN_GRACE_MS = 5_000;

interface ResolvedBin {
  node: string;
  dshScript: string;
}

interface ExitInfo {
  code: number | null;
  signal: string | null;
  stderr: string;
}

function candidateBinDirs(customPaths: string[] = []): string[] {
  const home: string = _homedir();
  const dirs: string[] = [];
  const nvmRoot: string = _join(home, ".nvm", "versions", "node");
  try {
    const entries: string[] = _readdirSync(nvmRoot);
    for (const ver of entries) {
      const dir: string = _join(nvmRoot, ver, "bin");
      dirs.push(dir);
    }
  } catch {
    // nvm not installed
  }
  const voltaBin: string = _join(home, ".volta", "bin");
  const asdfShims: string = _join(home, ".asdf", "shims");
  const localBin: string = _join(home, ".local", "bin");
  const homeBin: string = _join(home, "bin");
  const fnmBin: string = _join(home, ".fnm", "aliases", "default", "bin");
  dirs.push("/opt/homebrew/bin", "/usr/local/bin", voltaBin, asdfShims, localBin, homeBin, fnmBin);
  for (const p of customPaths) {
    if (p) dirs.unshift(p);
  }
  return dirs;
}

function augmentedEnv(customPaths: string[] = []): NodeJS.ProcessEnv {
  const base: string = _process.env.PATH ?? "/usr/bin:/bin";
  const baseParts: string[] = base.split(":");
  const prepend: string[] = [];
  const seen: Set<string> = new Set(baseParts);
  for (const d of candidateBinDirs(customPaths)) {
    if (_existsSync(d) && !seen.has(d)) {
      prepend.push(d);
      seen.add(d);
    }
  }
  const pathValue: string = [...prepend, ...baseParts].join(":");
  return { ..._process.env, PATH: pathValue };
}

function checkNodeHasZstd(nodePath: string): boolean {
  try {
    const result: Uint8Array = _execFileSync(
      nodePath,
      ["-e", "process.exit(typeof require('zlib').createZstdDecompress === 'function' ? 0 : 1)"],
      { stdio: "pipe", timeout: 5000 }
    );
    const output: string = result.toString();
    return output !== undefined;
  } catch {
    return false;
  }
}

function resolveNodeFromDsh(dshAbs: string): string | null {
  const binDir: string = _dirname(dshAbs);
  const nodePath: string = _join(binDir, "node");
  if (_existsSync(nodePath) && checkNodeHasZstd(nodePath)) {
    return nodePath;
  }
  return null;
}

function findInDirs(name: string, dirs: string[]): string | null {
  for (const d of dirs) {
    const p: string = _join(d, name);
    if (_existsSync(p)) {
      return p;
    }
  }
  return null;
}

async function resolveBin(customPaths: string[] = []): Promise<ResolvedBin | null> {
  const dirs: string[] = candidateBinDirs(customPaths);

  const dshAbs: string | null = findInDirs(DSH_COMMAND, dirs);
  if (!dshAbs) return null;

  const dshScript: string = _realpathSync(dshAbs);

  let nodePath: string | null = resolveNodeFromDsh(dshAbs);
  if (!nodePath) {
    const candidate: string | null = findInDirs("node", dirs);
    if (candidate && checkNodeHasZstd(candidate)) {
      nodePath = candidate;
    }
  }
  if (!nodePath) return null;

  const resolved: ResolvedBin = { node: nodePath, dshScript };
  return resolved;
}

export function searchForDsh(): Promise<string[]> {
  return new Promise<string[]>((resolve) => {
    const results: Set<string> = new Set();
    try {
      const raw: Uint8Array = _execFileSync("mdfind", ["-name", "dsh"], { stdio: ["pipe", "pipe", "pipe"], timeout: 5000 });
      const out: string = raw.toString();
      for (const line of out.split("\n")) {
        const trimmed: string = line.trim();
        if (trimmed && trimmed.endsWith("/dsh")) {
          results.add(trimmed);
        }
      }
    } catch {
      // mdfind unavailable or timed out
    }
    if (results.size > 0) {
      resolve([...results]);
      return;
    }
    const home: string = _homedir();
    const roots: string[] = [home, "/usr/local", "/opt/homebrew", "/usr/bin", "/opt"];
    const child: TypedChildProcess = _spawn("find", [...roots, "-name", "dsh", "-type", "f", "-maxdepth", "5"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out: string = "";
    const stdout: TypedStream | null = child.stdout;
    if (stdout) {
      stdout.on("data", (d: Uint8Array | string) => {
        const text: string = typeof d === "string" ? d : d.toString();
        out += text;
      });
    }
    child.on("error", () => resolve([]));
    child.on("exit", () => {
      for (const line of out.split("\n")) {
        const trimmed: string = line.trim();
        if (trimmed && trimmed.endsWith("/dsh")) {
          results.add(trimmed);
        }
      }
      resolve([...results]);
    });
    window.setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already dead
      }
    }, 10_000);
  });
}

function collectDescendants(rootPid: number): number[] {
  const descendants: number[] = [rootPid];
  try {
    const visited: Set<number> = new Set();
    const stack: number[] = [rootPid];
    while (stack.length) {
      const parent: number = stack.pop() as number;
      if (visited.has(parent)) continue;
      visited.add(parent);
      const raw: Uint8Array = _execFileSync("pgrep", ["-P", String(parent)], { stdio: ["pipe", "pipe", "pipe"] });
      const result: string = raw.toString();
      for (const line of result.split("\n")) {
        const trimmed: string = line.trim();
        if (trimmed) {
          const childPid: number = Number(trimmed);
          if (Number.isFinite(childPid) && !visited.has(childPid)) {
            descendants.push(childPid);
            stack.push(childPid);
          }
        }
      }
    }
  } catch {
    // pgrep unavailable or process already gone
  }
  return descendants;
}

export class DshManager {
  private process: TypedChildProcess | null = null;
  private port: number | null = null;
  private stderrLines: string[] = [];
  private resolved: ResolvedBin | null = null;
  private exitHookInstalled = false;
  private trackedPid: number | null = null;
  private customPaths: string[] = [];
  private onUnexpectedExit: ((info: ExitInfo) => void) | null = null;

  setOnUnexpectedExit(cb: (info: ExitInfo) => void): void {
    this.onUnexpectedExit = cb;
  }

  setCustomPaths(paths: string[]): void {
    this.customPaths = paths.filter((p: string) => p && p.trim().length > 0);
    this.resolved = null;
  }

  async isAvailable(): Promise<boolean> {
    if (this.resolved) return true;
    const bin: ResolvedBin | null = await resolveBin(this.customPaths);
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
    this.reapOrphanedDsh();
    if (!this.resolved) {
      const bin: ResolvedBin | null = await resolveBin(this.customPaths);
      if (!bin) throw new Error("DSH binary not found (need dsh + node>=22 with createZstdDecompress)");
      this.resolved = bin;
    }
    const port: number = await this.findFreePort();
    this.port = port;
    this.stderrLines = [];

    const resolved: ResolvedBin = this.resolved;
    this.process = _spawn(
      resolved.node,
      [resolved.dshScript, "web", "--port", String(port), "--host", "127.0.0.1", "--no-open"],
      { cwd: vaultPath, stdio: ["pipe", "pipe", "pipe"], env: augmentedEnv(this.customPaths) }
    );

    if (!this.exitHookInstalled) {
      this.exitHookInstalled = true;
      const killSync = (): void => {
        const pid: number | null = this.trackedPid;
        if (pid == null) return;
        try {
          _process.kill(pid, "SIGKILL");
        } catch {
          // already dead
        }
      };
      _process.on("exit", killSync);
      _process.on("SIGTERM", killSync);
      _process.on("SIGINT", killSync);
      _process.on("SIGUSR2", killSync);
      _process.on("SIGHUP", killSync);
    }

    this.trackedPid = this.process.pid ?? null;

    const stderr: TypedStream | null = this.process.stderr;
    if (stderr) {
      stderr.on("data", (data: Uint8Array | string) => {
        const text: string = typeof data === "string" ? data : data.toString();
        const lines: string[] = text.split("\n").filter((l: string) => l.trim());
        this.stderrLines.push(...lines);
        if (this.stderrLines.length > 50) {
          this.stderrLines = this.stderrLines.slice(-50);
        }
      });
    }

    const proc: TypedChildProcess = this.process;
    proc.on("exit", (code: number | null, signal: string | null) => {
      const wasRunning: boolean = this.process !== null;
      this.process = null;
      if (wasRunning && this.onUnexpectedExit) {
        const info: ExitInfo = {
          code,
          signal,
          stderr: this.stderrLines.join("\n"),
        };
        this.onUnexpectedExit(info);
      }
    });

    proc.on("error", (err: Error) => {
      this.process = null;
      if (this.onUnexpectedExit) {
        const info: ExitInfo = { code: null, signal: null, stderr: err.message };
        this.onUnexpectedExit(info);
      }
    });

    await this.waitForReady(port);
    await this.ensureWorkspace(port, vaultPath);
    return port;
  }

  private async ensureWorkspace(port: number, vaultPath: string): Promise<void> {
    const body: string = JSON.stringify({
      type: "client-request",
      rpcId: "workspace-init",
      method: "workspace.create",
      payload: { path: vaultPath },
    });
    try {
      const ok: boolean = await new Promise<boolean>((resolve) => {
        const req: TypedClientRequest = _httpRequest(
          {
            hostname: "127.0.0.1",
            port,
            path: "/api/workspace.create",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Content-Length": _byteLength(body),
            },
            timeout: 10_000,
          },
          (res: TypedIncomingMessage) => {
            let data: string = "";
            res.on("data", (chunk: Uint8Array) => {
              data += chunk.toString();
            });
            res.on("end", () => {
              const statusCode: number = res.statusCode as number;
              resolve(statusCode === 200 && data.includes("server-response"));
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
    } catch (err: unknown) {
      const error: Error = err as Error;
      console.warn("[DSH] failed to add vault as workspace:", error.message);
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
    const proc: TypedChildProcess | null = this.process;
    if (!proc) return;
    const rootPid: number | undefined = proc.pid;
    if (rootPid == null) return;
    const descendants: number[] = collectDescendants(rootPid);
    const reversed: number[] = [...descendants].reverse();
    for (const pid of reversed) {
      try {
        _process.kill(pid, "SIGTERM");
      } catch {
        // already dead
      }
    }
    window.setTimeout(() => {
      for (const pid of reversed) {
        try {
          _process.kill(pid, "SIGKILL");
        } catch {
          // already dead
        }
      }
    }, SHUTDOWN_GRACE_MS);
  }

  reapOrphanedDsh(): void {
    try {
      const raw: Uint8Array = _execFileSync("pgrep", ["-f", "dsh/lib/bin.js web"], { stdio: ["pipe", "pipe", "pipe"] });
      const out: string = raw.toString();
      for (const line of out.split("\n")) {
        const trimmed: string = line.trim();
        if (trimmed) {
          const pid: number = Number(trimmed);
          if (Number.isFinite(pid)) {
            try {
              _process.kill(pid, "SIGKILL");
            } catch {
              // already dead
            }
          }
        }
      }
    } catch {
      // no orphans
    }
  }

  isRunning(): boolean {
    return this.process !== null;
  }

  getPort(): number | null {
    return this.port;
  }

  private findFreePort(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const server: TypedServer = _createServer();
      server.listen(0, "127.0.0.1", () => {
        const addr: { port: number } | string | null = server.address();
        if (addr && typeof addr === "object") {
          const addrInfo: { port: number } = addr;
          const port: number = addrInfo.port;
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
    const deadline: number = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.process === null) {
        throw new Error(
          `DSH process exited before becoming ready.\nStderr:\n${this.stderrLines.join("\n")}`
        );
      }
      const ready: boolean = await this.checkPort(port);
      if (ready) break;
      await new Promise<void>((r) => window.setTimeout(r, POLL_INTERVAL_MS));
    }
    while (Date.now() < deadline) {
      if (this.process === null) {
        throw new Error(
          `DSH process exited before API became ready.\nStderr:\n${this.stderrLines.join("\n")}`
        );
      }
      const ready: boolean = await this.checkApiReady(port);
      if (ready) return;
      await new Promise<void>((r) => window.setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`DSH API did not become ready within ${STARTUP_TIMEOUT_MS / 1000}s`);
  }

  private checkPort(port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const conn: TypedSocket = _createConnection({ host: "127.0.0.1", port }, () => {
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
    return new Promise<boolean>((resolve) => {
      const body: string = JSON.stringify({
        type: "client-request",
        rpcId: "ready-probe",
        method: "session.list",
        payload: { cursor: null, limit: 1 },
      });
      const req: TypedClientRequest = _httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/session.list",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": _byteLength(body),
          },
          timeout: 3000,
        },
        (res: TypedIncomingMessage) => {
          let data: string = "";
          res.on("data", (chunk: Uint8Array) => {
            data += chunk.toString();
          });
          res.on("end", () => {
            const statusCode: number = res.statusCode as number;
            resolve(statusCode === 200 && data.includes("server-response"));
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
