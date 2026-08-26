import { App, Modal } from "obsidian";

export class DshInstallModal extends Modal {
  private onRetry: () => void;

  constructor(app: App, onRetry: () => void) {
    super(app);
    this.onRetry = onRetry;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "DSH not found" });

    contentEl.createEl("p", {
      text: "DeepSeek Harness (dsh) is required but was not found on your PATH.",
    });

    contentEl.createEl("p", { text: "Install via npm:" });
    const pre = contentEl.createEl("pre", { cls: "dsh-install-cmd" });
    pre.createEl("code", { text: "npm install -g @deepseek-ai/dsh" });

    contentEl.createEl("p", { text: "Or download a release:" });
    contentEl.createEl("a", {
      text: "github.com/deepseek-ai/deepseek-harness/releases",
      href: "https://github.com/deepseek-ai/deepseek-harness/releases",
    });

    const btnContainer = contentEl.createDiv({ cls: "modal-button-container" });
    const retryBtn = btnContainer.createEl("button", {
      text: "Retry",
      cls: "mod-cta",
    });
    retryBtn.addEventListener("click", () => {
      this.close();
      this.onRetry();
    });

    const closeBtn = btnContainer.createEl("button", { text: "Close" });
    closeBtn.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
