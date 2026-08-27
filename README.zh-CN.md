# DSH in Obsidian

将 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) 嵌入 Obsidian —— 让 dsh agent 读写 Vault 文件，并在 Vault 内维护 agent 工作记忆。

[English](./README.md) | 简体中文

## 功能

- 在 Obsidian 侧边栏（DSH View）内嵌 dsh web UI。
- 启动 `dsh web` 子进程，工作目录绑定到当前 Vault 根目录。
- 每次启动时自动将当前 Vault 注册为 dsh 工作区。
- 打开 Obsidian 时自动清理上次崩溃遗留的孤儿 dsh 进程。

## 前置要求

- [Obsidian](https://obsidian.md/) 1.5.0 或更高版本（仅桌面端）。
- [Node.js](https://nodejs.org/) 22 或更高版本（dsh 需要 `node:zlib.createZstdDecompress`）。
- 全局安装 [dsh](https://github.com/deepseek-ai/deepseek-harness)：

  ```bash
  npm install -g @deepseek-ai/dsh
  ```

  插件会扫描 nvm、Homebrew、Volta、asdf 的 bin 目录来定位 `dsh` 和兼容的 `node`，因此即使 Obsidian 内置 Electron 自带的 Node 版本较旧也能正常工作。

## 安装

### 从源码构建（开发用途）

```bash
git clone https://github.com/bzlir/obsidian-dsh-plugin.git
cd obsidian-dsh-plugin
npm install
npm run build
```

然后将 `main.js`、`manifest.json`、`styles.css` 复制到 Vault 的 `.obsidian/plugins/dsh-in-obsidian/` 目录下。

> **提示**：本仓库附带辅助脚本（`scripts/install.sh`、`scripts/rollback.sh`、`scripts/uninstall.sh`），可自动完成构建、安装（支持回滚）和卸载。执行 `npm install` 后运行 `bash scripts/install.sh` 即可。

### 在 Obsidian 中启用

1. 打开 **设置 → 社区插件**。
2. 开启 **社区插件**（如果当前是安全模式）。
3. 在 *已安装插件* 中找到 **DSH in Obsidian**，打开开关。

## 使用

- 点击左侧栏的 **dsh 图标**，或在命令面板（`Cmd+P`）中执行 **"Open DSH"**。
- DSH View 在右侧栏打开。首次启动可能需要几秒钟，等待 dsh 内部插件树启动、API 就绪。
- 关闭 DSH View 会停止 dsh 子进程；重新打开会启动新的进程。

## 工作原理

1. **进程解析**：扫描常见的 `node`/`dsh` 安装路径（nvm、Homebrew、Volta、asdf），找到 Node ≥ 22 和 dsh CLI，绕过 Obsidian 内置 Electron 的旧版 Node。
2. **启动就绪检测**：分两阶段等待 —— 先等 TCP 端口开放，再等 `POST /api/session.list` 返回有效 RPC 响应 —— 确保 iframe 在 dsh API 网关就绪后才加载。
3. **工作区注册**：调用 `POST /api/workspace.create` 传入 Vault 路径，让 dsh 将 Vault 作为工作目录。
4. **生命周期管理**：关闭 DSH View 或卸载插件时，杀死 dsh 进程树（先子进程后根进程）。下次打开 Obsidian 时，先清理上次崩溃遗留的孤儿 dsh 进程，再启动新进程。

## 配置

插件暂无设置项。dsh 配置位于 `~/.dsh/`，请参考 [dsh 文档](https://github.com/deepseek-ai/deepseek-harness) 了解 profile 和凭据设置。

## 许可证

[Apache-2.0](./LICENSE)
