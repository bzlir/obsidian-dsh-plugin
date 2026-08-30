import { App, Modal, Setting, ButtonComponent, Notice } from "obsidian";
import { runFullInstall, checkDshInstalled, type InstallProgress, type ProgressCallback } from "./dsh-installer";

type InstallState = "idle" | "installing" | "done" | "error";

export class DshInstallModal extends Modal {
  private onRetry: () => void;
  private state: InstallState = "idle";
  private progressEl: HTMLElement | null = null;

  constructor(app: App, onRetry: () => void) {
    super(app);
    this.onRetry = onRetry;
  }

  onOpen(): void {
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
          void this.runInstall(btn);
        });
      })
      .addButton((btn: ButtonComponent) => {
        btn.setButtonText("Retry").onClick(() => {
          this.close();
          this.onRetry();
        });
      })
      .addButton((btn: ButtonComponent) => {
        btn.setButtonText("Close").onClick(() => {
          this.close();
        });
      });

    const infoSetting: Setting = new Setting(contentEl);
    infoSetting.setDesc("Manual install: npm install -g @deepseek-ai/dsh");
  }

  private async runInstall(btn: ButtonComponent): Promise<void> {
    if (this.state === "installing") {
      new Notice("Installation already in progress...");
      return;
    }
    this.state = "installing";
    btn.setButtonText("Installing...").setDisabled(true);
    this.progressEl?.show();
    this.updateProgress({ step: "checking", message: "Starting installation..." });

    const callback: ProgressCallback = (progress: InstallProgress) => {
      this.updateProgress(progress);
    };

    try {
      const success: boolean = await runFullInstall(callback);
      if (success) {
        this.state = "done";
        btn.setButtonText("Done!").setDisabled(false);
        new Notice("dsh installed successfully!");
        this.close();
        this.onRetry();
      } else {
        this.state = "error";
        btn.setButtonText("Retry Install").setDisabled(false);
      }
    } catch (err: unknown) {
      this.state = "error";
      const error: Error = err as Error;
      this.updateProgress({ step: "error", message: `Unexpected error: ${error.message}` });
      btn.setButtonText("Retry Install").setDisabled(false);
      new Notice(`Installation failed: ${error.message}`);
    }
  }

  private updateProgress(progress: InstallProgress): void {
    if (!this.progressEl) return;
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
