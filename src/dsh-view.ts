import { ItemView, WorkspaceLeaf } from "obsidian";
import { DshManager } from "./dsh-manager";

export const DSH_VIEW_TYPE = "dsh-view";

export class DshView extends ItemView {
  private dsh: DshManager;
  private iframe: HTMLIFrameElement | null = null;
  private statusEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, dsh: DshManager) {
    super(leaf);
    this.dsh = dsh;
  }

  getViewType(): string {
    return DSH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "DSH";
  }

  getIcon(): string {
    return "bot";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("dsh-view-content");

    this.statusEl = this.contentEl.createEl("div", {
      text: "Starting DSH...",
      cls: "dsh-status",
    });

    this.dsh.setOnUnexpectedExit((info) => {
      this.showStatus(
        `DSH process exited unexpectedly (code: ${info.code}, signal: ${info.signal}).\n${info.stderr}`
      );
      this.iframe?.remove();
      this.iframe = null;
    });

    try {
      const vaultPath = (this.app.vault.adapter as any).getBasePath?.() ?? "";
      if (!vaultPath) {
        throw new Error("Could not determine vault path");
      }

      const port = await this.dsh.start(vaultPath);

      this.iframe = this.contentEl.createEl("iframe", {
        attr: {
          src: `http://127.0.0.1:${port}`,
          allow: "clipboard-read; clipboard-write",
        },
      });
      this.iframe.addClass("dsh-iframe");

      this.iframe.addEventListener("load", () => {
        this.statusEl?.hide();
      });
    } catch (err) {
      this.showStatus(`Failed to start DSH: ${(err as Error).message}`);
    }
  }

  async onClose(): Promise<void> {
    this.dsh.stop();
    this.iframe?.remove();
    this.iframe = null;
    this.statusEl = null;
  }

  private showStatus(msg: string): void {
    if (!this.statusEl) {
      this.statusEl = this.contentEl.createEl("div", { cls: "dsh-status" });
    }
    this.statusEl.empty();
    this.statusEl.show();
    const pre = this.statusEl.createEl("pre", { cls: "dsh-error" });
    pre.createEl("code", { text: msg });
  }
}
