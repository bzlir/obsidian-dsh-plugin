# DSH Embedded

将 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 嵌入 Obsidian —— 让 dsh agent 读写 Vault 文件，并在 Vault 内维护 agent 工作记忆。

[English](./README.md) | 简体中文

## 功能

- 在 Obsidian 侧边栏（DSH View）内嵌 dsh web UI。
- 启动 `dsh web` 子进程，工作目录绑定到当前 Vault 根目录。
- 每次启动时自动将当前 Vault 注册为 dsh 工作区。
- 打开 Obsidian 时自动清理上次崩溃遗留的孤儿 dsh 进程。

## 前置要求

- [Obsidian](https://obsidian.md/) 1.7.0 或更高版本（仅桌面端）。
- [Node.js](https://nodejs.org/) 22 或更高版本（dsh 需要 `node:zlib.createZstdDecompress`）。
- 全局安装 [dsh](https://github.com/deepseek-ai/deepseek-harness)：

  ```bash
  npm install -g @deepseek-ai/dsh
  ```

  插件会扫描 nvm、Homebrew、Volta、asdf、fnm、`~/.local/bin`、`~/bin` 的 bin 目录来定位 `dsh` 和兼容的 `node`，因此即使 Obsidian 内置 Electron 自带的 Node 版本较旧也能正常工作。也可在设置面板中添加自定义路径，或使用 **Search for dsh** 按钮自动检测。

## 安装

### 从源码构建（开发用途）

```bash
git clone https://github.com/bzlir/obsidian-dsh-plugin.git
cd obsidian-dsh-plugin
npm install
npm run build
```

然后将 `main.js`、`manifest.json`、`styles.css` 复制到 Vault 的 `.obsidian/plugins/dsh-embedded/` 目录下。

> **提示**：本仓库附带辅助脚本（`scripts/install.sh`、`scripts/rollback.sh`、`scripts/uninstall.sh`），可自动完成构建、安装（支持回滚）和卸载。执行 `npm install` 后运行 `bash scripts/install.sh` 即可。

### 在 Obsidian 中启用

1. 打开 **设置 → 社区插件**。
2. 开启 **社区插件**（如果当前是安全模式）。
3. 在 *已安装插件* 中找到 **DSH Embedded**，打开开关。

## 使用

- 点击左侧栏的 **dsh 图标**，或在命令面板（`Cmd+P`）中执行 **"Open DSH"**。
- DSH View 在右侧栏打开。首次启动可能需要几秒钟，等待 dsh 内部插件树启动、API 就绪。
- 关闭 DSH View 会停止 dsh 子进程；重新打开会启动新的进程。

## 工作原理

1. **进程解析**：扫描常见的 `node`/`dsh` 安装路径（nvm、Homebrew、Volta、asdf、fnm、`~/.local/bin`、`~/bin`，以及设置面板中用户添加的自定义路径），找到 Node ≥ 22 和 dsh CLI，绕过 Obsidian 内置 Electron 的旧版 Node。
2. **启动就绪检测**：分两阶段等待 —— 先等 TCP 端口开放，再等 `POST /api/session.list` 返回有效 RPC 响应 —— 确保 iframe 在 dsh API 网关就绪后才加载。
3. **工作区注册**：调用 `POST /api/workspace.create` 传入 Vault 路径，让 dsh 将 Vault 作为工作目录。
4. **生命周期管理**：关闭 DSH View 或卸载插件时，杀死 dsh 进程树（先子进程后根进程）。下次打开 Obsidian 时，先清理上次崩溃遗留的孤儿 dsh 进程，再启动新进程。

## 配置

插件提供设置面板（**设置 → DSH Embedded**），可添加自定义 `dsh` 搜索路径，或点击 **Search for dsh** 自动扫描机器上的 dsh 二进制位置。

dsh 配置位于 `~/.dsh/`，请参考 [dsh 文档](https://github.com/deepseek-ai/deepseek-harness) 了解 profile 和凭据设置。

## 隐私与网络使用

本插件启动本地 `dsh web` 子进程并通过 iframe 嵌入其 UI。根据 [Obsidian 开发者政策](https://docs.obsidian.md/community-directory/developer-policies)，披露如下：

- **网络使用**：插件在 `127.0.0.1`（仅本地回环）启动 `dsh web` HTTP 服务器。dsh 子进程本身可能会向 LLM 服务商 API（如 DeepSeek、NIO、OpenAI 兼容端点）发起外部网络请求，具体由 `~/.dsh/` 中的配置决定。插件本身不直接发起任何网络请求。
- **访问 Vault 外文件**：为定位 `dsh` 和 `node` 二进制，插件会读取以下 Vault 外路径：
  - `~/.nvm/`、`~/.volta/`、`~/.asdf/`、`~/.fnm/`、`~/.local/bin/`、`~/bin/`
  - `/opt/homebrew/bin`、`/usr/local/bin`
  - 设置面板中用户添加的自定义路径
  - 使用 **Search for dsh** 时：macOS Spotlight 索引（`mdfind`）或对常见安装根目录的有界 `find` 搜索

  插件间接依赖 dsh 读取 `~/.dsh/.credentials.yaml`（dsh 启动时读取自己的凭据文件）。插件本身不读取、修改或传输凭据文件。
- **无遥测**：插件不收集任何数据，不发送任何分析信息。

## 许可证

[Apache-2.0](./LICENSE)
