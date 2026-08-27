# DSH in Obsidian

English | [简体中文](./README.zh-CN.md)

Host [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) inside Obsidian — let the dsh agent read and write your Vault files, and maintain agent working memory directly inside the Vault.

## What it does

- Embeds the dsh web UI in a dedicated Obsidian side panel (DSH View).
- Spawns a `dsh web` subprocess bound to the current Vault's root directory.
- Automatically registers the Vault as a dsh workspace on every start.
- Reaps orphaned dsh processes from previous crashed sessions on launch.

## Prerequisites

- [Obsidian](https://obsidian.md/) 1.5.0 or later (desktop only).
- [Node.js](https://nodejs.org/) 22 or later (dsh requires `node:zlib.createZstdDecompress`).
- [dsh](https://github.com/deepseek-ai/deepseek-harness) installed globally:

  ```bash
  npm install -g @deepseek-ai/dsh
  ```

  The plugin scans nvm, Homebrew, Volta, and asdf bin directories to locate `dsh` and a compatible `node`, so it works even though Obsidian's bundled Electron ships an older Node.

## Installation

### From source (development)

```bash
git clone https://github.com/bzlir/obsidian-dsh-plugin.git
cd obsidian-dsh-plugin
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` into your Vault's `.obsidian/plugins/dsh-in-obsidian/` directory.

> **Tip**: This repo ships helper scripts (`scripts/install.sh`, `scripts/rollback.sh`, `scripts/uninstall.sh`) that automate building, installing with rollback support, and cleanup. Run `bash scripts/install.sh` after `npm install`.

### Enable in Obsidian

1. Open **Settings → Community plugins**.
2. Turn on **Community plugins** (if Safe Mode is on).
3. Find **DSH in Obsidian** under *Installed plugins* and toggle it on.

## Usage

- Click the **robot icon** in the left ribbon, or run **"Open DSH"** from the command palette (`Cmd+P`).
- The DSH View opens in the right sidebar. The first launch may take a few seconds while dsh boots its internal plugin tree and the API becomes ready.
- Closing the DSH View stops the dsh subprocess. Reopening spawns a fresh one.

## How it works

1. **Process resolution**: Scans common `node`/`dsh` install locations (nvm, Homebrew, Volta, asdf) to find a Node ≥ 22 and the dsh CLI, bypassing Obsidian's bundled Electron Node.
2. **Boot readiness**: Waits in two phases — first for the TCP port to open, then for `POST /api/session.list` to return a valid RPC response — so the iframe loads only after the dsh API gateway is live.
3. **Workspace registration**: Calls `POST /api/workspace.create` with the Vault path so dsh treats the Vault as its working directory.
4. **Lifecycle**: On DSH View close or plugin unload, kills the dsh process tree (children first, root last). On the next Obsidian launch, any orphaned dsh processes from a crashed previous session are reaped before spawning a new one.

## Configuration

No plugin settings yet. dsh configuration lives in `~/.dsh/` — see the [dsh documentation](https://github.com/deepseek-ai/deepseek-harness) for profile and credential setup.

## License

[Apache-2.0](./LICENSE)
