# DSH Embedded

English | [简体中文](./README.zh-CN.md)

Host [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) inside Obsidian — let the dsh agent read and write your Vault files, and maintain agent working memory directly inside the Vault.

## What it does

- Embeds the dsh web UI in a dedicated Obsidian side panel (DSH View).
- Spawns a `dsh web` subprocess bound to the current Vault's root directory.
- Automatically registers the Vault as a dsh workspace on every start.
- Reaps orphaned dsh processes from previous crashed sessions on launch.

## Prerequisites

- [Obsidian](https://obsidian.md/) 1.8.0 or later (desktop only).
- [Node.js](https://nodejs.org/) 22 or later (dsh requires `node:zlib.createZstdDecompress`).
- [dsh](https://github.com/deepseek-ai/deepseek-harness) installed globally:

  ```bash
  npm install -g @deepseek-ai/dsh
  ```

  The plugin scans nvm, Homebrew, Volta, asdf, fnm, `~/.local/bin`, and `~/bin` directories to locate `dsh` and a compatible `node`, so it works even though Obsidian's bundled Electron ships an older Node. You can also add custom paths in the settings panel or use the **Search for dsh** button to auto-detect.

## Installation

### From source (development)

```bash
git clone https://github.com/bzlir/obsidian-dsh-plugin.git
cd obsidian-dsh-plugin
npm install
npm run build
```

Then copy `main.js`, `manifest.json`, and `styles.css` into your Vault's `.obsidian/plugins/dsh-embedded/` directory.

> **Tip**: This repo ships helper scripts (`scripts/install.sh`, `scripts/rollback.sh`, `scripts/uninstall.sh`) that automate building, installing with rollback support, and cleanup. Run `bash scripts/install.sh` after `npm install`.

### Enable in Obsidian

1. Open **Settings → Community plugins**.
2. Turn on **Community plugins** (if Safe Mode is on).
3. Find **DSH Embedded** under *Installed plugins* and toggle it on.

## Usage

- Click the **dsh logo icon** in the left ribbon, or run **"Open DSH"** from the command palette (`Cmd+P`).
- The DSH View opens in the right sidebar. The first launch may take a few seconds while dsh boots its internal plugin tree and the API becomes ready.
- Closing the DSH View stops the dsh subprocess. Reopening spawns a fresh one.

## How it works

1. **Process resolution**: Scans common `node`/`dsh` install locations (nvm, Homebrew, Volta, asdf, fnm, `~/.local/bin`, `~/bin`, plus any user-added custom paths) to find a Node ≥ 22 and the dsh CLI, bypassing Obsidian's bundled Electron Node.
2. **Boot readiness**: Waits in two phases — first for the TCP port to open, then for `POST /api/session.list` to return a valid RPC response — so the iframe loads only after the dsh API gateway is live.
3. **Workspace registration**: Calls `POST /api/workspace.create` with the Vault path so dsh treats the Vault as its working directory.
4. **Lifecycle**: On DSH View close or plugin unload, kills the dsh process tree (children first, root last). On the next Obsidian launch, any orphaned dsh processes from a crashed previous session are reaped before spawning a new one.

## Configuration

The plugin has a settings panel (**Settings → DSH Embedded**) where you can add custom search paths for the `dsh` binary, or click **Search for dsh** to automatically scan your machine.

dsh configuration lives in `~/.dsh/` — see the [dsh documentation](https://github.com/deepseek-ai/deepseek-harness) for profile and credential setup.

## Privacy & network use

This plugin spawns a local `dsh web` subprocess and embeds its UI via an iframe. The following disclosures apply per the [Obsidian developer policies](https://docs.obsidian.md/community-directory/developer-policies):

- **Network use**: The plugin starts a `dsh web` HTTP server on `127.0.0.1` (loopback only). The dsh subprocess itself may make outbound network calls to LLM provider APIs (e.g. DeepSeek, NIO, OpenAI-compatible endpoints) as configured in `~/.dsh/`. The plugin does not make any network requests directly.
- **Files outside the Vault**: To locate the `dsh` and `node` binaries, the plugin reads the following locations outside the Vault:
  - `~/.nvm/`, `~/.volta/`, `~/.asdf/`, `~/.fnm/`, `~/.local/bin/`, `~/bin/`
  - `/opt/homebrew/bin`, `/usr/local/bin`
  - Any user-added custom paths from the settings panel
  - When **Search for dsh** is used: macOS Spotlight index (`mdfind`) or a bounded `find` over common install roots

  The plugin also reads `~/.dsh/.credentials.yaml` indirectly (dsh reads its own credentials file at startup). The plugin itself does not read, modify, or transmit credential files.
- **No telemetry**: The plugin collects no data and sends no analytics.

## License

[Apache-2.0](./LICENSE)
