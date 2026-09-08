import { App, Modal, Setting, ButtonComponent, TextComponent, Notice } from "obsidian";
import { runFullInstall, runInstallWithNode, type InstallProgress, type ProgressCallback } from "./dsh-installer";
import type DshPlugin from "./main";

type ModalMode = "auto" | "manual" | "installing";

export class DshInstallModal extends Modal {
  private onRetry: () => void;
  private plugin: DshPlugin;
  private mode: ModalMode = "auto";
  private progressEl: HTMLElement | null = null;
  private manualNodePath = "";

  constructor(app: App, plugin: DshPlugin, onRetry: () => void) {
    super(app);
    this.plugin = plugin;
    this.onRetry = onRetry;
  }

  onOpen(): void {
    this.renderAutoMode();
  }

  private renderAutoMode(): void {
    this.mode = "auto";
    const { contentEl } = this;
    contentEl.empty();

    this.titleEl.setText("DSH not found");

    new Setting(contentEl)
      .setName("DeepSeek Harness (dsh) is required")
      .setDesc("dsh is not installed on your machine. Click Install to automatically install nvm, Node.js 22, and dsh — no terminal needed.");

    this.progressEl = contentEl.createDiv({ cls: "dsh-install-progress" });
    this.progressEl.hide();

    new Setting(contentEl)
      .addButton((btn: ButtonComponent) => {
        btn.setButtonText("Install").setCta().onClick(() => {
          void this.runAutoInstall(btn);
        });
      })
      .addButton((btn: ButtonComponent) => {
        btn.setButtonText("Enter path manually").onClick(() => {
          this.renderManualMode();
        });
      })
      .addButton((btn: ButtonComponent) => {
        btn.setButtonText("Close").onClick(() => {
          this.close();
        });
      });
  }

  private renderManualMode(): void {
    this.mode = "manual";
    const { contentEl } = this;
    contentEl.empty();

    this.titleEl.setText("Manual path configuration");

    new Setting(contentEl)
      .setName("Node.js not detected")
      .setDesc("The plugin could not find Node.js or nvm on your system. This usually happens because Obsidian's process environment doesn't include the system PATH. You can provide the path manually.");

    const cmdSetting: Setting = new Setting(contentEl)
      .setName("Step 1: Find your node path")
      .setDesc("Open PowerShell and run:");
    const pre: HTMLElement = cmdSetting.infoEl.createEl("pre", { cls: "dsh-install-cmd" });
    const platform: string = (process as { platform: string }).platform;
    const cmd: string = platform === "win32" ? "where node" : "which node";
    pre.createEl("code", { text: cmd });

    new Setting(contentEl)
      .setName("Step 2: Paste the path here")
      .setDesc("Paste the full path to node (e.g. C:\\Users\\you\\AppData\\Roaming\\nvm\\v22.11.0\\node.exe)")
      .addText((text: TextComponent) => {
        text.setPlaceholder("C:\\path\\to\\node.exe").onChange((val: string) => {
          this.manualNodePath = val.trim();
        });
      });

    new Setting(contentEl)
      .addButton((btn: ButtonComponent) => {
        btn.setButtonText("Install with this path").setCta().onClick(() => {
          void this.runManualInstall(btn);
        });
      })
      .addButton((btn: ButtonComponent) => {
        btn.setButtonText("Back").onClick(() => {
          this.renderAutoMode();
        });
      })
      .addButton((btn: ButtonComponent) => {
        btn.setButtonText("Close").onClick(() => {
          this.close();
        });
      });
  }

  private renderInstallingMode(): void {
    this.mode = "installing";
    const { contentEl } = this;
    contentEl.empty();

    this.titleEl.setText("Installing...");

    this.progressEl = contentEl.createDiv({ cls: "dsh-install-progress" });
    this.progressEl.show();
  }

  private async runAutoInstall(btn: ButtonComponent): Promise<void> {
    btn.setButtonText("Installing...").setDisabled(true);
    this.progressEl?.show();
    this.updateProgress({ step: "checking", message: "Starting installation..." });

    const callback: ProgressCallback = (progress: InstallProgress) => {
      this.updateProgress(progress);
    };

    try {
      const success: boolean = await runFullInstall(callback);
      if (success) {
        new Notice("dsh installed successfully!");
        this.close();
        this.onRetry();
      } else {
        btn.setButtonText("Retry Install").setDisabled(false);
      }
    } catch (err: unknown) {
      const error: Error = err as Error;
      this.updateProgress({ step: "error", message: `Unexpected error: ${error.message}` });
      btn.setButtonText("Retry Install").setDisabled(false);
      new Notice(`Installation failed: ${error.message}`);
    }
  }

  private async runManualInstall(btn: ButtonComponent): Promise<void> {
    if (!this.manualNodePath) {
      new Notice("Enter the node path first");
      return;
    }

    this.renderInstallingMode();
    btn.setButtonText("Installing...").setDisabled(true);

    const callback: ProgressCallback = (progress: InstallProgress) => {
      this.updateProgress(progress);
    };

    try {
      const success: boolean = await runInstallWithNode(this.manualNodePath, callback, (dir: string) => {
        if (!this.plugin.settings.customPaths.includes(dir)) {
          this.plugin.settings.customPaths.push(dir);
          void this.plugin.saveSettings();
          this.plugin.applyCustomPaths();
        }
      });
      if (success) {
        new Notice("dsh installed successfully!");
        this.close();
        this.onRetry();
      } else {
        this.renderManualMode();
      }
    } catch (err: unknown) {
      const error: Error = err as Error;
      this.updateProgress({ step: "error", message: `Unexpected error: ${error.message}` });
      new Notice(`Installation failed: ${error.message}`);
      this.renderManualMode();
    }
  }

  private updateProgress(progress: InstallProgress): void {
    if (!this.progressEl) {
      this.progressEl = this.contentEl.createDiv({ cls: "dsh-install-progress" });
    }
    this.progressEl.empty();
    const stepLabel: string = this.stepLabel(progress.step);
    const text: string = `[${stepLabel}] ${progress.message}`;
    const pre: HTMLElement = this.progressEl.createEl("pre", { cls: "dsh-install-log" });
    pre.createEl("code", { text });
    if (progress.step === "error") {
      this.progressEl.addClass("dsh-install-error");
    } else if (progress.step === "done") {
      this.progressEl.addClass("dsh-install-success");
    }
  }

  private stepLabel(step: string): string {
    const labels: Record<string, string> = {
      idle: "READY",
      checking: "CHECK",
      "installing-nvm": "NVM",
      "installing-node": "NODE",
      "installing-dsh": "DSH",
      verifying: "VERIFY",
      done: "OK",
      error: "FAIL",
    };
    return labels[step] ?? step.toUpperCase();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
