import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const _existsSync = existsSync as unknown as (path: string) => boolean;
const _readFileSync = readFileSync as unknown as (path: string, encoding: string) => string;
const _writeFileSync = writeFileSync as unknown as (path: string, data: string) => void;
const _join = join as unknown as (...paths: string[]) => string;
const _homedir = homedir as unknown as () => string;

const DSH_HOME = _join(_homedir(), ".dsh");
const CREDENTIALS_PATH = _join(DSH_HOME, ".credentials.yaml");
const PATCH_PATH = _join(DSH_HOME, "profiles", "web", "cordis.patch.yml");

export interface ProviderModel {
  id: string;
  name: string;
  contextWindow?: number;
  maxTokens?: number;
}

export interface ProviderConfig {
  name: string;
  displayName: string;
  apiKeyEnv: string;
  api: string;
  baseURL: string;
  defaultContextWindow?: number;
  defaultMaxTokens?: number;
  models: ProviderModel[];
}

export interface ImportedProvider {
  name: string;
  displayName: string;
  baseURL: string;
  apiKey: string;
  api: string;
  models: ProviderModel[];
  source: string;
}

export interface CredentialEntry {
  envName: string;
  value: string;
}

export function isDshConfigured(): boolean {
  return _existsSync(DSH_HOME) && _existsSync(CREDENTIALS_PATH);
}

export function readCredentials(): Record<string, string> {
  if (!_existsSync(CREDENTIALS_PATH)) return {};
  const content: string = _readFileSync(CREDENTIALS_PATH, "utf-8");
  const result: Record<string, string> = {};
  const lines: string[] = content.split("\n");
  let inRefs = false;
  for (const line of lines) {
    const trimmed: string = line.trim();
    if (trimmed === "refs:") { inRefs = true; continue; }
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (inRefs && line.startsWith("{2}") && !line.startsWith("{4}")) {
      const colonIdx: number = trimmed.indexOf(":");
      if (colonIdx > 0) {
        const key: string = trimmed.substring(0, colonIdx).trim();
        const val: string = trimmed.substring(colonIdx + 1).trim();
        if (key && val) result[key] = val;
      }
    }
  }
  return result;
}

export function writeCredentials(creds: Record<string, string>): void {
  const lines: string[] = ["version: 1", "refs:"];
  for (const [key, val] of Object.entries(creds)) {
    lines.push(`  ${key}: ${val}`);
  }
  _writeFileSync(CREDENTIALS_PATH, lines.join("\n") + "\n");
}

export function setCredential(envName: string, apiKey: string): void {
  const creds: Record<string, string> = readCredentials();
  creds[envName] = apiKey;
  writeCredentials(creds);
}

export function getCredential(envName: string): string | null {
  const creds: Record<string, string> = readCredentials();
  return creds[envName] ?? null;
}

function parseYamlProviders(content: string): ProviderConfig[] {
  const providers: ProviderConfig[] = [];
  const lines: string[] = content.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line: string = lines[i];
    if (line.startsWith("- id: llm-pi-ai")) {
      i++;
      if (i < lines.length && lines[i].includes("config:")) i++;
      if (i < lines.length && lines[i].includes("providers:")) i++;
      while (i < lines.length) {
        const providerLine: string = lines[i];
        if (providerLine.startsWith("{8}") && !providerLine.startsWith("{10}") && providerLine.trim() && !providerLine.trim().startsWith("#") && providerLine.trim().endsWith(":") && !providerLine.includes("models:")) {
          const providerName: string = providerLine.trim().replace(":", "");
          const provider: ProviderConfig = {
            name: providerName,
            displayName: "",
            apiKeyEnv: "",
            api: "",
            baseURL: "",
            models: [],
          };
          i++;
          while (i < lines.length) {
            const fieldLine: string = lines[i];
            if (fieldLine.startsWith("{8}") && !fieldLine.startsWith("{10}") && fieldLine.trim() && !fieldLine.trim().startsWith("#")) {
              const fieldMatch: RegExpMatchArray | null = /^ {10}(\w+):\s*(.*)$/.exec(fieldLine);
              if (fieldMatch) {
                const fieldName: string = fieldMatch[1];
                const fieldValue: string = fieldMatch[2];
                if (fieldName === "displayName") provider.displayName = fieldValue;
                else if (fieldName === "apiKeyEnv") provider.apiKeyEnv = fieldValue;
                else if (fieldName === "api") provider.api = fieldValue;
                else if (fieldName === "baseURL") provider.baseURL = fieldValue;
                else if (fieldName === "defaultContextWindow") provider.defaultContextWindow = Number(fieldValue);
                else if (fieldName === "defaultMaxTokens") provider.defaultMaxTokens = Number(fieldValue);
              } else if (fieldLine.trim() === "models:") {
                i++;
                while (i < lines.length) {
                  const modelLine: string = lines[i];
                  if (modelLine.trim().startsWith("- id:")) {
                    const model: ProviderModel = { id: "", name: "" };
                    const modelId: string = modelLine.trim().replace("- id:", "").trim();
                    model.id = modelId;
                    i++;
                    while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith("- id:") && !lines[i].startsWith("{8}") && lines[i].startsWith("{12}")) {
                      const modelFieldMatch: RegExpMatchArray | null = /^ {12}(\w+):\s*(.*)$/.exec(lines[i]);
                      if (modelFieldMatch) {
                        const mField: string = modelFieldMatch[1];
                        const mVal: string = modelFieldMatch[2];
                        if (mField === "name") model.name = mVal;
                        else if (mField === "contextWindow") model.contextWindow = Number(mVal);
                        else if (mField === "maxTokens") model.maxTokens = Number(mVal);
                      }
                      i++;
                    }
                    provider.models.push(model);
                  } else {
                    break;
                  }
                }
                continue;
              }
              i++;
            } else {
              break;
            }
          }
          providers.push(provider);
        } else {
          i++;
          break;
        }
      }
    } else {
      i++;
    }
  }
  return providers;
}

export function readProviders(): ProviderConfig[] {
  if (!_existsSync(PATCH_PATH)) return [];
  const content: string = _readFileSync(PATCH_PATH, "utf-8");
  return parseYamlProviders(content);
}

export function writeProviders(providers: ProviderConfig[], defaultModel?: { provider: string; model: string }): void {
  const lines: string[] = ["# Generated by DSH Embedded plugin. User comments were lost on rewrite."];
  lines.push("");
  lines.push("- id: llm-pi-ai");
  lines.push("  config:");
  lines.push("    providers:");
  for (const provider of providers) {
    lines.push(`      ${provider.name}:`);
    lines.push(`        displayName: ${provider.displayName || provider.name}`);
    lines.push(`        apiKeyEnv: ${provider.apiKeyEnv}`);
    lines.push(`        api: ${provider.api || "openai-completions"}`);
    lines.push(`        baseURL: ${provider.baseURL}`);
    if (provider.defaultContextWindow) lines.push(`        defaultContextWindow: ${provider.defaultContextWindow}`);
    if (provider.defaultMaxTokens) lines.push(`        defaultMaxTokens: ${provider.defaultMaxTokens}`);
    if (provider.models.length > 0) {
      lines.push("        models:");
      for (const model of provider.models) {
        lines.push(`          - id: ${model.id}`);
        lines.push(`            name: ${model.name}`);
        if (model.contextWindow) lines.push(`            contextWindow: ${model.contextWindow}`);
        if (model.maxTokens) lines.push(`            maxTokens: ${model.maxTokens}`);
      }
    }
  }
  if (defaultModel) {
    lines.push("");
    lines.push("- id: agent-default-model");
    lines.push("  config:");
    lines.push(`    provider: ${defaultModel.provider}`);
    lines.push(`    model: ${defaultModel.model}`);
  }
  _writeFileSync(PATCH_PATH, lines.join("\n") + "\n");
}

export function addProvider(provider: ProviderConfig, apiKey: string): void {
  const existing: ProviderConfig[] = readProviders();
  const idx: number = existing.findIndex((p: ProviderConfig) => p.name === provider.name);
  if (idx >= 0) existing[idx] = provider;
  else existing.push(provider);
  writeProviders(existing);
  setCredential(provider.apiKeyEnv, apiKey);
}

export function removeProvider(providerName: string): void {
  const existing: ProviderConfig[] = readProviders();
  const filtered: ProviderConfig[] = existing.filter((p: ProviderConfig) => p.name !== providerName);
  writeProviders(filtered);
}

interface DetectedAgent {
  name: string;
  configPath: string;
  format: "opencode" | "pi";
}

function detectAgent(agentName: string): DetectedAgent | null {
  const home: string = _homedir();
  if (agentName === "opencode") {
    const configPath: string = _join(home, ".config", "opencode", "opencode.json");
    if (_existsSync(configPath)) return { name: "opencode", configPath, format: "opencode" };
  } else if (agentName === "pi") {
    const configPath: string = _join(home, ".pi", "agent", "models.json");
    if (_existsSync(configPath)) return { name: "pi", configPath, format: "pi" };
  } else if (agentName === "prime-agent") {
    const configPath: string = _join(home, ".prime", "agent", "models.json");
    if (_existsSync(configPath)) return { name: "prime-agent", configPath, format: "pi" };
  }
  return null;
}

export function detectAgents(): string[] {
  const agents: string[] = [];
  for (const name of ["opencode", "pi", "prime-agent"]) {
    if (detectAgent(name)) agents.push(name);
  }
  return agents;
}

function importFromOpencode(configPath: string): ImportedProvider[] {
  const content: string = _readFileSync(configPath, "utf-8");
  const data: Record<string, unknown> = JSON.parse(content) as Record<string, unknown>;
  const providerSection: Record<string, unknown> = (data["provider"] as Record<string, unknown>) ?? {};
  const providers: ImportedProvider[] = [];
  for (const [name, raw] of Object.entries(providerSection)) {
    const provider: Record<string, unknown> = raw as Record<string, unknown>;
    const options: Record<string, unknown> = (provider["options"] as Record<string, unknown>) ?? {};
    const apiKey: string = (options["apiKey"] as string) ?? "";
    const baseURL: string = (options["baseURL"] as string) ?? "";
    const models: ProviderModel[] = [];
    const modelsSection: Record<string, unknown> = (provider["models"] as Record<string, unknown>) ?? {};
    for (const [modelId, modelRaw] of Object.entries(modelsSection)) {
      const modelData: Record<string, unknown> = modelRaw as Record<string, unknown>;
      const limit: Record<string, unknown> = (modelData["limit"] as Record<string, unknown>) ?? {};
      models.push({
        id: modelId,
        name: (modelData["name"] as string) ?? modelId,
        contextWindow: (limit["context"] as number) ?? undefined,
        maxTokens: (limit["output"] as number) ?? undefined,
      });
    }
    providers.push({
      name,
      displayName: (provider["name"] as string) ?? name,
      baseURL,
      apiKey,
      api: "openai-completions",
      models,
      source: "opencode",
    });
  }
  return providers;
}

function importFromPi(configPath: string): ImportedProvider[] {
  const content: string = _readFileSync(configPath, "utf-8");
  const data: Record<string, unknown> = JSON.parse(content) as Record<string, unknown>;
  const providersSection: Record<string, unknown> = (data["providers"] as Record<string, unknown>) ?? {};
  const providers: ImportedProvider[] = [];
  for (const [name, raw] of Object.entries(providersSection)) {
    const provider: Record<string, unknown> = raw as Record<string, unknown>;
    const apiKey: string = (provider["apiKey"] as string) ?? "";
    const baseURL: string = (provider["baseUrl"] as string) ?? "";
    const api: string = (provider["api"] as string) ?? "openai-completions";
    const models: ProviderModel[] = [];
    const modelsArr: unknown[] = (provider["models"] as unknown[]) ?? [];
    for (const modelRaw of modelsArr) {
      const modelData: Record<string, unknown> = modelRaw as Record<string, unknown>;
      models.push({
        id: (modelData["id"] as string) ?? "",
        name: (modelData["name"] as string) ?? "",
        contextWindow: (modelData["contextWindow"] as number) ?? undefined,
        maxTokens: (modelData["maxTokens"] as number) ?? undefined,
      });
    }
    providers.push({
      name,
      displayName: (provider["name"] as string) ?? name,
      baseURL,
      apiKey,
      api,
      models,
      source: "pi",
    });
  }
  return providers;
}

export function importFromAgent(agentName: string): ImportedProvider[] {
  const agent: DetectedAgent | null = detectAgent(agentName);
  if (!agent) return [];
  if (agent.format === "opencode") return importFromOpencode(agent.configPath);
  if (agent.format === "pi") return importFromPi(agent.configPath);
  return [];
}

export function generateApiKeyEnv(providerName: string): string {
  return providerName.toUpperCase().replace(/[^A-Z0-9_]/g, "_") + "_API_KEY";
}

export function maskApiKey(key: string): string {
  if (key.length <= 8) return "****";
  return key.substring(0, 4) + "..." + key.substring(key.length - 4);
}
