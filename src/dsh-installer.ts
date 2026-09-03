import { spawn, execFileSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import https from "https";

const _spawn = spawn as unknown as (command: string, args: string[], options: object) => TypedChildProcess;
const _execFileSync = execFileSync as unknown as (cmd: string, args: string[], options: object) => string;
const _existsSync = existsSync as unknown as (path: string) => boolean;
const _mkdirSync = mkdirSync as unknown as (path: string, options: object) => void;
const _writeFileSync = writeFileSync as unknown as (path: string, data: Uint8Array) => void;
const _join = join as unknown as (...paths: string[]) => string;
const _homedir = homedir as unknown as () => string;
const _https = https as unknown as { get: (url: string, callback: (res: TypedIncomingMessage) => void) => TypedClientRequest };

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

interface TypedClientRequest {
  on: (event: string, listener: (...args: never[]) => void) => void;
  destroy: () => void;
}

interface TypedIncomingMessage {
  statusCode: number | undefined;
  headers: Record<string, string | string[] | undefined>;
  on: (event: string, listener: (...args: never[]) => void) => void;
}

const _process = process as unknown as TypedProcess;

interface TypedProcess {
  env: Record<string, string | undefined>;
  platform: string;
}

const NVM_INSTALL_URL = "https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh";
const NVM_DIR = _join(_homedir(), ".nvm");
const NVM_SH = _join(NVM_DIR, "nvm.sh");
const NVM_NODE_ROOT = _join(NVM_DIR, "versions", "node");
const DSH_PACKAGE = "@deepseek-ai/dsh";

export type InstallStep = "idle" | "checking" | "installing-nvm" | "installing-node" | "installing-dsh" | "verifying" | "done" | "error";

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

function runCommand(command: string, args: string[], env?: Record<string, string | undefined>): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child: TypedChildProcess = _spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], env: env ?? _process.env });
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
  // winget failed and nvm.exe not found — try direct download
  progress({ step: "installing-nvm", message: `winget failed (code ${wingetResult.code}), trying direct download...` });
  const downloadOk: boolean = await downloadAndInstallNvmWindows(progress);
  if (!downloadOk) return false;

  // Re-check after direct install
  refreshWindowsEnv();
  const nvmAfterDownload: string | null = findNvmExe();
  if (nvmAfterDownload) {
    progress({ step: "installing-nvm", message: "nvm-windows installed via direct download." });
    return true;
  }

  progress({ step: "error", message: `nvm-windows installation failed. Try manual install from https://github.com/coreybutler/nvm-windows/releases. Error: ${wingetResult.stderr}` });
  return false;
}

async function downloadAndInstallNvmWindows(progress: ProgressCallback): Promise<boolean> {
  const nvmVersion: string = "1.2.2";
  const downloadUrl: string = `https://github.com/coreybutler/nvm-windows/releases/download/${nvmVersion}/nvm-setup.exe`;
  const tempDir: string = _join(_homedir(), ".dsh", "downloads");
  const exePath: string = _join(tempDir, "nvm-setup.exe");

  try {
    _mkdirSync(tempDir, { recursive: true });
  } catch {
    // dir may already exist
  }

  progress({ step: "installing-nvm", message: `Downloading nvm-windows ${nvmVersion}...` });

  // Download via https with redirect support
  const downloaded: boolean = await downloadFile(downloadUrl, exePath);
  if (!downloaded) {
    progress({ step: "error", message: `Failed to download nvm-setup.exe from ${downloadUrl}` });
    return false;
  }

  progress({ step: "installing-nvm", message: "Running nvm-windows installer (silent)..." });
  // Run installer silently: /S flag for NSIS installer
  const result = await runCommand(exePath, ["/S"]);
  if (result.code !== 0) {
    progress({ step: "error", message: `nvm installer failed (exit ${result.code}): ${result.stderr}` });
    return false;
  }

  return true;
}

function downloadFile(url: string, destPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const handleResponse = (response: TypedIncomingMessage): void => {
      const statusCode: number = response.statusCode ?? 0;
      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        const redirectUrl: string = Array.isArray(response.headers.location) ? response.headers.location[0] : response.headers.location;
        const redirected: TypedClientRequest = _https.get(redirectUrl, handleResponse);
        redirected.on("error", () => resolve(false));
        return;
      }
      if (statusCode !== 200) {
        resolve(false);
        return;
      }
      const chunks: Uint8Array[] = [];
      response.on("data", (...args: never[]) => {
        const chunk: Uint8Array = args[0] as Uint8Array;
        chunks.push(chunk);
      });
      response.on("end", (...args: never[]) => {
        try {
          const totalLength: number = chunks.reduce((sum: number, c: Uint8Array) => sum + c.length, 0);
          const combined: Uint8Array = new Uint8Array(totalLength);
          let offset: number = 0;
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }
          _writeFileSync(destPath, combined);
          resolve(true);
        } catch {
          resolve(false);
        }
      });
      response.on("error", () => resolve(false));
    };
    const req: TypedClientRequest = _https.get(url, handleResponse);
    req.on("error", () => resolve(false));
  });
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

export async function installDsh(npmPath: string, progress: ProgressCallback): Promise<boolean> {
  progress({ step: "installing-dsh", message: "Installing dsh via npm..." });
  const nodeFound: { node: string; npm: string } | null = findNodeFromNvm() ?? findSystemNode();
  const env: Record<string, string | undefined> = { ..._process.env };
  if (nodeFound) {
    const binDir: string = nodeFound.node.substring(0, nodeFound.node.length - 5);
    const pathSeparator: string = _process.platform === "win32" ? ";" : ":";
    env.PATH = binDir + pathSeparator + (env.PATH ?? "");
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
  progress({ step: "done", message: "dsh is ready!" });
  return true;
}

export async function runFullInstall(progress: ProgressCallback): Promise<boolean> {
  const isWindows: boolean = _process.platform === "win32";

  progress({ step: "checking", message: "Checking for existing dsh..." });
  if (checkDshInstalled()) {
    progress({ step: "done", message: "dsh is already installed." });
    return true;
  }

  progress({ step: "checking", message: "Checking for Node.js >= 22..." });
  let nodeInfo: { node: string; npm: string } | null = findSystemNode();
  if (nodeInfo && checkNodeVersion(nodeInfo.node)) {
    // Have node >= 22, install dsh directly
  } else {
    nodeInfo = isWindows ? findNodeFromNvmWindows() : findNodeFromNvm();
    if (!nodeInfo || !checkNodeVersion(nodeInfo.node)) {
      // Need to install nvm + node
      const nvmHome: string | undefined = _process.env.NVM_HOME;
      const nvmReady: boolean = isWindows ? (nvmHome !== undefined && _existsSync(nvmHome)) : _existsSync(NVM_SH);
      if (!nvmReady) {
        // On Windows, also check if nvm.exe is findable even without NVM_HOME
        const winReady: boolean = isWindows ? findNvmExe() !== null : false;
        if (!winReady) {
          const nvmOk: boolean = await installNvm(progress);
          if (!nvmOk) return false;
        }
      }
      nodeInfo = await installNode22(progress);
      if (!nodeInfo) return false;
    }
  }

  const dshOk: boolean = await installDsh(nodeInfo.npm, progress);
  if (!dshOk) return false;

  const verified: boolean = await verifyDsh(progress);
  return verified;
}
