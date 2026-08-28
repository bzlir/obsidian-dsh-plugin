import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type DshPlugin from "./main";
import { searchForDsh } from "./dsh-manager";
import { dirname } from "path";

export class DshSettingTab extends PluginSettingTab {
  private plugin: DshPlugin;
  private searchInProgress = false;

  constructor(app: App, plugin: DshPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("DSH search paths")
      .setHeading();

    new Setting(containerEl)
      .setDesc("Additional directories to search for the dsh and node binaries. The plugin auto-scans nvm, Homebrew, Volta, asdf, fnm, ~/.local/bin, and ~/bin. Add a custom path below if dsh is installed elsewhere.");

    // Render existing custom paths with delete buttons.
    for (const path of this.plugin.settings.customPaths) {
      new Setting(containerEl)
        .addText((text) =>
          text.setValue(path).setDisabled(true)
        )
        .addExtraButton((btn) =>
          btn.setIcon("trash").setTooltip("Remove").onClick(() => {
            this.plugin.settings.customPaths = this.plugin.settings.customPaths.filter((p: string) => p !== path);
            void this.plugin.saveSettings();
            this.plugin.applyCustomPaths();
            this.display();
          })
        );
    }

    // Input + Add button.
    let newPath = "";
    new Setting(containerEl)
      .setName("Add custom path")
      .setDesc("A directory containing the dsh binary (e.g. /usr/local/my-dsh/bin)")
      .addText((text) => {
        text.setValue("");
        text.inputEl.addEventListener("change", () => {
          newPath = text.getValue().trim();
        });
      })
      .addButton((btn) =>
        btn.setButtonText("Add").setCta().onClick(() => {
          if (!newPath) {
            new Notice("Enter a path first");
            return;
          }
          if (this.plugin.settings.customPaths.includes(newPath)) {
            new Notice("Path already added");
            return;
          }
          this.plugin.settings.customPaths.push(newPath);
          void this.plugin.saveSettings();
          this.plugin.applyCustomPaths();
          new Notice(`Added: ${newPath}`);
          newPath = "";
          this.display();
        })
      );

    // Search button.
    new Setting(containerEl)
      .setName("Search for dsh")
      .setDesc("Scan the filesystem for dsh binaries and add their directories automatically.")
      .addButton((btn) => {
        btn.setButtonText("Search").onClick(async () => {
          if (this.searchInProgress) {
            new Notice("Search already running...");
            return;
          }
          this.searchInProgress = true;
          btn.setButtonText("Searching...").setDisabled(true);
          new Notice("Searching for dsh on your machine...");

          try {
            const found = await searchForDsh();
            if (found.length === 0) {
              new Notice("No dsh binary found. Install it via: npm install -g @deepseek-ai/dsh");
              return;
            }
            let added = 0;
            for (const dshPath of found) {
              const dir = dirname(dshPath);
              if (!this.plugin.settings.customPaths.includes(dir)) {
                this.plugin.settings.customPaths.push(dir);
                added++;
              }
            }
            if (added > 0) {
              void this.plugin.saveSettings();
              this.plugin.applyCustomPaths();
              new Notice(`Found ${found.length} dsh binary, added ${added} new path(s)`);
              this.display();
            } else {
              new Notice(`Found ${found.length} dsh binary, but path(s) already added`);
            }
          } catch (err) {
            new Notice(`Search failed: ${(err as Error).message}`);
          } finally {
            this.searchInProgress = false;
            btn.setButtonText("Search").setDisabled(false);
          }
        });
      });
  }
}
