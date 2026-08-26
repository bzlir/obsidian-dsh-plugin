# 每 Vault 独立 dsh 进程

## 背景

Plugin 需要决定 dsh 子进程的粒度：一个全局进程服务所有 Vault，还是每个 Vault 起一个独立进程。

## 决策

每个 Vault 启动一个独立的 dsh 子进程，不跨 Vault 共享进程或 DSH Session。

## 理由

每个 Vault 视作独立的记忆区。若用一个 session for all vaults，多个 Vault 的记忆会相互污染——工作 Vault 的 SQL 查询上下文混进个人 Vault 的日记，模型容易串味。隔离的代价是多 Vault 并存时多份进程内存，但记忆隔离是不可妥协的语义边界。
