import { spawn, execFileSync } from "child_process";
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
  platform: string;
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
  write: (data: string | Uint8Array) => void;
  pipe: (dest: unknown) => void;
  on: (event: string, listener: (...args: never[]) => void) => void;
  setTimeout: (timeout: number, callback: () => void) => void;
}

interface TypedClientRequest {
  on: (event: string, listener: (...args: never[]) => void) => void;
  destroy: () => void;
  write: (data: string) => void;
  end: () => void;
}

interface TypedProxyIncoming {
  method: string | undefined;
  url: string | undefined;
  httpVersion: string;
  headers: Record<string, string | string[] | undefined>;
  pipe: (dest: unknown) => void;
}

interface TypedProxyResponse {
  writeHead: (statusCode: number, headers?: Record<string, string | string[] | undefined>) => void;
  end: (data?: string) => void;
}

interface TypedHttpServer {
  on: (event: string, listener: (...args: never[]) => void) => void;
  listen: (port: number, host: string, callback: () => void) => void;
  close: (callback?: () => void) => void;
}

interface TypedIncomingMessage {
  statusCode: number | undefined;
  headers: Record<string, string | string[] | undefined>;
  on: (event: string, listener: (...args: never[]) => void) => void;
}

interface HttpRequestOptions {
  hostname: string;
  port: number;
  path: string;
  method: string;
  headers?: Record<string, string>;
  timeout: number;
}

interface HttpResult {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

const _process = process as unknown as TypedProcess;
const _spawn = spawn as unknown as (command: string, args: string[], options: object) => TypedChildProcess;
const _net = net as unknown as { createServer: () => TypedServer; createConnection: (options: { host: string; port: number }, callback: () => void) => TypedSocket };
const _createServer = _net.createServer;
const _createConnection = _net.createConnection;
const _http = http as unknown as {
  request: (options: object, callback: (res: TypedIncomingMessage) => void) => TypedClientRequest;
  createServer: () => TypedHttpServer;
};
const _httpRequest = _http.request;
const _createHttpServer = _http.createServer;

const DSH_COMMAND = "dsh";
const STARTUP_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 500;
const SHUTDOWN_GRACE_MS = 5_000;
// dsh web prints its browser-auth launch token on stdout, e.g.
// "dsh web: http://127.0.0.1:PORT/?token=<token>"
const TOKEN_PATTERN = /\?token=([A-Za-z0-9_-]+)/;
// New-protocol RPC endpoints (slash-separated namespace/method) and envelope.
const SESSION_LIST_PATH = "/api/session/list";
const SESSION_LIST_METHOD = "session/list";
const WORKSPACE_CREATE_PATH = "/api/workspace/create";
const WORKSPACE_CREATE_METHOD = "workspace/create";
// Legacy-protocol endpoints (pre-BrowserAuth dsh, e.g. 0.1.1): dotted method
// names, raw payloads, no token or cookie.
const LEGACY_SESSION_LIST_PATH = "/api/session.list";
const LEGACY_SESSION_LIST_METHOD = "session.list";
const LEGACY_WORKSPACE_CREATE_PATH = "/api/workspace.create";
const LEGACY_WORKSPACE_CREATE_METHOD = "workspace.create";

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
  if (_process.platform === "win32") {
    // Windows: npm global prefix (dsh.cmd + node_modules layout), the
    // default Node.js install dir, and nvm-windows locations. Obsidian's
    // process env is often stale, so read these from env vars / well-known
    // paths instead of relying on PATH.
    const appData: string | undefined = _process.env.APPDATA;
    if (appData) dirs.push(_join(appData, "npm"));
    const programFiles: string | undefined = _process.env.ProgramFiles ?? _process.env["ProgramW6432"];
    if (programFiles) dirs.push(_join(programFiles, "nodejs"));
    const nvmHome: string | undefined = _process.env.NVM_HOME;
    if (nvmHome) dirs.push(nvmHome);
    const nvmSymlink: string | undefined = _process.env.NVM_SYMLINK;
    if (nvmSymlink) dirs.push(nvmSymlink);
  }
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

function augmentedEnv(customPaths: string[] = []): Record<string, string | undefined> {
  const sep: string = _process.platform === "win32" ? ";" : ":";
  const fallback: string = _process.platform === "win32" ? "" : "/usr/bin:/bin";
  const base: string = _process.env.PATH ?? fallback;
  const baseParts: string[] = base.split(sep).filter((p: string) => p.length > 0);
  const prepend: string[] = [];
  const seen: Set<string> = new Set(baseParts);
  for (const d of candidateBinDirs(customPaths)) {
    if (_existsSync(d) && !seen.has(d)) {
      prepend.push(d);
      seen.add(d);
    }
  }
  const pathValue: string = [...prepend, ...baseParts].join(sep);
  const env: Record<string, string | undefined> = { ..._process.env, PATH: pathValue };
  return env;
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

/**
 * Windows resolution: npm lays out the global prefix as
 *   <prefix>\dsh.cmd + <prefix>\node_modules\@deepseek-ai\dsh\lib\bin.js
 * and node.exe may live in a different dir (e.g. C:\Program Files\nodejs).
 * Find a zstd-capable node.exe anywhere and bin.js under any prefix dir.
 */
function resolveBinWindows(customPaths: string[] = []): ResolvedBin | null {
  const dirs: string[] = candidateBinDirs(customPaths);
  let nodePath: string | null = findInDirs("node.exe", dirs);
  if (!nodePath) {
    const fallback: string | null = findInDirs("node", dirs);
    if (fallback) nodePath = fallback;
  }
  if (nodePath && !checkNodeHasZstd(nodePath)) nodePath = null;
  if (!nodePath) return null;
  for (const d of dirs) {
    const script: string = _join(d, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
    if (_existsSync(script)) {
      return { node: nodePath, dshScript: script };
    }
  }
  return null;
}

async function resolveBin(customPaths: string[] = []): Promise<ResolvedBin | null> {
  if (_process.platform === "win32") {
    return resolveBinWindows(customPaths);
  }
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
    // Match regular files and symlinks (e.g. /usr/local/bin/dsh -> nvm).
    // Depth 7 covers nvm's <home>/.nvm/versions/node/<ver>/bin/dsh (depth 6).
    const roots: string[] = [home, "/usr/local", "/opt/homebrew", "/usr/bin", "/opt"];
    const child: TypedChildProcess = _spawn(
      "find",
      [...roots, "-name", "dsh", "(", "-type", "f", "-o", "-type", "l", ")", "-maxdepth", "7"],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
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
  private stdoutLines: string[] = [];
  private authToken: string | null = null;
  private cookieHeader: string | null = null;
  private legacyMode = false;
  private proxyServer: TypedHttpServer | null = null;
  private proxyPort: number | null = null;
  private proxySockets: Set<unknown> = new Set();
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
    this.stdoutLines = [];
    this.authToken = null;
    this.cookieHeader = null;
    this.legacyMode = false;
    this.proxyServer = null;
    this.proxyPort = null;
    this.proxySockets.clear();

    const resolved: ResolvedBin = this.resolved;
    const child: TypedChildProcess = _spawn(
      resolved.node,
      [resolved.dshScript, "web", "--port", String(port), "--host", "127.0.0.1", "--no-open"],
      { cwd: vaultPath, stdio: ["pipe", "pipe", "pipe"], env: augmentedEnv(this.customPaths) }
    );
    this.process = child;

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

    const stdout: TypedStream | null = this.process.stdout;
    if (stdout) {
      stdout.on("data", (data: Uint8Array | string) => {
        const text: string = typeof data === "string" ? data : data.toString();
        for (const line of text.split("\n")) {
          const trimmed: string = line.trim();
          if (!trimmed) continue;
          this.stdoutLines.push(trimmed);
          if (this.stdoutLines.length > 50) {
            this.stdoutLines = this.stdoutLines.slice(-50);
          }
          // dsh web prints "dsh web: http://127.0.0.1:PORT/?token=<token>"
          const match: RegExpMatchArray | null = TOKEN_PATTERN.exec(trimmed);
          if (match) this.authToken = match[1];
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
    // Legacy dsh has no browser auth: no cookie, no proxy needed.
    if (!this.legacyMode) {
      await this.startProxy(port);
    }
    return port;
  }

  private async ensureWorkspace(port: number, vaultPath: string): Promise<void> {
    const legacy: boolean = this.legacyMode;
    const body: string = JSON.stringify(
      legacy
        ? {
            type: "client-request",
            rpcId: "workspace-init",
            method: LEGACY_WORKSPACE_CREATE_METHOD,
            payload: { path: vaultPath },
          }
        : {
            type: "client-request",
            rpcId: "workspace-init",
            method: WORKSPACE_CREATE_METHOD,
            payload: { args: { request: { path: vaultPath } } },
          },
    );
    try {
      const res: HttpResult = await this.httpText(
        {
          hostname: "127.0.0.1",
          port,
          path: legacy ? LEGACY_WORKSPACE_CREATE_PATH : WORKSPACE_CREATE_PATH,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(_byteLength(body)),
            ...this.apiHeaders(),
          },
          timeout: 10_000,
        },
        body,
      );
      const ok: boolean = res.statusCode === 200 && res.body.includes("server-response");
      if (!ok) {
        // workspace registration is best-effort; failure is surfaced via progress callback
      }
    } catch {
      // workspace registration failed — non-fatal, dsh still usable
    }
  }

  stop(): void {
    this.stopProxy();
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

  /** Launch token printed by `dsh web` on stdout (null until boot prints it). */
  getAuthToken(): string | null {
    return this.authToken;
  }

  /** Browser URL carrying the launch token (null until boot prints it). */
  getAuthedUrl(): string | null {
    if (this.port == null) return null;
    if (this.legacyMode) return `http://127.0.0.1:${this.port}`;
    if (!this.authToken) return null;
    return `http://127.0.0.1:${this.port}/?token=${this.authToken}`;
  }

  /**
   * Same-origin-safe URL for the embedded iframe: the plugin's local proxy
   * attaches the session cookie server-side, so the cross-site
   * SameSite=Strict cookie policy never blocks the iframe.
   * Null in legacy mode (no auth, no proxy).
   */
  getProxyUrl(): string | null {
    if (this.legacyMode) return null;
    if (this.proxyPort == null) return null;
    const suffix: string = this.authToken ? `?token=${this.authToken}` : "";
    return `http://127.0.0.1:${this.proxyPort}/${suffix}`;
  }

  private apiHeaders(): Record<string, string> {
    if (this.cookieHeader) return { Cookie: this.cookieHeader };
    return {};
  }

  private httpText(options: HttpRequestOptions, reqBody?: string): Promise<HttpResult> {
    return new Promise<HttpResult>((resolve) => {
      const req: TypedClientRequest = _httpRequest(
        {
          hostname: options.hostname,
          port: options.port,
          path: options.path,
          method: options.method,
          headers: options.headers ?? {},
          timeout: options.timeout,
        },
        (res: TypedIncomingMessage) => {
          let data: string = "";
          res.on("data", (chunk: Uint8Array) => {
            data += chunk.toString();
          });
          res.on("end", () => {
            resolve({
              statusCode: res.statusCode as number,
              headers: res.headers ?? {},
              body: data,
            });
          });
        },
      );
      req.on("error", () => resolve({ statusCode: 0, headers: {}, body: "" }));
      req.on("timeout", () => {
        req.destroy();
        resolve({ statusCode: 0, headers: {}, body: "" });
      });
      if (reqBody !== undefined) req.write(reqBody);
      req.end();
    });
  }

  private static headerFirst(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) return value.length > 0 ? value[0] : null;
    return value ?? null;
  }

  private static collectCookies(
    headers: Record<string, string | string[] | undefined>,
    jar: Map<string, string>,
  ): void {
    const setCookie: string | string[] | undefined = headers["set-cookie"];
    const entries: string[] = Array.isArray(setCookie) ? setCookie : setCookie !== undefined ? [setCookie] : [];
    for (const entry of entries) {
      const pair: string = entry.split(";")[0].trim();
      const eq: number = pair.indexOf("=");
      if (eq > 0) jar.set(pair.substring(0, eq).trim(), pair.substring(eq + 1).trim());
    }
  }

  /**
   * Exchange the stdout launch token for a session cookie: GET /?token=
   * answers 303 + set-cookie, follow the redirect to / and keep the cookie.
   */
  private async exchangeTokenForCookie(port: number, token: string): Promise<boolean> {
    const jar: Map<string, string> = new Map<string, string>();
    let path: string = `/?token=${token}`;
    for (let i = 0; i < 5; i++) {
      const headers: Record<string, string> = {};
      if (jar.size > 0) {
        headers.Cookie = [...jar.entries()].map(([k, v]: [string, string]) => `${k}=${v}`).join("; ");
      }
      const res: HttpResult = await this.httpText(
        { hostname: "127.0.0.1", port, path, method: "GET", headers, timeout: 10_000 },
      );
      DshManager.collectCookies(res.headers, jar);
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 303) {
        const location: string | null = DshManager.headerFirst(res.headers["location"]);
        if (!location) return false;
        path = location.startsWith("/") ? location : "/";
        continue;
      }
      if (res.statusCode === 200) break;
      return false;
    }
    if (jar.size === 0) return false;
    this.cookieHeader = [...jar.entries()].map(([k, v]: [string, string]) => `${k}=${v}`).join("; ");
    return true;
  }

  /**
   * Start a same-origin-safe reverse proxy in front of dsh. The iframe runs
   * cross-site (app:// vs http://127.0.0.1) where dsh's SameSite=Strict
   * cookie is never sent back; the proxy attaches the session cookie
   * server-side so the embedded UI (including its /api/remote.mux
   * WebSocket) authenticates transparently.
   */
  private async startProxy(dshPort: number): Promise<number> {
    const proxyPort: number = await this.findFreePort();
    const server: TypedHttpServer = _createHttpServer();
    server.on("request", (...args: never[]) => {
      const ireq: TypedProxyIncoming = args[0];
      const ires: TypedProxyResponse = args[1];
      this.forwardRequest(ireq, ires, dshPort);
    });
    server.on("upgrade", (...args: never[]) => {
      const ireq: TypedProxyIncoming = args[0];
      const socket: TypedSocket = args[1];
      const head: Uint8Array = args[2];
      this.forwardUpgrade(ireq, socket, head, dshPort);
    });
    await new Promise<void>((resolve, reject) => {
      server.on("error", (...args: never[]) => reject(args[0]));
      server.listen(proxyPort, "127.0.0.1", () => resolve());
    });
    this.proxyServer = server;
    this.proxyPort = proxyPort;
    return proxyPort;
  }

  private forwardRequest(ireq: TypedProxyIncoming, ires: TypedProxyResponse, dshPort: number): void {
    const preq: TypedClientRequest = _httpRequest(
      {
        hostname: "127.0.0.1",
        port: dshPort,
        path: ireq.url ?? "/",
        method: ireq.method ?? "GET",
        headers: this.proxyHeaders(ireq.headers, dshPort, true),
      },
      (pres: TypedIncomingMessage) => {
        ires.writeHead((pres.statusCode as number) ?? 502, pres.headers ?? {});
        (pres as unknown as { pipe: (dest: unknown) => void }).pipe(ires);
      },
    );
    preq.on("error", () => {
      try {
        ires.writeHead(502);
        ires.end("proxy: dsh unreachable");
      } catch {
        // response already on its way out
      }
    });
    ireq.pipe(preq);
  }

  /**
   * Build the header set forwarded to dsh: Host always points at dsh, the
   * session cookie is attached server-side, and Origin (when the browser
   * sent one) is realigned to dsh's authority. Without the Origin rewrite
   * dsh's Host/Origin fence sees Origin=proxy vs Host=dsh and rejects every
   * /api call and WebSocket upgrade with 403.
   */
  private proxyHeaders(
    incoming: Record<string, string | string[] | undefined>,
    dshPort: number,
    stripConnection: boolean,
  ): Record<string, string | string[] | undefined> {
    const dshAuthority: string = `127.0.0.1:${dshPort}`;
    const headers: Record<string, string | string[] | undefined> = { ...incoming };
    headers.host = dshAuthority;
    if (headers.origin !== undefined) headers.origin = `http://${dshAuthority}`;
    if (stripConnection) delete headers["connection"];
    if (this.cookieHeader) headers.cookie = this.cookieHeader;
    return headers;
  }
  private forwardUpgrade(
    ireq: TypedProxyIncoming,
    socket: TypedSocket,
    head: Uint8Array,
    dshPort: number,
  ): void {
    this.proxySockets.add(socket);
    socket.on("close", () => {
      this.proxySockets.delete(socket);
    });
    const target: TypedSocket = _createConnection({ host: "127.0.0.1", port: dshPort }, () => {
      const headers: Record<string, string | string[] | undefined> = this.proxyHeaders(
        ireq.headers,
        dshPort,
        false,
      );
      const flat: Record<string, string> = {};
      for (const [k, v] of Object.entries(headers)) {
        if (v === undefined) continue;
        flat[k] = Array.isArray(v) ? v.join(", ") : v;
      }
      const lines: string[] = [`${ireq.method ?? "GET"} ${ireq.url ?? "/"} HTTP/${ireq.httpVersion}`];
      for (const [k, v] of Object.entries(flat)) lines.push(`${k}: ${v}`);
      target.write(lines.join("\r\n") + "\r\n\r\n");
      if (head && head.length > 0) target.write(head);
      socket.pipe(target);
      target.pipe(socket);
    });
    const onError = (): void => {
      this.proxySockets.delete(socket);
      try {
        socket.destroy();
      } catch {
        // already gone
      }
      try {
        target.destroy();
      } catch {
        // already gone
      }
    };
    socket.on("error", onError);
    target.on("error", onError);
  }

  private stopProxy(): void {
    this.proxySockets.forEach((s: unknown) => {
      try {
        (s as TypedSocket).destroy();
      } catch {
        // already gone
      }
    });
    this.proxySockets.clear();
    if (this.proxyServer) {
      const server: TypedHttpServer = this.proxyServer;
      this.proxyServer = null;
      try {
        server.close();
      } catch {
        // already closed
      }
    }
    this.proxyPort = null;
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
    // Phase 1: TCP port open.
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
    // Phase 2: protocol detection. New dsh prints a launch token (?token=)
    // on stdout; legacy dsh (no browser auth) answers the old dotted probe.
    // Whichever responds first selects the protocol for this session.
    while (Date.now() < deadline) {
      if (this.process === null) {
        throw new Error(
          `DSH process exited before printing its launch token.\nStderr:\n${this.stderrLines.join("\n")}`
        );
      }
      if (this.authToken) break;
      if (await this.checkLegacyApiReady(port)) {
        this.legacyMode = true;
        break;
      }
      await new Promise<void>((r) => window.setTimeout(r, POLL_INTERVAL_MS));
    }
    if (!this.authToken && !this.legacyMode) {
      throw new Error(
        `DSH did not print a launch token (?token=) within ${STARTUP_TIMEOUT_MS / 1000}s. Is dsh up to date?\nStdout:\n${this.stdoutLines.join("\n")}`
      );
    }
    // Phase 3: exchange the token for a session cookie (new protocol only).
    if (!this.legacyMode && this.authToken) {
      const authed: boolean = await this.exchangeTokenForCookie(port, this.authToken);
      if (!authed) {
        throw new Error("DSH token exchange failed (no session cookie issued).");
      }
    }
    // Phase 4: API probe.
    while (Date.now() < deadline) {
      if (this.process === null) {
        throw new Error(
          `DSH process exited before API became ready.\nStderr:\n${this.stderrLines.join("\n")}`
        );
      }
      const ready: boolean = this.legacyMode
        ? await this.checkLegacyApiReady(port)
        : await this.checkApiReady(port);
      if (ready) return;
      await new Promise<void>((r) => window.setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`DSH API did not become ready within ${STARTUP_TIMEOUT_MS / 1000}s`);
  }

  /** Legacy-protocol probe: dotted endpoint, raw payload, no cookie. */
  private async checkLegacyApiReady(port: number): Promise<boolean> {
    const body: string = JSON.stringify({
      type: "client-request",
      rpcId: "legacy-probe",
      method: LEGACY_SESSION_LIST_METHOD,
      payload: { cursor: null, limit: 1 },
    });
    try {
      const res: HttpResult = await this.httpText(
        {
          hostname: "127.0.0.1",
          port,
          path: LEGACY_SESSION_LIST_PATH,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(_byteLength(body)),
          },
          timeout: 1500,
        },
        body,
      );
      return res.statusCode === 200 && res.body.includes("server-response");
    } catch {
      return false;
    }
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

  private async checkApiReady(port: number): Promise<boolean> {
    const body: string = JSON.stringify({
      type: "client-request",
      rpcId: "ready-probe",
      method: SESSION_LIST_METHOD,
      payload: { args: { _request: {} } },
    });
    try {
      const res: HttpResult = await this.httpText(
        {
          hostname: "127.0.0.1",
          port,
          path: SESSION_LIST_PATH,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(_byteLength(body)),
            ...this.apiHeaders(),
          },
          timeout: 3000,
        },
        body,
      );
      return res.statusCode === 200 && res.body.includes("server-response");
    } catch {
      return false;
    }
  }
}
