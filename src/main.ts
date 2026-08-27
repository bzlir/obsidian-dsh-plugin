import { Plugin } from "obsidian";
import { DshManager } from "./dsh-manager";
import { DSH_VIEW_TYPE, DshView } from "./dsh-view";
import { DshInstallModal } from "./dsh-install-modal";

export default class DshPlugin extends Plugin {
  private dsh!: DshManager;

  async onload(): Promise<void> {
    this.dsh = new DshManager();

    // Kill any orphaned dsh web processes from a previous crashed session.
    // Obsidian's Cmd+Q may SIGKILL the Electron main process without giving
    // plugins a chance to clean up, so dsh children survive. Reap them here
    // so every Obsidian launch starts clean.
    this.dsh.reapOrphanedDsh();

    this.registerView(DSH_VIEW_TYPE, (leaf) => new DshView(leaf, this.dsh));

    this.addRibbonIcon("bot", "Open DSH", () => {
      this.openDshView();
    });

    this.addCommand({
      id: "open-dsh-view",
      name: "Open DSH",
      callback: () => this.openDshView(),
    });

    this.app.workspace.onLayoutReady(() => {
      this.checkDshAvailability();
    });
  }

  async onunload(): Promise<void> {
    this.dsh.stop();
  }

  private async checkDshAvailability(): Promise<void> {
    const available = await this.dsh.isAvailable();
    if (!available) {
      new DshInstallModal(this.app, () => {
        this.checkDshAvailability();
      }).open();
    }
  }

  private async openDshView(): Promise<void> {
    const available = await this.dsh.isAvailable();
    if (!available) {
      new DshInstallModal(this.app, () => {
        this.checkDshAvailability();
      }).open();
      return;
    }

    const existing = this.app.workspace.getLeavesOfType(DSH_VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: DSH_VIEW_TYPE, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
}
