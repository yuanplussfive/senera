# WorkspaceApplyPatch

## 简述

对工作区执行 Codex-like 高层文件补丁：新增文件、用 unified hunk 修改文件、删除文件、移动文件、创建目录、删除目录。

## 何时使用

需要写代码、修改配置、创建新文件、删除文件或重命名文件时优先使用。局部修改使用 `update.patch`，不要生成 `oldText/newText` 替换。

## 输入要点

`operations` 是一个逻辑补丁内的操作列表。`update` 和 `move.patch` 只写 `@@ ... @@` hunk，不要包含 `diff --git`、`---`、`+++` 文件头。同一文件多个 hunk 合并进同一个 `patch`。

先读取目标文件，再生成 hunk patch。大范围重写已有文件也应通过 `update` 表达；新文件用 `add`。

## 注意

目标路径必须在工作区内。`add` 不覆盖已有文件，`move` 不覆盖目标文件，`deleteDirectory` 默认只删除空目录。复杂或高风险修改可以先设置 `dryRun=true`。
