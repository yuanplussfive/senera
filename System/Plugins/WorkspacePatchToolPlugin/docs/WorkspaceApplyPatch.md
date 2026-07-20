# WorkspaceApplyPatch

## 简述

对工作区执行 Codex-like 高层文件补丁：新增文件、局部 hunk 修改、整文件替换、删除、移动以及目录操作。

## 何时使用

需要写代码、修改配置、创建新文件、删除文件或重命名文件时优先使用。局部修改使用 `update.patch`；大范围重写使用 `replace.content`，不要伪造巨大 hunk。

## 输入要点

`operations` 是一个逻辑补丁内的操作列表。`update` 和 `move.patch` 只写 `@@ ... @@` hunk，不要包含 `diff --git`、`---`、`+++` 文件头。同一文件多个 hunk 合并进同一个 `patch`。

先读取目标文件，再生成补丁。读取工具提供 SHA-256 时，将其传入 `expectedSha256`；运行时还会在写盘前自动复核文件状态，发现并发修改就拒绝提交。新文件用 `add`。

## 注意

目标路径必须在工作区内。`add` 不覆盖已有文件，`move` 不覆盖目标文件，`deleteDirectory` 默认只删除空目录。复杂或高风险修改可以先设置 `dryRun=true`。
