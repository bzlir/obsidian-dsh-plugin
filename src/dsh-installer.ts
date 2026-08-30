import { spawn, execFileSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const _spawn = spawn as unknown as (command: string, args: string[], options: object) => TypedChildProcess;
const _execFileSync = execFileSync as unknown as (cmd: string, args: string[], options: object) => string;
const _existsSync = existsSync as unknown as (path: string) => boolean;
const _join = join as unknown as (...paths: string[]) => string;
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

export function findSystemNode(): { node: string; npm: string } | null {
  try {
    const nodePath: string = _execFileSync("which", ["node"], { stdio: ["pipe", "pipe", "pipe"] }).trim();
    const npmPath: string = _execFileSync("which", ["npm"], { stdio: ["pipe", "pipe", "pipe"] }).trim();
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
  try {
    _execFileSync("which", ["dsh"], { stdio: ["pipe", "pipe", "pipe"] });
    return true;
  } catch {
    // Check nvm bin dirs
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
      const code: number | null = args[0] as number | null;
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
  progress({ step: "installing-nvm", message: "Downloading and installing nvm..." });
  const result = await runCommand("bash", ["-c", `curl -fsSL ${NVM_INSTALL_URL} | bash`]);
  if (result.code !== 0 && !_existsSync(NVM_SH)) {
    progress({ step: "error", message: `nvm installation failed: ${result.stderr}` });
    return false;
  }
  progress({ step: "installing-nvm", message: "nvm installed successfully." });
  return true;
}

export async function installNode22(progress: ProgressCallback): Promise<{ node: string; npm: string } | null> {
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
    nodeInfo = findNodeFromNvm();
    if (!nodeInfo || !checkNodeVersion(nodeInfo.node)) {
      // Need to install nvm + node
      if (!_existsSync(NVM_SH)) {
        const nvmOk: boolean = await installNvm(progress);
        if (!nvmOk) return false;
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
