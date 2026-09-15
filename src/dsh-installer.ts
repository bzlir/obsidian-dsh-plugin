import { spawn, execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const _spawn = spawn as unknown as (command: string, args: string[], options: object) => TypedChildProcess;
const _execFileSync = execFileSync as unknown as (cmd: string, args: string[], options: object) => string;
const _existsSync = existsSync as unknown as (path: string) => boolean;
const _mkdirSync = mkdirSync as unknown as (path: string, options: { recursive: boolean }) => void;
const _readFileSync = readFileSync as unknown as (path: string, encoding: string) => string;
const _writeFileSync = writeFileSync as unknown as (path: string, data: string) => void;
const _join = join as unknown as (...paths: string[]) => string;
const _dirname = dirname as unknown as (path: string) => string;
const _homedir = homedir as unknown as () => string;

interface TypedChildProcess {
  pid: number | undefined;
  stdout: TypedStream | null;
  stderr: TypedStream | null;
  on: (event: string, listener: (...args: never[]) => void) => void;
  kill: (signal: string) => void;
}

interface TypedStream {
  on: (event: string, listener: (data: Uint8Array | string) => void) => void;
}

const _process = process as unknown as TypedProcess;

interface TypedProcess {
  env: Record<string, string | undefined>;
  platform: string;
  arch: string;
}

const NVM_INSTALL_URL = "https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh";
const NVM_DIR = _join(_homedir(), ".nvm");
const NVM_SH = _join(NVM_DIR, "nvm.sh");
const NVM_NODE_ROOT = _join(NVM_DIR, "versions", "node");
const DSH_PACKAGE = "@deepseek-ai/dsh";
export const DSH_MARKET_PACKAGE = "dshmarket";
const DEFAULT_DSH_HOME = _join(_homedir(), ".dsh");
// Must mirror @deepseek-ai/dsh-app-boot's shipped web template (PROFILE_TEMPLATES).
const WEB_PROFILE_BUNDLES = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"];
const PROFILE_PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`;
const PROFILE_PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`;

interface ProfileManifest {
  name?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  dsh?: {
    profile?: {
      bundles?: string[];
      patchReload?: string;
    };
  };
}

export type InstallStep = "idle" | "checking" | "installing-nvm" | "installing-node" | "installing-dsh" | "installing-plugins" | "verifying" | "done" | "error";

export interface InstallProgress {
  step: InstallStep;
  message: string;
}

export type ProgressCallback = (progress: InstallProgress) => void;

export function findNodeFromNvm(): { node: string; npm: string } | null {
  if (!_existsSync(NVM_NODE_ROOT)) return null;
  const dirs: string[] = [];
  try {
    const result: string = _execFileSync("ls", [NVM_NODE_ROOT], { stdio: ["pipe", "pipe", "pipe"] });
    for (const line of result.split("\n")) {
      const trimmed: string = line.trim();
      if (trimmed) dirs.push(trimmed);
    }
  } catch {
    return null;
  }
  for (let i = dirs.length - 1; i >= 0; i--) {
    const binDir: string = _join(NVM_NODE_ROOT, dirs[i], "bin");
    const nodePath: string = _join(binDir, "node");
    const npmPath: string = _join(binDir, "npm");
    if (_existsSync(nodePath) && _existsSync(npmPath)) {
      return { node: nodePath, npm: npmPath };
    }
  }
  return null;
}

function findNodeFromNvmWindows(): { node: string; npm: string } | null {
  const nvmHome: string | undefined = _process.env.NVM_HOME;
  if (!nvmHome) return null;
  const nvmDir: string = nvmHome;
  if (!_existsSync(nvmDir)) return null;
  const dirs: string[] = [];
  try {
    const result: string = _execFileSync("cmd", ["/c", "dir", "/b", nvmDir], { stdio: ["pipe", "pipe", "pipe"] });
    for (const line of result.split("\n")) {
      const trimmed: string = line.trim();
      if (trimmed) dirs.push(trimmed);
    }
  } catch {
    return null;
  }
  for (let i = dirs.length - 1; i >= 0; i--) {
    const nodePath: string = _join(nvmDir, dirs[i], "node.exe");
    const npmPath: string = _join(nvmDir, dirs[i], "npm.cmd");
    if (_existsSync(nodePath) && _existsSync(npmPath)) {
      return { node: nodePath, npm: npmPath };
    }
  }
  return null;
}

export function findSystemNode(): { node: string; npm: string } | null {
  const cmd: string = _process.platform === "win32" ? "where" : "which";
  try {
    const nodePath: string = _execFileSync(cmd, ["node"], { stdio: ["pipe", "pipe", "pipe"] }).trim().split("\n")[0].trim();
    const npmPath: string = _execFileSync(cmd, ["npm"], { stdio: ["pipe", "pipe", "pipe"] }).trim().split("\n")[0].trim();
    if (nodePath && npmPath) return { node: nodePath, npm: npmPath };
  } catch {
    // not on PATH
  }
  return null;
}

export function checkNodeVersion(nodePath: string): boolean {
  try {
    _execFileSync(nodePath, ["-e", "process.exit(process.versions.node >= 22 ? 0 : 1)"], { stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    return false;
  }
}

export function checkDshInstalled(): boolean {
  const cmd: string = _process.platform === "win32" ? "where" : "which";
  try {
    _execFileSync(cmd, ["dsh"], { stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    // Check nvm bin dirs (macOS/Linux)
    if (_existsSync(NVM_NODE_ROOT)) {
      try {
        const result: string = _execFileSync("ls", [NVM_NODE_ROOT], { stdio: ["pipe", "pipe", "pipe"] });
        for (const line of result.split("\n")) {
          const trimmed: string = line.trim();
          if (trimmed) {
            const dshPath: string = _join(NVM_NODE_ROOT, trimmed, "bin", "dsh");
            if (_existsSync(dshPath)) return true;
          }
        }
      } catch {
        // nvm dir not readable
      }
    }
    // Check nvm-windows dirs
    const winNode: { node: string; npm: string } | null = findNodeFromNvmWindows();
    if (winNode) {
      const dshPath: string = _join(winNode.node.substring(0, winNode.node.length - 9), "dsh.cmd");
      if (_existsSync(dshPath)) return true;
    }
    return false;
  }
}

function runCommand(command: string, args: string[], env?: Record<string, string | undefined>, cwd?: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    let child: TypedChildProcess;
    const spawnOptions: object = { stdio: ["pipe", "pipe", "pipe"], env: env ?? _process.env, ...(cwd ? { cwd } : {}) };
    try {
      if (_process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
        // Node cannot spawn .cmd/.bat directly (throws EINVAL/ENOENT).
        // Route through cmd.exe with separate argv elements so libuv quotes
        // paths containing spaces itself. Do NOT pre-quote: libuv escaping
        // combined with cmd's /s quote-stripping breaks the command line.
        child = _spawn("cmd", ["/d", "/c", command, ...args], spawnOptions);
      } else {
        child = _spawn(command, args, spawnOptions);
      }
    } catch (e: unknown) {
      const message: string = e instanceof Error ? e.message : String(e);
      resolve({ stdout: "", stderr: `spawn failed: ${message}`, code: -1 });
      return;
    }
    let stdout = "";
    let stderr = "";
    if (child.stdout) {
      child.stdout.on("data", (data: Uint8Array | string) => {
        stdout += typeof data === "string" ? data : data.toString();
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (data: Uint8Array | string) => {
        stderr += typeof data === "string" ? data : data.toString();
      });
    }
    child.on("exit", (...args: never[]) => {
      const code: number | null = args[0];
      resolve({ stdout, stderr, code });
    });
    child.on("error", () => {
      resolve({ stdout, stderr, code: -1 });
    });
  });
}

function getNvmEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ..._process.env };
  const nvmDir: string = NVM_DIR;
  const pathSeparator: string = _process.platform === "win32" ? ";" : ":";
  const nodeFound: { node: string; npm: string } | null = findNodeFromNvm();
  if (nodeFound) {
    const binDir: string = nodeFound.node.substring(0, nodeFound.node.length - 5);
    env.PATH = binDir + pathSeparator + (env.PATH ?? "");
  }
  env.NVM_DIR = nvmDir;
  return env;
}

export async function installNvm(progress: ProgressCallback): Promise<boolean> {
  if (_process.platform === "win32") {
    return installNvmWindows(progress);
  }
  return installNvmUnix(progress);
}

async function installNvmUnix(progress: ProgressCallback): Promise<boolean> {
  progress({ step: "installing-nvm", message: "Downloading and installing nvm..." });
  const result = await runCommand("bash", ["-c", `curl -fsSL ${NVM_INSTALL_URL} | bash`]);
  if (result.code !== 0 && !_existsSync(NVM_SH)) {
    progress({ step: "error", message: `nvm installation failed: ${result.stderr}` });
    return false;
  }
  progress({ step: "installing-nvm", message: "nvm installed successfully." });
  return true;
}

async function installNvmWindows(progress: ProgressCallback): Promise<boolean> {
  // Check if nvm is already installed (user may have installed it before)
  refreshWindowsEnv();
  const existingNvm: string | null = findNvmExe();
  if (existingNvm) {
    progress({ step: "installing-nvm", message: "nvm-windows already installed." });
    return true;
  }

  progress({ step: "installing-nvm", message: "Installing nvm-windows via winget..." });
  const wingetResult = await runCommand("winget", ["install", "coreybutler.nvmforwindows", "--accept-package-agreements", "--accept-source-agreements"]);
  // winget may return non-zero even on success (e.g. already installed, or requires admin)
  // Re-check env + filesystem regardless of winget exit code
  refreshWindowsEnv();
  const nvmHome: string | undefined = _process.env.NVM_HOME;
  if (!nvmHome || !_existsSync(_join(nvmHome, "nvm.exe"))) {
    const appData: string | undefined = _process.env.APPDATA;
    if (appData) {
      const fallbackNvm: string = _join(appData, "nvm");
      if (_existsSync(_join(fallbackNvm, "nvm.exe"))) {
        if (!_process.env.NVM_HOME) _process.env.NVM_HOME = fallbackNvm;
      }
    }
  }
  // Final check: is nvm.exe findable now?
  const nvmExe: string | null = findNvmExe();
  if (nvmExe) {
    progress({ step: "installing-nvm", message: "nvm-windows installed successfully." });
    return true;
  }
  // winget failed and nvm.exe not found — tell user
  progress({ step: "error", message: `winget failed (code ${wingetResult.code}). Try manual install from https://github.com/coreybutler/nvm-windows/releases, or install Node.js directly from https://nodejs.org.` });
  return false;
}

async function downloadAndInstallNodeWindows(progress: ProgressCallback): Promise<{ node: string; npm: string } | null> {
  // Check if node is already installed (before trying winget)
  // Use PowerShell — most reliable way to find node on Windows regardless
  // of Obsidian's stale process env
  const existingNode: { node: string; npm: string } | null = findNodeViaPowerShell();
  if (existingNode && checkNodeVersion(existingNode.node)) {
    progress({ step: "installing-node", message: `Node.js already installed: ${existingNode.node}` });
    return existingNode;
  }

  // Try winget install
  progress({ step: "installing-node", message: "Installing Node.js LTS via winget..." });
  const wingetResult = await runCommand("winget", ["install", "OpenJS.NodeJS.LTS", "--accept-package-agreements", "--accept-source-agreements"]);

  // Regardless of winget exit code, try to find node via PowerShell
  // (winget may report failure but node may still be installed)
  const nodeInfo: { node: string; npm: string } | null = findNodeViaPowerShell();
  if (nodeInfo && checkNodeVersion(nodeInfo.node)) {
    progress({ step: "installing-node", message: `Node.js installed: ${nodeInfo.node}` });
    return nodeInfo;
  }

  // Node not found — tell user to install manually
  progress({ step: "error", message: `winget install completed (exit ${wingetResult.code}) but Node.js not found. Please install Node.js 22+ manually from https://nodejs.org, then click "Enter path manually" and paste the output of 'where.exe node'.` });
  return null;
}

function findNodeViaPowerShell(): { node: string; npm: string } | null {
  // Use PowerShell to find node — reads fresh system env, not Obsidian's stale process env
  try {
    const psResult: string = _execFileSync("cmd", ["/c", "powershell", "-NoProfile", "-Command", "(Get-Command node -ErrorAction SilentlyContinue).Source"], { stdio: ["pipe", "pipe", "pipe"] });
    const nodePath: string = psResult.trim().split("\n")[0].trim();
    if (nodePath && _existsSync(nodePath)) {
      const dir: string = _dirname(nodePath);
      const npmName: string = "npm.cmd";
      const npmPath: string = _join(dir, npmName);
      if (_existsSync(npmPath)) {
        return { node: nodePath, npm: npmPath };
      }
      // npm might be npm without .cmd
      const npmAlt: string = _join(dir, "npm");
      if (_existsSync(npmAlt)) {
        return { node: nodePath, npm: npmAlt };
      }
    }
  } catch {
    // PowerShell couldn't find node
  }
  return null;
}

function refreshWindowsEnv(): void {
  // Read NVM_HOME and NVM_SYMLINK from registry (set by nvm-windows installer)
  try {
    const regResult: string = _execFileSync("reg", ["query", "HKCU\\Environment"], { stdio: ["pipe", "pipe", "pipe"] });
    const lines: string[] = regResult.split("\n");
    for (const line of lines) {
      const trimmed: string = line.trim();
      if (trimmed.startsWith("NVM_HOME")) {
        const match: RegExpMatchArray | null = /NVM_HOME\s+REG_SZ\s+(.+)/.exec(trimmed);
        if (match) _process.env.NVM_HOME = match[1].trim();
      }
      if (trimmed.startsWith("NVM_SYMLINK")) {
        const match: RegExpMatchArray | null = /NVM_SYMLINK\s+REG_SZ\s+(.+)/.exec(trimmed);
        if (match) _process.env.NVM_SYMLINK = match[1].trim();
      }
    }
  } catch {
    // registry query failed — nvm may not have set env vars yet
  }
}

function findNvmExe(): string | null {
  // Check NVM_HOME first
  const nvmHome: string | undefined = _process.env.NVM_HOME;
  if (nvmHome) {
    const exe: string = _join(nvmHome, "nvm.exe");
    if (_existsSync(exe)) return exe;
  }
  // Check APPDATA fallback
  const appData: string | undefined = _process.env.APPDATA;
  if (appData) {
    const exe: string = _join(appData, "nvm", "nvm.exe");
    if (_existsSync(exe)) return exe;
  }
  // Check NVM_SYMLINK
  const nvmSymlink: string | undefined = _process.env.NVM_SYMLINK;
  if (nvmSymlink) {
    const exe: string = _join(nvmSymlink, "nvm.exe");
    if (_existsSync(exe)) return exe;
  }
  // Fallback: use 'where nvm' to find it on PATH (system PATH may have been
  // updated after Obsidian launched, so process env is stale)
  if (_process.platform === "win32") {
    try {
      const result: string = _execFileSync("where", ["nvm"], { stdio: ["pipe", "pipe", "pipe"] });
      const firstLine: string = result.split("\n")[0].trim();
      if (firstLine && _existsSync(firstLine)) return firstLine;
    } catch {
      // nvm not on PATH
    }
  }
  return null;
}

export async function installNode22(progress: ProgressCallback): Promise<{ node: string; npm: string } | null> {
  if (_process.platform === "win32") {
    return installNode22Windows(progress);
  }
  return installNode22Unix(progress);
}

async function installNode22Unix(progress: ProgressCallback): Promise<{ node: string; npm: string } | null> {
  progress({ step: "installing-node", message: "Installing Node.js 22 via nvm..." });
  const nvmEnv: Record<string, string | undefined> = getNvmEnv();
  const result = await runCommand("bash", ["-c", `source "${NVM_SH}" && nvm install 22`], nvmEnv);
  if (result.code !== 0) {
    progress({ step: "error", message: `Node.js installation failed: ${result.stderr}` });
    return null;
  }
  const nodeFound: { node: string; npm: string } | null = findNodeFromNvm();
  if (!nodeFound) {
    progress({ step: "error", message: "Node.js installed but binary not found." });
    return null;
  }
  if (!checkNodeVersion(nodeFound.node)) {
    progress({ step: "error", message: "Node.js installed but version < 22." });
    return null;
  }
  progress({ step: "installing-node", message: `Node.js installed: ${nodeFound.node}` });
  return nodeFound;
}

async function installNode22Windows(progress: ProgressCallback): Promise<{ node: string; npm: string } | null> {
  progress({ step: "installing-node", message: "Installing Node.js 22 via nvm-windows..." });
  const nvmExe: string | null = findNvmExe();
  if (!nvmExe) {
    progress({ step: "error", message: "nvm.exe not found after installation. Try restarting Obsidian and retry." });
    return null;
  }
  const result = await runCommand(nvmExe, ["install", "22"]);
  if (result.code !== 0) {
    progress({ step: "error", message: `Node.js installation failed: ${result.stderr}` });
    return null;
  }
  const useResult = await runCommand(nvmExe, ["use", "22"]);
  if (useResult.code !== 0) {
    progress({ step: "error", message: `Node.js installed but nvm use failed: ${useResult.stderr}` });
    return null;
  }
  // Refresh env again — nvm use sets the symlink
  refreshWindowsEnv();
  const nodeFound: { node: string; npm: string } | null = findNodeFromNvmWindows() ?? findSystemNode();
  if (!nodeFound) {
    progress({ step: "error", message: "Node.js installed but binary not found. Try restarting Obsidian." });
    return null;
  }
  if (!checkNodeVersion(nodeFound.node)) {
    progress({ step: "error", message: "Node.js installed but version < 22." });
    return null;
  }
  progress({ step: "installing-node", message: `Node.js installed: ${nodeFound.node}` });
  return nodeFound;
}

async function getNpmPrefix(npmPath: string, env: Record<string, string | undefined>): Promise<string | null> {
  // Ask npm where its global prefix is. Falls back to the Windows default
  // (%APPDATA%\npm) when npm itself cannot answer.
  try {
    const result = await runCommand(npmPath, ["config", "get", "prefix"], env);
    const prefix: string = (result.stdout ?? "").trim().split("\n")[0].trim();
    if (result.code === 0 && prefix) return prefix;
  } catch {
    // fall through to defaults below
  }
  if (_process.platform === "win32") {
    const appData: string | undefined = _process.env.APPDATA;
    if (appData) return _join(appData, "npm");
  }
  return null;
}

export async function installDsh(npmPath: string, progress: ProgressCallback): Promise<boolean> {
  progress({ step: "installing-dsh", message: "Installing dsh via npm..." });
  const nodeFound: { node: string; npm: string } | null = findNodeFromNvm() ?? findSystemNode();
  const env: Record<string, string | undefined> = { ..._process.env };
  if (nodeFound) {
    const binDir: string = nodeFound.node.substring(0, nodeFound.node.length - 5);
    const pathSeparator: string = _process.platform === "win32" ? ";" : ":";
    env.PATH = binDir + pathSeparator + (env.PATH ?? "");
  }
  if (_process.platform === "win32") {
    // The default global prefix (%APPDATA%\npm) may not exist on a fresh
    // machine, which breaks `npm install -g` and the later `where dsh`
    // check. Create it upfront; if creation fails, let npm try on its own.
    const prefix: string | null = await getNpmPrefix(npmPath, env);
    if (prefix && !_existsSync(prefix)) {
      progress({ step: "installing-dsh", message: `Creating npm global directory: ${prefix}` });
      try {
        _mkdirSync(prefix, { recursive: true });
      } catch {
        // npm may still succeed by creating the prefix itself
      }
    }
  }
  const result = await runCommand(npmPath, ["install", "-g", DSH_PACKAGE], env);
  if (result.code !== 0) {
    progress({ step: "error", message: `dsh installation failed: ${result.stderr}` });
    return false;
  }
  progress({ step: "installing-dsh", message: "dsh installed successfully." });
  return true;
}

export async function verifyDsh(progress: ProgressCallback): Promise<boolean> {
  progress({ step: "verifying", message: "Verifying dsh installation..." });
  const installed: boolean = checkDshInstalled();
  if (!installed) {
    progress({ step: "error", message: "dsh not found after installation." });
    return false;
  }
  return true;
}

/** Final success line, reflecting whether recommended plugins were requested. */
function finishInstall(progress: ProgressCallback, plugins: string[]): void {
  const message: string = plugins.length > 0 ? "dsh and the requested plugin(s) are ready!" : "dsh is ready!";
  progress({ step: "done", message });
}

function resolveDshHome(): string {
  const fromEnv: string | undefined = _process.env.DSH_HOME;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  return DEFAULT_DSH_HOME;
}

/**
 * Build the child env used for npm/pnpm runs: prepend the resolved node's
 * bin dir so package-manager shims resolve even with Obsidian's stale PATH.
 */
function buildPackageManagerEnv(npmPath: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ..._process.env };
  const nodeFound: { node: string; npm: string } | null = findNodeFromNvm() ?? findSystemNode();
  if (nodeFound) {
    const binDir: string = nodeFound.node.substring(0, nodeFound.node.length - 5);
    const pathSeparator: string = _process.platform === "win32" ? ";" : ":";
    env.PATH = binDir + pathSeparator + (env.PATH ?? "");
  }
  // npm lives next to node; make sure its directory is on PATH too.
  const npmDir: string = _dirname(npmPath);
  const pathSeparator: string = _process.platform === "win32" ? ";" : ":";
  if (!env.PATH?.includes(npmDir)) {
    env.PATH = npmDir + pathSeparator + (env.PATH ?? "");
  }
  return env;
}

/**
 * Replicate @deepseek-ai/dsh-app-boot's initProfile for the web profile:
 * create the manifest, empty user patch layer, and pnpm settings when the
 * profile directory does not exist yet. Existing files are never touched,
 * matching dsh's own no-clobber initialization.
 */
function initWebProfileDir(dir: string): void {
  _mkdirSync(dir, { recursive: true });
  const manifestPath: string = _join(dir, "package.json");
  if (!_existsSync(manifestPath)) {
    const manifest: ProfileManifest = {
      name: "dsh-profile-web",
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: [...WEB_PROFILE_BUNDLES], patchReload: "live" } },
    };
    _writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }
  const patchPath: string = _join(dir, "cordis.patch.yml");
  if (!_existsSync(patchPath)) {
    _writeFileSync(patchPath, PROFILE_PATCH_TEMPLATE);
  }
  const workspacePath: string = _join(dir, "pnpm-workspace.yaml");
  if (!_existsSync(workspacePath)) {
    _writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE);
  }
}

function findPnpm(env: Record<string, string | undefined>): Promise<string | null> {
  const probe: string = _process.platform === "win32" ? "where" : "which";
  return runCommand(probe, ["pnpm"], env).then((result) => {
    if (result.code !== 0) return null;
    const first: string = result.stdout.trim().split("\n")[0].trim();
    return first || null;
  });
}

/**
 * Install community plugins into the dsh web profile (`~/.dsh/profiles/web`).
 *
 * This is the plugin-side replacement for `dsh plugin --profile web add`,
 * which requires pnpm on PATH. Here pnpm is used when present; otherwise the
 * install falls back to `npm install --legacy-peer-deps` so peers
 * (@deepseek-ai/cordis etc.) resolve through dsh's shared module fallback at
 * ~/.dsh/profiles/node_modules instead of being duplicated into the profile.
 *
 * After the package-manager run, each plugin name is appended to the
 * manifest's `dsh.profile.bundles` layer list so dsh boots its patch layer.
 */
export async function installProfilePlugins(npmPath: string, plugins: string[], progress: ProgressCallback): Promise<boolean> {
  if (plugins.length === 0) return true;
  const names: string = plugins.join(", ");
  progress({ step: "installing-plugins", message: `Installing dsh plugin(s): ${names}...` });
  const profileDir: string = _join(resolveDshHome(), "profiles", "web");
  initWebProfileDir(profileDir);
  const env: Record<string, string | undefined> = buildPackageManagerEnv(npmPath);

  // Idempotency: skip a plugin already present in node_modules AND bundles.
  let manifest: ProfileManifest = {};
  try {
    manifest = JSON.parse(_readFileSync(_join(profileDir, "package.json"), "utf8")) as ProfileManifest;
  } catch {
    manifest = {};
  }
  const bundles: string[] = manifest.dsh?.profile?.bundles ?? [];
  const pending: string[] = plugins.filter((p: string) => !(bundles.includes(p) && _existsSync(_join(profileDir, "node_modules", p))));
  if (pending.length === 0) {
    progress({ step: "installing-plugins", message: `dsh plugin(s) already installed: ${names}.` });
    return true;
  }

  const pnpmPath: string | null = await findPnpm(env);
  let result: { stdout: string; stderr: string; code: number | null };
  if (pnpmPath) {
    progress({ step: "installing-plugins", message: `pnpm found at ${pnpmPath} — running pnpm add...` });
    result = await runCommand(pnpmPath, ["add", ...pending], env, profileDir);
  } else {
    progress({ step: "installing-plugins", message: "pnpm not found — using npm (legacy peer resolution)..." });
    result = await runCommand(npmPath, ["install", ...pending, "--legacy-peer-deps"], env, profileDir);
  }
  if (result.code !== 0) {
    progress({ step: "error", message: `dsh plugin installation failed: ${result.stderr || result.stdout}` });
    return false;
  }

  // Reconcile the bundle layer list against the installed state, mirroring
  // dsh's own `dsh plugin` post-install step.
  try {
    const after: ProfileManifest = JSON.parse(_readFileSync(_join(profileDir, "package.json"), "utf8")) as ProfileManifest;
    const profile = after.dsh?.profile ?? {};
    const currentBundles: string[] = profile.bundles ?? [...WEB_PROFILE_BUNDLES];
    const merged: string[] = [...currentBundles];
    for (const p of pending) {
      if (!merged.includes(p)) merged.push(p);
    }
    after.dsh = { profile: { bundles: merged, patchReload: profile.patchReload ?? "live" } };
    _writeFileSync(_join(profileDir, "package.json"), JSON.stringify(after, null, 2) + "\n");
  } catch (e: unknown) {
    const message: string = e instanceof Error ? e.message : String(e);
    progress({ step: "error", message: `dsh plugin manifest update failed: ${message}` });
    return false;
  }

  for (const p of pending) {
    if (!_existsSync(_join(profileDir, "node_modules", p))) {
      progress({ step: "error", message: `dsh plugin ${p} not found in profile node_modules after install.` });
      return false;
    }
  }
  progress({ step: "installing-plugins", message: `dsh plugin(s) installed: ${names}.` });
  return true;
}

export async function runFullInstall(progress: ProgressCallback, plugins: string[] = []): Promise<boolean> {
  const isWindows: boolean = _process.platform === "win32";

  progress({ step: "checking", message: "Checking for existing dsh..." });
  if (checkDshInstalled()) {
    if (plugins.length > 0) {
      const nodeInfo: { node: string; npm: string } | null = findSystemNode() ?? findNodeFromNvm();
      if (nodeInfo) {
        await installProfilePlugins(nodeInfo.npm, plugins, progress);
      } else {
        progress({ step: "error", message: "dsh is installed, but npm could not be located to install the requested plugin(s)." });
      }
    }
    finishInstall(progress, plugins);
    return true;
  }

  progress({ step: "checking", message: "Checking for Node.js >= 22..." });
  let nodeInfo: { node: string; npm: string } | null = findSystemNode();
  if (nodeInfo && checkNodeVersion(nodeInfo.node)) {
    progress({ step: "checking", message: "Found Node.js >= 22, installing dsh..." });
  } else {
    nodeInfo = isWindows ? findNodeFromNvmWindows() : findNodeFromNvm();
    if (nodeInfo && checkNodeVersion(nodeInfo.node)) {
      progress({ step: "checking", message: "Found Node.js >= 22 via nvm, installing dsh..." });
    } else {
      if (isWindows) {
        // Windows: download Node.js standalone binary (no nvm needed)
        progress({ step: "installing-node", message: "Node.js >= 22 not found. Downloading Node.js standalone binary..." });
        nodeInfo = await downloadAndInstallNodeWindows(progress);
        if (!nodeInfo) return false;
      } else {
        // macOS/Linux: use nvm
        progress({ step: "checking", message: "Checking for nvm..." });
        const nvmReady: boolean = _existsSync(NVM_SH);
        if (nvmReady) {
          progress({ step: "checking", message: "nvm found, but Node.js 22 not installed. Installing node..." });
        } else {
          progress({ step: "checking", message: "nvm not found. Installing nvm..." });
          const nvmOk: boolean = await installNvm(progress);
          if (!nvmOk) return false;
        }
        nodeInfo = await installNode22(progress);
        if (!nodeInfo) return false;
      }
    }
  }

  const dshOk: boolean = await installDsh(nodeInfo.npm, progress);
  if (!dshOk) return false;

  const verified: boolean = await verifyDsh(progress);
  if (!verified) return false;

  // Plugin install is non-fatal: dsh itself works without it, and the
  // failure details were already surfaced via the progress callback.
  if (plugins.length > 0) {
    const pluginsOk: boolean = await installProfilePlugins(nodeInfo.npm, plugins, progress);
    if (!pluginsOk) {
      progress({ step: "done", message: "dsh is ready, but plugin installation failed — see the error above." });
      return true;
    }
  }
  finishInstall(progress, plugins);
  return true;
}

export async function runInstallWithNode(nodePath: string, progress: ProgressCallback, onCustomPath?: (dir: string) => void, plugins: string[] = []): Promise<boolean> {
  // Validate the user-provided node path
  if (!_existsSync(nodePath)) {
    progress({ step: "error", message: `File not found: ${nodePath}` });
    return false;
  }

  // Verify it's actually node >= 22
  progress({ step: "checking", message: `Verifying Node.js at ${nodePath}...` });
  if (!checkNodeVersion(nodePath)) {
    progress({ step: "error", message: "Node.js found but version < 22. Please install Node.js 22+ first." });
    return false;
  }

  // Extract npm path from node path (same directory)
  const dir: string = _dirname(nodePath);
  const npmName: string = _process.platform === "win32" ? "npm.cmd" : "npm";
  const npmPath: string = _join(dir, npmName);

  if (!_existsSync(npmPath)) {
    progress({ step: "error", message: `npm not found in same directory as node: ${dir}` });
    return false;
  }

  // Notify plugin to save this path for future sessions
  if (onCustomPath) {
    onCustomPath(dir);
  }

  // Install dsh using this npm
  const dshOk: boolean = await installDsh(npmPath, progress);
  if (!dshOk) return false;

  const verified: boolean = await verifyDsh(progress);
  if (!verified) return false;

  // Non-fatal, same policy as runFullInstall.
  if (plugins.length > 0) {
    const pluginsOk: boolean = await installProfilePlugins(npmPath, plugins, progress);
    if (!pluginsOk) {
      progress({ step: "done", message: "dsh is ready, but plugin installation failed — see the error above." });
      return true;
    }
  }
  finishInstall(progress, plugins);
  return true;
}
