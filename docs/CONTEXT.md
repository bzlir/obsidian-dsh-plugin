# Obsidian DSH Plugin

将 DeepSeek Harness (dsh) 嵌入 Obsidian，让用户在 Vault 内直接面对 dsh 的对话界面；dsh 能读写 Vault 文件，并在 Vault 内维护 agent 工作记忆。

## Language

### 宿主与嵌入

**Vault**:
Obsidian 的本地知识库容器，是本插件的工作目录与隔离边界。
_Avoid_: workspace, repo, knowledge base

**Plugin**:
本 Obsidian 插件自身——宿主 dsh 子进程、注册 DSH View、管理生命周期与配置。
_Avoid_: extension, add-on

**Bundle**:
dsh 的扩展包，通过 DSH Profile Root 装配进某个 profile。Plugin 不是 Bundle，二者运行在不同宿主里。
_Avoid_: dsh plugin, plugin（指 dsh 侧时）

**DSH Profile Root**:
dsh 的 profile 配置根目录 `~/.dsh/profiles/<name>/`，包含 cordis.yml 与已装配的 Bundle。
_Avoid_: workspace, dsh config

**DSH Session**:
dsh 的一次对话上下文，持久化在 `~/.dsh/sessions/`，作用域绑定到单个 Vault，不跨 Vault 共享。一个 DSH View 活跃期间可切换多个 DSH Session（1:N）；Session 切换是 dsh web UI 内部行为，Plugin 不感知。
_Avoid_: conversation, chat（作为领域名词时）

**DSH View**:
Obsidian 内承载 dsh Web UI 的专用视图，一个 Vault 同时只有一个 DSH View 活跃。DSH View 是 dsh 子进程的宿主窗口——View 打开启动进程，View 关闭杀进程；进程不绑定 Session，切 Session 不重启进程。
_Avoid_: panel, tab, window

### Agent 记忆（v1.1+，已定方向）

**Agent Charter**:
Vault 根的 `AGENTS.md`，定义 dsh agent 在该 Vault 内的全部行为准则——文件读写边界、安全约束、Memory 系统规则等。dsh 子进程 cwd 设为 Vault 根后自动读取。范围大于 Memory，Memory Charter 是其中的一个章节。
_Avoid_: rules, config, system prompt（它是文件而非 prompt 片段）

**Memory Charter**:
Agent Charter 中专门治理 Memory 的章节，定义何时记、记什么、如何记的原则；具体判断由 agent 自主完成，不依赖外部事件触发。
_Avoid_: rules, config

**Memory**:
dsh agent 在 Vault 内维护的持久工作记忆，存放于可配置的 Memory Directory（默认 `dsh-memory/`）。Memory 是 agent 自主读写的普通 Vault 笔记，进搜索与图谱，接受人工手动编辑造成的污染（人机共写）。
_Avoid_: notes, cache, log, isolated files

**Observation**:
agent 对 Vault 当前状态的被动观察记录，追加写入 `OBSERVATIONS.md`。由独立的 Headless Task 执行——观察者与被观察对象（正在修改 Vault 的主 dsh agent）解耦。触发时机：每天首次打开 DSH View。
_Avoid_: snapshot, summary

**Working Log**:
agent 对 Vault 结构性变更与教训的主动记录，追加写入 `WORKING.md`。由主 dsh agent 自己写入——只有干活的人知道"为什么这么做、学到什么"，外部进程只能从 git diff 反推，丢语义。触发时机与颗粒度由 Memory Charter 定义，agent 自主判断。
_Avoid_: changelog, diary, journal

**Headless Task**:
Plugin 在后台 spawn 的 `dsh --profile headless` 子进程，仅用于执行 Observation 的写入，不进入用户可见的 DSH View。
_Avoid_: background job, cron
