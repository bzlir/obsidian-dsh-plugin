import { App, Notice, PluginSettingTab, Setting, SettingDefinitionItem, SettingDefinitionRender, SettingDefinitionGroup, ButtonComponent } from "obsidian";
import type DshPlugin from "./main";
import { searchForDsh } from "./dsh-manager";
import { dirname } from "path";

const _dirname = dirname as unknown as (path: string) => string;

export class DshSettingTab extends PluginSettingTab {
  private plugin: DshPlugin;
  private searchInProgress = false;

  constructor(app: App, plugin: DshPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const items: SettingDefinitionItem[] = [];

    // Heading.
    const heading: SettingDefinitionGroup = {
      type: "group",
      heading: "DSH search paths",
      items: [],
    };
    items.push(heading);

    // Description row.
    const desc: SettingDefinitionRender = {
      name: "",
      desc: "Additional directories to search for the dsh and node binaries. The plugin auto-scans nvm, Homebrew, Volta, asdf, fnm, ~/.local/bin, and ~/bin. Add a custom path below if dsh is installed elsewhere.",
      render: () => {},
    };
    items.push(desc);

    // One row per existing custom path (with delete button).
    for (const path of this.plugin.settings.customPaths) {
      const row: SettingDefinitionRender = {
        name: path,
        render: (setting: Setting) => {
          setting.addExtraButton((btn) =>
            btn.setIcon("trash").setTooltip("Remove").onClick(() => {
              this.plugin.settings.customPaths = this.plugin.settings.customPaths.filter((p: string) => p !== path);
              void this.plugin.saveSettings();
              this.plugin.applyCustomPaths();
              this.update();
            })
          );
        },
      };
      items.push(row);
    }

    // Add-path input + button.
    let newPath = "";
    const addRow: SettingDefinitionRender = {
      name: "Add custom path",
      desc: "A directory containing the dsh binary (e.g. /usr/local/my-dsh/bin)",
      render: (setting: Setting) => {
        setting.addText((text) => {
          text.setValue("");
          text.inputEl.addEventListener("change", () => {
            newPath = text.getValue().trim();
          });
        });
        setting.addButton((btn) =>
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
            this.update();
          })
        );
      },
    };
    items.push(addRow);

    // Search button.
    const searchRow: SettingDefinitionRender = {
      name: "Search for dsh",
      desc: "Scan the filesystem for dsh binaries and add their directories automatically.",
      render: (setting: Setting) => {
        setting.addButton((btn) => {
          btn.setButtonText("Search").onClick(() => {
            if (this.searchInProgress) {
              new Notice("Search already running...");
              return;
            }
            this.searchInProgress = true;
            btn.setButtonText("Searching...").setDisabled(true);
            new Notice("Searching for dsh on your machine...");
            void this.runSearch(btn);
          });
        });
      },
    };
    items.push(searchRow);

    return items;
  }

  private async runSearch(btn: ButtonComponent): Promise<void> {
    try {
      const found = await searchForDsh();
      if (found.length === 0) {
        new Notice("No dsh binary found. Install it via: npm install -g @deepseek-ai/dsh");
        return;
      }
      let added = 0;
      for (const dshPath of found) {
        const dir: string = _dirname(dshPath);
        if (!this.plugin.settings.customPaths.includes(dir)) {
          this.plugin.settings.customPaths.push(dir);
          added++;
        }
      }
      if (added > 0) {
        void this.plugin.saveSettings();
        this.plugin.applyCustomPaths();
        new Notice(`Found ${found.length} dsh binary, added ${added} new path(s)`);
        this.update();
      } else {
        new Notice(`Found ${found.length} dsh binary, but path(s) already added`);
      }
    } catch (err: unknown) {
      new Notice(`Search failed: ${(err as Error).message}`);
    } finally {
      this.searchInProgress = false;
      btn.setButtonText("Search").setDisabled(false);
    }
  }
}
