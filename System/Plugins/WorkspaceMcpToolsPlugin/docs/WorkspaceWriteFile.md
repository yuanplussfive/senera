# WorkspaceWriteFile

## Summary

通过 MCP filesystem server 创建或覆盖一个工作区文本文件。常规文件变更优先使用 WorkspaceApplyPatch。

## When To Use

需要写入完整文件内容，或者明确要用新内容覆盖目标文件时使用。

## Avoid

不要用于小范围修改已有文件。新增、修改、删除、移动文件优先使用 WorkspaceApplyPatch。
