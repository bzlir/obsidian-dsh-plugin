import { ChildProcess, spawn } from "child_process";
import { createServer, createConnection } from "net";
import { homedir } from "os";
import { existsSync, readdirSync } from "fs";
import { join } from "path";

const DSH_COMMAND = "dsh";
const STARTUP_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 500;
const SHUTDOWN_GRACE_MS = 5_000;

function candidateBinDirs(): string[] {
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
  return dirs;
}

function augmentedEnv(): NodeJS.ProcessEnv {
  const base = process.env.PATH ?? "/usr/bin:/bin";
  const merged = base.split(":");
  const seen = new Set(merged);
  for (const d of candidateBinDirs()) {
    if (existsSync(d) && !seen.has(d)) {
      merged.push(d);
      seen.add(d);
    }
  }
  return { ...process.env, PATH: merged.join(":") };
}

function resolveViaLoginShell(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("/bin/zsh", ["-l", "-c", "command -v dsh"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout?.on("data", (d: Buffer) => (out += d.toString()));
    child.on("error", () => resolve(null));
    child.on("exit", () => resolve(out.trim() || null));
  });
}

export class DshManager {
  private process: ChildProcess | null = null;
  private port: number | null = null;
  private stderrLines: string[] = [];
  private resolvedCommand: string | null = null;
  private onUnexpectedExit: ((info: { code: number | null; signal: string | null; stderr: string }) => void) | null = null;

  setOnUnexpectedExit(cb: (info: { code: number | null; signal: string | null; stderr: string }) => void): void {
    this.onUnexpectedExit = cb;
  }

  async isAvailable(): Promise<boolean> {
    if (this.resolvedCommand) return true;
    const cmd = await this.resolveDsh();
    if (cmd) {
      this.resolvedCommand = cmd;
      return true;
    }
    return false;
  }

  private resolveDsh(): Promise<string | null> {
    return new Promise((resolve) => {
      const child = spawn(DSH_COMMAND, ["--version"], {
        stdio: "pipe",
        env: augmentedEnv(),
      });
      child.on("error", async () => {
        const viaShell = await resolveViaLoginShell();
        resolve(viaShell);
      });
      child.on("exit", async (code) => {
        if (code === 0) resolve(DSH_COMMAND);
        else {
          const viaShell = await resolveViaLoginShell();
          resolve(viaShell);
        }
      });
    });
  }

  async start(vaultPath: string): Promise<number> {
    if (this.process) {
      throw new Error("DSH process is already running");
    }
    if (!this.resolvedCommand) {
      const cmd = await this.resolveDsh();
      if (!cmd) throw new Error("DSH binary not found on PATH");
      this.resolvedCommand = cmd;
    }
    const port = await this.findFreePort();
    this.port = port;
    this.stderrLines = [];

    this.process = spawn(
      this.resolvedCommand,
      ["web", "--port", String(port), "--host", "127.0.0.1"],
      { cwd: vaultPath, stdio: ["pipe", "pipe", "pipe"], env: augmentedEnv() }
    );

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
    return port;
  }

  stop(): void {
    if (this.process) {
      const proc = this.process;
      this.process = null;
      proc.removeAllListeners("exit");
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, SHUTDOWN_GRACE_MS);
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
    while (Date.now() < deadline) {
      if (this.process === null) {
        throw new Error(
          `DSH process exited before becoming ready.\nStderr:\n${this.stderrLines.join("\n")}`
        );
      }
      if (await this.checkPort(port)) return;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error(`DSH did not become ready within ${STARTUP_TIMEOUT_MS / 1000}s`);
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
}
