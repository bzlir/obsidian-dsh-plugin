# Working Log 由主 agent 自主写入

## 背景

Working Log 记录 dsh agent 对 Vault 的结构性变更与教训。写入者有两种选择：主 dsh agent 在工作过程中自主追加，或 Plugin 在 session 结束时 spawn headless 子进程从 git diff 反推重建。

## 决策

Working Log 由主 dsh agent 遵循 Agent Charter（Vault 根 `AGENTS.md` 中的 Memory Charter 章节）自主写入。Plugin 不监听 session 结束事件，不 spawn headless 做 Working Log 重建。Charter 只写原则，不规定颗粒度、不加任何硬约束（如"每 Session 一条"或"切换 Session 前收尾"），写入时机与记录边界完全由 agent 自主判断。

## 理由

只有干活的 agent 知道"为什么这么做、学到什么"。外部 headless 进程只能从 git diff 反推变更内容，丢失决策动机与教训语义——而教训正是 Working Log 的核心价值。颗粒度也是语义判断：一次小修改不值得记、一次跨 Session 的重构值得合并记，只有 agent 能区分。强加结构化约束会把"原则驱动"退化为"事件驱动"，丢掉这个核心优势。代价是完全不可控，但这是 prompt 工程问题，不是架构问题。

## 后果

Plugin 的事件层因此简化——无需为 Working Log 维护 session 结束检测或 debounce 逻辑。Headless Task 的职责收窄到仅 Observation（被动观察由独立 observer 执行，与被观察对象解耦）。
