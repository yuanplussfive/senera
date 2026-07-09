# WorkspaceEditFile

## Summary

通过 MCP filesystem server 对工作区文件执行局部文本编辑，并返回 diff。

## When To Use

仅在需要直接调用 MCP filesystem 的精确文本替换时使用。代码修改、创建、删除、移动文件优先使用 WorkspaceApplyPatch。

## Avoid

不要在没读取文件内容时猜 `oldText`。不要把它作为常规代码编辑首选；常规工作区变更使用 WorkspaceApplyPatch。
