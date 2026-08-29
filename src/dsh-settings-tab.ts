import { App, Notice, PluginSettingTab, Setting, SettingDefinitionItem, SettingDefinitionRender, SettingDefinitionGroup, ButtonComponent, ExtraButtonComponent, TextComponent } from "obsidian";
import type DshPlugin from "./main";
import { searchForDsh } from "./dsh-manager";
import { dirname } from "path";
import {
  isDshConfigured,
  readProviders,
  readCredentials,
  addProvider,
  removeProvider,
  getCredential,
  setCredential,
  generateApiKeyEnv,
  maskApiKey,
  detectAgents,
  importFromAgent,
  type ProviderConfig,
  type ProviderModel,
  type ImportedProvider,
} from "./dsh-provider-config";

const _dirname = dirname as unknown as (path: string) => string;

export class DshSettingTab extends PluginSettingTab {
  private plugin: DshPlugin;
  private searchInProgress = false;
  private detectedAgents: string[] = [];

  constructor(app: App, plugin: DshPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const items: SettingDefinitionItem[] = [];

    this.buildSearchPathsSection(items);
    this.buildProviderConfigSection(items);
    this.buildAgentImportSection(items);

    return items;
  }

  private buildSearchPathsSection(items: SettingDefinitionItem[]): void {
    const heading: SettingDefinitionGroup = {
      type: "group",
      heading: "DSH search paths",
      items: [],
    };
    items.push(heading);

    const desc: SettingDefinitionRender = {
      name: "",
      desc: "Additional directories to search for the dsh and node binaries. The plugin auto-scans nvm, Homebrew, Volta, asdf, fnm, ~/.local/bin, and ~/bin. Add a custom path below if dsh is installed elsewhere.",
      render: () => {},
    };
    items.push(desc);

    for (const path of this.plugin.settings.customPaths) {
      const pathCopy: string = path;
      const row: SettingDefinitionRender = {
        name: pathCopy,
        render: (setting: Setting) => {
          setting.addExtraButton((btn: ExtraButtonComponent) =>
            btn.setIcon("trash").setTooltip("Remove").onClick(() => {
              this.plugin.settings.customPaths = this.plugin.settings.customPaths.filter((p: string) => p !== pathCopy);
              void this.plugin.saveSettings();
              this.plugin.applyCustomPaths();
              this.update();
            })
          );
        },
      };
      items.push(row);
    }

    let newPath = "";
    const addRow: SettingDefinitionRender = {
      name: "Add custom path",
      desc: "A directory containing the dsh binary (e.g. /usr/local/my-dsh/bin)",
      render: (setting: Setting) => {
        setting.addText((text: TextComponent) => {
          text.setValue("");
          text.inputEl.addEventListener("change", () => {
            newPath = text.getValue().trim();
          });
        });
        setting.addButton((btn: ButtonComponent) =>
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

    const searchRow: SettingDefinitionRender = {
      name: "Search for dsh",
      desc: "Scan the filesystem for dsh binaries and add their directories automatically.",
      render: (setting: Setting) => {
        setting.addButton((btn: ButtonComponent) => {
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
  }

  private buildProviderConfigSection(items: SettingDefinitionItem[]): void {
    const heading: SettingDefinitionGroup = {
      type: "group",
      heading: "DSH provider configuration",
      items: [],
    };
    items.push(heading);

    if (!isDshConfigured()) {
      const warn: SettingDefinitionRender = {
        name: "dsh not configured",
        desc: "Install dsh first (npm install -g @deepseek-ai/dsh), then return here to configure providers and API keys.",
        render: () => {},
      };
      items.push(warn);
      return;
    }

    const providers: ProviderConfig[] = readProviders();
    const creds: Record<string, string> = readCredentials();

    if (providers.length === 0) {
      const empty: SettingDefinitionRender = {
        name: "No providers configured",
        desc: "Add a custom provider below or import from other agents.",
        render: () => {},
      };
      items.push(empty);
    }

    for (const provider of providers) {
      const providerCopy: ProviderConfig = provider;
      const apiKey: string = creds[provider.apiKeyEnv] ?? "";
      const maskedKey: string = apiKey ? maskApiKey(apiKey) : "Not set";

      const row: SettingDefinitionRender = {
        name: providerCopy.displayName || providerCopy.name,
        desc: `${providerCopy.api} | ${providerCopy.baseURL} | Key: ${maskedKey} | ${providerCopy.models.length} model(s)`,
        render: (setting: Setting) => {
          setting.addExtraButton((btn: ExtraButtonComponent) =>
            btn.setIcon("eye").setTooltip("Set API key").onClick(() => {
              void this.promptApiKey(providerCopy);
            })
          );
          setting.addExtraButton((btn: ExtraButtonComponent) =>
            btn.setIcon("trash").setTooltip("Remove provider").onClick(() => {
              removeProvider(providerCopy.name);
              new Notice(`Removed provider: ${providerCopy.name}`);
              this.update();
            })
          );
        },
      };
      items.push(row);
    }

    let newName = "";
    let newBaseURL = "";
    let newApiKey = "";
    let newModelId = "";
    const addProviderRow: SettingDefinitionRender = {
      name: "Add custom provider",
      desc: "Fill all fields then click Add. The provider is written to dsh config immediately.",
      render: (setting: Setting) => {
        setting.addText((text: TextComponent) => {
          text.setPlaceholder("Provider name (e.g. openai)").onChange((val: string) => {
            newName = val.trim();
          });
        });
        setting.addText((text: TextComponent) => {
          text.setPlaceholder("Base URL (e.g. https://api.openai.com/v1)").onChange((val: string) => {
            newBaseURL = val.trim();
          });
        });
        setting.addText((text: TextComponent) => {
          text.setPlaceholder("Model ID (e.g. gpt-4o)").onChange((val: string) => {
            newModelId = val.trim();
          });
        });
        setting.addText((text: TextComponent) => {
          text.setPlaceholder("API Key").onChange((val: string) => {
            newApiKey = val.trim();
          });
        });
        setting.addButton((btn: ButtonComponent) =>
          btn.setButtonText("Add").setCta().onClick(() => {
            if (!newName || !newBaseURL || !newApiKey || !newModelId) {
              new Notice("Fill all fields: name, baseURL, model ID, API key");
              return;
            }
            const apiKeyEnv: string = generateApiKeyEnv(newName);
            const provider: ProviderConfig = {
              name: newName,
              displayName: newName,
              apiKeyEnv,
              api: "openai-completions",
              baseURL: newBaseURL,
              defaultContextWindow: 100000,
              defaultMaxTokens: 16384,
              models: [{ id: newModelId, name: newModelId }],
            };
            addProvider(provider, newApiKey);
            new Notice(`Added provider: ${newName}`);
            newName = "";
            newBaseURL = "";
            newApiKey = "";
            newModelId = "";
            this.update();
          })
        );
      },
    };
    items.push(addProviderRow);
  }

  private buildAgentImportSection(items: SettingDefinitionItem[]): void {
    const heading: SettingDefinitionGroup = {
      type: "group",
      heading: "Import from other agents",
      items: [],
    };
    items.push(heading);

    const desc: SettingDefinitionRender = {
      name: "",
      desc: "Detect locally installed coding agents (opencode, pi, prime-agent) and import their provider configurations and API keys into dsh.",
      render: () => {},
    };
    items.push(desc);

    const detectRow: SettingDefinitionRender = {
      name: "Detect installed agents",
      desc: "Scans PATH for opencode, pi, and prime-agent CLIs.",
      render: (setting: Setting) => {
        setting.addButton((btn: ButtonComponent) =>
          btn.setButtonText("Detect").onClick(() => {
            this.detectedAgents = detectAgents();
            if (this.detectedAgents.length === 0) {
              new Notice("No agents detected. Install opencode, pi, or prime-agent.");
            } else {
              new Notice(`Detected: ${this.detectedAgents.join(", ")}`);
            }
            this.update();
          })
        );
      },
    };
    items.push(detectRow);

    for (const agentName of this.detectedAgents) {
      const agentCopy: string = agentName;
      const row: SettingDefinitionRender = {
        name: agentCopy,
        desc: `Import all providers from ${agentCopy}'s config file.`,
        render: (setting: Setting) => {
          setting.addButton((btn: ButtonComponent) =>
            btn.setButtonText("Import").onClick(() => {
              void this.runImport(agentCopy, btn);
            })
          );
        },
      };
      items.push(row);
    }
  }

  private async promptApiKey(provider: ProviderConfig): Promise<void> {
    const existing: string | null = getCredential(provider.apiKeyEnv);
    const current: string = existing ?? "";
    const masked: string = current ? maskApiKey(current) : "";

    const input: HTMLInputElement = document.createElement("input");
    input.type = "password";
    input.value = current;
    input.placeholder = `Enter API key for ${provider.name} (currently: ${masked || "not set"})`;
    input.style.width = "300px";

    const container: HTMLDivElement = document.createElement("div");
    container.style.padding = "1rem";
    container.appendChild(input);

    const btnRow: HTMLDivElement = document.createElement("div");
    btnRow.style.marginTop = "0.5rem";
    btnRow.style.display = "flex";
    btnRow.style.gap = "0.5rem";

    const saveBtn: HTMLButtonElement = document.createElement("button");
    saveBtn.textContent = "Save";
    saveBtn.className = "mod-cta";

    const cancelBtn: HTMLButtonElement = document.createElement("button");
    cancelBtn.textContent = "Cancel";

    btnRow.appendChild(saveBtn);
    btnRow.appendChild(cancelBtn);
    container.appendChild(btnRow);

    const modal: HTMLElement = document.createElement("div");
    modal.className = "modal-container";
    modal.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;";
    modal.appendChild(container);

    const overlay: HTMLElement = document.body.appendChild(modal);

    const close = (): void => { overlay.remove(); };
    cancelBtn.addEventListener("click", close);
    saveBtn.addEventListener("click", () => {
      const val: string = input.value.trim();
      if (!val) {
        new Notice("Enter a key or Cancel");
        return;
      }
      setCredential(provider.apiKeyEnv, val);
      new Notice(`API key set for ${provider.name}`);
      close();
      this.update();
    });
  }

  private async runImport(agentName: string, btn: ButtonComponent): Promise<void> {
    btn.setButtonText("Importing...").setDisabled(true);
    try {
      const imported: ImportedProvider[] = importFromAgent(agentName);
      if (imported.length === 0) {
        new Notice(`No providers found in ${agentName}`);
        return;
      }

      const existingProviders: ProviderConfig[] = readProviders();
      const existingNames: string[] = existingProviders.map((p: ProviderConfig) => p.name);
      let added = 0;
      let skipped = 0;

      for (const imp of imported) {
        if (existingNames.includes(imp.name)) {
          skipped++;
          continue;
        }
        const apiKeyEnv: string = generateApiKeyEnv(imp.name);
        const provider: ProviderConfig = {
          name: imp.name,
          displayName: imp.displayName,
          apiKeyEnv,
          api: imp.api || "openai-completions",
          baseURL: imp.baseURL,
          defaultContextWindow: 100000,
          defaultMaxTokens: 16384,
          models: imp.models.map((m: ProviderModel) => ({
            id: m.id,
            name: m.name,
            contextWindow: m.contextWindow,
            maxTokens: m.maxTokens,
          })),
        };
        addProvider(provider, imp.apiKey);
        existingNames.push(imp.name);
        added++;
      }

      if (added > 0) {
        new Notice(`Imported ${added} provider(s) from ${agentName}${skipped > 0 ? `, ${skipped} skipped (already exists)` : ""}`);
        this.update();
      } else {
        new Notice(`All ${skipped} provider(s) already exist in dsh config`);
      }
    } catch (err: unknown) {
      new Notice(`Import failed: ${(err as Error).message}`);
    } finally {
      btn.setButtonText("Import").setDisabled(false);
    }
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
